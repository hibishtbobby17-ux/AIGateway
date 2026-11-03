package upstream_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"AIGateway/internal/identity/delegation"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/mcp/protocol"
	"AIGateway/internal/mcp/upstream"
)

func TestHTTPClient_DownstreamCredentialsAndAntiRelay(t *testing.T) {
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed initializing key manager: %v", err)
	}
	exchanger, err := delegation.NewTokenExchanger(keyManager, "https://gateway.example.com", 5*time.Minute)
	if err != nil {
		t.Fatalf("failed initializing exchanger: %v", err)
	}
	credProvider := delegation.NewProvider(exchanger)

	var lastReceivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastReceivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		id := json.RawMessage(`99`)
		resp := protocol.Response{
			JSONRPC: "2.0",
			ID:      &id,
			Result:  json.RawMessage(`{}`),
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Case 1: Delegated Token Exchange
	client := upstream.NewHTTPClient(upstream.Config{
		ServerID:           "test-server-1",
		EndpointURL:        server.URL,
		CredentialProvider: credProvider,
		AuthConfig: delegation.UpstreamAuthConfig{
			Type: delegation.TypeDelegatedTokenExchange,
		},
		AllowLocalEgress: true, // test server is loopback
	})

	callerCtx := principal.WithContext(context.Background(), principal.Principal{
		Subject:  "agent-007",
		TenantID: "tenant-corp",
		Roles:    []string{"tool-consumer"},
	})
	callerCtx = delegation.WithInboundToken(callerCtx, "inbound-client-bearer-token")

	err = client.Ping(callerCtx)
	if err != nil {
		t.Fatalf("ping failed: %v", err)
	}
	if lastReceivedAuth == "" || lastReceivedAuth == "Bearer inbound-client-bearer-token" {
		t.Errorf("expected downstream delegated token, got: %s", lastReceivedAuth)
	}

	// Case 2: Anti-Relay Violation (attempting to forward raw inbound client token)
	relayedClient := upstream.NewHTTPClient(upstream.Config{
		ServerID:         "test-server-2",
		EndpointURL:      server.URL,
		AuthHeader:       "Bearer inbound-client-bearer-token", // matches caller's inbound token!
		AllowLocalEgress: true,
	})

	err = relayedClient.Ping(callerCtx)
	if !errors.Is(err, delegation.ErrTokenRelayBlocked) {
		t.Errorf("expected ErrTokenRelayBlocked when attempting to relay raw inbound token, got: %v", err)
	}
}
