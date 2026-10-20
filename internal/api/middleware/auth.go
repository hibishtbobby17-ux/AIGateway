package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/observability/correlation"
	"project_alpha/internal/policy"
)

type authContextKey string

const (
	SubjectKey authContextKey = "auth_subject"
	RolesKey   authContextKey = "auth_roles"
	ScopesKey  authContextKey = "auth_scopes"
)

// GetSubject returns authenticated subject from context.
func GetSubject(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(SubjectKey).(string); ok {
		return v
	}
	return ""
}

// GetRoles returns authenticated roles from context.
func GetRoles(ctx context.Context) []string {
	if ctx == nil {
		return nil
	}
	if v, ok := ctx.Value(RolesKey).([]string); ok {
		return v
	}
	return nil
}

// GetScopes returns authenticated scopes from context.
func GetScopes(ctx context.Context) []string {
	if ctx == nil {
		return nil
	}
	if v, ok := ctx.Value(ScopesKey).([]string); ok {
		return v
	}
	return nil
}

// AuthMiddleware inspects Bearer JWT tokens, validates signatures & tenant isolation,
// and populates caller context.
func AuthMiddleware(verifier *tokens.Verifier, engine *policy.Engine) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			// Public endpoints that do not require mandatory authentication
			if isPublicEndpoint(path) {
				authHeader := r.Header.Get("Authorization")
				if authHeader != "" && strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
					tokenStr := strings.TrimSpace(authHeader[7:])
					if claims, err := verifier.VerifyContext(r.Context(), tokenStr); err == nil {
						ctx := r.Context()
						ctx = delegation.WithInboundToken(ctx, tokenStr)
						ctx = context.WithValue(ctx, correlation.TenantIDKey, claims.TenantID)
						ctx = context.WithValue(ctx, SubjectKey, claims.Subject)
						ctx = context.WithValue(ctx, RolesKey, claims.Roles)
						ctx = context.WithValue(ctx, ScopesKey, claims.Scopes)
						ctx = principal.WithContext(ctx, principal.Principal{
							Subject:    claims.Subject,
							TenantID:   claims.TenantID,
							Roles:      append([]string(nil), claims.Roles...),
							Scopes:     append([]string(nil), claims.Scopes...),
							Attributes: cloneAttributes(claims.Attributes),
						})
						r = r.WithContext(ctx)
					}
				}
				next.ServeHTTP(w, r)
				return
			}

			tokenStr := ""
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" && strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
				tokenStr = strings.TrimSpace(authHeader[7:])
			} else if cookie, err := r.Cookie("gateway_console_session"); err == nil && cookie.Value != "" {
				tokenStr = strings.TrimSpace(cookie.Value)
			}

			if tokenStr == "" {
				writeAuthError(w, http.StatusUnauthorized, "missing or malformed Authorization header (expected 'Bearer <token>') or session cookie")
				return
			}

			claims, err := verifier.VerifyContext(r.Context(), tokenStr)
			if err != nil {
				if errors.Is(err, tokens.ErrRevocationCheck) || errors.Is(err, tokens.ErrRevocationStore) {
					writeAuthError(w, http.StatusServiceUnavailable, "token revocation status is unavailable")
					return
				}
				writeAuthError(w, http.StatusUnauthorized, "token verification failed: "+err.Error())
				return
			}

			// Tenant Isolation Enforcement:
			// If client provides an explicit X-Tenant-ID header, it MUST match the token's tenant_id claim.
			requestedTenant := r.Header.Get("X-Tenant-ID")
			if requestedTenant != "" && requestedTenant != claims.TenantID {
				writeAuthError(w, http.StatusForbidden, "security violation: cross-tenant access prohibited")
				return
			}

			// Populate request context with authenticated caller claims
			ctx := r.Context()
			ctx = delegation.WithInboundToken(ctx, tokenStr)
			ctx = context.WithValue(ctx, correlation.TenantIDKey, claims.TenantID)
			ctx = context.WithValue(ctx, SubjectKey, claims.Subject)
			ctx = context.WithValue(ctx, RolesKey, claims.Roles)
			ctx = context.WithValue(ctx, ScopesKey, claims.Scopes)
			ctx = principal.WithContext(ctx, principal.Principal{
				Subject:    claims.Subject,
				TenantID:   claims.TenantID,
				Roles:      append([]string(nil), claims.Roles...),
				Scopes:     append([]string(nil), claims.Scopes...),
				Attributes: cloneAttributes(claims.Attributes),
			})

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func cloneAttributes(attributes map[string]any) map[string]any {
	if attributes == nil {
		return nil
	}
	cloned := make(map[string]any, len(attributes))
	for key, value := range attributes {
		cloned[key] = value
	}
	return cloned
}

func isPublicEndpoint(p string) bool {
	if p == "/healthz" || p == "/readyz" || p == "/startupz" || p == "/" || p == "/metrics" {
		return true
	}
	if strings.HasPrefix(p, "/.well-known/") {
		return true
	}
	if p == "/oauth/token" || p == "/oauth/revoke" || p == "/login" || p == "/consent" || p == "/api/v1/auth/login" {
		return true
	}
	if strings.HasPrefix(p, "/v1/") {
		return true
	}
	return false
}

func writeAuthError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   http.StatusText(statusCode),
		"message": message,
	})
}
