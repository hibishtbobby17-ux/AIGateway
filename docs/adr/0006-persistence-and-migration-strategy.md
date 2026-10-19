# ADR-0006: Primary Persistence and Database Migration Strategy

## Status
Accepted

## Context
The platform requires durable, transactional storage for tenants, OAuth clients, policies, MCP/A2A registries, task execution records, and audit logs. The system must support clean automated migrations, multi-replica concurrency, and strict multi-tenant isolation.

## Decision
1. **Primary Database Engine**: Standardize on **PostgreSQL 16+**.
   - PostgreSQL provides robust ACID transactions, mature JSONB support for tool schemas and task payloads, native UUID generation, and rock-solid indexing.
2. **Database Driver & Connection Pooling**: Use **`jackc/pgx/v5`**.
   - Direct PostgreSQL binary protocol support without cgo.
   - Built-in connection pool (`pgxpool.Pool`) with bounded connections (`MaxConns`, `MinConns`, `MaxConnIdleTime`, `MaxConnLifetime`).
3. **Migration Engine**: Standardize on **`golang-migrate/migrate/v4`**.
   - Migration scripts stored in `/migrations` as sequential SQL pairs: `{version}_{description}.up.sql` and `{version}_{description}.down.sql`.
   - Embedded directly into the Go binary using `//go:embed` for seamless self-migrating standalone deployments and a dedicated CLI tool (`cmd/migrate`) for Kubernetes pre-install jobs.
4. **Multi-Tenant Schema Architecture**:
   - Adopt **Shared Database, Shared Schema with Discriminator Column (`tenant_id`)**.
   - Every tenant-scoped table includes `tenant_id` as part of the primary key or unique composite index.
   - All repository queries require `tenant_id` in `WHERE` clauses.
   - For PostgreSQL 16+, support optional PostgreSQL Row Level Security (RLS) policies as an additional layer of defense.
5. **Secret Encryption at Rest**:
   - Client secrets, upstream auth tokens, and external IdP credentials stored in the database are encrypted using **AES-256-GCM** with an envelope key derived from an environment variable master key (`GATEWAY_ENCRYPTION_KEY`).

## Consequences
### Positive
- Predictable, version-controlled schema evolution with automated rollbacks.
- Native performance and connection management with `pgx`.
- High portability across standalone Docker Compose, AWS RDS, GCP Cloud SQL, and self-hosted Kubernetes PostgreSQL clusters.

### Negative
- Requires strict developer hygiene to ensure `tenant_id` is never omitted from a query; mitigated by compiler-checked repository interfaces and integration tests.
