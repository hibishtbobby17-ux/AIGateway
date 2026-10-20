# ADR-0009: OAuth Authorization Server Framework and Persistence

## Status
Accepted

## Context

The first OAuth implementation maintained protocol state, client credentials, authorization codes, and PKCE checks in process-local maps. This is unsuitable for concurrent replicas, restarts, and security-sensitive OAuth protocol handling. The platform needs standard authorization-code and machine-client grants, tenant-scoped client registration, PKCE S256, durable one-time authorization codes, and access tokens that remain compatible with the gateway's existing ES256 verifier.

Resource-owner authentication and consent must be provided by a trusted identity layer. OAuth request parameters must never be treated as proof of a user's identity or consent.

## Decision

- Use ORY Fosite `v0.49.0` as the OAuth 2.0 protocol framework.
- Compose only the authorization-code, client-credentials, PKCE, and token-revocation handlers needed by this milestone. Do not enable implicit or password grants.
- Require PKCE for authorization-code flows and disable the `plain` challenge method.
- Persist OAuth client registrations, authorization-code/PKCE state, access/refresh grant sessions, and client-assertion replay identifiers in the platform SQL database.
- Persist only hashed confidential-client secrets. Use Fosite's BCrypt hasher by default; `SQLStore` and `FositeServer` accept an injected Fosite-compatible hasher so deployment configuration can select a stronger policy without storing cleartext secrets.
- Issue ES256 JWT access tokens using the platform signing-key manager. Include a `kid`, issuer, audience, subject, tenant, roles, and scopes so tokens can be consumed by the existing verifier.
- Persist ES256 signing keys in the shared SQL database with AES-256-GCM encrypted private scalars. The encryption key is supplied separately to `NewPersistentManager` and must be shared across replicas; there is no insecure fallback to process-local keys in persistent mode.
- Refresh signing keys from SQL for active-key lookup, verification-key lookup, and JWKS generation so rotations made by another replica are observed without a process restart. Retain previous public keys to verify existing tokens.
- Require an injected `AuthorizationService` to authenticate the resource owner and resolve approved scopes. The provider returns an error when this service is absent or denies the request.
- Provide a SQL authorization service that accepts identity only from the verified principal in request context, enforces tenant/client matching, and grants only scopes explicitly preapproved in tenant-scoped consent records. Consent grants are provisioned through privileged server-side code; this is not an interactive login or consent UI.
- Keep the provider component unmounted in runtime executables until signing keys are shared and durable across gateway/control-plane replicas and a concrete authenticated user/consent service is available.

## Consequences

### Positive

- OAuth request validation and grant processing use a dedicated protocol framework instead of bespoke endpoint logic.
- One-time code, PKCE, and client registration state survive process restarts when stored in SQL.
- Signing keys are encrypted at rest and shared across replicas; previous keys remain published after rotation for token verification.
- The authorization boundary is explicit and fail-closed; the framework cannot infer user identity from query parameters.
- Existing verified bearer-token identity can be used as the resource owner, while SQL consent records restrict authorization to explicit prior approval.
- ES256 access tokens retain the claims needed by existing gateway token validation.

### Negative

- Fosite adds a larger dependency graph and requires adapters for platform-specific client and session persistence.
- The provider cannot be safely exposed until the platform persists and shares signing keys, wires authenticated user/consent, and ensures token revocation is enforced by resource servers.
- Deployments must provision and consistently distribute a 32-byte signing-key encryption secret outside the SQL database (environment variable `GATEWAY_SIGNING_KEY_ENCRYPTION_KEY`, encoded as exactly 64 hexadecimal characters). The secret is excluded from config serialization. This component does not yet define secret-manager integration or old-key retirement policy.
- The SQL consent implementation has no user-facing approval interface or administrative grant API. Integrators must ensure only a trusted, authorized control-plane path can create consent records.
- This decision implements OAuth protocol handling, not the complete built-in identity provider or external OIDC federation.
