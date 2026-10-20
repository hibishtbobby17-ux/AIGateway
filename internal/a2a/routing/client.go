package routing

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"project_alpha/internal/a2a/protocol"
	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/observability/correlation"
	"project_alpha/internal/resilience"
)

var (
	ErrUpstreamUnavailable = errors.New("upstream agent service unavailable")
	ErrAgentCardFetchFailed = errors.New("failed to fetch agent card from upstream")
)

// AgentClient defines the client communication contract with an upstream A2A agent.
type AgentClient interface {
	FetchAgentCard(ctx context.Context) (*protocol.AgentCard, error)
	SubmitTask(ctx context.Context, task *protocol.Task) (*protocol.TaskResponse, error)
	CancelTask(ctx context.Context, taskID string) error
	Ping(ctx context.Context) error
	Close() error
}

// ClientConfig holds settings for HTTPAgentClient.
type ClientConfig struct {
	AgentID            string
	EndpointURL        string
	CredentialProvider delegation.CredentialProvider
	AuthConfig         delegation.UpstreamAuthConfig
	Timeout            time.Duration
	ConcurrencyLimit   int
	MaxRetries         int
	AllowLocalEgress   bool
	AllowedCIDRs       []string
}

// HTTPAgentClient implements AgentClient with SSRF defense, circuit breaker,
// concurrency bulkheads, token anti-relay, and W3C trace context propagation.
type HTTPAgentClient struct {
	agentID            string
	endpointURL        string
	httpClient         *http.Client
	circuitBreaker     *resilience.CircuitBreaker
	bulkhead           *resilience.Bulkhead
	timeout            time.Duration
	credentialProvider delegation.CredentialProvider
	authConfig         delegation.UpstreamAuthConfig
	maxRetries         int
}

// NewHTTPAgentClient creates a new resilient HTTPAgentClient.
func NewHTTPAgentClient(cfg ClientConfig) *HTTPAgentClient {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.ConcurrencyLimit <= 0 {
		cfg.ConcurrencyLimit = 50
	}
	if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 3
	}

	httpClient := resilience.NewSafeHTTPClient(cfg.AllowLocalEgress, cfg.AllowedCIDRs, cfg.Timeout)
	cb := resilience.NewCircuitBreaker(cfg.AgentID, 5, 30*time.Second)
	bh := resilience.NewBulkhead(cfg.ConcurrencyLimit)

	return &HTTPAgentClient{
		agentID:            cfg.AgentID,
		endpointURL:        strings.TrimRight(cfg.EndpointURL, "/"),
		httpClient:         httpClient,
		circuitBreaker:     cb,
		bulkhead:           bh,
		timeout:            cfg.Timeout,
		credentialProvider: cfg.CredentialProvider,
		authConfig:         cfg.AuthConfig,
		maxRetries:         cfg.MaxRetries,
	}
}

// FetchAgentCard discovers and validates the AgentCard from the upstream agent.
func (c *HTTPAgentClient) FetchAgentCard(ctx context.Context) (*protocol.AgentCard, error) {
	url := fmt.Sprintf("%s/card", c.endpointURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	var card protocol.AgentCard
	err = c.executeWithRetry(ctx, req, true, func(resp *http.Response) error {
		if resp.StatusCode == http.StatusNotFound {
			// Fallback to .well-known/agent.json
			return c.fetchWellKnownCard(ctx, &card)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("%w: status %d", ErrAgentCardFetchFailed, resp.StatusCode)
		}
		return json.NewDecoder(resp.Body).Decode(&card)
	})
	if err != nil {
		return nil, err
	}

	if err := card.Validate(); err != nil {
		return nil, fmt.Errorf("upstream agent card validation failed: %w", err)
	}
	return &card, nil
}

func (c *HTTPAgentClient) fetchWellKnownCard(ctx context.Context, dest *protocol.AgentCard) error {
	fallbackURL := fmt.Sprintf("%s/.well-known/agent.json", c.endpointURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fallbackURL, nil)
	if err != nil {
		return err
	}
	return c.executeWithRetry(ctx, req, true, func(resp *http.Response) error {
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("%w: fallback returned %d", ErrAgentCardFetchFailed, resp.StatusCode)
		}
		return json.NewDecoder(resp.Body).Decode(dest)
	})
}

// SubmitTask dispatches a task to the upstream agent.
func (c *HTTPAgentClient) SubmitTask(ctx context.Context, task *protocol.Task) (*protocol.TaskResponse, error) {
	if task == nil {
		return nil, errors.New("task cannot be nil")
	}

	url := fmt.Sprintf("%s/tasks", c.endpointURL)
	payloadBytes, err := json.Marshal(map[string]any{
		"id":              task.ID,
		"input_payload":   task.InputPayload,
		"idempotency_key": task.IdempotencyKey,
		"deadline":        task.Deadline,
	})
	if err != nil {
		return nil, fmt.Errorf("failed marshaling task payload: %w", err)
	}

	isIdempotent := task.IdempotencyKey != ""
	var taskResp protocol.TaskResponse

	err = c.executeWithRetry(ctx, nil, isIdempotent, func(resp *http.Response) error {
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
			return fmt.Errorf("upstream task execution failed with status %d: %s", resp.StatusCode, string(body))
		}
		return json.NewDecoder(resp.Body).Decode(&taskResp)
	}, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payloadBytes))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		c.injectTraceContext(ctx, req, task.TraceID, task.TenantID)
		return req, nil
	})

	if err != nil {
		return nil, err
	}
	return &taskResp, nil
}

// CancelTask requests upstream task cancellation.
func (c *HTTPAgentClient) CancelTask(ctx context.Context, taskID string) error {
	url := fmt.Sprintf("%s/tasks/%s/cancel", c.endpointURL, taskID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}

	return c.executeWithRetry(ctx, req, true, func(resp *http.Response) error {
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("upstream task cancellation failed with status %d", resp.StatusCode)
		}
		return nil
	})
}

// Ping verifies reachability of the upstream agent.
func (c *HTTPAgentClient) Ping(ctx context.Context) error {
	url := fmt.Sprintf("%s/healthz", c.endpointURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	return c.executeWithRetry(ctx, req, true, func(resp *http.Response) error {
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			// Try /ping
			pingURL := fmt.Sprintf("%s/ping", c.endpointURL)
			pReq, err := http.NewRequestWithContext(ctx, http.MethodGet, pingURL, nil)
			if err != nil {
				return err
			}
			return c.executeWithRetry(ctx, pReq, true, func(pResp *http.Response) error {
				if pResp.StatusCode < 200 || pResp.StatusCode >= 300 {
					return fmt.Errorf("upstream ping failed with status %d", pResp.StatusCode)
				}
				return nil
			})
		}
		return nil
	})
}

// Close closes idle connections.
func (c *HTTPAgentClient) Close() error {
	c.httpClient.CloseIdleConnections()
	return nil
}

func (c *HTTPAgentClient) executeWithRetry(
	ctx context.Context,
	staticReq *http.Request,
	allowRetry bool,
	handler func(*http.Response) error,
	requestBuilders ...func() (*http.Request, error),
) error {
	// 1. Acquire bulkhead slot
	if err := c.bulkhead.Acquire(ctx); err != nil {
		return err
	}
	defer c.bulkhead.Release()

	maxAttempts := 1
	if allowRetry && c.maxRetries > 0 {
		maxAttempts = c.maxRetries + 1
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(100*(1<<attempt)) * time.Millisecond):
			}
		}

		err := c.circuitBreaker.Execute(ctx, func(execCtx context.Context) error {
			var req *http.Request
			if len(requestBuilders) > 0 && requestBuilders[0] != nil {
				var err error
				req, err = requestBuilders[0]()
				if err != nil {
					return err
				}
			} else {
				req = staticReq.Clone(execCtx)
			}

			// Apply authentication & anti-relay
			if c.credentialProvider != nil {
				cred, err := c.credentialProvider.Resolve(execCtx, c.agentID, c.authConfig)
				if err != nil {
					return fmt.Errorf("delegated credential resolution failed: %w", err)
				}
				if cred != nil {
					inbound := delegation.InboundTokenFromContext(execCtx)
					if err := delegation.ValidateAntiRelay(inbound, cred); err != nil {
						return err
					}
					cred.Apply(req)
				}
			} else if c.authConfig.StaticToken != "" {
				inbound := delegation.InboundTokenFromContext(execCtx)
				staticCred := delegation.BearerCredential{Token: c.authConfig.StaticToken}
				if err := delegation.ValidateAntiRelay(inbound, staticCred); err != nil {
					return err
				}
				req.Header.Set("Authorization", "Bearer "+c.authConfig.StaticToken)
			}

			callCtx, cancel := context.WithTimeout(execCtx, c.timeout)
			defer cancel()
			req = req.WithContext(callCtx)

			resp, err := c.httpClient.Do(req)
			if err != nil {
				return err
			}
			defer resp.Body.Close()

			// Check for retryable server status codes (502, 503, 504)
			if allowRetry && (resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 504) {
				return fmt.Errorf("transient upstream error: status %d", resp.StatusCode)
			}

			return handler(resp)
		})

		if err == nil {
			return nil
		}
		lastErr = err
	}

	return lastErr
}

func (c *HTTPAgentClient) injectTraceContext(ctx context.Context, req *http.Request, explicitTraceID, tenantID string) {
	traceID := explicitTraceID
	if traceID == "" && ctx != nil {
		if val, ok := ctx.Value(correlation.TraceIDKey).(string); ok {
			traceID = val
		}
	}
	if traceID == "" {
		traceID = hex.EncodeToString(generateRandomBytes(16))
	}

	// Format as W3C traceparent (32 hex trace-id, 16 hex span-id)
	w3cTraceID := format32Hex(traceID)
	spanID := hex.EncodeToString(generateRandomBytes(8))
	traceparent := fmt.Sprintf("00-%s-%s-01", w3cTraceID, spanID)

	req.Header.Set("traceparent", traceparent)
	req.Header.Set("X-Trace-ID", traceID)
	if tenantID != "" {
		req.Header.Set("X-Tenant-ID", tenantID)
	}
}

func format32Hex(input string) string {
	clean := strings.ReplaceAll(input, "-", "")
	if len(clean) == 32 {
		return clean
	}
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:16])
}

func generateRandomBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = io.ReadFull(strings.NewReader(fmt.Sprintf("%d-%d", time.Now().UnixNano(), n)), b)
	return b
}

// MockAgentClient provides a programmable in-memory client for testing.
type MockAgentClient struct {
	mu           sync.Mutex
	Card         *protocol.AgentCard
	SubmitFunc   func(task *protocol.Task) (*protocol.TaskResponse, error)
	CancelFunc   func(taskID string) error
	PingFunc     func() error
	Submitted    []*protocol.Task
	Cancelled    []string
	ClosedCalled bool
}

// NewMockAgentClient creates a MockAgentClient.
func NewMockAgentClient(card *protocol.AgentCard) *MockAgentClient {
	return &MockAgentClient{
		Card: card,
	}
}

func (m *MockAgentClient) FetchAgentCard(ctx context.Context) (*protocol.AgentCard, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Card == nil {
		return nil, ErrAgentCardFetchFailed
	}
	return m.Card, nil
}

func (m *MockAgentClient) SubmitTask(ctx context.Context, task *protocol.Task) (*protocol.TaskResponse, error) {
	m.mu.Lock()
	m.Submitted = append(m.Submitted, task)
	fn := m.SubmitFunc
	m.mu.Unlock()

	if fn != nil {
		return fn(task)
	}
	return &protocol.TaskResponse{
		ID:            task.ID,
		Status:        protocol.StatusCompleted,
		OutputPayload: json.RawMessage(`{"status":"ok"}`),
	}, nil
}

func (m *MockAgentClient) CancelTask(ctx context.Context, taskID string) error {
	m.mu.Lock()
	m.Cancelled = append(m.Cancelled, taskID)
	fn := m.CancelFunc
	m.mu.Unlock()

	if fn != nil {
		return fn(taskID)
	}
	return nil
}

func (m *MockAgentClient) Ping(ctx context.Context) error {
	m.mu.Lock()
	fn := m.PingFunc
	m.mu.Unlock()

	if fn != nil {
		return fn()
	}
	return nil
}

func (m *MockAgentClient) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ClosedCalled = true
	return nil
}
