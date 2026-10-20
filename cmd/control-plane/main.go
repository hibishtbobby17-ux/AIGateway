package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	a2aregistry "project_alpha/internal/a2a/registry"
	a2atasks "project_alpha/internal/a2a/tasks"
	"project_alpha/internal/api/admin"
	"project_alpha/internal/api/health"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/idp"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/oidc"
	"project_alpha/internal/identity/tokens"
	mcpregistry "project_alpha/internal/mcp/registry"
	"project_alpha/internal/mcp/upstream"
	"project_alpha/internal/observability/correlation"
	obsmetrics "project_alpha/internal/observability/metrics"
	obsstorage "project_alpha/internal/observability/storage"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
	"project_alpha/internal/tenants"
	"project_alpha/web"
)

func main() {
	// 1. Initialize structured logger
	logger := correlation.NewLogger(os.Stdout, slog.LevelInfo, true)
	logger.Info("starting AI Gateway Control Plane runtime...", "component", "control-plane")

	// 2. Load and validate configuration
	cfg := config.NewDefaultConfig()
	cfg.LoadFromEnv()
	if err := cfg.Validate(); err != nil {
		logger.Error("configuration validation failed", "error", err)
		os.Exit(1)
	}
	logger.Info("configuration loaded successfully", "environment", string(cfg.Environment), "admin_port", cfg.Admin.Port)

	// 3. Health & Readiness
	healthHandler := health.NewHandler()

	// 4. Initialize Database Connection
	db, err := storage.OpenDB(&cfg.Database)
	if err != nil {
		logger.Error("control-plane database connection failed on startup", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	healthHandler.RegisterCheck("database", func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return db.PingContext(ctx)
	})
	logger.Info("control-plane database pool initialized", "driver", cfg.Database.Driver)

	// 5. Initialize Identity Verifier, Audit Recorder, and Policy Engine
	signingKeyEncryptionKey, err := cfg.SigningKeyEncryptionKey()
	if err != nil {
		logger.Error("signing key encryption key required for control plane", "error", err)
		os.Exit(1)
	}
	keyRepo, err := keys.NewSQLRepository(db)
	if err != nil {
		logger.Error("signing key repository initialization failed", "error", err)
		os.Exit(1)
	}
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	keyManager, err := keys.NewPersistentManager(startupCtx, keyRepo, signingKeyEncryptionKey)
	cancelStartup()
	if err != nil {
		logger.Error("signing key manager initialization failed", "error", err)
		os.Exit(1)
	}

	revocationStore, err := tokens.NewSQLRevocationStore(db)
	if err != nil {
		logger.Error("revocation store initialization failed", "error", err)
		os.Exit(1)
	}
	revocationCtx, cancelRevocation := context.WithTimeout(context.Background(), 10*time.Second)
	err = revocationStore.Validate(revocationCtx)
	cancelRevocation()
	if err != nil {
		logger.Error("revocation schema validation failed", "error", err)
		os.Exit(1)
	}

	verifier := tokens.NewVerifier(keyManager, revocationStore, cfg.Security.JWTIssuer, cfg.Security.JWTAudience)

	policyRepo, err := policy.NewSQLRepository(db)
	if err != nil {
		logger.Error("policy repository initialization failed", "error", err)
		os.Exit(1)
	}
	policyCtx, cancelPolicies := context.WithTimeout(context.Background(), 10*time.Second)
	policyEngine, err := policyRepo.LoadEngine(policyCtx)
	cancelPolicies()
	if err != nil {
		logger.Error("policy engine initialization failed", "error", err)
		os.Exit(1)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	auditRecorder := audit.NewSQLRecorder(db)
	mcpReg := mcpregistry.NewSQLRegistry(db)
	a2aReg := a2aregistry.NewSQLRegistry(db)
	tasksStore := a2atasks.NewSQLStore(db)
	traceStore := obsstorage.NewSQLTraceStore(db)
	logStore := obsstorage.NewSQLLogStore(db)

	userRepo, err := idp.NewSQLUserRepository(db, 10)
	if err != nil {
		logger.Error("user repository initialization failed", "error", err)
		os.Exit(1)
	}

	oidcRepo, err := oidc.NewSQLProviderRepository(db)
	if err != nil {
		logger.Error("oidc provider repository initialization failed", "error", err)
		os.Exit(1)
	}
	oidcDiscoverer := oidc.NewDiscoverer(true, 5*time.Second)

	// Ensure default admin user and tenant exist for immediate login
	bootstrapCtx, cancelBootstrap := context.WithTimeout(context.Background(), 5*time.Second)
	defaultTenantID := "tenant-1"
	if t, err := tenantsRepo.GetTenantByID(bootstrapCtx, defaultTenantID); err != nil || t == nil {
		_ = tenantsRepo.CreateTenant(bootstrapCtx, &tenants.Tenant{
			ID:     defaultTenantID,
			Name:   "Acme AI Labs",
			Slug:   "acme-ai",
			Status: "ACTIVE",
			Tier:   "enterprise",
		})
	}
	if _, err := userRepo.GetUserByUsernameGlobal(bootstrapCtx, "admin"); errors.Is(err, idp.ErrUserNotFound) {
		adminPass := os.Getenv("GATEWAY_ADMIN_PASSWORD")
		if adminPass == "" {
			adminPass = "admin123"
		}
		_ = userRepo.CreateUser(bootstrapCtx, &idp.User{
			TenantID: defaultTenantID,
			Username: "admin",
			Email:    "admin@gateway.local",
			Roles:    []string{"platform-admin", "tenant-admin", "auditor"},
			Active:   true,
		}, adminPass)
		logger.Info("bootstrapped default console administrator", "username", "admin", "tenant_id", defaultTenantID)
	}
	cancelBootstrap()

	adminHandler := admin.NewHandlerWithConfig(admin.Config{
		Recorder:       auditRecorder,
		PolicyRepo:     policyRepo,
		TenantsRepo:    tenantsRepo,
		MCPRegistry:    mcpReg,
		A2ARegistry:    a2aReg,
		TasksStore:     tasksStore,
		TraceStore:     traceStore,
		LogStore:       logStore,
		PolicyEngine:   policyEngine,
		UserRepo:       userRepo,
		KeyManager:     keyManager,
		JWTIssuer:      cfg.Security.JWTIssuer,
		JWTAudience:    cfg.Security.JWTAudience,
		OIDCRepo:       oidcRepo,
		OIDCDiscoverer: oidcDiscoverer,
		OAuthProvider:  upstream.NewOAuthTokenProvider(5*time.Second, true),
	})

	// 6. Admin API router
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)
	mux.HandleFunc("/startupz", healthHandler.StartupHandler)

	metricsReg := obsmetrics.NewRegistry()
	mux.HandleFunc("/metrics", metricsReg.Handler())

	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"service":"control-plane","status":"healthy"}`))
	})

	// Public authentication endpoints for Console login
	mux.HandleFunc("/api/v1/auth/login", adminHandler.HandleLogin)
	mux.HandleFunc("/api/v1/auth/logout", adminHandler.HandleLogout)
	mux.HandleFunc("/api/v1/auth/sso/providers", adminHandler.HandlePublicSSOProviders)
	mux.HandleFunc("/api/v1/auth/sso/simulate", adminHandler.HandleSimulateSSOLogin)

	// Authenticated & role-guarded administrative endpoints
	adminMux := http.NewServeMux()
	adminHandler.RegisterRoutes(adminMux)

	adminChain := middleware.AuthMiddleware(verifier, policyEngine)(
		middleware.RequireRoles(auditRecorder, "platform-admin", "tenant-admin", "auditor")(adminMux),
	)

	mux.Handle("/api/v1/", adminChain)

	// Embedded management console
	consoleHandler := web.Handler()
	mux.Handle("/console/", http.StripPrefix("/console", consoleHandler))
	mux.HandleFunc("/console", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/console/", http.StatusPermanentRedirect)
	})
	mux.Handle("/", consoleHandler)

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Admin.Host, cfg.Admin.Port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 7. Start HTTP server
	serverErrChan := make(chan error, 1)
	go func() {
		logger.Info("listening for administrative control-plane traffic", "addr", server.Addr)
		healthHandler.SetReady(true)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrChan <- err
		}
	}()

	// 8. Graceful shutdown
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrChan:
		logger.Error("control-plane server fatal error", "error", err)
		os.Exit(1)
	case sig := <-stopChan:
		logger.Info("shutdown signal received; commence draining", "signal", sig.String())
	}

	healthHandler.SetReady(false)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("control-plane shutdown error", "error", err)
		os.Exit(1)
	}

	logger.Info("control-plane cleanly stopped")
}
