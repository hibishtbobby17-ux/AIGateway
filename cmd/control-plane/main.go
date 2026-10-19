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
	"project_alpha/internal/config"
	"project_alpha/internal/observability/correlation"
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
		logger.Warn("control-plane database connection failed on startup", "error", err)
	} else {
		defer db.Close()
		healthHandler.RegisterCheck("database", func() error {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			return db.PingContext(ctx)
		})
		logger.Info("control-plane database pool initialized", "driver", cfg.Database.Driver)
	}

	// 5. Admin API router
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)
	mux.HandleFunc("/startupz", healthHandler.StartupHandler)

	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"service":"control-plane","status":"healthy"}`))
	})

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Admin.Host, cfg.Admin.Port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 5. Start HTTP server
	serverErrChan := make(chan error, 1)
	go func() {
		logger.Info("listening for administrative control-plane traffic", "addr", server.Addr)
		healthHandler.SetReady(true)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrChan <- err
		}
	}()

	// 6. Graceful shutdown
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
