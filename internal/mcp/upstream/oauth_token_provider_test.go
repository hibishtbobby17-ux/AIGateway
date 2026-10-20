package upstream_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/mcp/upstream"
)

func TestOAuthTokenProvider_GetTokenAndCaching(t *testing.T) {
	var requestCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)

		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form", http.StatusBadRequest)
			return
		}

		if r.FormValue("grant_type") != "client_credentials" {
			http.Error(w, "invalid grant_type", http.StatusBadRequest)
			return
		}

		if r.FormValue("client_id") != "test-client" || r.FormValue("client_secret") != "test-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":             "invalid_client",
				"error_description": "bad client credentials",
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "token-xyz-12345",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer server.Close()

	provider := upstream.NewOAuthTokenProvider(5*time.Second, true)

	cfg := delegation.UpstreamAuthConfig{
		Type:          delegation.TypeOAuth2ClientCredentials,
		TokenEndpoint: server.URL,
		ClientID:      "test-client",
		ClientSecret:  "test-secret",
		Scopes:        "tools:execute",
	}

	ctx := context.Background()

	// 1. First call: acquires token from remote server
	tok1, err := provider.GetToken(ctx, "srv-1", cfg)
	if err != nil {
		t.Fatalf("expected successful token fetch, got: %v", err)
	}
	if tok1 != "token-xyz-12345" {
		t.Fatalf("unexpected token value: %s", tok1)
	}
	if atomic.LoadInt32(&requestCount) != 1 {
		t.Fatalf("expected 1 http request, got %d", requestCount)
	}

	// 2. Second call: should serve from cache (requestCount remains 1)
	tok2, err := provider.GetToken(ctx, "srv-1", cfg)
	if err != nil {
		t.Fatalf("expected cached token fetch, got: %v", err)
	}
	if tok2 != tok1 {
		t.Fatalf("expected identical token from cache")
	}
	if atomic.LoadInt32(&requestCount) != 1 {
		t.Fatalf("expected request count still 1 after cache hit, got %d", requestCount)
	}

	// 3. Test invalid credentials
	badCfg := cfg
	badCfg.ClientSecret = "wrong-secret"
	_, err = provider.GetToken(ctx, "srv-bad", badCfg)
	if err == nil {
		t.Fatalf("expected error for bad credentials, got nil")
	}
}

func TestOAuthTokenProvider_FetchTokenDirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "test-direct-token",
			"token_type":   "Bearer",
			"expires_in":   1800,
		})
	}))
	defer server.Close()

	provider := upstream.NewOAuthTokenProvider(5*time.Second, true)

	res, err := provider.FetchTokenDirect(context.Background(), server.URL, "client", "secret", "read", "")
	if err != nil {
		t.Fatalf("expected direct token probe success, got: %v", err)
	}
	if res["status"] != "ok" {
		t.Fatalf("expected status 'ok', got: %v", res["status"])
	}
	if res["token_type"] != "Bearer" {
		t.Fatalf("expected token_type 'Bearer'")
	}
}
