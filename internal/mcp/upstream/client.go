package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"project_alpha/internal/mcp/protocol"
	"project_alpha/internal/resilience"
)

// Client defines the upstream MCP server contract.
type Client interface {
	Initialize(ctx context.Context) (*protocol.InitializeResult, error)
	ListTools(ctx context.Context) (*protocol.ListToolsResult, error)
	CallTool(ctx context.Context, name string, args json.RawMessage) (*protocol.CallToolResult, error)
	ListResources(ctx context.Context) (*protocol.ListResourcesResult, error)
	ListPrompts(ctx context.Context) (*protocol.ListPromptsResult, error)
	Ping(ctx context.Context) error
	Close() error
}

// HTTPClient is an HTTP-based upstream MCP client protected with SSRF defenses,
// circuit breaker, and concurrency bulkheads.
type HTTPClient struct {
	serverID       string
	endpointURL    string
	httpClient     *http.Client
	circuitBreaker *resilience.CircuitBreaker
	bulkhead       *resilience.Bulkhead
	timeout        time.Duration
	authHeader     string
}

// Config defines options for creating an HTTPClient.
type Config struct {
	ServerID         string
	EndpointURL      string
	AuthHeader       string
	Timeout          time.Duration
	ConcurrencyLimit int
	AllowLocalEgress bool
	AllowedCIDRs     []string
}

// NewHTTPClient creates a resilient HTTPClient.
func NewHTTPClient(cfg Config) *HTTPClient {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.ConcurrencyLimit <= 0 {
		cfg.ConcurrencyLimit = 50
	}

	httpClient := resilience.NewSafeHTTPClient(cfg.AllowLocalEgress, cfg.AllowedCIDRs, cfg.Timeout)
	cb := resilience.NewCircuitBreaker(cfg.ServerID, 5, 30*time.Second)
	bh := resilience.NewBulkhead(cfg.ConcurrencyLimit)

	return &HTTPClient{
		serverID:       cfg.ServerID,
		endpointURL:    cfg.EndpointURL,
		httpClient:     httpClient,
		circuitBreaker: cb,
		bulkhead:       bh,
		timeout:        cfg.Timeout,
		authHeader:     cfg.AuthHeader,
	}
}

// Initialize sends the standard initialize RPC to upstream.
func (c *HTTPClient) Initialize(ctx context.Context) (*protocol.InitializeResult, error) {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(1),
		Method:  "initialize",
		Params: mustMarshal(protocol.InitializeParams{
			ProtocolVersion: protocol.ProtocolVersion,
			ClientInfo: protocol.Implementation{
				Name:    "ai-gateway",
				Version: "1.0.0",
			},
		}),
	}

	var res protocol.InitializeResult
	if err := c.doRPC(ctx, req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ListTools retrieves tools exposed by the upstream server.
func (c *HTTPClient) ListTools(ctx context.Context) (*protocol.ListToolsResult, error) {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(2),
		Method:  "tools/list",
	}

	var res protocol.ListToolsResult
	if err := c.doRPC(ctx, req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// CallTool invokes a tool on the upstream server.
func (c *HTTPClient) CallTool(ctx context.Context, name string, args json.RawMessage) (*protocol.CallToolResult, error) {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(3),
		Method:  "tools/call",
		Params: mustMarshal(protocol.CallToolParams{
			Name:      name,
			Arguments: args,
		}),
	}

	var res protocol.CallToolResult
	if err := c.doRPC(ctx, req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ListResources queries resources from upstream.
func (c *HTTPClient) ListResources(ctx context.Context) (*protocol.ListResourcesResult, error) {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(4),
		Method:  "resources/list",
	}

	var res protocol.ListResourcesResult
	if err := c.doRPC(ctx, req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ListPrompts queries prompts from upstream.
func (c *HTTPClient) ListPrompts(ctx context.Context) (*protocol.ListPromptsResult, error) {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(5),
		Method:  "prompts/list",
	}

	var res protocol.ListPromptsResult
	if err := c.doRPC(ctx, req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// Ping checks if the upstream server responds.
func (c *HTTPClient) Ping(ctx context.Context) error {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      rawID(99),
		Method:  "ping",
	}
	var res map[string]any
	return c.doRPC(ctx, req, &res)
}

// Close cleans up client connections.
func (c *HTTPClient) Close() error {
	c.httpClient.CloseIdleConnections()
	return nil
}

func (c *HTTPClient) doRPC(ctx context.Context, rpcReq protocol.Request, resultDest any) error {
	// 1. Acquire bulkhead concurrency slot
	if err := c.bulkhead.Acquire(ctx); err != nil {
		return err
	}
	defer c.bulkhead.Release()

	// 2. Execute via circuit breaker with timeout
	return c.circuitBreaker.Execute(ctx, func(execCtx context.Context) error {
		callCtx, cancel := context.WithTimeout(execCtx, c.timeout)
		defer cancel()

		payload, err := json.Marshal(rpcReq)
		if err != nil {
			return err
		}

		httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, c.endpointURL, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		if c.authHeader != "" {
			httpReq.Header.Set("Authorization", c.authHeader)
		}

		httpResp, err := c.httpClient.Do(httpReq)
		if err != nil {
			return fmt.Errorf("upstream call failed: %w", err)
		}
		defer httpResp.Body.Close()

		if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
			return fmt.Errorf("upstream returned non-2xx status: %d", httpResp.StatusCode)
		}

		var rpcResp protocol.Response
		if err := json.NewDecoder(httpResp.Body).Decode(&rpcResp); err != nil {
			return fmt.Errorf("failed decoding upstream JSON-RPC response: %w", err)
		}

		if rpcResp.Error != nil {
			return rpcResp.Error
		}

		if resultDest != nil && len(rpcResp.Result) > 0 {
			if err := json.Unmarshal(rpcResp.Result, resultDest); err != nil {
				return fmt.Errorf("failed unmarshaling result payload: %w", err)
			}
		}

		return nil
	})
}

// --- Mock Client Implementation for Testing ---

// MockClient provides an in-memory MCP upstream for tests.
type MockClient struct {
	mu           sync.Mutex
	tools        []protocol.Tool
	resources    []protocol.Resource
	prompts      []protocol.Prompt
	callHandlers map[string]func(args json.RawMessage) (*protocol.CallToolResult, error)
	Closed       bool
	FailPing     bool
}

// NewMockClient creates a new mock MCP upstream client.
func NewMockClient() *MockClient {
	return &MockClient{
		callHandlers: make(map[string]func(args json.RawMessage) (*protocol.CallToolResult, error)),
	}
}

func (m *MockClient) AddTool(tool protocol.Tool, handler func(args json.RawMessage) (*protocol.CallToolResult, error)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tools = append(m.tools, tool)
	if handler != nil {
		m.callHandlers[tool.Name] = handler
	}
}

func (m *MockClient) AddResource(resource protocol.Resource) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resources = append(m.resources, resource)
}

func (m *MockClient) AddPrompt(prompt protocol.Prompt) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prompts = append(m.prompts, prompt)
}

func (m *MockClient) Initialize(ctx context.Context) (*protocol.InitializeResult, error) {
	return &protocol.InitializeResult{
		ProtocolVersion: protocol.ProtocolVersion,
		ServerInfo: protocol.Implementation{
			Name:    "mock-upstream",
			Version: "1.0.0",
		},
	}, nil
}

func (m *MockClient) ListTools(ctx context.Context) (*protocol.ListToolsResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return &protocol.ListToolsResult{Tools: m.tools}, nil
}

func (m *MockClient) CallTool(ctx context.Context, name string, args json.RawMessage) (*protocol.CallToolResult, error) {
	m.mu.Lock()
	handler, ok := m.callHandlers[name]
	m.mu.Unlock()

	if !ok {
		return nil, fmt.Errorf("tool %q not found on mock upstream", name)
	}
	return handler(args)
}

func (m *MockClient) ListResources(ctx context.Context) (*protocol.ListResourcesResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return &protocol.ListResourcesResult{Resources: m.resources}, nil
}

func (m *MockClient) ListPrompts(ctx context.Context) (*protocol.ListPromptsResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return &protocol.ListPromptsResult{Prompts: m.prompts}, nil
}

func (m *MockClient) Ping(ctx context.Context) error {
	if m.FailPing {
		return fmt.Errorf("upstream ping failed")
	}
	return nil
}

func (m *MockClient) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Closed = true
	return nil
}

func rawID(id int) *json.RawMessage {
	raw := json.RawMessage([]byte(fmt.Sprintf("%d", id)))
	return &raw
}

func mustMarshal(v any) json.RawMessage {
	raw, _ := json.Marshal(v)
	return raw
}
