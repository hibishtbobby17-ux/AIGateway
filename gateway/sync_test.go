package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

func TestGatewayAtomicSwapConcurrency(t *testing.T) {
	tempFile, _ := os.CreateTemp("", "test_atomic_*.json")
	defer os.Remove(tempFile.Name())

	gw := &Gateway{
		configPath: tempFile.Name(),
	}

	initialCfg := &GatewayConfig{
		Version: 1,
		Projects: map[string]Project{
			"prod": {ID: "p1", Slug: "prod", Name: "Prod", ConfigVersion: 1},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	gw.currentCfg.Store(initialCfg)

	var wg sync.WaitGroup
	// 50 concurrent readers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				cfg := gw.currentCfg.Load()
				if cfg == nil || cfg.Version < 1 {
					t.Errorf("read invalid config version: %v", cfg)
				}
				time.Sleep(10 * time.Microsecond)
			}
		}()
	}

	// 5 concurrent atomic writers
	for v := 2; v <= 6; v++ {
		wg.Add(1)
		go func(ver int) {
			defer wg.Done()
			newCfg := &GatewayConfig{
				Version: ver,
				Projects: map[string]Project{
					"prod": {ID: "p1", Slug: "prod", Name: "Prod", ConfigVersion: ver},
				},
				UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			}
			gw.currentCfg.Store(newCfg)
		}(v)
	}

	wg.Wait()

	finalCfg := gw.currentCfg.Load()
	if finalCfg == nil || finalCfg.Version < 2 {
		t.Fatalf("expected atomic swap final version >= 2, got %v", finalCfg)
	}
}

func TestGatewayConfigSyncMockServer(t *testing.T) {
	tempFile, _ := os.CreateTemp("", "test_mock_sync_*.json")
	defer os.Remove(tempFile.Name())

	mockConsole := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/gateway/v1/auth" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"token":      "mock-jwt-token",
				"expires_in": 3600,
			})
			return
		}

		if r.URL.Path == "/api/gateway/v1/config" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("ETag", `"v10"`)
			_ = json.NewEncoder(w).Encode(GatewayConfig{
				Version: 10,
				Projects: map[string]Project{
					"synced-project": {
						ID:            "proj-10",
						Slug:          "synced-project",
						Name:          "Synced Project",
						Status:        "active",
						ConfigVersion: 10,
					},
				},
				UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			})
			return
		}

		if r.URL.Path == "/api/gateway/v1/heartbeat" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "acknowledged",
			})
			return
		}

		http.NotFound(w, r)
	}))
	defer mockConsole.Close()

	gw := &Gateway{
		configPath:    tempFile.Name(),
		consoleURL:    mockConsole.URL,
		gatewaySecret: "secret",
		gatewayID:     "gw-1",
		httpClient:    mockConsole.Client(),
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Run auth
	err := gw.authenticateWithConsole()
	if err != nil {
		t.Fatalf("auth failed: %v", err)
	}

	// Trigger single poll cycle
	go gw.startConfigPoller(ctx)

	// Wait up to 500ms for poller to apply config
	time.Sleep(300 * time.Millisecond)

	cfg := gw.currentCfg.Load()
	if cfg == nil || cfg.Version != 10 {
		t.Fatalf("expected synced config version 10, got %v", cfg)
	}

	if _, exists := cfg.Projects["synced-project"]; !exists {
		t.Fatalf("expected project 'synced-project' in synced config")
	}
}
