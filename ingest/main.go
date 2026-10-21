package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type LogEvent struct {
	EventID    string                 `json:"event_id"`
	Timestamp  string                 `json:"timestamp"`
	Project    string                 `json:"project"`
	MCPServer  string                 `json:"mcp_server,omitempty"`
	Tool       string                 `json:"tool,omitempty"`
	ClientID   string                 `json:"client_id,omitempty"`
	Status     string                 `json:"status"`
	LatencyMs  float64                `json:"latency_ms"`
	BytesIn    int64                  `json:"bytes_in"`
	BytesOut   int64                  `json:"bytes_out"`
	TraceID    string                 `json:"trace_id,omitempty"`
	Error      string                 `json:"error,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type IngestServer struct {
	redisClient   *redis.Client
	pgPool        *pgxpool.Pool
	clickhouseURL string
	logger        *slog.Logger
	maxBodySize   int64
	httpClient    *http.Client
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	logger.Info("starting AI Ingest Service (Headless)...", "service", "ingest")

	port := os.Getenv("INGEST_PORT")
	if port == "" {
		port = "8082"
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://gateway:gateway@localhost:5432/gateway_dev?sslmode=disable"
	}

	clickhouseURL := os.Getenv("CLICKHOUSE_URL")
	if clickhouseURL == "" {
		clickhouseURL = "http://localhost:8123"
	}

	// 1. Initialize Redis Client
	rdb := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})

	initCtx, initCancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := rdb.Ping(initCtx).Err(); err != nil {
		logger.Warn("redis connection not ready at startup, will reconnect", "redis_addr", redisAddr, "error", err)
	} else {
		logger.Info("connected to redis stream queue", "redis_addr", redisAddr)
	}
	initCancel()

	// 2. Initialize Postgres Connection Pool
	var pgPool *pgxpool.Pool
	pgConfig, err := pgxpool.ParseConfig(dbURL)
	if err == nil {
		pgConfig.MaxConns = 15
		pgConfig.MinConns = 2
		pgConfig.MaxConnLifetime = 30 * time.Minute
		pgPool, err = pgxpool.NewWithConfig(context.Background(), pgConfig)
		if err != nil {
			logger.Warn("failed to initialize postgres pool", "error", err)
		} else {
			testCtx, testCancel := context.WithTimeout(context.Background(), 2*time.Second)
			if err := pgPool.Ping(testCtx); err != nil {
				logger.Warn("postgres ping failed at startup, will retry in background", "error", err)
			} else {
				logger.Info("connected to postgres log store")
			}
			testCancel()
		}
	} else {
		logger.Warn("failed to parse postgres database URL", "error", err)
	}

	server := &IngestServer{
		redisClient:   rdb,
		pgPool:        pgPool,
		clickhouseURL: clickhouseURL,
		logger:        logger,
		maxBodySize:   5242880, // 5MB payload limit
		httpClient:    &http.Client{Timeout: 3 * time.Second},
	}

	// 3. Start Background Redis Stream Consumers
	consumerCtx, consumerCancel := context.WithCancel(context.Background())
	go server.startLogQueueConsumer(consumerCtx)

	// 4. Setup Routes - STRICTLY NO READ/UI ROUTES
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.handleHealthz)
	mux.HandleFunc("GET /readyz", server.handleReadyz)
	mux.HandleFunc("POST /ingest/v1/logs", server.handleLogs)
	mux.HandleFunc("POST /ingest/v1/telemetry", server.handleTelemetry)

	// Catch-all handler rejecting all other routes and methods (no UI, no read endpoints)
	mux.HandleFunc("/", server.handleCatchAll)

	httpServer := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("ingest service listening", "port", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("ingest server crashed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down ingest service...")
	consumerCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
	}
	_ = rdb.Close()
	if pgPool != nil {
		pgPool.Close()
	}
	logger.Info("ingest service exited cleanly")
}

func (s *IngestServer) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok","service":"ingest"}`))
}

func (s *IngestServer) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
	defer cancel()

	if err := s.redisClient.Ping(ctx).Err(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"degraded","error":%q}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ready","queue":"redis-streams"}`))
}

func (s *IngestServer) handleCatchAll(w http.ResponseWriter, r *http.Request) {
	// Strictly no UI and no read endpoints
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_, _ = w.Write([]byte(`{"error":"Method Not Allowed: ingest service exposes no UI or read endpoints"}`))
		return
	}
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`{"error":"Not Found"}`))
}

func (s *IngestServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"payload too large or unreadable"}`, http.StatusRequestEntityTooLarge)
		return
	}

	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		http.Error(w, `{"error":"empty request body"}`, http.StatusBadRequest)
		return
	}

	var events []LogEvent

	if trimmed[0] == '[' {
		// Array of events
		if err := json.Unmarshal(trimmed, &events); err != nil {
			http.Error(w, `{"error":"invalid json event array"}`, http.StatusBadRequest)
			return
		}
	} else {
		// Single event or wrapped object
		var single LogEvent
		if err := json.Unmarshal(trimmed, &single); err == nil && (single.EventID != "" || single.Project != "") {
			events = []LogEvent{single}
		} else {
			var wrapper struct {
				Events []LogEvent `json:"events"`
			}
			if err2 := json.Unmarshal(trimmed, &wrapper); err2 == nil && len(wrapper.Events) > 0 {
				events = wrapper.Events
			} else {
				http.Error(w, `{"error":"invalid json event schema"}`, http.StatusBadRequest)
				return
			}
		}
	}

	if len(events) == 0 {
		http.Error(w, `{"error":"no valid events found"}`, http.StatusBadRequest)
		return
	}

	// Normalize events and prepare Redis Stream writes
	pipe := s.redisClient.Pipeline()
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	for i := range events {
		if events[i].EventID == "" {
			events[i].EventID = uuid.NewString()
		}
		if events[i].Timestamp == "" {
			events[i].Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
		}
		if events[i].Status == "" {
			events[i].Status = "200"
		}
		if events[i].Attributes == nil {
			events[i].Attributes = make(map[string]interface{})
		}

		rawEvent, _ := json.Marshal(events[i])
		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: "ai_gateway:events",
			Values: map[string]interface{}{
				"event_id": events[i].EventID,
				"project":  events[i].Project,
				"payload":  string(rawEvent),
			},
		})
	}

	_, err = pipe.Exec(ctx)
	if err != nil {
		s.logger.Warn("redis enqueue failed", "error", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "accepted",
		"count":  len(events),
	})
}

func (s *IngestServer) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"payload too large"}`, http.StatusRequestEntityTooLarge)
		return
	}

	eventID := uuid.NewString()
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	_ = s.redisClient.XAdd(ctx, &redis.XAddArgs{
		Stream: "ai_gateway:telemetry",
		Values: map[string]interface{}{
			"event_id": eventID,
			"payload":  string(body),
		},
	}).Err()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "accepted",
		"event_id": eventID,
	})
}

// startLogQueueConsumer drains the Redis Stream 'ai_gateway:events' into PostgreSQL and ClickHouse
func (s *IngestServer) startLogQueueConsumer(ctx context.Context) {
	streamKey := "ai_gateway:events"
	groupName := "ingest-workers"
	consumerName := fmt.Sprintf("worker-%s", uuid.NewString()[:8])

	// Create consumer group if not exists
	_ = s.redisClient.XGroupCreateMkStream(ctx, streamKey, groupName, "$").Err()

	s.logger.Info("started redis stream consumer", "stream", streamKey, "group", groupName, "consumer", consumerName)

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Info("stopping redis stream consumer")
			return
		case <-ticker.C:
			// Read new messages from group
			streams, err := s.redisClient.XReadGroup(ctx, &redis.XReadGroupArgs{
				Group:    groupName,
				Consumer: consumerName,
				Streams:  []string{streamKey, ">"},
				Count:    100,
				Block:    500 * time.Millisecond,
			}).Result()

			if err != nil {
				if err != redis.Nil && !strings.Contains(err.Error(), "context canceled") {
					// Log only occasionally on errors to avoid flooding
					time.Sleep(500 * time.Millisecond)
				}
				continue
			}

			for _, stream := range streams {
				if len(stream.Messages) == 0 {
					continue
				}

				var eventsToPersist []LogEvent
				var ackIDs []string

				for _, msg := range stream.Messages {
					ackIDs = append(ackIDs, msg.ID)
					payloadStr, ok := msg.Values["payload"].(string)
					if !ok {
						continue
					}

					var ev LogEvent
					if err := json.Unmarshal([]byte(payloadStr), &ev); err == nil {
						eventsToPersist = append(eventsToPersist, ev)
					}
				}

				if len(eventsToPersist) > 0 {
					s.persistEventsToStores(ctx, eventsToPersist)
				}

				if len(ackIDs) > 0 {
					_ = s.redisClient.XAck(ctx, streamKey, groupName, ackIDs...).Err()
				}
			}
		}
	}
}

// persistEventsToStores saves batch to PostgreSQL gateway_logs and ClickHouse
func (s *IngestServer) persistEventsToStores(ctx context.Context, events []LogEvent) {
	if len(events) == 0 {
		return
	}

	// 1. Persist to PostgreSQL gateway_logs
	if s.pgPool != nil {
		pCtx, pCancel := context.WithTimeout(ctx, 5*time.Second)
		defer pCancel()

		conn, err := s.pgPool.Acquire(pCtx)
		if err == nil {
			tx, err := conn.Begin(pCtx)
			if err == nil {
				stmt := `
					INSERT INTO gateway_logs (
						event_id, project, mcp_server, tool, client_id, status,
						latency_ms, bytes_in, bytes_out, trace_id, error, attributes, timestamp
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
					ON CONFLICT (event_id) DO NOTHING
				`
				for _, ev := range events {
					attrBytes, _ := json.Marshal(ev.Attributes)
					ts, parseErr := time.Parse(time.RFC3339Nano, ev.Timestamp)
					if parseErr != nil {
						ts, parseErr = time.Parse(time.RFC3339, ev.Timestamp)
						if parseErr != nil {
							ts = time.Now().UTC()
						}
					}

					_, _ = tx.Exec(pCtx, stmt,
						ev.EventID,
						ev.Project,
						ev.MCPServer,
						ev.Tool,
						ev.ClientID,
						ev.Status,
						ev.LatencyMs,
						ev.BytesIn,
						ev.BytesOut,
						ev.TraceID,
						ev.Error,
						string(attrBytes),
						ts,
					)
				}
				_ = tx.Commit(pCtx)
			}
			conn.Release()
		} else {
			s.logger.Warn("postgres acquire failed during event persistence", "error", err)
		}
	}

	// 2. Best-effort write to ClickHouse ai_gateway_logs via HTTP
	if s.clickhouseURL != "" {
		go func(evs []LogEvent) {
			var chRows bytes.Buffer
			for _, ev := range evs {
				attrBytes, _ := json.Marshal(ev.Attributes)
				ts, parseErr := time.Parse(time.RFC3339Nano, ev.Timestamp)
				if parseErr != nil {
					ts, parseErr = time.Parse(time.RFC3339, ev.Timestamp)
					if parseErr != nil {
						ts = time.Now().UTC()
					}
				}
				chTimestamp := ts.UTC().Format("2006-01-02 15:04:05.000")

				row := map[string]interface{}{
					"event_id":   ev.EventID,
					"timestamp":  chTimestamp,
					"project":    ev.Project,
					"mcp_server": ev.MCPServer,
					"tool":       ev.Tool,
					"client_id":  ev.ClientID,
					"status":     ev.Status,
					"latency_ms": ev.LatencyMs,
					"bytes_in":   ev.BytesIn,
					"bytes_out":  ev.BytesOut,
					"trace_id":   ev.TraceID,
					"error":      ev.Error,
					"attributes": string(attrBytes),
				}
				rowBytes, err := json.Marshal(row)
				if err == nil {
					chRows.Write(rowBytes)
					chRows.WriteByte('\n')
				}
			}

			if chRows.Len() > 0 {
				chReq, err := http.NewRequest("POST", s.clickhouseURL+"/?query=INSERT+INTO+ai_gateway_logs+FORMAT+JSONEachRow", &chRows)
				if err == nil {
					chReq.Header.Set("Content-Type", "application/json")
					resp, err := s.httpClient.Do(chReq)
					if err != nil {
						s.logger.Warn("clickhouse post failed", "error", err)
					} else {
						defer resp.Body.Close()
						if resp.StatusCode != http.StatusOK {
							chErrBody, _ := io.ReadAll(resp.Body)
							s.logger.Warn("clickhouse insert non-200", "status", resp.StatusCode, "body", string(chErrBody))
						} else {
							s.logger.Info("successfully wrote batch to clickhouse", "count", len(evs))
						}
					}
				}
			}
		}(events)
	}
}
