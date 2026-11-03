import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 
  `postgres://${process.env.POSTGRES_USER || 'gateway'}:${process.env.POSTGRES_PASSWORD || 'gateway'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'gateway_dev'}?sslmode=disable`;

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let isInitialized = false;

export async function initDatabase(): Promise<void> {
  if (isInitialized) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Organizations
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
    `);

    // 2. Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Projects
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        config_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. MCP Servers
    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        namespace_prefix VARCHAR(50) NOT NULL,
        transport VARCHAR(50) NOT NULL DEFAULT 'http',
        url TEXT NOT NULL,
        auth_type VARCHAR(50) NOT NULL DEFAULT 'none',
        timeouts JSONB NOT NULL DEFAULT '{"dial_ms": 5000, "call_ms": 15000}'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT true,
        health_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        last_checked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 5. Tool Policies
    await client.query(`
      CREATE TABLE IF NOT EXISTS tool_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        tool_name VARCHAR(255) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        rename VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_policies_server_tool ON tool_policies(mcp_server_id, tool_name);
    `);

    // 6. OAuth Configurations
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        mcp_server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
        issuer TEXT NOT NULL,
        token_endpoint TEXT,
        authorization_endpoint TEXT,
        jwks_uri TEXT,
        client_id TEXT NOT NULL,
        client_secret_encrypted TEXT,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        audience TEXT,
        redirect_uri TEXT,
        grant_type VARCHAR(50) NOT NULL DEFAULT 'client_credentials',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      DROP INDEX IF EXISTS idx_oauth_configs_server;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_configs_server ON oauth_configs(mcp_server_id);
    `);

    // 7. OAuth Tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        mcp_server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        expires_at TIMESTAMPTZ,
        subject VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'ok',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      DROP INDEX IF EXISTS idx_oauth_tokens_server;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_server ON oauth_tokens(mcp_server_id);
    `);

    // 8. Gateway Instances
    await client.query(`
      CREATE TABLE IF NOT EXISTS gateway_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        secret_hash VARCHAR(255) NOT NULL,
        last_seen_at TIMESTAMPTZ,
        version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
        applied_config_version INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'registered',
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_instances_name ON gateway_instances(name);
      ALTER TABLE gateway_instances ADD COLUMN IF NOT EXISTS protocol VARCHAR(20) DEFAULT 'http';
      ALTER TABLE gateway_instances ADD COLUMN IF NOT EXISTS tls_enabled BOOLEAN DEFAULT false;
      ALTER TABLE gateway_instances ADD COLUMN IF NOT EXISTS metrics JSONB DEFAULT '{}'::jsonb;
    `);

    // 9. Gateway Project Bindings
    await client.query(`
      CREATE TABLE IF NOT EXISTS gateway_project_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gateway_id UUID NOT NULL REFERENCES gateway_instances(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(gateway_id, project_id)
      );
    `);

    // 10. Client Credentials
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'api_key',
        hash VARCHAR(255) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        rate_limit JSONB NOT NULL DEFAULT '{"requests_per_minute": 600}'::jsonb,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 11. Ingest Keys
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingest_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        hash VARCHAR(255) NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 12. Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        actor VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target VARCHAR(255) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        diff JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 13. Gateway Logs (Log Store)
    await client.query(`
      CREATE TABLE IF NOT EXISTS gateway_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(128) NOT NULL,
        project VARCHAR(100) NOT NULL,
        mcp_server VARCHAR(255),
        tool VARCHAR(255),
        client_id VARCHAR(255),
        status VARCHAR(50) NOT NULL,
        latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        bytes_in BIGINT NOT NULL DEFAULT 0,
        bytes_out BIGINT NOT NULL DEFAULT 0,
        trace_id VARCHAR(128),
        error TEXT,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_logs_event_id ON gateway_logs (event_id);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_project_ts ON gateway_logs (project, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_timestamp ON gateway_logs (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_trace_id ON gateway_logs (trace_id);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_server ON gateway_logs (mcp_server);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_tool ON gateway_logs (tool);
    `);

    // 14. LLM Gateways (Multi-Cloud Universal LLM Proxy)
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_gateways (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        inbound_auth JSONB NOT NULL DEFAULT '{"mode": "api_key"}'::jsonb,
        primary_backend JSONB NOT NULL DEFAULT '{}'::jsonb,
        fallback_backends JSONB NOT NULL DEFAULT '[]'::jsonb,
        routing_strategy VARCHAR(50) NOT NULL DEFAULT 'priority_fallback',
        guardrails JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{"tokens_processed": 0, "requests_total": 0}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_llm_gateways_org ON llm_gateways (org_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_gateways_slug ON llm_gateways (slug);
    `);

    // Seed default organization if empty
    const orgRes = await client.query('SELECT id FROM organizations LIMIT 1');
    let defaultOrgId: string;
    if (orgRes.rows.length === 0) {
      const insOrg = await client.query(`
        INSERT INTO organizations (name, slug)
        VALUES ('Default Enterprise', 'default-enterprise')
        RETURNING id
      `);
      defaultOrgId = insOrg.rows[0].id;
    } else {
      defaultOrgId = orgRes.rows[0].id;
    }

    // Seed default admin user if not exists
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@aigateway.local';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!@#';
    const userRes = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (userRes.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(adminPass, salt);
      await client.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `, [defaultOrgId, adminEmail, hash]);
    }

    // Seed default project if empty
    const projRes = await client.query('SELECT id FROM projects LIMIT 1');
    if (projRes.rows.length === 0) {
      await client.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `, [defaultOrgId]);
    }

    // Seed default gateway instance if empty
    const gwRes = await client.query('SELECT id FROM gateway_instances WHERE name = $1', ['gateway-default-01']);
    if (gwRes.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const secretHash = await bcrypt.hash('dev-gateway-secret', salt);
      await client.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `, [secretHash]);
    }

    // Seed default LLM gateways if empty
    const llmRes = await client.query('SELECT id FROM llm_gateways LIMIT 1');
    if (llmRes.rows.length === 0) {
      await client.query(`
        INSERT INTO llm_gateways (org_id, name, slug, status, inbound_auth, primary_backend, fallback_backends, routing_strategy, guardrails, metrics)
        VALUES 
        (
          $1, 
          'Enterprise Multi-Cloud Chat Gateway', 
          'enterprise-chat', 
          'active',
          '{
            "mode": "oauth_pkce",
            "issuer": "https://auth.enterprise.okta.com/oauth2/default",
            "client_id": "0oa9k18lq2AbCdEf0h7",
            "audience": "https://gateway.corp/llm/enterprise-chat",
            "scopes": ["llm:chat", "llm:stream"],
            "jwks_uri": "https://auth.enterprise.okta.com/oauth2/default/v1/keys",
            "allow_client_credentials": true,
            "allow_api_key": true,
            "api_key": "sec_llm_live_98a76bc543210fe"
          }'::jsonb,
          '{
            "provider": "azure_openai",
            "endpoint": "https://corp-ai-eastus2.openai.azure.com",
            "deployment_name": "gpt-4o-prod",
            "api_version": "2024-08-01-preview",
            "model_alias": "gpt-4o",
            "api_key": "••••••••••••••••••••••••••••••••",
            "region": "eastus2",
            "weight": 100
          }'::jsonb,
          '[
            {
              "provider": "aws_bedrock",
              "region": "us-east-1",
              "model_id": "anthropic.claude-3-5-sonnet-20240620-v1:0",
              "model_alias": "claude-3-5-sonnet",
              "access_key_id": "AKIA••••••••••••••••",
              "secret_access_key": "••••••••••••••••••••••••••••••••",
              "priority": 1,
              "trigger_on_status": [429, 500, 503]
            },
            {
              "provider": "openai_direct",
              "model": "gpt-4o",
              "model_alias": "gpt-4o",
              "api_key": "sk-proj-••••••••••••••••••••••••••••••••",
              "organization_id": "org-corp-enterprise",
              "priority": 2,
              "trigger_on_status": [429, 500, 503]
            }
          ]'::jsonb,
          'priority_fallback',
          '{
            "rate_limits": { "requests_per_minute": 1200, "tokens_per_minute": 350000 },
            "pii_masking": true,
            "prompt_injection_detection": true,
            "max_tokens_ceiling": 4096
          }'::jsonb,
          '{
            "tokens_processed": 1428500,
            "requests_total": 4210,
            "prompt_tokens": 890200,
            "completion_tokens": 538300,
            "fallback_events": 14,
            "avg_latency_ms": 285
          }'::jsonb
        ),
        (
          $1, 
          'Code & Reasoning Intelligence Gateway', 
          'code-intelligence', 
          'active',
          '{
            "mode": "api_key",
            "allow_client_credentials": true,
            "issuer": "https://auth.enterprise.okta.com/oauth2/default",
            "client_id": "0oa7x19mk0ZyXwVu1j9",
            "api_key": "sec_llm_live_44f55e66d77c88b9"
          }'::jsonb,
          '{
            "provider": "anthropic_direct",
            "model": "claude-3-5-sonnet-latest",
            "model_alias": "claude-3.5-sonnet",
            "api_key": "sk-ant-api03-••••••••••••••••••••••••••••••••",
            "api_version": "2023-06-01",
            "weight": 100
          }'::jsonb,
          '[
            {
              "provider": "azure_openai",
              "endpoint": "https://corp-ai-westus.openai.azure.com",
              "deployment_name": "gpt-4o-mini-prod",
              "model_alias": "gpt-4o-mini",
              "api_version": "2024-08-01-preview",
              "api_key": "••••••••••••••••••••••••••••••••",
              "priority": 1,
              "trigger_on_status": [429, 500, 503]
            }
          ]'::jsonb,
          'lowest_latency',
          '{
            "rate_limits": { "requests_per_minute": 3000, "tokens_per_minute": 800000 },
            "pii_masking": false,
            "prompt_injection_detection": true,
            "max_tokens_ceiling": 8192
          }'::jsonb,
          '{
            "tokens_processed": 3892000,
            "requests_total": 11450,
            "prompt_tokens": 2100000,
            "completion_tokens": 1792000,
            "fallback_events": 3,
            "avg_latency_ms": 194
          }'::jsonb
        )
      `, [defaultOrgId]);
    }

    // 15. LLM Model Rates (FinOps Rate Card)
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_model_rates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        input_rate_per_1m DOUBLE PRECISION NOT NULL DEFAULT 2.50,
        output_rate_per_1m DOUBLE PRECISION NOT NULL DEFAULT 10.00,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, provider, model)
      );
    `);

    // 16. LLM Consumer Budgets (FinOps Chargeback & Quotas)
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_consumer_budgets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        consumer_id VARCHAR(255) NOT NULL,
        consumer_name VARCHAR(255) NOT NULL,
        monthly_budget_usd DOUBLE PRECISION NOT NULL DEFAULT 50.00,
        high_cost_task_threshold_usd DOUBLE PRECISION NOT NULL DEFAULT 0.05,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, consumer_id)
      );
    `);

    // 17. LLM Usage & Task FinOps Ledger
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_usage_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        gateway_id UUID REFERENCES llm_gateways(id) ON DELETE SET NULL,
        gateway_slug VARCHAR(100) NOT NULL,
        consumer_id VARCHAR(255) NOT NULL,
        consumer_name VARCHAR(255) NOT NULL,
        auth_mode VARCHAR(50) NOT NULL DEFAULT 'api_key',
        task_id VARCHAR(128) NOT NULL,
        task_title VARCHAR(255) NOT NULL DEFAULT 'LLM Completion Task',
        step_number INTEGER NOT NULL DEFAULT 1,
        step_name VARCHAR(255) NOT NULL DEFAULT 'LLM Completion Call',
        task_status VARCHAR(50) NOT NULL DEFAULT 'completed',
        provider VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        region VARCHAR(100) NOT NULL DEFAULT 'eastus2',
        failover_triggered BOOLEAN NOT NULL DEFAULT false,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        prompt_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        completion_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        primary_baseline_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        latency_ms INTEGER NOT NULL DEFAULT 200,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_org_time ON llm_usage_ledger(org_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_consumer ON llm_usage_ledger(org_id, consumer_id);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_task ON llm_usage_ledger(org_id, task_id);
    `);

    // Seed default model rates if empty
    const ratesRes = await client.query('SELECT id FROM llm_model_rates WHERE org_id = $1 LIMIT 1', [defaultOrgId]);
    if (ratesRes.rows.length === 0) {
      await client.query(`
        INSERT INTO llm_model_rates (org_id, provider, model, input_rate_per_1m, output_rate_per_1m)
        VALUES
          ($1, 'azure_openai', 'gpt-4o', 2.50, 10.00),
          ($1, 'azure_openai', 'gpt-4o-mini', 0.15, 0.60),
          ($1, 'aws_bedrock', 'claude-3-5-sonnet', 3.00, 15.00),
          ($1, 'anthropic_direct', 'claude-3.5-sonnet', 3.00, 15.00),
          ($1, 'openai_direct', 'gpt-4o', 2.50, 10.00),
          ($1, 'anthropic_direct', 'claude-3-haiku', 0.25, 1.25)
        ON CONFLICT (org_id, provider, model) DO NOTHING
      `, [defaultOrgId]);
    }

    // Seed default consumer budgets if empty
    const budgetsRes = await client.query('SELECT id FROM llm_consumer_budgets WHERE org_id = $1 LIMIT 1', [defaultOrgId]);
    if (budgetsRes.rows.length === 0) {
      await client.query(`
        INSERT INTO llm_consumer_budgets (org_id, consumer_id, consumer_name, monthly_budget_usd, high_cost_task_threshold_usd)
        VALUES
          ($1, 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 0.50, 0.045),
          ($1, 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 0.60, 0.050),
          ($1, 'okta-marketing-copilot', 'Marketing Campaign Copilot (Okta PKCE)', 0.30, 0.035),
          ($1, 'agent-sup-03', 'Customer Support Escalation Agent', 0.25, 0.025),
          ($1, 'agent-data-04', 'ETL Pipeline & Vector Ingestion Agent', 0.20, 0.020)
        ON CONFLICT (org_id, consumer_id) DO NOTHING
      `, [defaultOrgId]);
    }

    // Seed realistic multi-step task usage ledger if empty
    const ledgerRes = await client.query('SELECT id FROM llm_usage_ledger WHERE org_id = $1 LIMIT 1', [defaultOrgId]);
    if (ledgerRes.rows.length === 0) {
      const gwRows = await client.query('SELECT id, slug FROM llm_gateways WHERE org_id = $1', [defaultOrgId]);
      const entGwId = gwRows.rows.find((r: any) => r.slug === 'enterprise-chat')?.id || gwRows.rows[0]?.id || null;
      const codeGwId = gwRows.rows.find((r: any) => r.slug === 'code-intelligence')?.id || entGwId;

      await client.query(`
        INSERT INTO llm_usage_ledger (
          org_id, gateway_id, gateway_slug, consumer_id, consumer_name, auth_mode,
          task_id, task_title, step_number, step_name, task_status,
          provider, model, region, failover_triggered,
          prompt_tokens, completion_tokens, total_tokens,
          cost_usd, prompt_cost_usd, completion_cost_usd, primary_baseline_cost_usd, latency_ms, created_at
        )
        VALUES
          -- Task 1: agent-fin-01 (3-step Q3 10-K SEC Earnings Synthesis with 1 failover on step 3)
          ($1, $2, 'enterprise-chat', 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 'client_credentials',
           'task_sec_q3_ebitda_901', 'Q3 10-K SEC Filing & EBITDA Variance Synthesis', 1, 'Step 1: Parse 10-K Balance Sheet & Footnotes', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           3200, 950, 4150, 0.017500, 0.008000, 0.009500, 0.017500, 310, NOW() - INTERVAL '4 hours'),
          ($1, $2, 'enterprise-chat', 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 'client_credentials',
           'task_sec_q3_ebitda_901', 'Q3 10-K SEC Filing & EBITDA Variance Synthesis', 2, 'Step 2: Verify YoY Revenue & Margin Ratios', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           4100, 1280, 5380, 0.023050, 0.010250, 0.012800, 0.023050, 345, NOW() - INTERVAL '3 hours 58 minutes'),
          ($1, $2, 'enterprise-chat', 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 'client_credentials',
           'task_sec_q3_ebitda_901', 'Q3 10-K SEC Filing & EBITDA Variance Synthesis', 3, 'Step 3: Executive Board Markdown Report Generation', 'completed',
           'aws_bedrock', 'claude-3-5-sonnet', 'us-east-1', true,
           4800, 2100, 6900, 0.045900, 0.014400, 0.031500, 0.033000, 490, NOW() - INTERVAL '3 hours 56 minutes'),

          -- Task 2: agent-fin-01 (2-step Peer Valuation Multiples Task)
          ($1, $2, 'enterprise-chat', 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 'client_credentials',
           'task_fin_peer_comp_902', 'SaaS Peer Valuation Multiples & DCF Modeling', 1, 'Step 1: Extract Peer EV/Revenue Comps', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           2400, 820, 3220, 0.014200, 0.006000, 0.008200, 0.014200, 265, NOW() - INTERVAL '2 hours 30 minutes'),
          ($1, $2, 'enterprise-chat', 'agent-fin-01', 'Financial Research Synthesizer (A2A Agent)', 'client_credentials',
           'task_fin_peer_comp_902', 'SaaS Peer Valuation Multiples & DCF Modeling', 2, 'Step 2: Synthesize Sensitivity Matrix', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           2900, 1150, 4050, 0.018750, 0.007250, 0.011500, 0.018750, 290, NOW() - INTERVAL '2 hours 28 minutes'),

          -- Task 3: agent-code-02 (3-step PR #418 AST Security Audit on code-intelligence gateway)
          ($1, $3, 'code-intelligence', 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 'api_key',
           'task_pr_418_audit', 'PR #418 OAuth Token Middleware Security & AST Audit', 1, 'Step 1: AST Taint Flow & SQLi Surface Scan', 'completed',
           'anthropic_direct', 'claude-3.5-sonnet', 'global', false,
           5400, 1400, 6800, 0.037200, 0.016200, 0.021000, 0.037200, 220, NOW() - INTERVAL '3 hours 10 minutes'),
          ($1, $3, 'code-intelligence', 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 'api_key',
           'task_pr_418_audit', 'PR #418 OAuth Token Middleware Security & AST Audit', 2, 'Step 2: Generate Verified Remediation Patch', 'completed',
           'anthropic_direct', 'claude-3.5-sonnet', 'global', false,
           4200, 1850, 6050, 0.040350, 0.012600, 0.027750, 0.040350, 240, NOW() - INTERVAL '3 hours 08 minutes'),
          ($1, $3, 'code-intelligence', 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 'api_key',
           'task_pr_418_audit', 'PR #418 OAuth Token Middleware Security & AST Audit', 3, 'Step 3: Unit Test Assertion Synthesis (Failover to Mini)', 'completed',
           'azure_openai', 'gpt-4o-mini', 'westus', true,
           3100, 1200, 4300, 0.001185, 0.000465, 0.000720, 0.027300, 145, NOW() - INTERVAL '3 hours 06 minutes'),

          -- Task 4: agent-code-02 (2-step CVE Dependency Triage)
          ($1, $3, 'code-intelligence', 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 'api_key',
           'task_cve_triage_104', 'Zero-Day Dependency Reachability Analysis', 1, 'Step 1: Call-Graph Reachability Check', 'completed',
           'anthropic_direct', 'claude-3.5-sonnet', 'global', false,
           3600, 980, 4580, 0.025500, 0.010800, 0.014700, 0.025500, 195, NOW() - INTERVAL '1 hour 45 minutes'),
          ($1, $3, 'code-intelligence', 'agent-code-02', 'Code Reviewer & Security Auditor (A2A Agent)', 'api_key',
           'task_cve_triage_104', 'Zero-Day Dependency Reachability Analysis', 2, 'Step 2: Advisory Summary & Upgrade Plan', 'completed',
           'anthropic_direct', 'claude-3.5-sonnet', 'global', false,
           2200, 860, 3060, 0.019500, 0.006600, 0.012900, 0.019500, 180, NOW() - INTERVAL '1 hour 43 minutes'),

          -- Task 5: okta-marketing-copilot (2-step Product Launch Copy Task via Okta OAuth PKCE)
          ($1, $2, 'enterprise-chat', 'okta-marketing-copilot', 'Marketing Campaign Copilot (Okta PKCE)', 'oauth_pkce',
           'task_mkt_launch_77', 'Q4 Enterprise AI Gateway Launch Campaign Brief', 1, 'Step 1: Persona Messaging Matrix', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           1800, 1100, 2900, 0.015500, 0.004500, 0.011000, 0.015500, 230, NOW() - INTERVAL '1 hour 15 minutes'),
          ($1, $2, 'enterprise-chat', 'okta-marketing-copilot', 'Marketing Campaign Copilot (Okta PKCE)', 'oauth_pkce',
           'task_mkt_launch_77', 'Q4 Enterprise AI Gateway Launch Campaign Brief', 2, 'Step 2: Multi-Region Landing Page Copy', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           2100, 1450, 3550, 0.019750, 0.005250, 0.014500, 0.019750, 260, NOW() - INTERVAL '1 hour 12 minutes'),

          -- Task 6: agent-sup-03 (2-step Customer Support Escalation Triage)
          ($1, $2, 'enterprise-chat', 'agent-sup-03', 'Customer Support Escalation Agent', 'client_credentials',
           'task_sup_ticket_8821', 'P1 Enterprise Ticket #8821 Root Cause & Slack Escalation', 1, 'Step 1: Sentiment & Log Correlation', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           1450, 520, 1970, 0.008825, 0.003625, 0.005200, 0.008825, 190, NOW() - INTERVAL '45 minutes'),
          ($1, $2, 'enterprise-chat', 'agent-sup-03', 'Customer Support Escalation Agent', 'client_credentials',
           'task_sup_ticket_8821', 'P1 Enterprise Ticket #8821 Root Cause & Slack Escalation', 2, 'Step 2: Draft Customer RCA & Slack Alert', 'completed',
           'azure_openai', 'gpt-4o', 'eastus2', false,
           1600, 680, 2280, 0.010800, 0.004000, 0.006800, 0.010800, 210, NOW() - INTERVAL '44 minutes'),

          -- Task 7: agent-data-04 (1-step Vector Schema Classification Task)
          ($1, $3, 'code-intelligence', 'agent-data-04', 'ETL Pipeline & Vector Ingestion Agent', 'client_credentials',
           'task_etl_schema_309', 'S3 Parquet Metadata Classification & Chunking Plan', 1, 'Step 1: Infer Parquet Taxonomy & Embedding Strategy', 'completed',
           'azure_openai', 'gpt-4o-mini', 'westus', false,
           4500, 1200, 5700, 0.001395, 0.000675, 0.000720, 0.001395, 135, NOW() - INTERVAL '20 minutes')
      `, [defaultOrgId, entGwId, codeGwId]);
    }

    await client.query('COMMIT');
    isInitialized = true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
