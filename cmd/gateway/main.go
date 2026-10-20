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

	"project_alpha/internal/api/health"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/config"
	a2aregistry "project_alpha/internal/a2a/registry"
	"project_alpha/internal/a2a/routing"
	"project_alpha/internal/a2a/tasks"
	a2atransport "project_alpha/internal/a2a/transport"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/identity/idp"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/oauth"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/mcp/aggregation"
	"project_alpha/internal/mcp/registry"
	"project_alpha/internal/mcp/session"
	"project_alpha/internal/mcp/transport"
	"project_alpha/internal/observability/correlation"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
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

	// 8. Setup Gateway HTTP router
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)
	mux.HandleFunc("/startupz", healthHandler.StartupHandler)

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
			_, _ = w.Write([]byte(`{"platform":"AI Gateway & Observability Platform","status":"online","mcp_endpoint":"/mcp/v1/sse","a2a_endpoint":"/a2a/v1/agents"}`))
			return
		}
		http.NotFound(w, r)
	})

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      middleware.AuthMiddleware(verifier, policyEngine)(mux),
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
