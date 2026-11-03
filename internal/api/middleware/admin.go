package middleware

import (
	"encoding/json"
	"net/http"

	"AIGateway/internal/audit"
	"AIGateway/internal/identity/principal"
)

// RequireRoles returns a middleware that verifies the authenticated caller possesses
// at least one of the specified roles. Denials are recorded in the audit log.
func RequireRoles(recorder audit.Recorder, allowedRoles ...string) func(http.Handler) http.Handler {
	allowedMap := make(map[string]bool, len(allowedRoles))
	for _, r := range allowedRoles {
		allowedMap[r] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := principal.FromContext(r.Context())
			if !ok || p.Subject == "" {
				writeAuthError(w, http.StatusUnauthorized, "authentication required for administrative operation")
				return
			}

			// Check role match
			hasRole := false
			for _, role := range p.Roles {
				if allowedMap[role] {
					hasRole = true
					break
				}
			}

			if !hasRole {
				if recorder != nil && p.TenantID != "" {
					_ = recorder.Record(r.Context(), audit.Event{
						TenantID:  p.TenantID,
						ActorID:   p.Subject,
						ActorType: audit.ActorTypeUser,
						Action:    audit.ActionAccessDenied,
						Outcome:   audit.OutcomeDenied,
						ClientIP:  r.RemoteAddr,
						UserAgent: r.UserAgent(),
						Metadata: map[string]any{
							"path":           r.URL.Path,
							"method":         r.Method,
							"required_roles": allowedRoles,
							"caller_roles":   p.Roles,
						},
					})
				}
				writeAuthError(w, http.StatusForbidden, "security violation: insufficient administrative privileges")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// WriteJSON is a helper to write consistent JSON responses.
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
