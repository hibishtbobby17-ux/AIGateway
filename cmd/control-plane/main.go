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

	"project_alpha/internal/api/admin"
	"project_alpha/internal/api/health"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/observability/correlation"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
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
	adminHandler := admin.NewHandler(auditRecorder, policyRepo, tenantsRepo)

	// 6. Admin API router
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)
	mux.HandleFunc("/startupz", healthHandler.StartupHandler)

	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"service":"control-plane","status":"healthy"}`))
	})

	// Authenticated & role-guarded administrative endpoints
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/api/v1/audit", adminHandler.HandleGetAudit)
	adminMux.HandleFunc("/api/v1/policies", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			adminHandler.HandleCreatePolicy(w, r)
		} else {
			adminHandler.HandleListPolicies(w, r)
		}
	})
	adminMux.HandleFunc("/api/v1/tenants", adminHandler.HandleGetTenant)

	adminChain := middleware.AuthMiddleware(verifier, policyEngine)(
		middleware.RequireRoles(auditRecorder, "platform-admin", "tenant-admin", "auditor")(adminMux),
	)

	mux.Handle("/api/v1/audit", adminChain)
	mux.Handle("/api/v1/policies", adminChain)
	mux.Handle("/api/v1/tenants", adminChain)

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
