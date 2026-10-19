# ADR-0002: Model Context Protocol (MCP) Specification and Transport Strategy

## Status
Accepted

## Context
The Model Context Protocol (MCP) is an open specification enabling AI models to interact with local and remote data sources, tools, and prompts. The platform must act as an enterprise MCP Gateway: aggregating multiple upstream MCP servers behind a single logical endpoint, resolving namespace collisions, enforcing security policies, and managing upstream connections.

## Decision
1. **MCP Protocol Version**: Pin to **Protocol Version `2024-11-05`** (latest stable MCP standard).
2. **Transport Mechanisms**:
   - **Client-to-Gateway**:
     - **HTTP with Server-Sent Events (SSE)**: `GET /mcp/v1/sse` for server-to-client notifications/events, and `POST /mcp/v1/messages` for client-to-server JSON-RPC 2.0 requests.
     - **Stream / Chunked Transfer**: Optional direct HTTP streaming for non-browser clients.
   - **Gateway-to-Upstream**:
     - **Remote Upstreams**: HTTP + SSE client over TLS with persistent connection pooling and keep-alive pings.
     - **Local Upstreams**: Standard I/O (`stdio`) subprocess execution with isolated process groups, bounded memory/CPU limits, and automatic crash restarts.
3. **Namespace & Conflict Resolution**:
   - Each registered upstream MCP server is assigned a unique `server_slug` (e.g., `github`, `postgres-db`).
   - Tools are exposed to the client with a canonical qualified name: `<server_slug>::<tool_name>`.
   - The Gateway maintains a bidirectional mapping table:
     - Client calls `github::search_issues` $\rightarrow$ Gateway strips prefix and routes `search_issues` to the `github` upstream server.
   - If an upstream server registers duplicate tool names internally, registration validation rejects it until resolved.
4. **Dual-Phase Authorization**:
   - **Discovery (`tools/list`, `resources/list`, `prompts/list`)**: Evaluates read permissions and filters results so clients only see tools they are allowed to discover.
   - **Execution (`tools/call`)**: Strictly evaluates the caller's identity, tenant, and invocation permissions independently. A tool appearing in a cached or discovered list **never** bypasses invocation authorization.
5. **Catalog Caching & Invalidation**:
   - Cached tool schemas have a configurable TTL (default: 5 minutes).
   - Invalidation occurs via:
     - Explicit admin API call (`POST /api/v1/mcp/servers/{id}/refresh`).
     - Upstream notification (JSON-RPC `notifications/tools/list_changed`).
     - Background health check discovering upstream schema version change.

## Consequences
### Positive
- AI clients need only configure one endpoint (`https://gateway.example.com/mcp/v1`) rather than dozens of disparate servers.
- Guaranteed conflict-free tool names through standardized `::` delimiter namespacing.
- Fine-grained access control prevents unprivileged clients from executing sensitive tools even if discovered.

### Negative
- Prefixing tool names requires clients or system prompts to accommodate qualified identifiers.
- Managing long-lived SSE connections across multiple gateway replicas requires session affinity or a distributed pub/sub event bus (e.g., Redis pub/sub) for multi-replica cluster setups.
