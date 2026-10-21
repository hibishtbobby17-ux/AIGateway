package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
)

type GatewayConfig struct {
	Version   int                `json:"config_version"`
	Projects  map[string]Project `json:"projects"`
	UpdatedAt string             `json:"generated_at"`
}

type Project struct {
	ID            string      `json:"id"`
	Slug          string      `json:"slug"`
	Name          string      `json:"name"`
	Status        string      `json:"status"`
	Settings      interface{} `json:"settings"`
	ConfigVersion int         `json:"config_version"`
	Servers       []MCPServer `json:"servers,omitempty"`
}

type MCPServer struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	NamespacePrefix string       `json:"namespace_prefix"`
	Transport       string       `json:"transport"`
	URL             string       `json:"url"`
	AuthType        string       `json:"auth_type"`
	Enabled         bool         `json:"enabled"`
	ToolPolicies    []ToolPolicy `json:"tool_policies,omitempty"`
}

type ToolPolicy struct {
	ToolName string  `json:"tool_name"`
	Enabled  bool    `json:"enabled"`
	Rename   *string `json:"rename"`
}

type Gateway struct {
	configPath    string
	consoleURL    string
	gatewaySecret string
	gatewayID     string
	ingestURL     string
	currentCfg    atomic.Pointer[GatewayConfig]
	logger        *slog.Logger
	httpClient    *http.Client
	pool          *DownstreamPool
	aggregator    *MCPAggregator
	mu            sync.RWMutex
	token         string
	tokenExpiry   time.Time
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

	pool := NewDownstreamPool(consoleURL, logger)
	aggregator := NewMCPAggregator(pool, logger)

	gw := &Gateway{
		configPath:    configCachePath,
		consoleURL:    consoleURL,
		gatewaySecret: gatewaySecret,
		gatewayID:     gatewayID,
		ingestURL:     ingestURL,
		logger:        logger,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		pool:       pool,
		aggregator: aggregator,
	}

	// 1. Load last known good config from local disk (fail-static guarantee)
	gw.loadLocalConfig()

	// 2. Start background synchronizers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Config Poller (long-poll with ETag and atomic swap)
	go gw.startConfigPoller(ctx)

	// Heartbeat emitter
	go gw.startHeartbeatLoop(ctx)

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

func (g *Gateway) getAggregator() *MCPAggregator {
	if g.aggregator == nil {
		if g.pool == nil {
			g.pool = NewDownstreamPool(g.consoleURL, g.logger)
		}
		g.aggregator = NewMCPAggregator(g.pool, g.logger)
	}
	return g.aggregator
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
		resp := NewJSONRPCError(nil, ErrCodeInternalError, "Gateway uninitialized", nil)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	proj, exists := cfg.Projects[slug]
	if !exists || proj.Status != "active" {
		resp := NewJSONRPCError(nil, ErrCodeInvalidRequest, fmt.Sprintf("Project %q not found or inactive", slug), nil)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	// Read client payload
	body, err := io.ReadAll(r.Body)
	if err != nil {
		resp := NewJSONRPCError(nil, ErrCodeParseError, "Failed to read request body", err.Error())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	// Allow empty GET for health/capabilities discovery
	if len(body) == 0 && r.Method == http.MethodGet {
		resp := g.getAggregator().HandleInitialize(&JSONRPCRequest{ID: 1}, &proj)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	var rpcReq JSONRPCRequest
	if err := json.Unmarshal(body, &rpcReq); err != nil {
		resp := NewJSONRPCError(nil, ErrCodeParseError, "Parse error: invalid JSON", err.Error())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	// Notifications have no ID and start with notifications/
	if rpcReq.ID == nil && strings.HasPrefix(rpcReq.Method, "notifications/") {
		w.WriteHeader(http.StatusOK)
		return
	}

	agg := g.getAggregator()
	var rpcResp *JSONRPCResponse
	var mcpServer string
	var toolName string

	switch rpcReq.Method {
	case "initialize":
		rpcResp = agg.HandleInitialize(&rpcReq, &proj)
	case "ping":
		rpcResp = agg.HandlePing(&rpcReq)
	case "tools/list":
		rpcResp = agg.HandleToolsList(r.Context(), &rpcReq, &proj)
	case "tools/call":
		rpcResp, mcpServer, toolName, _ = agg.HandleToolsCall(r.Context(), &rpcReq, &proj)
	case "prompts/list":
		rpcResp = agg.HandlePromptsList(r.Context(), &rpcReq, &proj)
	case "resources/list":
		rpcResp = agg.HandleResourcesList(r.Context(), &rpcReq, &proj)
	default:
		rpcResp = NewJSONRPCError(rpcReq.ID, ErrCodeMethodNotFound, fmt.Sprintf("Method not found: %s", rpcReq.Method), nil)
	}

	respBytes, _ := json.Marshal(rpcResp)

	// Async log dispatch to Ingest
	statusStr := "200"
	errStr := ""
	if rpcResp.Error != nil {
		statusStr = fmt.Sprintf("%d", rpcResp.Error.Code)
		errStr = rpcResp.Error.Message
	}
	go g.dispatchLogExtended(eventID, slug, mcpServer, toolName, startTime, statusStr, len(body), len(respBytes), errStr)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(respBytes)
}

func (g *Gateway) dispatchLog(eventID, project string, start time.Time, status int, bytesIn int) {
	g.dispatchLogExtended(eventID, project, "", "", start, fmt.Sprintf("%d", status), bytesIn, 128, "")
}

func (g *Gateway) dispatchLogExtended(eventID, project, server, tool string, start time.Time, status string, bytesIn, bytesOut int, errStr string) {
	if g.httpClient == nil {
		g.httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	latency := float64(time.Since(start).Microseconds()) / 1000.0
	payload := map[string]interface{}{
		"event_id":   eventID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		"project":    project,
		"mcp_server": server,
		"tool":       tool,
		"status":     status,
		"latency_ms": latency,
		"bytes_in":   bytesIn,
		"bytes_out":  bytesOut,
		"error":      errStr,
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
					ID:            "00000000-0000-0000-0000-000000000001",
					Slug:          "production",
					Name:          "Production Gateway",
					Status:        "active",
					ConfigVersion: 1,
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

// authenticateWithConsole exchanges GATEWAY_SECRET for a short-lived JWT
func (g *Gateway) authenticateWithConsole() error {
	if g.logger == nil {
		g.logger = slog.Default()
	}
	payload := map[string]string{
		"gateway_id": g.gatewayID,
		"secret":     g.gatewaySecret,
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", g.consoleURL+"/api/gateway/v1/auth", bytes.NewBuffer(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("gateway auth failed with status %d: %s", resp.StatusCode, string(body))
	}

	var authRes struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&authRes); err != nil {
		return err
	}

	g.mu.Lock()
	g.token = authRes.Token
	g.tokenExpiry = time.Now().Add(time.Duration(authRes.ExpiresIn-60) * time.Second)
	g.mu.Unlock()

	g.logger.Info("gateway authenticated with control plane", "gateway_id", g.gatewayID)
	return nil
}

func (g *Gateway) getToken() (string, error) {
	g.mu.RLock()
	token := g.token
	expiry := g.tokenExpiry
	g.mu.RUnlock()

	if token == "" || time.Now().After(expiry) {
		if err := g.authenticateWithConsole(); err != nil {
			return "", err
		}
		g.mu.RLock()
		token = g.token
		g.mu.RUnlock()
	}
	return token, nil
}

// startConfigPoller executes long-polling with ETag and atomic swap
func (g *Gateway) startConfigPoller(ctx context.Context) {
	if g.logger == nil {
		g.logger = slog.Default()
	}
	g.logger.Info("starting gateway configuration synchronizer", "console_url", g.consoleURL)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		token, err := g.getToken()
		if err != nil {
			g.logger.Warn("cannot authenticate with console, using fail-static cache", "error", err)
			time.Sleep(2 * time.Second)
			continue
		}

		currentCfg := g.currentCfg.Load()
		currentVersion := 0
		if currentCfg != nil {
			currentVersion = currentCfg.Version
		}

		url := fmt.Sprintf("%s/api/gateway/v1/config?since=%d", g.consoleURL, currentVersion)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			time.Sleep(1 * time.Second)
			continue
		}

		req.Header.Set("Authorization", "Bearer "+token)
		if currentVersion > 0 {
			req.Header.Set("If-None-Match", fmt.Sprintf(`"v%d"`, currentVersion))
		}

		resp, err := g.httpClient.Do(req)
		if err != nil {
			g.logger.Warn("config sync request failed, preserving current config (fail-static)", "error", err)
			// Jittered backoff between 1.5s - 2.5s
			jitter := time.Duration(1500+rand.Intn(1000)) * time.Millisecond
			time.Sleep(jitter)
			continue
		}

		if resp.StatusCode == http.StatusNotModified {
			_ = resp.Body.Close()
			// Config unchanged, loop immediately or after small jitter
			time.Sleep(200 * time.Millisecond)
			continue
		}

		if resp.StatusCode == http.StatusUnauthorized {
			_ = resp.Body.Close()
			g.mu.Lock()
			g.token = "" // Force re-authentication
			g.mu.Unlock()
			time.Sleep(1 * time.Second)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			g.logger.Warn("unexpected status from config sync", "status", resp.StatusCode, "body", string(body))
			time.Sleep(2 * time.Second)
			continue
		}

		var newConfig GatewayConfig
		if err := json.NewDecoder(resp.Body).Decode(&newConfig); err != nil {
			_ = resp.Body.Close()
			g.logger.Error("failed to decode config sync response, preserving current config", "error", err)
			time.Sleep(2 * time.Second)
			continue
		}
		_ = resp.Body.Close()

		// Validate new config
		if newConfig.Projects == nil {
			newConfig.Projects = make(map[string]Project)
		}

		// Perform Atomic Swap
		g.currentCfg.Store(&newConfig)
		_ = g.saveLocalConfig(&newConfig)

		g.logger.Info("applied new configuration atomically",
			"new_version", newConfig.Version,
			"previous_version", currentVersion,
			"projects_count", len(newConfig.Projects))

		// Immediately trigger a heartbeat update
		go g.sendHeartbeat()
	}
}

// startHeartbeatLoop sends periodic health and metrics heartbeats to Console
func (g *Gateway) startHeartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			g.sendHeartbeat()
		}
	}
}

func (g *Gateway) sendHeartbeat() {
	token, err := g.getToken()
	if err != nil {
		return
	}

	currentCfg := g.currentCfg.Load()
	appliedVersion := 0
	if currentCfg != nil {
		appliedVersion = currentCfg.Version
	}

	payload := map[string]interface{}{
		"gateway_id":             g.gatewayID,
		"version":                "1.0.0",
		"applied_config_version": appliedVersion,
		"metrics": map[string]interface{}{
			"goroutines": 10,
			"status":     "healthy",
		},
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", g.consoleURL+"/api/gateway/v1/heartbeat", bytes.NewBuffer(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := g.httpClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}
