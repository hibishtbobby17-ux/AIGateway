package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestGatewayEndpoints(t *testing.T) {
	tempFile, err := os.CreateTemp("", "test_cfg_*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tempFile.Name())

	gw := &Gateway{
		configPath: tempFile.Name(),
		logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	// Bootstrap config
	gw.loadLocalConfig()

	// 1. Test /healthz
	reqHealth := httptest.NewRequest("GET", "/healthz", nil)
	recHealth := httptest.NewRecorder()
	gw.handleHealthz(recHealth, reqHealth)

	if recHealth.Code != http.StatusOK {
		t.Fatalf("expected 200 for healthz, got %d", recHealth.Code)
	}

	// 2. Test /readyz
	reqReady := httptest.NewRequest("GET", "/readyz", nil)
	recReady := httptest.NewRecorder()
	gw.handleReadyz(recReady, reqReady)

	if recReady.Code != http.StatusOK {
		t.Fatalf("expected 200 for readyz, got %d", recReady.Code)
	}

	// 3. Test /p/production/mcp
	mcpPayload := []byte(`{"jsonrpc":"2.0","method":"initialize","id":1}`)
	reqMCP := httptest.NewRequest("POST", "/p/production/mcp", bytes.NewBuffer(mcpPayload))
	reqMCP.SetPathValue("slug", "production")
	recMCP := httptest.NewRecorder()
	gw.handleMCP(recMCP, reqMCP)

	if recMCP.Code != http.StatusOK {
		t.Fatalf("expected 200 for mcp endpoint, got %d", recMCP.Code)
	}

	var res map[string]interface{}
	if err := json.Unmarshal(recMCP.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse mcp response: %v", err)
	}
	if res["jsonrpc"] != "2.0" {
		t.Fatalf("expected jsonrpc 2.0, got %v", res["jsonrpc"])
	}
}

func TestGatewayFailStatic(t *testing.T) {
	tempFile, _ := os.CreateTemp("", "test_fail_static_*.json")
	defer os.Remove(tempFile.Name())

	gw := &Gateway{
		configPath: tempFile.Name(),
	}

	cfg := &GatewayConfig{
		Version: 42,
		Projects: map[string]Project{
			"test-slug": {
				ID:   "proj-1",
				Slug: "test-slug",
				Name: "Test Project",
			},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	err := gw.saveLocalConfig(cfg)
	if err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	gw2 := &Gateway{
		configPath: tempFile.Name(),
	}
	gw2.loadLocalConfig()

	loaded := gw2.currentCfg.Load()
	if loaded == nil || loaded.Version != 42 {
		t.Fatalf("fail-static load failed, expected version 42, got %v", loaded)
	}
}
