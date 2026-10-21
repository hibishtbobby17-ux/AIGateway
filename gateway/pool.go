package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type DownstreamPool struct {
	client      *http.Client
	consoleURL  string
	bulkheads   sync.Map // map[string]chan struct{}
	maxPerHost  int
	logger      *slog.Logger
	oauth       *OAuthManager
}

func NewDownstreamPool(consoleURL string, logger *slog.Logger) *DownstreamPool {
	if logger == nil {
		logger = slog.Default()
	}

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        256,
		MaxIdleConnsPerHost: 64,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 5 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &DownstreamPool{
		client: &http.Client{
			Transport: transport,
			Timeout:   30 * time.Second, // Global safety cap, per-request ctx controls actual timeout
		},
		consoleURL: consoleURL,
		maxPerHost: 50,
		logger:     logger,
	}
}

func (p *DownstreamPool) SetOAuthManager(oauth *OAuthManager) {
	p.oauth = oauth
}

// normalizeURL resolves docker network hostnames if running within docker compose
func (p *DownstreamPool) normalizeURL(rawURL string) string {
	if strings.Contains(p.consoleURL, "console:") {
		rawURL = strings.Replace(rawURL, "://localhost:3000", "://console:3000", 1)
		rawURL = strings.Replace(rawURL, "://127.0.0.1:3000", "://console:3000", 1)
	}
	return rawURL
}

// acquireBulkhead limits concurrent in-flight requests per downstream server
func (p *DownstreamPool) acquireBulkhead(serverID string) (func(), error) {
	val, _ := p.bulkheads.LoadOrStore(serverID, make(chan struct{}, p.maxPerHost))
	sem := val.(chan struct{})

	select {
	case sem <- struct{}{}:
		return func() { <-sem }, nil
	default:
		return nil, fmt.Errorf("downstream concurrency bulkhead limit (%d) reached for server %s", p.maxPerHost, serverID)
	}
}

// generateTraceparent generates W3C traceparent header: 00-{32hex}-{16hex}-01
func generateTraceparent() (string, string) {
	traceBytes := make([]byte, 16)
	spanBytes := make([]byte, 8)
	_, _ = rand.Read(traceBytes)
	_, _ = rand.Read(spanBytes)
	traceID := hex.EncodeToString(traceBytes)
	spanID := hex.EncodeToString(spanBytes)
	return fmt.Sprintf("00-%s-%s-01", traceID, spanID), traceID
}

// Execute sends a JSON-RPC request to a downstream MCP server with pooling, bulkheading, and trace context
func (p *DownstreamPool) Execute(ctx context.Context, server *MCPServer, rpcReq *JSONRPCRequest) (*JSONRPCResponse, string, error) {
	release, err := p.acquireBulkhead(server.ID)
	if err != nil {
		return nil, "", err
	}
	defer release()

	targetURL := p.normalizeURL(server.URL)
	traceparent, traceID := generateTraceparent()

	rawBody, err := json.Marshal(rpcReq)
	if err != nil {
		return nil, traceID, fmt.Errorf("failed to encode downstream request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewBuffer(rawBody))
	if err != nil {
		return nil, traceID, fmt.Errorf("failed to create downstream request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("traceparent", traceparent)

	// Attach outbound OAuth token if configured
	if p.oauth != nil && (server.AuthType == "oauth_cc" || server.AuthType == "oauth_authcode") {
		token, tokenErr := p.oauth.GetOutboundToken(ctx, server, false)
		if tokenErr != nil {
			return nil, traceID, fmt.Errorf("failed to obtain token for %s: %w", server.Name, tokenErr)
		}
		if token != "" {
			httpReq.Header.Set("Authorization", "Bearer "+token)
		}
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, traceID, fmt.Errorf("downstream connection failed: %w", err)
	}

	// On 401 Unauthorized, force token refresh and retry ONCE
	if resp.StatusCode == http.StatusUnauthorized && p.oauth != nil && (server.AuthType == "oauth_cc" || server.AuthType == "oauth_authcode") {
		_ = resp.Body.Close()
		p.logger.Warn("downstream returned 401, forcing token refresh and retrying once", "server", server.Name)
		refreshedToken, refErr := p.oauth.GetOutboundToken(ctx, server, true)
		if refErr != nil {
			return nil, traceID, fmt.Errorf("token refresh failed for %s: %w", server.Name, refErr)
		}

		retryReq, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewBuffer(rawBody))
		if err != nil {
			return nil, traceID, err
		}
		retryReq.Header.Set("Content-Type", "application/json")
		retryReq.Header.Set("Accept", "application/json")
		retryReq.Header.Set("traceparent", traceparent)
		retryReq.Header.Set("Authorization", "Bearer "+refreshedToken)

		resp, err = p.client.Do(retryReq)
		if err != nil {
			return nil, traceID, fmt.Errorf("downstream retry failed: %w", err)
		}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, traceID, fmt.Errorf("failed to read downstream response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(respBody))
		if len(snippet) > 80 {
			snippet = snippet[:80] + "..."
		}
		return nil, traceID, fmt.Errorf("downstream returned HTTP %d: %s", resp.StatusCode, snippet)
	}

	var rpcResp JSONRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, traceID, fmt.Errorf("invalid downstream JSON-RPC response: %w (body: %s)", err, string(respBody))
	}

	// Ensure response ID matches request ID
	rpcResp.ID = rpcReq.ID
	return &rpcResp, traceID, nil
}
