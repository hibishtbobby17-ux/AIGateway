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
	"strconv"
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

type InboundAuth struct {
	Mode           string   `json:"mode"` // none, oauth, api_key
	Issuer         string   `json:"issuer,omitempty"`
	JWKSUri        string   `json:"jwks_uri,omitempty"`
	Audience       string   `json:"audience,omitempty"`
	RequiredScopes []string `json:"required_scopes,omitempty"`
}

type Project struct {
	ID            string      `json:"id"`
	Slug          string      `json:"slug"`
	Name          string      `json:"name"`
	Status        string      `json:"status"`
	Settings      interface{} `json:"settings"`
	InboundAuth   InboundAuth `json:"inbound_auth,omitempty"`
	ConfigVersion int         `json:"config_version"`
	Servers       []MCPServer `json:"servers,omitempty"`
}

type OAuthConfig struct {
	Issuer        string   `json:"issuer,omitempty"`
	TokenEndpoint string   `json:"token_endpoint,omitempty"`
	ClientID      string   `json:"client_id,omitempty"`
	ClientSecret  string   `json:"client_secret,omitempty"`
	Scopes        []string `json:"scopes,omitempty"`
	Audience      string   `json:"audience,omitempty"`
	GrantType     string   `json:"grant_type,omitempty"`
	Status        string   `json:"status,omitempty"`
}

type MCPServer struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	NamespacePrefix string       `json:"namespace_prefix"`
	Transport       string       `json:"transport"`
	URL             string       `json:"url"`
	AuthType        string       `json:"auth_type"` // none, api_key, oauth_cc, oauth_authcode
	Timeouts        interface{}  `json:"timeouts,omitempty"`
	Enabled         bool         `json:"enabled"`
	ToolPolicies    []ToolPolicy `json:"tool_policies,omitempty"`
	OAuthConfig     *OAuthConfig `json:"oauth_config,omitempty"`
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
	oauth         *OAuthManager
	spooler       *Spooler
	rateLimiter   *TokenBucketLimiter
	breakers      *BreakerRegistry
	metrics       *MetricsCollector
	inFlight      int64
	maxInFlight   int64
	maxBodySize   int64
	isTLS         bool
	tlsTelemetry  map[string]interface{}
	mu            sync.RWMutex
	token         string
	tokenExpiry   time.Time
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	logger.Info("starting Headless AI Gateway (Data Plane)...", "component", "gateway")

	port := os.Getenv("GATEWAY_PORT")
	if port == "" {
		port = os.Getenv("LISTEN_PORT")
	}
	if port == "" {
		port = "8080"
	}

	consoleURL := os.Getenv("CONSOLE_URL")
	if consoleURL == "" {
		consoleURL = "http://console:3000"
	}
	consoleURL = strings.TrimRight(consoleURL, "/")
	consoleURL = strings.TrimSuffix(consoleURL, "/api/v1")
	consoleURL = strings.TrimRight(consoleURL, "/")

	gatewaySecret := os.Getenv("AI_GATEWAY_KEY")
	if gatewaySecret == "" {
		gatewaySecret = os.Getenv("GATEWAY_SECRET")
	}
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

	configCachePath := os.Getenv("CACHE_PATH")
	if configCachePath == "" {
		configCachePath = os.Getenv("CONFIG_CACHE_PATH")
	}
	if configCachePath == "" {
		configCachePath = "cache.db"
	}

	maxInFlight := int64(1000)
	if envMax := os.Getenv("GATEWAY_MAX_IN_FLIGHT"); envMax != "" {
		if val, err := strconv.ParseInt(envMax, 10, 64); err == nil && val > 0 {
			maxInFlight = val
		}
	}

	tlsOpts := LoadServerTLSOptionsFromEnv()
	serverTLSConfig, err := SetupServerTLS(tlsOpts, logger)
	if err != nil {
		logger.Error("failed to configure inbound TLS", "error", err)
		os.Exit(1)
	}

	breakers := NewBreakerRegistry()
	pool := NewDownstreamPool(consoleURL, logger)
	pool.SetBreakerRegistry(breakers)
	aggregator := NewMCPAggregator(pool, logger)

	downTLSOpts := LoadDownstreamTLSOptionsFromEnv()
	tlsTelemetry := GetTLSTelemetry(tlsOpts, downTLSOpts)

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
		pool:         pool,
		aggregator:   aggregator,
		breakers:     breakers,
		rateLimiter:  NewTokenBucketLimiter(600, 50),
		maxInFlight:  maxInFlight,
		maxBodySize:  5 * 1024 * 1024, // 5MB
		isTLS:        tlsOpts.Enabled,
		tlsTelemetry: tlsTelemetry,
	}

	metrics := NewMetricsCollector(breakers, &gw.inFlight)
	gw.metrics = metrics
	pool.SetMetricsCollector(metrics)

	spooler := NewSpooler(SpoolerConfig{
		IngestURL:     ingestURL,
		SpoolFilePath: os.Getenv("SPOOL_FILE_PATH"),
		BatchSize:     20,
		FlushInterval: 400 * time.Millisecond,
		Logger:        logger,
		HTTPClient:    &http.Client{Timeout: 1500 * time.Millisecond},
	})
	gw.spooler = spooler

	oauthMgr := NewOAuthManager(consoleURL, gw, logger)
	pool.SetOAuthManager(oauthMgr)
	gw.oauth = oauthMgr

	// 1. Load last known good config from local disk (fail-static guarantee)
	gw.loadLocalConfig()

	// 2. Start background synchronizers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Config Poller (long-poll with ETag and atomic swap)
	go gw.startConfigPoller(ctx)

	// Real-time SSE Stream listener (push delivery)
	go gw.startSSEStream(ctx)

	// Heartbeat emitter
	go gw.startHeartbeatLoop(ctx)

	// 3. Setup HTTP Server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", gw.handleHealthz)
	mux.HandleFunc("GET /readyz", gw.handleReadyz)
	mux.HandleFunc("GET /metrics", gw.metrics.HandleMetrics)
	mux.HandleFunc("POST /p/{slug}/mcp", gw.handleMCP)
	mux.HandleFunc("GET /p/{slug}/mcp", gw.handleMCP)
	mux.HandleFunc("GET /p/{slug}/.well-known/oauth-protected-resource", gw.handleOAuthProtectedResource)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", gw.handleOAuthProtectedResource)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		TLSConfig:    serverTLSConfig,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		if tlsOpts.Enabled {
			logger.Info("headless gateway listening with TLS/HTTPS", "port", port, "min_version", tlsOpts.MinVersion)
			if err := server.ListenAndServeTLS(tlsOpts.CertFile, tlsOpts.KeyFile); err != nil && err != http.ErrServerClosed {
				logger.Error("gateway TLS server error", "error", err)
				os.Exit(1)
			}
		} else {
			logger.Info("headless gateway listening with HTTP", "port", port)
			if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				logger.Error("gateway server error", "error", err)
				os.Exit(1)
			}
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
	gw.spooler.Close()
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

func (g *Gateway) getOAuth() *OAuthManager {
	if g.oauth == nil {
		g.oauth = NewOAuthManager(g.consoleURL, g, g.logger)
		if g.pool != nil {
			g.pool.SetOAuthManager(g.oauth)
		}
	}
	return g.oauth
}

func (g *Gateway) getRateLimiter() *TokenBucketLimiter {
	if g.rateLimiter == nil {
		g.rateLimiter = NewTokenBucketLimiter(600, 50)
	}
	return g.rateLimiter
}

func (g *Gateway) handleOAuthProtectedResource(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	cfg := g.currentCfg.Load()
	issuer := ""
	if cfg != nil && slug != "" {
		if p, ok := cfg.Projects[slug]; ok && p.InboundAuth.Issuer != "" {
			issuer = p.InboundAuth.Issuer
		}
	}
	authServers := []string{}
	if issuer != "" {
		authServers = append(authServers, issuer)
	}
	scheme := RequestScheme(r, g.isTLS)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"resource":              fmt.Sprintf("%s://%s/p/%s/mcp", scheme, r.Host, slug),
		"authorization_servers": authServers,
		"scopes_supported":      []string{"mcp:tools", "mcp:read", "mcp:write"},
	})
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
	// 1. Load Shedding Concurrency Guard
	currentInFlight := atomic.AddInt64(&g.inFlight, 1)
	defer atomic.AddInt64(&g.inFlight, -1)

	if g.maxInFlight > 0 && currentInFlight > g.maxInFlight {
		if g.metrics != nil {
			g.metrics.RecordLoadShedding()
		}
		w.Header().Set("Retry-After", "1")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		resp := NewJSONRPCError(nil, ErrCodeDownstream, "Load shedding: maximum concurrent requests reached", nil)
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	slug := r.PathValue("slug")
	cfg := g.currentCfg.Load()

	startTime := time.Now()
	eventID := uuid.NewString()

	traceID := r.Header.Get("traceparent")
	if traceID == "" {
		traceID = r.Header.Get("X-Trace-ID")
	}
	if traceID == "" {
		traceID = r.Header.Get("X-Request-ID")
	}
	if traceID == "" {
		traceID = eventID
	}

	clientID := r.Header.Get("X-Client-ID")
	if clientID == "" {
		clientID = r.RemoteAddr
	}

	statusStr := "200"
	errStr := ""
	mcpServer := ""
	toolName := ""
	rpcMethod := r.Method
	bytesIn := 0
	bytesOut := 0

	defer func() {
		latency := float64(time.Since(startTime).Microseconds()) / 1000.0
		durationSec := time.Since(startTime).Seconds()
		if g.metrics != nil {
			g.metrics.RecordRequest(slug, rpcMethod, statusStr, durationSec)
		}
		if g.spooler != nil {
			g.spooler.Emit(LogEvent{
				EventID:    eventID,
				Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
				Project:    slug,
				MCPServer:  mcpServer,
				Tool:       toolName,
				ClientID:   clientID,
				Status:     statusStr,
				LatencyMs:  latency,
				BytesIn:    int64(bytesIn),
				BytesOut:   int64(bytesOut),
				TraceID:    traceID,
				Error:      errStr,
				Attributes: map[string]interface{}{"method": r.Method, "path": r.URL.Path},
			})
		}
	}()

	if cfg == nil {
		statusStr = "503"
		errStr = "Gateway uninitialized"
		resp := NewJSONRPCError(nil, ErrCodeInternalError, "Gateway uninitialized", nil)
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write(respBytes)
		return
	}

	proj, exists := cfg.Projects[slug]
	if !exists || proj.Status != "active" {
		statusStr = "404"
		errStr = fmt.Sprintf("Project %q not found or inactive", slug)
		resp := NewJSONRPCError(nil, ErrCodeInvalidRequest, errStr, nil)
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write(respBytes)
		return
	}

	// 2. Token Bucket Rate Limiting per Project/Client
	var customRPM int
	if proj.Settings != nil {
		if m, ok := proj.Settings.(map[string]interface{}); ok {
			if rl, ok := m["rate_limit"].(float64); ok && rl > 0 {
				customRPM = int(rl)
			}
		}
	}
	limiterKey := fmt.Sprintf("%s:%s", slug, clientID)
	limitRes := g.getRateLimiter().Allow(limiterKey, customRPM, 0)

	w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limitRes.Limit))
	w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", limitRes.Remaining))
	w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", int(limitRes.ResetDuration.Seconds())))

	if !limitRes.Allowed {
		if g.metrics != nil {
			g.metrics.RecordRateLimited(slug, clientID)
		}
		statusStr = "429"
		errStr = "Rate limit exceeded"
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(limitRes.RetryAfter.Seconds())))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		resp := NewJSONRPCError(nil, ErrCodeInvalidRequest, fmt.Sprintf("Rate limit exceeded. Retry after %v", limitRes.RetryAfter), nil)
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		_, _ = w.Write(respBytes)
		return
	}

	// Inbound OAuth Bearer Auth Enforcement
	if proj.InboundAuth.Mode == "oauth" {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			statusStr = "401"
			errStr = "Missing bearer token"
			w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token", error_description="Missing bearer token"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			resp := NewJSONRPCError(nil, ErrCodeDownstream, "Unauthorized: missing bearer token", nil)
			respBytes, _ := json.Marshal(resp)
			bytesOut = len(respBytes)
			_, _ = w.Write(respBytes)
			return
		}
		rawToken := strings.TrimPrefix(authHeader, "Bearer ")
		_, err := g.getOAuth().VerifyInboundBearer(r.Context(), rawToken, proj.InboundAuth)
		if err != nil {
			statusStr = "401"
			errStr = err.Error()
			w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer error="invalid_token", error_description="%s"`, err.Error()))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			resp := NewJSONRPCError(nil, ErrCodeDownstream, fmt.Sprintf("Unauthorized: %s", err.Error()), nil)
			respBytes, _ := json.Marshal(resp)
			bytesOut = len(respBytes)
			_, _ = w.Write(respBytes)
			return
		}
	}

	// 3. Request Body Size Limits
	maxBody := g.maxBodySize
	if maxBody <= 0 {
		maxBody = 5 * 1024 * 1024
	}
	if r.ContentLength > maxBody {
		statusStr = "413"
		errStr = fmt.Sprintf("Payload too large: Content-Length %d exceeds limit %d", r.ContentLength, maxBody)
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		resp := NewJSONRPCError(nil, ErrCodeParseError, "Payload too large", errStr)
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		_, _ = w.Write(respBytes)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	body, err := io.ReadAll(r.Body)
	bytesIn = len(body)
	if err != nil {
		statusStr = "413"
		errStr = "Payload too large or unreadable: " + err.Error()
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		resp := NewJSONRPCError(nil, ErrCodeParseError, "Payload too large or unreadable", err.Error())
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		_, _ = w.Write(respBytes)
		return
	}

	// Allow empty GET for health/capabilities discovery
	if len(body) == 0 && r.Method == http.MethodGet {
		rpcMethod = "initialize"
		resp := g.getAggregator().HandleInitialize(&JSONRPCRequest{ID: 1}, &proj)
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(respBytes)
		return
	}

	var rpcReq JSONRPCRequest
	if err := json.Unmarshal(body, &rpcReq); err != nil {
		statusStr = "400"
		errStr = "Parse error: invalid JSON"
		resp := NewJSONRPCError(nil, ErrCodeParseError, "Parse error: invalid JSON", err.Error())
		respBytes, _ := json.Marshal(resp)
		bytesOut = len(respBytes)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write(respBytes)
		return
	}

	rpcMethod = rpcReq.Method

	// Notifications have no ID and start with notifications/
	if rpcReq.ID == nil && strings.HasPrefix(rpcReq.Method, "notifications/") {
		w.WriteHeader(http.StatusOK)
		return
	}

	agg := g.getAggregator()
	var rpcResp *JSONRPCResponse

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

	if rpcResp.Error != nil {
		statusStr = fmt.Sprintf("%d", rpcResp.Error.Code)
		errStr = rpcResp.Error.Message
	}

	respBytes, _ := json.Marshal(rpcResp)
	bytesOut = len(respBytes)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(respBytes)
}

func (g *Gateway) dispatchLog(eventID, project string, start time.Time, status int, bytesIn int) {
	g.dispatchLogExtended(eventID, project, "", "", start, fmt.Sprintf("%d", status), bytesIn, 128, "")
}

func (g *Gateway) dispatchLogExtended(eventID, project, server, tool string, start time.Time, status string, bytesIn, bytesOut int, errStr string) {
	latency := float64(time.Since(start).Microseconds()) / 1000.0
	if g.spooler != nil {
		g.spooler.Emit(LogEvent{
			EventID:    eventID,
			Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
			Project:    project,
			MCPServer:  server,
			Tool:       tool,
			Status:     status,
			LatencyMs:  latency,
			BytesIn:    int64(bytesIn),
			BytesOut:   int64(bytesOut),
			Error:      errStr,
		})
	}
}

func (g *Gateway) loadLocalConfig() {
	if g.logger == nil {
		g.logger = slog.Default()
	}
	data, err := LoadEncryptedConfig(g.configPath, g.gatewaySecret)
	if err != nil || len(data) == 0 {
		g.logger.Warn("no local config cache found or cache unreadable, bootstrapping minimal fallback", "path", g.configPath)
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
	// Log plan-specified warning when booting from local cache
	g.logger.Warn("Operating in degraded offline cached mode", "version", cfg.Version, "projects", len(cfg.Projects), "path", g.configPath)
}

func (g *Gateway) saveLocalConfig(cfg *GatewayConfig) error {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return SaveEncryptedConfig(g.configPath, g.gatewaySecret, raw)
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
	if strings.HasPrefix(g.gatewaySecret, "aigw_live_") || strings.HasPrefix(g.gatewaySecret, "gwsec_") {
		return g.gatewaySecret, nil
	}

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
		req.Header.Set("X-Gateway-ID", g.gatewayID)
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

	protocol := "http"
	if g.isTLS {
		protocol = "https"
	}

	payload := map[string]interface{}{
		"gateway_id":             g.gatewayID,
		"version":                "1.0.0",
		"protocol":               protocol,
		"tls_enabled":            g.isTLS,
		"applied_config_version": appliedVersion,
		"metrics": map[string]interface{}{
			"goroutines":    10,
			"status":        "healthy",
			"protocol":      protocol,
			"tls_enabled":   g.isTLS,
			"tls_telemetry": g.tlsTelemetry,
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
