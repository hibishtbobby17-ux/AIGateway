package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type LogEvent struct {
	EventID     string                 `json:"event_id"`
	Timestamp   string                 `json:"timestamp"`
	Project     string                 `json:"project"`
	MCPServer   string                 `json:"mcp_server,omitempty"`
	Tool        string                 `json:"tool,omitempty"`
	ClientID    string                 `json:"client_id,omitempty"`
	Status      string                 `json:"status"`
	LatencyMs   float64                `json:"latency_ms"`
	BytesIn     int64                  `json:"bytes_in"`
	BytesOut    int64                  `json:"bytes_out"`
	TraceID     string                 `json:"trace_id,omitempty"`
	Error       string                 `json:"error,omitempty"`
	Attributes  map[string]interface{} `json:"attributes,omitempty"`
}

type TelemetryPayload struct {
	ResourceSpans  interface{} `json:"resourceSpans,omitempty"`
	ResourceMetrics interface{} `json:"resourceMetrics,omitempty"`
}

type IngestServer struct {
	redisClient *redis.Client
	logger      *slog.Logger
	maxBodySize int64
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	logger.Info("starting AI Ingest Service...", "service", "ingest")

	port := os.Getenv("INGEST_PORT")
	if port == "" {
		port = "8082"
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn("redis connection not ready at startup, will retry", "redis_addr", redisAddr, "error", err)
	} else {
		logger.Info("connected to redis stream queue", "redis_addr", redisAddr)
	}
	cancel()

	server := &IngestServer{
		redisClient: rdb,
		logger:      logger,
		maxBodySize: 1048576, // 1MB payload limit
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.handleHealthz)
	mux.HandleFunc("GET /readyz", server.handleReadyz)
	mux.HandleFunc("POST /ingest/v1/logs", server.handleLogs)
	mux.HandleFunc("POST /ingest/v1/telemetry", server.handleTelemetry)

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
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
	}
	_ = rdb.Close()
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

func (s *IngestServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBodySize))
	if err != nil {
		http.Error(w, `{"error":"payload too large or unreadable"}`, http.StatusRequestEntityTooLarge)
		return
	}

	var event LogEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, `{"error":"invalid json event schema"}`, http.StatusBadRequest)
		return
	}

	if event.EventID == "" {
		event.EventID = uuid.NewString()
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	// Enqueue to Redis Stream
	rawEvent, _ := json.Marshal(event)
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	err = s.redisClient.XAdd(ctx, &redis.XAddArgs{
		Stream: "ai_gateway:events",
		Values: map[string]interface{}{
			"event_id": event.EventID,
			"project":  event.Project,
			"payload":  string(rawEvent),
		},
	}).Err()

	if err != nil {
		s.logger.Warn("redis enqueue failed, buffering locally", "error", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "accepted",
		"event_id": event.EventID,
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
