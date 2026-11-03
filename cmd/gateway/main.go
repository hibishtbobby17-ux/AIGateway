package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"AIGateway/internal/api/health"
	"AIGateway/internal/api/middleware"
	"AIGateway/internal/config"
	a2aregistry "AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/routing"
	"AIGateway/internal/a2a/tasks"
	a2atransport "AIGateway/internal/a2a/transport"
	"AIGateway/internal/audit"
	"AIGateway/internal/identity/delegation"
	"AIGateway/internal/identity/idp"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/oauth"
	"AIGateway/internal/identity/tokens"
	"AIGateway/internal/mcp/aggregation"
	"AIGateway/internal/mcp/registry"
	"AIGateway/internal/mcp/session"
	"AIGateway/internal/mcp/transport"
	"AIGateway/internal/observability/correlation"
	obsmetrics "AIGateway/internal/observability/metrics"
	"AIGateway/internal/observability/otlp"
	"AIGateway/internal/observability/pipeline"
	obsstorage "AIGateway/internal/observability/storage"
	"AIGateway/internal/observability/tracing"
	"AIGateway/internal/policy"
	"AIGateway/internal/resilience"
	"AIGateway/internal/storage"
)

func main() {
	// 1. Initialize base structured logger
	logger := correlation.NewLogger(os.Stdout, slog.LevelInfo, true)
	logger.Info("starting AI Gateway runtime...", "component", "gateway")

	// 2. Load and validate configuration
	cfg := config.NewDefaultConfig()
	cfg.LoadFromEnv()
	if err := cfg.Validate(); err != nil {
		logger.Error("configuration validation failed", "error", err)
		os.Exit(1)
	}
	logger.Info("configuration loaded successfully", "environment", string(cfg.Environment), "port", cfg.Server.Port)

	// 3. Initialize health and readiness probes
	healthHandler := health.NewHandler()

	// 4. Initialize shared database-backed identity and policy state.
	db, err := storage.OpenDB(&cfg.Database)
	if err != nil {
		logger.Error("database connection failed; gateway cannot safely validate tokens", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	healthHandler.RegisterCheck("database", func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return db.PingContext(ctx)
	})
	logger.Info("database connection pool initialized", "driver", cfg.Database.Driver)

	signingKeyEncryptionKey, err := cfg.SigningKeyEncryptionKey()
	if err != nil {
		logger.Error("persistent signing-key encryption is required", "error", err)
		os.Exit(1)
	}
	keyRepository, err := keys.NewSQLRepository(db)
	if err != nil {
		logger.Error("signing-key repository initialization failed", "error", err)
		os.Exit(1)
	}
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	keyManager, err := keys.NewPersistentManager(startupCtx, keyRepository, signingKeyEncryptionKey)
	cancelStartup()
	if err != nil {
		logger.Error("persistent signing-key initialization failed", "error", err)
		os.Exit(1)
	}
	revocationStore, err := tokens.NewSQLRevocationStore(db)
	if err != nil {
		logger.Error("token revocation store initialization failed", "error", err)
		os.Exit(1)
	}
	revocationCtx, cancelRevocation := context.WithTimeout(context.Background(), 10*time.Second)
	err = revocationStore.Validate(revocationCtx)
	cancelRevocation()
	if err != nil {
		logger.Error("token revocation schema validation failed", "error", err)
		os.Exit(1)
	}
	verifier := tokens.NewVerifier(keyManager, revocationStore, cfg.Security.JWTIssuer, cfg.Security.JWTAudience)
	policyRepository, err := policy.NewSQLRepository(db)
	if err != nil {
		logger.Error("policy repository initialization failed", "error", err)
		os.Exit(1)
	}
	policyCtx, cancelPolicies := context.WithTimeout(context.Background(), 10*time.Second)
	policyEngine, err := policyRepository.LoadEngine(policyCtx)
	cancelPolicies()
	if err != nil {
		logger.Error("persisted policy loading failed", "error", err)
		os.Exit(1)
	}

	// 5. Initialize MCP Gateway Core
	mcpRegistry := registry.NewMemoryRegistry()
	mcpAggregator := aggregation.NewAggregator(mcpRegistry, 5*time.Minute)
	mcpSessions := session.NewManager()
	mcpHandler := transport.NewGatewayHandler(mcpAggregator, mcpSessions, "default")
	mcpHandler.SetPolicyEngine(policyEngine)
	logger.Info("MCP Gateway engine initialized", "protocol_version", "2024-11-05")

	// 6. Initialize A2A Gateway Core & Delegation Provider
	auditRecorder := audit.NewSQLRecorder(db)
	tokenExchanger, _ := delegation.NewTokenExchanger(keyManager, cfg.Security.JWTIssuer, 5*time.Minute)
	credentialProvider := delegation.NewProvider(tokenExchanger)
	a2aRegistry := a2aregistry.NewSQLRegistry(db)
	a2aStore := tasks.NewSQLStore(db)
	a2aRouter := routing.NewRouter(routing.RouterConfig{
		Registry:           a2aRegistry,
		Store:              a2aStore,
		CredentialProvider: credentialProvider,
		AllowLocalEgress:   cfg.Environment != config.EnvProduction,
	})
	defer a2aRouter.Close()
	a2aHandler := a2atransport.NewHandler(a2aRegistry, a2aStore, a2aRouter, policyEngine, auditRecorder, "default")
	logger.Info("A2A Gateway engine initialized", "protocol_version", "a2a/v1")

	// 7. Initialize OAuth 2.0 & Built-in Identity Provider
	oauthStore, err := oauth.NewSQLStore(db, nil)
	if err != nil {
		logger.Error("oauth store initialization failed", "error", err)
		os.Exit(1)
	}
	oauthServer, err := oauth.NewFositeServer(oauthStore, keyManager, cfg.Security.JWTIssuer, cfg.Security.JWTAudience, signingKeyEncryptionKey)
	if err != nil {
		logger.Error("oauth server initialization failed", "error", err)
		os.Exit(1)
	}
	userRepo, err := idp.NewSQLUserRepository(db, 10)
	if err != nil {
		logger.Error("idp user repository initialization failed", "error", err)
		os.Exit(1)
	}
	consentRepo, err := oauth.NewSQLAuthorizationService(db)
	if err != nil {
		logger.Error("oauth consent repository initialization failed", "error", err)
		os.Exit(1)
	}
	interactiveIdP, err := idp.NewInteractiveService(userRepo, consentRepo, signingKeyEncryptionKey)
	if err != nil {
		logger.Error("idp interactive service initialization failed", "error", err)
		os.Exit(1)
	}
	oauthServer.SetAuthorizationService(interactiveIdP)

	// 8. Initialize Observability Pipeline, Tracer, Metrics & OTLP Ingestion
	traceStore := obsstorage.NewSQLTraceStore(db)
	logStore := obsstorage.NewSQLLogStore(db)
	telemetryPipe := pipeline.NewPipeline(traceStore, logStore, pipeline.Config{
		Capacity:      10000,
		BatchSize:     100,
		FlushInterval: 200 * time.Millisecond,
	})
	defer telemetryPipe.Close()

	tracer := tracing.NewTracer("ai-gateway", telemetryPipe)
	metricsReg := obsmetrics.NewRegistry()
	_ = obsmetrics.NewGatewayMetrics(metricsReg)
	otlpHandler := otlp.NewIngestionHandler(telemetryPipe, "default")
	logger.Info("Observability pipeline and OTLP ingestion initialized", "otlp_endpoints", "/v1/traces, /v1/logs, /v1/metrics")

	// 9. Setup Gateway HTTP router
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)
	mux.HandleFunc("/startupz", healthHandler.StartupHandler)

	// Mount Metrics and OTLP ingestion endpoints
	mux.HandleFunc("/metrics", metricsReg.Handler())
	otlpHandler.Mount(mux)

	// Mount OAuth and IdP endpoints
	oauthServer.Mount(mux)
	mux.HandleFunc("/login", interactiveIdP.HandleLogin)
	mux.HandleFunc("/consent", interactiveIdP.HandleConsent)

	// MCP Gateway logical protocol endpoints
	mux.HandleFunc("/mcp/v1/sse", mcpHandler.HandleSSE)
	mux.HandleFunc("/mcp/v1/messages", mcpHandler.HandleMessages)

	// A2A Gateway logical protocol endpoints
	a2aHandler.Mount(mux)

	// Logical endpoint root
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"platform":"AI Gateway & Observability Platform","status":"online","mcp_endpoint":"/mcp/v1/sse","a2a_endpoint":"/a2a/v1/agents","otlp_traces":"/v1/traces","metrics":"/metrics"}`))
			return
		}
		http.NotFound(w, r)
	})

	rateLimiter := resilience.NewRateLimiter(resilience.RateLimiterConfig{
		RequestsPerMinute: 1200,
		Burst:             100,
	})

	gatewayHandler := tracing.TraceMiddleware(tracer)(mux)
	gatewayHandler = middleware.AuthMiddleware(verifier, policyEngine)(gatewayHandler)
	gatewayHandler = resilience.RateLimitMiddleware(rateLimiter, resilience.DefaultKeyExtractor)(gatewayHandler)
	gatewayHandler = resilience.MaxBytesMiddleware(resilience.DefaultMaxRequestBodySize)(gatewayHandler)

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      gatewayHandler,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// 5. Start HTTP server in background goroutine
	serverErrChan := make(chan error, 1)
	go func() {
		logger.Info("listening for inbound gateway traffic", "addr", server.Addr)
		healthHandler.SetReady(true)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrChan <- err
		}
	}()

	// 6. Graceful shutdown coordination
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrChan:
		logger.Error("server fatal error", "error", err)
		os.Exit(1)
	case sig := <-stopChan:
		logger.Info("shutdown signal received; commencing graceful draining", "signal", sig.String())
	}

	// Step 1: Switch readiness probe to 503 so load balancers stop sending traffic
	healthHandler.SetReady(false)

	// Step 2: Bounded drain deadline
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed; forcing termination", "error", err)
		os.Exit(1)
	}

	logger.Info("gateway server cleanly terminated")
}
