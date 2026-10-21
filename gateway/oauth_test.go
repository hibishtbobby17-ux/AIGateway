package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOAuthInboundBearerVerification(t *testing.T) {
	// 1. Generate RSA key for mock IdP
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	nStr := base64.RawURLEncoding.EncodeToString(privKey.N.Bytes())
	eStr := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privKey.E)).Bytes())

	// 2. Start Mock JWKS server
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(JWKSResponse{
			Keys: []JWKKey{
				{
					Kty: "RSA",
					Use: "sig",
					Alg: "RS256",
					Kid: "test-kid",
					N:   nStr,
					E:   eStr,
				},
			},
		})
	}))
	defer jwksServer.Close()

	oauthMgr := NewOAuthManager("http://console:3000", nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// Helper to sign JWT
	signToken := func(iss, aud string, exp int64) string {
		header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"test-kid"}`))
		payloadMap := map[string]interface{}{
			"iss": iss,
			"aud": aud,
			"exp": exp,
			"sub": "user-123",
		}
		rawPayload, _ := json.Marshal(payloadMap)
		payload := base64.RawURLEncoding.EncodeToString(rawPayload)

		msg := header + "." + payload
		hashed := sha256.Sum256([]byte(msg))
		sigBytes, _ := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, hashed[:])
		sig := base64.RawURLEncoding.EncodeToString(sigBytes)
		return msg + "." + sig
	}

	inboundAuth := InboundAuth{
		Mode:     "oauth",
		Issuer:   "https://auth.example.com",
		JWKSUri:  jwksServer.URL,
		Audience: "https://api.example.com",
	}

	// Case A: Valid Token
	validToken := signToken("https://auth.example.com", "https://api.example.com", time.Now().Add(1*time.Hour).Unix())
	payload, err := oauthMgr.VerifyInboundBearer(context.Background(), validToken, inboundAuth)
	if err != nil {
		t.Fatalf("expected valid token to pass, got: %v", err)
	}
	if payload.Subject != "user-123" {
		t.Errorf("expected subject user-123, got %s", payload.Subject)
	}

	// Case B: Expired Token
	expiredToken := signToken("https://auth.example.com", "https://api.example.com", time.Now().Add(-10*time.Minute).Unix())
	_, err = oauthMgr.VerifyInboundBearer(context.Background(), expiredToken, inboundAuth)
	if err == nil {
		t.Fatalf("expected expired token to fail, got nil")
	}

	// Case C: Issuer Mismatch
	wrongIssToken := signToken("https://wrong-auth.com", "https://api.example.com", time.Now().Add(1*time.Hour).Unix())
	_, err = oauthMgr.VerifyInboundBearer(context.Background(), wrongIssToken, inboundAuth)
	if err == nil {
		t.Fatalf("expected issuer mismatch to fail, got nil")
	}
}

func TestOAuthOutboundClientCredentials(t *testing.T) {
	tokenCallCount := 0
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenCallCount++
		grantType := r.FormValue("grant_type")
		if grantType != "client_credentials" {
			http.Error(w, "invalid grant_type", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token": "mock-cc-token-123",
			"expires_in":   3600,
		})
	}))
	defer tokenServer.Close()

	oauthMgr := NewOAuthManager("http://console:3000", nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	server := &MCPServer{
		ID:       "srv-cc-1",
		Name:     "Secure CC Server",
		AuthType: "oauth_cc",
		OAuthConfig: &OAuthConfig{
			TokenEndpoint: tokenServer.URL,
			ClientID:      "test-client",
			ClientSecret:  "test-secret",
			Scopes:        []string{"mcp:tools"},
		},
	}

	// 1. Initial token acquisition
	token1, err := oauthMgr.GetOutboundToken(context.Background(), server, false)
	if err != nil {
		t.Fatalf("failed to get outbound cc token: %v", err)
	}
	if token1 != "mock-cc-token-123" {
		t.Fatalf("unexpected token: %s", token1)
	}
	if tokenCallCount != 1 {
		t.Errorf("expected 1 token call, got %d", tokenCallCount)
	}

	// 2. Cached token acquisition (should not call endpoint again)
	token2, err := oauthMgr.GetOutboundToken(context.Background(), server, false)
	if err != nil {
		t.Fatalf("failed to get cached token: %v", err)
	}
	if token2 != "mock-cc-token-123" {
		t.Fatalf("unexpected cached token: %s", token2)
	}
	if tokenCallCount != 1 {
		t.Errorf("expected tokenCallCount to remain 1, got %d", tokenCallCount)
	}

	// 3. Forced refresh token acquisition (should call endpoint again)
	token3, err := oauthMgr.GetOutboundToken(context.Background(), server, true)
	if err != nil {
		t.Fatalf("failed to force refresh token: %v", err)
	}
	if token3 != "mock-cc-token-123" {
		t.Fatalf("unexpected refreshed token: %s", token3)
	}
	if tokenCallCount != 2 {
		t.Errorf("expected tokenCallCount to be 2, got %d", tokenCallCount)
	}
}

func TestOAuthOutboundAuthCodeDeliveryAndReauthRequired(t *testing.T) {
	reauthMode := false
	consoleServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reauthMode {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "reauth_required",
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token": "console-delivered-access-token",
			"expires_in":   1800,
		})
	}))
	defer consoleServer.Close()

	gw := &Gateway{
		token:       "test-gw-token",
		tokenExpiry: time.Now().Add(1 * time.Hour),
	}
	oauthMgr := NewOAuthManager(consoleServer.URL, gw, slog.New(slog.NewTextHandler(io.Discard, nil)))

	server := &MCPServer{
		ID:       "srv-authcode-1",
		Name:     "Secure AuthCode Server",
		AuthType: "oauth_authcode",
	}

	// 1. Successful token delivery from Console
	token, err := oauthMgr.GetOutboundToken(context.Background(), server, false)
	if err != nil {
		t.Fatalf("expected successful token delivery, got: %v", err)
	}
	if token != "console-delivered-access-token" {
		t.Fatalf("unexpected token: %s", token)
	}

	// 2. Reauth-required error propagation
	reauthMode = true
	_, err = oauthMgr.GetOutboundToken(context.Background(), server, true)
	if !errors.Is(err, ErrReauthRequired) {
		t.Fatalf("expected ErrReauthRequired, got: %v", err)
	}
}
