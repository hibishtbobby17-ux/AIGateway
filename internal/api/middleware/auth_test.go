package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/policy"
)

func TestOAuthAuthorizeRequiresAuthentication(t *testing.T) {
	tests := []struct {
		path   string
		public bool
	}{
		{path: "/oauth/authorize", public: false},
		{path: "/oauth/token", public: true},
		{path: "/oauth/revoke", public: true},
		{path: "/.well-known/jwks.json", public: true},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			if got := isPublicEndpoint(test.path); got != test.public {
				t.Fatalf("isPublicEndpoint(%q) = %t, want %t", test.path, got, test.public)
			}
		})
	}
}

func TestAuthMiddlewareAddsVerifiedPrincipalToRequestContext(t *testing.T) {
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	active, err := keyManager.GetActiveKey()
	if err != nil {
		t.Fatalf("get signing key: %v", err)
	}
	token, err := tokens.Sign(&tokens.Claims{
		Issuer: "https://issuer.example", Subject: "user-1", Audience: "gateway-api",
		TenantID: "tenant-1", Roles: []string{"user"}, Scopes: []string{"mcp:read"},
		IssuedAt: time.Now().Unix(), ExpiresAt: time.Now().Add(time.Minute).Unix(), TokenID: "token-1",
	}, active)
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}
	verifier := tokens.NewVerifier(keyManager, nil, "https://issuer.example", "gateway-api")

	var got principal.Principal
	handler := AuthMiddleware(verifier, policy.NewEngine())(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		var ok bool
		got, ok = principal.FromContext(r.Context())
		if !ok {
			t.Error("verified request context has no principal")
		}
	}))
	request := httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(httptest.NewRecorder(), request)

	if got.Subject != "user-1" || got.TenantID != "tenant-1" || len(got.Roles) != 1 || got.Roles[0] != "user" {
		t.Fatalf("principal from verified token = %+v", got)
	}
	if len(got.Scopes) != 1 || got.Scopes[0] != "mcp:read" {
		t.Fatalf("principal scopes = %v, want [mcp:read]", got.Scopes)
	}
}
