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
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
)

type GatewayConfig struct {
	Version      int                 `json:"config_version"`
	Projects     map[string]Project  `json:"projects"`
	UpdatedAt    string              `json:"updated_at"`
}

type Project struct {
	ID        string      `json:"id"`
	Slug      string      `json:"slug"`
	Name      string      `json:"name"`
	Status    string      `json:"status"`
	Servers   []MCPServer `json:"servers,omitempty"`
}

type MCPServer struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	NamespacePrefix string `json:"namespace_prefix"`
	Transport       string `json:"transport"`
	URL             string `json:"url"`
	AuthType        string `json:"auth_type"`
	Enabled         bool   `json:"enabled"`
}

type Gateway struct {
	configPath   string
	consoleURL   string
	gatewaySecret string
	gatewayID    string
	ingestURL    string
	currentCfg   atomic.Pointer[GatewayConfig]
	logger       *slog.Logger
	httpClient   *http.Client
	mu           sync.RWMutex
	token        string
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	logger.Info("starting Headless AI Gateway (Data Plane)...", "component", "gateway")

	port := os.Getenv("GATEWAY_PORT")
	if port == "" {
		port = "8080"
	}

	consoleURL := os.Getenv("CONSOLE_URL")
	if consoleURL == "" {
		consoleURL = "http://console:3000"
	}

	gatewaySecret := os.Getenv("GATEWAY_SECRET")
	if gatewaySecret == "" {
		gatewaySecret = "dev-gateway-secret"
	}

	gatewayID := os.Getenv("GATEWAY_ID")
	if gatewayID == "" {
		gatewayID = "gateway-default-01"
	}

	ingestURL := os.Getenv("INGEST_URL")
	if ingestURL == "" {
		ingestURL = "http://ingest:8082"
	}

	configCachePath := os.Getenv("CONFIG_CACHE_PATH")
	if configCachePath == "" {
		configCachePath = "last_good_config.json"
	}

	gw := &Gateway{
		configPath:    configCachePath,
		consoleURL:    consoleURL,
		gatewaySecret: gatewaySecret,
		gatewayID:     gatewayID,
		ingestURL:     ingestURL,
		logger:        logger,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	// 1. Load last known good config from local disk (fail-static guarantee)
	gw.loadLocalConfig()

	// 2. Start background config synchronizer (pull / poll from Console)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go gw.startConfigPoller(ctx)

	// 3. Setup HTTP Server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", gw.handleHealthz)
	mux.HandleFunc("GET /readyz", gw.handleReadyz)
	mux.HandleFunc("POST /p/{slug}/mcp", gw.handleMCP)
	mux.HandleFunc("GET /p/{slug}/mcp", gw.handleMCP)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		logger.Info("headless gateway listening", "port", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("gateway server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down headless gateway...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("gateway forced shutdown", "error", err)
	}
	logger.Info("gateway terminated cleanly")
}

func (g *Gateway) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok","component":"gateway"}`))
}

func (g *Gateway) handleReadyz(w http.ResponseWriter, r *http.Request) {
	cfg := g.currentCfg.Load()
	if cfg == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"initializing","error":"no config loaded"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "ready",
		"config_version": cfg.Version,
		"projects_count": len(cfg.Projects),
	})
}

func (g *Gateway) handleMCP(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	cfg := g.currentCfg.Load()

	startTime := time.Now()
	eventID := uuid.NewString()

	if cfg == nil {
		http.Error(w, `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Gateway uninitialized"},"id":null}`, http.StatusServiceUnavailable)
		return
	}

	proj, exists := cfg.Projects[slug]
	if !exists {
		http.Error(w, fmt.Sprintf(`{"jsonrpc":"2.0","error":{"code":-32000,"message":"Project %q not found"},"id":null}`, slug), http.StatusNotFound)
		return
	}

	// Read client payload
	body, _ := io.ReadAll(r.Body)

	// Async log dispatch to Ingest
	go g.dispatchLog(eventID, slug, startTime, http.StatusOK, len(body))

	// Return mock MCP initialize or aggregated tools response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": "2.0",
		"result": map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{"listChanged": true},
			},
			"serverInfo": map[string]interface{}{
				"name":    fmt.Sprintf("AI Gateway Virtual Server [%s]", proj.Name),
				"version": "1.0.0",
			},
		},
		"id": 1,
	})
}

func (g *Gateway) dispatchLog(eventID, project string, start time.Time, status int, bytesIn int) {
	if g.httpClient == nil {
		g.httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	latency := float64(time.Since(start).Microseconds()) / 1000.0
	payload := map[string]interface{}{
		"event_id":   eventID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		"project":    project,
		"status":     fmt.Sprintf("%d", status),
		"latency_ms": latency,
		"bytes_in":   bytesIn,
		"bytes_out":  128,
	}

	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", g.ingestURL+"/ingest/v1/logs", bytes.NewBuffer(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.httpClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

func (g *Gateway) loadLocalConfig() {
	if g.logger == nil {
		g.logger = slog.Default()
	}
	data, err := os.ReadFile(g.configPath)
	if err != nil || len(data) == 0 {
		g.logger.Warn("no local config cache found, bootstrapping minimal fallback", "path", g.configPath)
		fallback := &GatewayConfig{
			Version: 1,
			Projects: map[string]Project{
				"production": {
					ID:     "00000000-0000-0000-0000-000000000001",
					Slug:   "production",
					Name:   "Production Gateway",
					Status: "active",
				},
			},
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		g.currentCfg.Store(fallback)
		_ = g.saveLocalConfig(fallback)
		return
	}

	var cfg GatewayConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		g.logger.Error("corrupted local config cache", "error", err)
		return
	}

	g.currentCfg.Store(&cfg)
	g.logger.Info("loaded last good configuration from disk", "version", cfg.Version, "projects", len(cfg.Projects))
}

func (g *Gateway) saveLocalConfig(cfg *GatewayConfig) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(g.configPath, raw, 0644)
}

func (g *Gateway) startConfigPoller(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Query console /api/gateway/v1/config when implemented in Phase 3
			// For Phase 1, ensure local config remains valid
			if g.currentCfg.Load() == nil {
				g.loadLocalConfig()
			}
		}
	}
}
