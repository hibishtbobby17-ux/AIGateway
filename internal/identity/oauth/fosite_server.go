package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/compose"
	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/token/jwt"

	"project_alpha/internal/identity/keys"
)

// FositeServer exposes OAuth endpoints backed by Fosite and SQLStore.
type FositeServer struct {
	mu                   sync.RWMutex
	provider             fosite.OAuth2Provider
	store                *SQLStore
	authorizationService AuthorizationService
	keyManager           *keys.Manager
	audience             string
}

func NewFositeServer(store *SQLStore, keyManager *keys.Manager, issuer, audience string, globalSecret []byte) (*FositeServer, error) {
	if store == nil {
		return nil, errors.New("OAuth provider requires a SQL store")
	}
	if keyManager == nil {
		return nil, errors.New("OAuth provider requires a signing key manager")
	}
	if issuer == "" || audience == "" {
		return nil, errors.New("OAuth issuer and audience are required")
	}
	if len(globalSecret) < 32 {
		return nil, errors.New("OAuth global secret must contain at least 32 bytes")
	}

	config := &fosite.Config{
		AccessTokenIssuer:              issuer,
		GlobalSecret:                   append([]byte(nil), globalSecret...),
		EnforcePKCE:                    true,
		EnablePKCEPlainChallengeMethod: false,
		ScopeStrategy:                  fosite.ExactScopeStrategy,
		AudienceMatchingStrategy:       fosite.ExactAudienceMatchingStrategy,
		JWTScopeClaimKey:               jwt.JWTScopeFieldList,
		AccessTokenLifespan:            time.Hour,
		AuthorizeCodeLifespan:          5 * time.Minute,
		SendDebugMessagesToClients:     false,
		HMACHasher:                     sha256.New,
		ClientSecretsHasher:            store.hasher,
	}
	coreStrategy := compose.NewOAuth2HMACStrategy(config)
	keyGetter := func(context.Context) (interface{}, error) {
		active, err := keyManager.GetActiveKey()
		if err != nil {
			return nil, err
		}
		return active.Private, nil
	}
	strategy := compose.NewOAuth2JWTStrategy(keyGetter, coreStrategy, config)
	provider := compose.Compose(
		config,
		store,
		strategy,
		compose.OAuth2AuthorizeExplicitFactory,
		compose.OAuth2ClientCredentialsGrantFactory,
		compose.OAuth2PKCEFactory,
		compose.OAuth2TokenRevocationFactory,
	)
	return &FositeServer{
		provider:   provider,
		store:      store,
		keyManager: keyManager,
		audience:   audience,
	}, nil
}

func (s *FositeServer) SetAuthorizationService(service AuthorizationService) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorizationService = service
}

func (s *FositeServer) RegisterClient(ctx context.Context, client *Client) error {
	return s.store.RegisterClient(ctx, client)
}

func (s *FositeServer) Mount(mux *http.ServeMux) {
	mux.HandleFunc("/oauth/authorize", s.HandleAuthorize)
	mux.HandleFunc("/oauth/token", s.HandleToken)
	mux.HandleFunc("/.well-known/jwks.json", s.HandleJWKS)
}

func (s *FositeServer) HandleJWKS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	jwks, err := s.keyManager.GetJWKS()
	if err != nil {
		http.Error(w, "failed to load signing keys", http.StatusInternalServerError)
		return
	}
	if err := json.NewEncoder(w).Encode(jwks); err != nil {
		http.Error(w, "failed to encode signing keys", http.StatusInternalServerError)
	}
}

// HandleAuthorize validates the OAuth request, delegates user authentication
// and consent, then returns the authorization response through Fosite.
func (s *FositeServer) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method must be GET", http.StatusMethodNotAllowed)
		return
	}
	authorizeRequest, err := s.provider.NewAuthorizeRequest(r.Context(), r)
	if err != nil {
		if authorizeRequest == nil {
			http.Error(w, "invalid authorization request", http.StatusBadRequest)
			return
		}
		s.provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, err)
		return
	}

	client, ok := authorizeRequest.GetClient().(*tenantClient)
	if !ok || client.TenantID == "" {
		s.provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, fosite.ErrInvalidClient)
		return
	}
	s.mu.RLock()
	authorizationService := s.authorizationService
	s.mu.RUnlock()
	if authorizationService == nil {
		s.provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, fosite.ErrServerError.WithHint("authorization service is not configured"))
		return
	}

	requestedScopes := []string(authorizeRequest.GetRequestedScopes())
	decision, err := authorizationService.Authorize(r.Context(), r, client.toRegistration(), requestedScopes)
	if err != nil || strings.TrimSpace(decision.Subject) == "" ||
		!scopesSubset(decision.Scopes, requestedScopes) {
		s.provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, fosite.ErrAccessDenied)
		return
	}
	for _, scope := range decision.Scopes {
		authorizeRequest.GrantScope(scope)
	}
	authorizeRequest.GrantAudience(s.audience)

	session := &oauth2.JWTSession{
		JWTClaims: &jwt.JWTClaims{
			Subject:  decision.Subject,
			Audience: []string{s.audience},
			Extra: map[string]interface{}{
				"tenant_id": client.TenantID,
				"roles":     []string{"user"},
			},
		},
	}
	session.SetSubject(decision.Subject)
	response, err := s.provider.NewAuthorizeResponse(r.Context(), authorizeRequest, session)
	if err != nil {
		s.provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, err)
		return
	}
	s.provider.WriteAuthorizeResponse(r.Context(), w, authorizeRequest, response)
}

func (s *FositeServer) HandleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method must be POST", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)

	accessRequest, err := s.provider.NewAccessRequest(r.Context(), r, &oauth2.JWTSession{})
	if err != nil {
		s.provider.WriteAccessError(r.Context(), w, accessRequest, err)
		return
	}
	client, ok := accessRequest.GetClient().(*tenantClient)
	if !ok || client.TenantID == "" {
		s.provider.WriteAccessError(r.Context(), w, accessRequest, fosite.ErrInvalidClient)
		return
	}
	session, ok := accessRequest.GetSession().(*oauth2.JWTSession)
	if !ok {
		s.provider.WriteAccessError(r.Context(), w, accessRequest, fosite.ErrServerError)
		return
	}
	activeKey, err := s.keyManager.GetActiveKey()
	if err != nil {
		s.provider.WriteAccessError(r.Context(), w, accessRequest, fosite.ErrServerError)
		return
	}
	session.GetJWTHeader().Add("kid", activeKey.ID)
	if containsArgument([]string(accessRequest.GetGrantTypes()), "client_credentials") {
		for _, scope := range accessRequest.GetRequestedScopes() {
			accessRequest.GrantScope(scope)
		}
		accessRequest.GrantAudience(s.audience)
		session.Subject = client.GetID()
		session.JWTClaims = &jwt.JWTClaims{
			Subject:  client.GetID(),
			Audience: []string{s.audience},
			Extra: map[string]interface{}{
				"tenant_id": client.TenantID,
				"roles":     []string{"client"},
			},
		}
	}
	response, err := s.provider.NewAccessResponse(r.Context(), accessRequest)
	if err != nil {
		s.provider.WriteAccessError(r.Context(), w, accessRequest, err)
		return
	}
	s.provider.WriteAccessResponse(r.Context(), w, accessRequest, response)
}

func (c *tenantClient) toRegistration() *Client {
	clientType := "CONFIDENTIAL"
	if c.IsPublic() {
		clientType = "PUBLIC"
	}
	return &Client{
		ID:                c.GetID(),
		ClientID:          c.GetID(),
		ClientType:        clientType,
		TenantID:          c.TenantID,
		RedirectURIs:      append([]string(nil), c.GetRedirectURIs()...),
		AllowedGrantTypes: append([]string(nil), c.GetGrantTypes()...),
		AllowedScopes:     append([]string(nil), c.GetScopes()...),
	}
}
