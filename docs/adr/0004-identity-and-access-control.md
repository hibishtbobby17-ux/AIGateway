# ADR-0004: Identity, Access Management, and Policy Evaluation

## Status
Accepted

## Context
Enterprise AI deployments span internal employees, third-party developers, automated CLI scripts, and autonomous machine agents. The platform must provide robust identity authentication (both native and federated) and fine-grained authorization across MCP tools and A2A agents while preventing token relay attacks.

## Decision
1. **OAuth 2.1 & OIDC Standard Baseline**:
   - Disallow insecure flows (no Resource Owner Password Credentials, no Implicit grant).
   - **Interactive User / Public Clients**: Enforce OAuth 2.1 **Authorization Code Flow with PKCE** using code challenge method `S256`.
   - **Machine-to-Machine (M2M) Clients**: Standardize on **Client Credentials Grant** (`grant_type=client_credentials`) with secret hashing (Argon2id) or mTLS/private_key_jwt.
2. **Built-in IdP & Cryptographic Key Management**:
   - The platform acts as an OpenTelemetry/OAuth 2.1 compliant authorization server.
   - Signs JWT access tokens using **ECDSA P-256 (ES256)** or **Ed25519 (EdDSA)**.
   - Publishes public keys via standard JWKS endpoint (`/.well-known/jwks.json`).
   - Supports key versioning and rotation without downtime (maintaining active and previous verification keys in JWKS).
3. **External IdP Federation**:
   - Supports multi-tenant external identity federation via OIDC Discovery (`/.well-known/openid-configuration`).
   - Configurable per tenant for **Okta**, **Auth0**, **Microsoft Entra ID**, and standard OIDC providers.
   - Dynamic claim mapping transforms external identity claims (e.g., `groups`, `roles`, `email`) into platform roles and tenant contexts.
4. **Authorization Engine (RBAC + ABAC)**:
   - **Role-Based Access Control (RBAC)**: Baseline roles (`platform-admin`, `tenant-admin`, `agent-operator`, `tool-consumer`, `auditor`).
   - **Attribute-Based Access Control (ABAC)**: Evaluates dynamic conditions (e.g., environment tags, IP CIDR, project boundary, tool parameter constraints).
   - Strict deny-by-default evaluation.
   - MCP discovery and invocation require an authenticated principal whose tenant matches the requested tenant. Tool, resource, and prompt catalogs are filtered independently, and tool calls are checked again at invocation.
   - Policies may restrict roles, required token scopes, and trusted signed-token attributes; action-specific OAuth scopes are checked independently of policy rules. Explicit deny rules take precedence over the platform-admin role bypass.
5. **Downstream Token Security & Anti-Relay**:
   - Inbound client tokens are **never forwarded** directly to upstream servers.
   - Gateway establishes downstream identity via:
     - **Dedicated Upstream Credentials**: Managed in Gateway Vault per server.
     - **RFC 8693 OAuth 2.0 Token Exchange**: The Gateway exchanges the client token for an upstream-scoped token with a restricted `aud` (audience) claim, preventing upstream backends from abusing client credentials against other services.

## Consequences
### Positive
- Strict adherence to OAuth 2.1 and OIDC specifications ensures compatibility with enterprise SSO.
- Zero token-relay vulnerabilities.
- Cryptographic isolation between tenants and services.

### Negative
- Token exchange and ABAC evaluation add a small latency overhead (mitigated by in-memory key and policy caching).
- The gateway executable now requires verified bearer tokens and loads tenant-scoped policies from SQL at startup. Missing or malformed signing-key, revocation, or policy state fails startup; a tenant with no matching allow policy is denied. OAuth provider routes remain unmounted until interactive login/consent and production secret provisioning are ready.
