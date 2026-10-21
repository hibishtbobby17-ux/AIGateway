package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAggregatorInitialize(t *testing.T) {
	pool := NewDownstreamPool("http://console:3000", slog.New(slog.NewTextHandler(io.Discard, nil)))
	agg := NewMCPAggregator(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	proj := &Project{
		ID:            "proj-1",
		Slug:          "test-proj",
		Name:          "Test Project",
		ConfigVersion: 3,
		Servers:       []MCPServer{{ID: "srv-1", Name: "Math", Enabled: true}},
	}

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
	}

	resp := agg.HandleInitialize(req, proj)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}

	resMap, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map result, got %T", resp.Result)
	}

	serverInfo := resMap["serverInfo"].(map[string]interface{})
	if serverInfo["config_version"] != 3 {
		t.Fatalf("expected config_version 3, got %v", serverInfo["config_version"])
	}
}

func TestAggregatorToolsListFanOutAndPolicy(t *testing.T) {
	// 1. Mock Downstream Server 1: Math (add, multiply)
	mathServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		if req.Method == "tools/list" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result": map[string]interface{}{
					"tools": []MCPTool{
						{Name: "add", Description: "Add numbers"},
						{Name: "multiply", Description: "Multiply numbers"},
					},
				},
			})
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer mathServer.Close()

	// 2. Mock Downstream Server 2: Weather (get_current_weather)
	weatherServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		if req.Method == "tools/list" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result": map[string]interface{}{
					"tools": []MCPTool{
						{Name: "get_current_weather", Description: "Get current weather"},
					},
				},
			})
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer weatherServer.Close()

	pool := NewDownstreamPool("http://console:3000", slog.New(slog.NewTextHandler(io.Discard, nil)))
	agg := NewMCPAggregator(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	renamed := "plus"
	proj := &Project{
		ID:            "proj-agg",
		Slug:          "test-agg",
		Name:          "Aggregation Test Project",
		ConfigVersion: 1,
		Servers: []MCPServer{
			{
				ID:              "srv-math",
				Name:            "Math Service",
				NamespacePrefix: "math",
				URL:             mathServer.URL,
				Enabled:         true,
				ToolPolicies: []ToolPolicy{
					{ToolName: "add", Enabled: true, Rename: &renamed},
					{ToolName: "multiply", Enabled: false}, // Disabled!
				},
			},
			{
				ID:              "srv-weather",
				Name:            "Weather Service",
				NamespacePrefix: "weather",
				URL:             weatherServer.URL,
				Enabled:         true,
			},
		},
	}

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      2,
		Method:  "tools/list",
	}

	resp := agg.HandleToolsList(context.Background(), req, proj)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}

	listRes, ok := resp.Result.(MCPToolsListResult)
	if !ok {
		t.Fatalf("expected MCPToolsListResult, got %T", resp.Result)
	}

	// Should have 2 tools: math__plus, weather__get_current_weather.
	// multiply should be filtered out because it is disabled!
	if len(listRes.Tools) != 2 {
		t.Fatalf("expected 2 tools, got %d: %+v", len(listRes.Tools), listRes.Tools)
	}

	toolNames := make(map[string]bool)
	for _, tool := range listRes.Tools {
		toolNames[tool.Name] = true
	}

	if !toolNames["math__plus"] {
		t.Errorf("expected tool math__plus to be present, got: %+v", toolNames)
	}
	if !toolNames["weather__get_current_weather"] {
		t.Errorf("expected tool weather__get_current_weather to be present, got: %+v", toolNames)
	}
	if toolNames["math__multiply"] || toolNames["multiply"] {
		t.Errorf("expected disabled tool multiply to be filtered out, but it was found")
	}
}

func TestAggregatorToolsCallRoutingAndPrefixStripping(t *testing.T) {
	var receivedTool string
	var receivedArgs map[string]interface{}

	mathServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			JSONRPC string `json:"jsonrpc"`
			ID      int    `json:"id"`
			Method  string `json:"method"`
			Params  struct {
				Name      string                 `json:"name"`
				Arguments map[string]interface{} `json:"arguments"`
			} `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)

		receivedTool = req.Params.Name
		receivedArgs = req.Params.Arguments

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"content": []map[string]string{
					{"type": "text", "text": "42"},
				},
			},
		})
	}))
	defer mathServer.Close()

	pool := NewDownstreamPool("http://console:3000", slog.New(slog.NewTextHandler(io.Discard, nil)))
	agg := NewMCPAggregator(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	renamed := "plus"
	proj := &Project{
		ID:            "proj-call",
		Slug:          "test-call",
		Name:          "Call Project",
		ConfigVersion: 1,
		Servers: []MCPServer{
			{
				ID:              "srv-math",
				Name:            "Math Service",
				NamespacePrefix: "math",
				URL:             mathServer.URL,
				Enabled:         true,
				ToolPolicies: []ToolPolicy{
					{ToolName: "add", Enabled: true, Rename: &renamed},
					{ToolName: "multiply", Enabled: false},
				},
			},
		},
	}

	// 1. Call math__plus with arguments
	callParamsRaw, _ := json.Marshal(map[string]interface{}{
		"name":      "math__plus",
		"arguments": map[string]interface{}{"a": 20, "b": 22},
	})
	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      3,
		Method:  "tools/call",
		Params:  callParamsRaw,
	}

	resp, srvName, toolName, err := agg.HandleToolsCall(context.Background(), req, proj)
	if err != nil || resp.Error != nil {
		t.Fatalf("unexpected call error: %v, resp error: %+v", err, resp.Error)
	}

	if srvName != "Math Service" {
		t.Errorf("expected server 'Math Service', got %s", srvName)
	}
	if toolName != "add" {
		t.Errorf("expected downstream tool 'add', got %s", toolName)
	}
	// Verify that downstream server received the stripped, unrenamed original tool name 'add'
	if receivedTool != "add" {
		t.Errorf("expected downstream received tool 'add', got %s", receivedTool)
	}
	if fmt.Sprintf("%v", receivedArgs["a"]) != "20" {
		t.Errorf("expected arg a=20, got %v", receivedArgs["a"])
	}

	// 2. Call disabled tool: math__multiply
	callDisParamsRaw, _ := json.Marshal(map[string]interface{}{
		"name":      "math__multiply",
		"arguments": map[string]interface{}{"a": 2, "b": 3},
	})
	disReq := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      4,
		Method:  "tools/call",
		Params:  disDisParamsRaw(callDisParamsRaw),
	}

	disResp, _, _, _ := agg.HandleToolsCall(context.Background(), disReq, proj)
	if disResp.Error == nil {
		t.Fatalf("expected error calling disabled tool, got nil")
	}
	if disResp.Error.Code != ErrCodePolicyRejected {
		t.Errorf("expected code ErrCodePolicyRejected (%d), got %d", ErrCodePolicyRejected, disResp.Error.Code)
	}
}

func disDisParamsRaw(b []byte) []byte {
	return b
}

func TestAggregatorPartialFailureDegradation(t *testing.T) {
	// Healthy server
	healthyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
			"result": map[string]interface{}{
				"tools": []MCPTool{{Name: "healthy_tool", Description: "I am alive"}},
			},
		})
	}))
	defer healthyServer.Close()

	pool := NewDownstreamPool("http://console:3000", slog.New(slog.NewTextHandler(io.Discard, nil)))
	agg := NewMCPAggregator(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	proj := &Project{
		ID:            "proj-degrade",
		Slug:          "test-degrade",
		Name:          "Degrade Project",
		ConfigVersion: 1,
		Servers: []MCPServer{
			{
				ID:              "srv-dead",
				Name:            "Dead Service",
				NamespacePrefix: "dead",
				URL:             "http://127.0.0.1:59999", // Connection refused
				Enabled:         true,
			},
			{
				ID:              "srv-alive",
				Name:            "Alive Service",
				NamespacePrefix: "alive",
				URL:             healthyServer.URL,
				Enabled:         true,
			},
		},
	}

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      5,
		Method:  "tools/list",
	}

	resp := agg.HandleToolsList(context.Background(), req, proj)
	if resp.Error != nil {
		t.Fatalf("tools/list must not fail on partial failure, but got error: %+v", resp.Error)
	}

	listRes, ok := resp.Result.(MCPToolsListResult)
	if !ok {
		t.Fatalf("expected MCPToolsListResult, got %T", resp.Result)
	}

	// Should still have tools from the healthy server!
	if len(listRes.Tools) != 1 || listRes.Tools[0].Name != "alive__healthy_tool" {
		t.Fatalf("expected 1 tool 'alive__healthy_tool', got: %+v", listRes.Tools)
	}

	// Warnings should contain note about Dead Service
	warnings, hasWarn := listRes.Meta["warnings"].([]string)
	if !hasWarn || len(warnings) == 0 {
		t.Fatalf("expected warnings metadata for partial failure, got: %+v", listRes.Meta)
	}
}

func TestAggregatorErrorNormalization(t *testing.T) {
	pool := NewDownstreamPool("http://console:3000", slog.New(slog.NewTextHandler(io.Discard, nil)))
	agg := NewMCPAggregator(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	proj := &Project{
		ID:            "proj-err",
		Slug:          "test-err",
		Name:          "Error Project",
		ConfigVersion: 1,
		Servers: []MCPServer{
			{
				ID:              "srv-dummy",
				Name:            "Dummy",
				NamespacePrefix: "dummy",
				URL:             "http://localhost:9999",
				Enabled:         true,
			},
		},
	}

	// Call non-existent tool
	callParamsRaw, _ := json.Marshal(map[string]interface{}{
		"name": "nonexistent__action",
	})
	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      6,
		Method:  "tools/call",
		Params:  callParamsRaw,
	}

	resp, _, _, _ := agg.HandleToolsCall(context.Background(), req, proj)
	if resp.Error == nil {
		t.Fatalf("expected error for nonexistent tool, got nil")
	}
	if resp.Error.Code != ErrCodeMethodNotFound {
		t.Errorf("expected ErrCodeMethodNotFound (-32601), got %d", resp.Error.Code)
	}
}
