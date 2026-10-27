"use strict";(()=>{var e={};e.id=5398,e.ids=[5398],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},4770:e=>{e.exports=require("crypto")},8678:e=>{e.exports=import("pg")},8140:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{originalPathname:()=>d,patchFetch:()=>n,requestAsyncStorage:()=>_,routeModule:()=>N,serverHooks:()=>A,staticGenerationAsyncStorage:()=>L});var s=a(9303),i=a(8716),E=a(670),r=a(3255),o=e([r]);r=(o.then?(await o)():o)[0];let N=new s.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/llm/[slug]/v1/models/route",pathname:"/api/llm/[slug]/v1/models",filename:"route",bundlePath:"app/api/llm/[slug]/v1/models/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\llm\\[slug]\\v1\\models\\route.ts",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:_,staticGenerationAsyncStorage:L,serverHooks:A}=N,d="/api/llm/[slug]/v1/models/route";function n(){return(0,E.patchFetch)({serverHooks:A,staticGenerationAsyncStorage:L})}T()}catch(e){T(e)}})},3255:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{GET:()=>r,dynamic:()=>o});var s=a(7070),i=a(469),E=e([i]);i=(E.then?(await E)():E)[0];let o="force-dynamic";async function r(e,{params:t}){try{await (0,i.q)();let e=await i.d.query(`
      SELECT * FROM llm_gateways
      WHERE slug = $1 AND status = 'active'
    `,[t.slug]);if(0===e.rows.length)return s.NextResponse.json({error:"LLM Gateway not found"},{status:404});let a=e.rows[0],T=a.primary_backend||{},E=a.fallback_backends||[],r=[{id:T.model_alias||"gpt-4o",object:"model",created:1715e6,owned_by:T.provider||"azure_openai",permission:[],root:T.model_alias||"gpt-4o",parent:null},...E.map(e=>({id:e.model_alias||"claude-3-5-sonnet",object:"model",created:1715e6,owned_by:e.provider||"aws_bedrock",permission:[],root:e.model_alias||"claude-3-5-sonnet",parent:null}))];return s.NextResponse.json({object:"list",data:r})}catch(e){return s.NextResponse.json({error:e.message||"Internal error"},{status:500})}}T()}catch(e){T(e)}})},469:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{d:()=>N,q:()=>o});var s=a(8678),i=a(2023),E=a.n(i),r=e([s]);s=(r.then?(await r)():r)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new s.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),_=!1;async function o(){if(_)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
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
    `),await e.query(`
      CREATE TABLE IF NOT EXISTS gateway_project_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gateway_id UUID NOT NULL REFERENCES gateway_instances(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(gateway_id, project_id)
      );
    `),await e.query(`
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
    `),await e.query(`
      CREATE TABLE IF NOT EXISTS ingest_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        hash VARCHAR(255) NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `),await e.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        actor VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target VARCHAR(255) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        diff JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `),await e.query(`
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
    `),await e.query(`
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
    `);let a=await e.query("SELECT id FROM organizations LIMIT 1");t=0===a.rows.length?(await e.query(`
        INSERT INTO organizations (name, slug)
        VALUES ('Default Enterprise', 'default-enterprise')
        RETURNING id
      `)).rows[0].id:a.rows[0].id;let T=process.env.ADMIN_EMAIL||"admin@aigateway.local",s=process.env.ADMIN_PASSWORD||"Admin123!@#",i=await e.query("SELECT id FROM users WHERE email = $1",[T]);if(0===i.rows.length){let a=await E().genSalt(10),i=await E().hash(s,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,T,i])}let r=await e.query("SELECT id FROM projects LIMIT 1");0===r.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await E().genSalt(10),a=await E().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}let n=await e.query("SELECT id FROM llm_gateways LIMIT 1");0===n.rows.length&&await e.query(`
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
      `,[t]),await e.query("COMMIT"),_=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}T()}catch(e){T(e)}})}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),T=t.X(0,[9276,5972,2023],()=>a(8140));module.exports=T})();