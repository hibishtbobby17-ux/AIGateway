package oauth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/handler/pkce"

	"project_alpha/internal/identity/tokens"
)

const (
	fositeAuthorizeCode = "authorize_code"
	fositePKCE          = "pkce"
	fositeAccessToken   = "access_token"
	fositeRefreshToken  = "refresh_token"
)

// SQLStore implements Fosite's client, grant, token, PKCE, and replay storage
// contracts using the application's SQL database.
type SQLStore struct {
	db     *sql.DB
	hasher fosite.Hasher
}

var (
	_ fosite.Storage                = (*SQLStore)(nil)
	_ oauth2.CoreStorage            = (*SQLStore)(nil)
	_ oauth2.TokenRevocationStorage = (*SQLStore)(nil)
	_ pkce.PKCERequestStorage       = (*SQLStore)(nil)
)

func NewSQLStore(db *sql.DB, hasher fosite.Hasher) (*SQLStore, error) {
	if db == nil {
		return nil, errors.New("oauth SQL store requires a database")
	}
	if hasher == nil {
		return nil, errors.New("oauth SQL store requires a client secret hasher")
	}
	return &SQLStore{db: db, hasher: hasher}, nil
}

// RegisterClient persists a validated client registration. The returned
// registration omits the cleartext secret.
func (s *SQLStore) RegisterClient(ctx context.Context, client *Client) error {
	if err := validateClient(client); err != nil {
		return err
	}
	var secretHash []byte
	if client.ClientType == "CONFIDENTIAL" {
		var err error
		secretHash, err = s.hasher.Hash(ctx, []byte(client.ClientSecret))
		if err != nil {
			return fmt.Errorf("hash oauth client secret: %w", err)
		}
	}
	grants, err := json.Marshal(client.AllowedGrantTypes)
	if err != nil {
		return fmt.Errorf("encode oauth client grant types: %w", err)
	}
	redirects, err := json.Marshal(client.RedirectURIs)
	if err != nil {
		return fmt.Errorf("encode oauth client redirect uris: %w", err)
	}
	scopes, err := json.Marshal(client.AllowedScopes)
	if err != nil {
		return fmt.Errorf("encode oauth client scopes: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO oauth_clients
			(id, tenant_id, client_id, client_secret_hash, client_type, allowed_grant_types, redirect_uris, allowed_scopes, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		client.ID, client.TenantID, client.ClientID, nullableString(secretHash), client.ClientType,
		string(grants), string(redirects), string(scopes), time.Now().UTC(),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrClientAlreadyExists
		}
		return fmt.Errorf("persist oauth client: %w", err)
	}
	return nil
}

func validateClient(client *Client) error {
	if client == nil {
		return errors.New("oauth client cannot be nil")
	}
	if client.ID == "" || client.ClientID == "" || client.TenantID == "" {
		return errors.New("oauth client id, client_id, and tenant_id are required")
	}
	if client.ClientType != "PUBLIC" && client.ClientType != "CONFIDENTIAL" {
		return errors.New("oauth client_type must be PUBLIC or CONFIDENTIAL")
	}
	if len(client.AllowedGrantTypes) == 0 {
		return errors.New("oauth client must allow at least one grant type")
	}
	for _, grant := range client.AllowedGrantTypes {
		if grant != "authorization_code" && grant != "client_credentials" {
			return fmt.Errorf("unsupported allowed grant type %q", grant)
		}
		if grant == "client_credentials" && client.ClientType != "CONFIDENTIAL" {
			return errors.New("client_credentials is only permitted for confidential clients")
		}
	}
	if contains(client.AllowedGrantTypes, "authorization_code") && len(client.RedirectURIs) == 0 {
		return errors.New("authorization_code clients must register at least one redirect URI")
	}
	for _, redirectURI := range client.RedirectURIs {
		if !validRedirectURI(redirectURI) {
			return fmt.Errorf("invalid registered redirect URI %q", redirectURI)
		}
	}
	if client.ClientType == "CONFIDENTIAL" && len(client.ClientSecret) < 32 {
		return errors.New("confidential client secret must be at least 32 characters")
	}
	if client.ClientType == "PUBLIC" && client.ClientSecret != "" {
		return errors.New("public clients must not have a client secret")
	}
	for _, scope := range client.AllowedScopes {
		if !validScope(scope) {
			return fmt.Errorf("invalid registered scope %q", scope)
		}
	}
	return nil
}

type tenantClient struct {
	*fosite.DefaultClient
	TenantID string
}

func (s *SQLStore) GetClient(ctx context.Context, id string) (fosite.Client, error) {
	var tenantID, clientType, grantsJSON, redirectsJSON, scopesJSON string
	var secretHash sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT tenant_id, client_type, client_secret_hash, allowed_grant_types, redirect_uris, allowed_scopes
		FROM oauth_clients WHERE client_id = $1`, id,
	).Scan(&tenantID, &clientType, &secretHash, &grantsJSON, &redirectsJSON, &scopesJSON)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fosite.ErrNotFound
		}
		return nil, fmt.Errorf("load oauth client: %w", err)
	}

	var grants, redirects, scopes []string
	if err := json.Unmarshal([]byte(grantsJSON), &grants); err != nil {
		return nil, fmt.Errorf("decode oauth client grant types: %w", err)
	}
	if err := json.Unmarshal([]byte(redirectsJSON), &redirects); err != nil {
		return nil, fmt.Errorf("decode oauth client redirect uris: %w", err)
	}
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return nil, fmt.Errorf("decode oauth client scopes: %w", err)
	}

	return &tenantClient{
		DefaultClient: &fosite.DefaultClient{
			ID:            id,
			Secret:        []byte(secretHash.String),
			RedirectURIs:  redirects,
			GrantTypes:    grants,
			ResponseTypes: []string{"code"},
			Scopes:        scopes,
			Public:        clientType == "PUBLIC",
		},
		TenantID: tenantID,
	}, nil
}

func (s *SQLStore) ClientAssertionJWTValid(ctx context.Context, jti string) error {
	var expiresAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT expires_at FROM oauth_client_assertion_jtis WHERE jti = $1`, jti,
	).Scan(&expiresAt)
	if errors.Is(err, sql.ErrNoRows) || err == nil && !expiresAt.After(time.Now()) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("check client assertion replay: %w", err)
	}
	return fosite.ErrJTIKnown
}

func (s *SQLStore) SetClientAssertionJWT(ctx context.Context, jti string, exp time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin client assertion transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "DELETE FROM oauth_client_assertion_jtis WHERE expires_at <= $1", time.Now().UTC()); err != nil {
		return fmt.Errorf("clean expired client assertion ids: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO oauth_client_assertion_jtis (jti, expires_at) VALUES ($1, $2)", jti, exp.UTC()); err != nil {
		if isUniqueViolation(err) {
			return fosite.ErrJTIKnown
		}
		return fmt.Errorf("record client assertion id: %w", err)
	}
	return tx.Commit()
}

type requestSnapshot struct {
	ID                string                  `json:"id"`
	RequestedAt       time.Time               `json:"requested_at"`
	ClientID          string                  `json:"client_id"`
	RequestedScopes   fosite.Arguments        `json:"requested_scopes"`
	GrantedScopes     fosite.Arguments        `json:"granted_scopes"`
	Form              url.Values              `json:"form"`
	Session           *oauth2.JWTSession      `json:"session"`
	RequestedAudience fosite.Arguments        `json:"requested_audience"`
	GrantedAudience   fosite.Arguments        `json:"granted_audience"`
	ResponseTypes     fosite.Arguments        `json:"response_types,omitempty"`
	RedirectURI       string                  `json:"redirect_uri,omitempty"`
	State             string                  `json:"state,omitempty"`
	ResponseMode      fosite.ResponseModeType `json:"response_mode,omitempty"`
	DefaultMode       fosite.ResponseModeType `json:"default_response_mode,omitempty"`
}

func snapshotRequester(request fosite.Requester) (*requestSnapshot, error) {
	if request == nil || request.GetClient() == nil {
		return nil, errors.New("cannot persist an incomplete oauth request")
	}
	session, ok := request.GetSession().(*oauth2.JWTSession)
	if !ok || session == nil {
		return nil, fmt.Errorf("unsupported oauth session type %T", request.GetSession())
	}
	snapshot := &requestSnapshot{
		ID:                request.GetID(),
		RequestedAt:       request.GetRequestedAt(),
		ClientID:          request.GetClient().GetID(),
		RequestedScopes:   append(fosite.Arguments(nil), request.GetRequestedScopes()...),
		GrantedScopes:     append(fosite.Arguments(nil), request.GetGrantedScopes()...),
		Form:              cloneValues(request.GetRequestForm()),
		Session:           session,
		RequestedAudience: append(fosite.Arguments(nil), request.GetRequestedAudience()...),
		GrantedAudience:   append(fosite.Arguments(nil), request.GetGrantedAudience()...),
	}
	if authorizeRequest, ok := request.(fosite.AuthorizeRequester); ok {
		snapshot.ResponseTypes = append(fosite.Arguments(nil), authorizeRequest.GetResponseTypes()...)
		if redirectURI := authorizeRequest.GetRedirectURI(); redirectURI != nil {
			snapshot.RedirectURI = redirectURI.String()
		}
		snapshot.State = authorizeRequest.GetState()
		snapshot.ResponseMode = authorizeRequest.GetResponseMode()
		snapshot.DefaultMode = authorizeRequest.GetDefaultResponseMode()
	}
	return snapshot, nil
}

func (s *SQLStore) persistSession(ctx context.Context, tokenType, signature string, request fosite.Requester, invalidated bool, fallbackTTL time.Duration) error {
	snapshot, err := snapshotRequester(request)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("encode oauth session: %w", err)
	}
	expiresAt := time.Now().UTC().Add(fallbackTTL)
	switch tokenType {
	case fositeAuthorizeCode:
		if expiry := request.GetSession().GetExpiresAt(fosite.AuthorizeCode); !expiry.IsZero() {
			expiresAt = expiry
		}
	case fositeAccessToken:
		if expiry := request.GetSession().GetExpiresAt(fosite.AccessToken); !expiry.IsZero() {
			expiresAt = expiry
		}
	case fositeRefreshToken:
		if expiry := request.GetSession().GetExpiresAt(fosite.RefreshToken); !expiry.IsZero() {
			expiresAt = expiry
		}
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO oauth_sessions (token_type, signature, request_json, invalidated, expires_at)
		VALUES ($1, $2, $3, $4, $5)`,
		tokenType, signature, string(payload), invalidated, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("persist oauth %s session: %w", tokenType, err)
	}
	return nil
}

func (s *SQLStore) loadSession(ctx context.Context, tokenType, signature string) (fosite.Requester, bool, error) {
	var payload string
	var invalidated bool
	var expiresAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT request_json, invalidated, expires_at
		FROM oauth_sessions WHERE token_type = $1 AND signature = $2`,
		tokenType, signature,
	).Scan(&payload, &invalidated, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, fosite.ErrNotFound
	}
	if err != nil {
		return nil, false, fmt.Errorf("load oauth %s session: %w", tokenType, err)
	}
	if !expiresAt.After(time.Now()) {
		if _, err := s.db.ExecContext(ctx, "DELETE FROM oauth_sessions WHERE token_type = $1 AND signature = $2", tokenType, signature); err != nil {
			return nil, false, fmt.Errorf("delete expired oauth session: %w", err)
		}
		return nil, false, fosite.ErrNotFound
	}
	var snapshot requestSnapshot
	if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
		return nil, false, fmt.Errorf("decode oauth session: %w", err)
	}
	client, err := s.GetClient(ctx, snapshot.ClientID)
	if err != nil {
		return nil, false, err
	}
	hydratedSession := snapshot.Session
	if hydratedSession == nil {
		return nil, false, errors.New("oauth session has no token session")
	}
	base := fosite.Request{
		ID:                snapshot.ID,
		RequestedAt:       snapshot.RequestedAt,
		Client:            client,
		RequestedScope:    snapshot.RequestedScopes,
		GrantedScope:      snapshot.GrantedScopes,
		Form:              snapshot.Form,
		Session:           hydratedSession,
		RequestedAudience: snapshot.RequestedAudience,
		GrantedAudience:   snapshot.GrantedAudience,
	}
	if len(snapshot.ResponseTypes) == 0 {
		return &base, invalidated, nil
	}
	redirectURI, err := url.Parse(snapshot.RedirectURI)
	if err != nil {
		return nil, false, fmt.Errorf("decode oauth redirect uri: %w", err)
	}
	return &fosite.AuthorizeRequest{
		ResponseTypes:        snapshot.ResponseTypes,
		RedirectURI:          redirectURI,
		State:                snapshot.State,
		HandledResponseTypes: fosite.Arguments{"code"},
		ResponseMode:         snapshot.ResponseMode,
		DefaultResponseMode:  snapshot.DefaultMode,
		Request:              base,
	}, invalidated, nil
}

func (s *SQLStore) CreateAuthorizeCodeSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.persistSession(ctx, fositeAuthorizeCode, signature, request, false, 5*time.Minute)
}

func (s *SQLStore) GetAuthorizeCodeSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	request, invalidated, err := s.loadSession(ctx, fositeAuthorizeCode, signature)
	if err != nil {
		return nil, err
	}
	if invalidated {
		return request, fosite.ErrInvalidatedAuthorizeCode
	}
	return request, nil
}

func (s *SQLStore) InvalidateAuthorizeCodeSession(ctx context.Context, signature string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE oauth_sessions SET invalidated = 1
		WHERE token_type = $1 AND signature = $2 AND invalidated = 0 AND expires_at > $3`,
		fositeAuthorizeCode, signature, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("invalidate oauth authorization code: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check oauth authorization code invalidation: %w", err)
	}
	if rows != 1 {
		return fosite.ErrNotFound
	}
	return nil
}

func (s *SQLStore) CreatePKCERequestSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.persistSession(ctx, fositePKCE, signature, request, false, 5*time.Minute)
}

func (s *SQLStore) GetPKCERequestSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	request, _, err := s.loadSession(ctx, fositePKCE, signature)
	return request, err
}

func (s *SQLStore) DeletePKCERequestSession(ctx context.Context, signature string) error {
	return s.deleteSession(ctx, fositePKCE, signature)
}

func (s *SQLStore) CreateAccessTokenSession(ctx context.Context, signature string, request fosite.Requester) error {
	return s.persistSession(ctx, fositeAccessToken, signature, request, false, time.Hour)
}

func (s *SQLStore) GetAccessTokenSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	request, _, err := s.loadSession(ctx, fositeAccessToken, signature)
	return request, err
}

func (s *SQLStore) DeleteAccessTokenSession(ctx context.Context, signature string) error {
	return s.deleteSession(ctx, fositeAccessToken, signature)
}

func (s *SQLStore) CreateRefreshTokenSession(ctx context.Context, signature, accessSignature string, request fosite.Requester) error {
	return s.persistSession(ctx, fositeRefreshToken, signature, request, false, 30*24*time.Hour)
}

func (s *SQLStore) GetRefreshTokenSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	request, _, err := s.loadSession(ctx, fositeRefreshToken, signature)
	return request, err
}

func (s *SQLStore) DeleteRefreshTokenSession(ctx context.Context, signature string) error {
	return s.deleteSession(ctx, fositeRefreshToken, signature)
}

func (s *SQLStore) RotateRefreshToken(ctx context.Context, requestID, signature string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin oauth refresh token rotation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var payload string
	var invalidated bool
	err = tx.QueryRowContext(ctx, `
		SELECT request_json, invalidated FROM oauth_sessions
		WHERE token_type = $1 AND signature = $2`,
		fositeRefreshToken, signature,
	).Scan(&payload, &invalidated)
	if errors.Is(err, sql.ErrNoRows) {
		return fosite.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load oauth refresh token for rotation: %w", err)
	}
	var snapshot requestSnapshot
	if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
		return fmt.Errorf("decode oauth refresh token for rotation: %w", err)
	}
	if invalidated || snapshot.ID != requestID {
		return fosite.ErrNotFound
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE oauth_sessions SET invalidated = 1
		WHERE token_type = $1 AND signature = $2 AND invalidated = 0`,
		fositeRefreshToken, signature,
	)
	if err != nil {
		return fmt.Errorf("rotate oauth refresh token: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check oauth refresh token rotation: %w", err)
	}
	if rows != 1 {
		return fosite.ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit oauth refresh token rotation: %w", err)
	}
	return nil
}

func (s *SQLStore) RevokeRefreshToken(ctx context.Context, requestID string) error {
	return s.revokeByRequestID(ctx, fositeRefreshToken, requestID)
}

func (s *SQLStore) RevokeAccessToken(ctx context.Context, requestID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin access token revocation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT signature, request_json, expires_at FROM oauth_sessions
		WHERE token_type = $1 AND invalidated = 0 AND expires_at > $2`,
		fositeAccessToken, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("query access tokens for revocation: %w", err)
	}
	type revokedSession struct {
		signature string
		tokenID   string
		expiresAt time.Time
	}
	var matches []revokedSession
	for rows.Next() {
		var signature, payload string
		var expiresAt time.Time
		if err := rows.Scan(&signature, &payload, &expiresAt); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read access token for revocation: %w", err)
		}
		var snapshot requestSnapshot
		if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
			_ = rows.Close()
			return fmt.Errorf("decode access token for revocation: %w", err)
		}
		if snapshot.ID != requestID {
			continue
		}
		if snapshot.Session == nil || snapshot.Session.GetJWTClaims() == nil {
			_ = rows.Close()
			return fmt.Errorf("access token session %q has no JWT claims", requestID)
		}
		tokenID := snapshot.Session.GetJWTClaims().ToMapClaims()["jti"]
		jti, ok := tokenID.(string)
		if !ok || jti == "" {
			_ = rows.Close()
			return fmt.Errorf("access token session %q has no JWT ID", requestID)
		}
		matches = append(matches, revokedSession{signature: signature, tokenID: jti, expiresAt: expiresAt})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate access tokens for revocation: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close access token revocation query: %w", err)
	}
	if len(matches) == 0 {
		return fosite.ErrNotFound
	}
	for _, match := range matches {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO token_revocations (token_id_hash, expires_at)
			VALUES ($1, $2)
			ON CONFLICT (token_id_hash) DO UPDATE SET expires_at = excluded.expires_at`,
			tokens.RevocationKey(match.tokenID), match.expiresAt,
		); err != nil {
			return fmt.Errorf("persist access token revocation: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE oauth_sessions SET invalidated = 1
			WHERE token_type = $1 AND signature = $2`,
			fositeAccessToken, match.signature,
		); err != nil {
			return fmt.Errorf("invalidate access token session: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit access token revocation: %w", err)
	}
	return nil
}

func (s *SQLStore) deleteSession(ctx context.Context, tokenType, signature string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM oauth_sessions WHERE token_type = $1 AND signature = $2", tokenType, signature)
	if err != nil {
		return fmt.Errorf("delete oauth %s session: %w", tokenType, err)
	}
	return nil
}

func (s *SQLStore) revokeByRequestID(ctx context.Context, tokenType, requestID string) error {
	rows, err := s.db.QueryContext(ctx, "SELECT signature, request_json FROM oauth_sessions WHERE token_type = $1", tokenType)
	if err != nil {
		return fmt.Errorf("query oauth sessions for revocation: %w", err)
	}
	defer rows.Close()
	var signatures []string
	for rows.Next() {
		var signature, payload string
		if err := rows.Scan(&signature, &payload); err != nil {
			return fmt.Errorf("read oauth session for revocation: %w", err)
		}
		var snapshot requestSnapshot
		if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
			return fmt.Errorf("decode oauth session for revocation: %w", err)
		}
		if snapshot.ID == requestID {
			signatures = append(signatures, signature)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate oauth sessions for revocation: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close oauth session query: %w", err)
	}
	for _, signature := range signatures {
		if err := s.deleteSession(ctx, tokenType, signature); err != nil {
			return err
		}
	}
	return nil
}

func nullableString(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func cloneValues(values url.Values) url.Values {
	cloned := make(url.Values, len(values))
	for key, items := range values {
		cloned[key] = append([]string(nil), items...)
	}
	return cloned
}

func isUniqueViolation(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique") || strings.Contains(message, "duplicate key")
}
