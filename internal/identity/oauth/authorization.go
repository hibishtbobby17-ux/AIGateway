package oauth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"AIGateway/internal/identity/principal"
)

var (
	ErrAuthenticatedPrincipalRequired = errors.New("authenticated principal is required")
	ErrConsentRequired                = errors.New("explicit client consent is required")
	ErrConsentTenantMismatch          = errors.New("authenticated principal and OAuth client tenants do not match")
)

type SQLAuthorizationService struct {
	db *sql.DB
}

func NewSQLAuthorizationService(db *sql.DB) (*SQLAuthorizationService, error) {
	if db == nil {
		return nil, errors.New("OAuth authorization service requires a database")
	}
	return &SQLAuthorizationService{db: db}, nil
}

// GrantConsent records a trusted, pre-approved set of scopes for a user and
// client. Callers must be privileged control-plane code; this is not an HTTP API.
func (s *SQLAuthorizationService) GrantConsent(ctx context.Context, tenantID, subject, clientID string, scopes []string) error {
	if tenantID == "" || subject == "" || clientID == "" || len(scopes) == 0 {
		return errors.New("tenant, subject, client, and at least one consent scope are required")
	}
	var clientTenant, allowedJSON string
	if err := s.db.QueryRowContext(ctx,
		"SELECT tenant_id, allowed_scopes FROM oauth_clients WHERE client_id = $1", clientID,
	).Scan(&clientTenant, &allowedJSON); err != nil {
		return fmt.Errorf("load OAuth client for consent: %w", err)
	}
	if clientTenant != tenantID {
		return ErrConsentTenantMismatch
	}
	var allowedScopes []string
	if err := json.Unmarshal([]byte(allowedJSON), &allowedScopes); err != nil {
		return fmt.Errorf("decode OAuth client scopes for consent: %w", err)
	}
	if !scopesSubset(scopes, allowedScopes) {
		return errors.New("consent scopes exceed client registration")
	}
	encodedScopes, err := json.Marshal(scopes)
	if err != nil {
		return fmt.Errorf("encode OAuth consent scopes: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO oauth_consents (tenant_id, subject, client_id, scopes)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tenant_id, subject, client_id)
		DO UPDATE SET scopes = excluded.scopes, updated_at = CURRENT_TIMESTAMP`,
		tenantID, subject, clientID, string(encodedScopes),
	)
	if err != nil {
		return fmt.Errorf("persist OAuth consent: %w", err)
	}
	return nil
}

func (s *SQLAuthorizationService) RevokeConsent(ctx context.Context, tenantID, subject, clientID string) error {
	if tenantID == "" || subject == "" || clientID == "" {
		return errors.New("tenant, subject, and client are required to revoke consent")
	}
	_, err := s.db.ExecContext(ctx,
		"DELETE FROM oauth_consents WHERE tenant_id = $1 AND subject = $2 AND client_id = $3",
		tenantID, subject, clientID,
	)
	if err != nil {
		return fmt.Errorf("revoke OAuth consent: %w", err)
	}
	return nil
}

func (s *SQLAuthorizationService) Authorize(ctx context.Context, _ *http.Request, client *Client, requestedScopes []string) (AuthorizationDecision, error) {
	if client == nil {
		return AuthorizationDecision{}, errors.New("OAuth client is required")
	}
	authenticated, ok := principal.FromContext(ctx)
	if !ok || authenticated.Subject == "" || authenticated.TenantID == "" {
		return AuthorizationDecision{}, ErrAuthenticatedPrincipalRequired
	}
	if authenticated.TenantID != client.TenantID {
		return AuthorizationDecision{}, ErrConsentTenantMismatch
	}

	var encodedScopes string
	err := s.db.QueryRowContext(ctx, `
		SELECT scopes FROM oauth_consents
		WHERE tenant_id = $1 AND subject = $2 AND client_id = $3`,
		authenticated.TenantID, authenticated.Subject, client.ClientID,
	).Scan(&encodedScopes)
	if errors.Is(err, sql.ErrNoRows) {
		return AuthorizationDecision{}, ErrConsentRequired
	}
	if err != nil {
		return AuthorizationDecision{}, fmt.Errorf("load OAuth consent: %w", err)
	}
	var consentedScopes []string
	if err := json.Unmarshal([]byte(encodedScopes), &consentedScopes); err != nil {
		return AuthorizationDecision{}, fmt.Errorf("decode OAuth consent scopes: %w", err)
	}
	grantedScopes := make([]string, 0, len(requestedScopes))
	for _, scope := range requestedScopes {
		if contains(consentedScopes, scope) && contains(client.AllowedScopes, scope) {
			grantedScopes = append(grantedScopes, scope)
		}
	}
	if len(grantedScopes) == 0 {
		return AuthorizationDecision{}, ErrConsentRequired
	}
	return AuthorizationDecision{Subject: authenticated.Subject, Scopes: grantedScopes}, nil
}
