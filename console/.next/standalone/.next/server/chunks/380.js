"use strict";exports.id=380,exports.ids=[380],exports.modules={469:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{d:()=>_,q:()=>o});var i=a(8678),E=a(2023),r=a.n(E),T=e([i]);i=(T.then?(await T)():T)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,_=new i.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),N=!1;async function o(){if(N)return;let e=await _.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
    `);let a=await e.query("SELECT id FROM organizations LIMIT 1");t=0===a.rows.length?(await e.query(`
        INSERT INTO organizations (name, slug)
        VALUES ('Default Enterprise', 'default-enterprise')
        RETURNING id
      `)).rows[0].id:a.rows[0].id;let s=process.env.ADMIN_EMAIL||"admin@aigateway.local",i=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[s]);if(0===E.rows.length){let a=await r().genSalt(10),E=await r().hash(i,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,s,E])}let T=await e.query("SELECT id FROM projects LIMIT 1");0===T.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await r().genSalt(10),a=await r().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),N=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}s()}catch(e){s(e)}})},1211:(e,t,a)=>{a.d(t,{Q:()=>T,l:()=>r});var s=a(4770),i=a.n(s);let E=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function r(e){let t=i().randomBytes(12),a=i().createCipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),t),s=a.update(e,"utf8","hex");s+=a.final("hex");let r=a.getAuthTag().toString("hex");return`${t.toString("hex")}:${r}:${s}`}function T(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[a,s,r]=t,T=i().createDecipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),Buffer.from(a,"hex"));return T.setAuthTag(Buffer.from(s,"hex")),T.update(r,"hex","utf8")+T.final("utf8")}},9805:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{v:()=>_});var i=a(469),E=a(1482),r=a.n(E),T=a(2023),o=a.n(T),n=e([i]);i=(n.then?(await n)():n)[0];let N=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";async function _(e){let t="",a=e.headers.get("authorization");if(!(t=a?.startsWith("Bearer ")?a.substring(7).trim():new URL(e.url).searchParams.get("token")||""))return null;let s=e.headers.get("x-gateway-id")||new URL(e.url).searchParams.get("gateway_id")||"";try{let e=r().verify(t,N);if(e?.type==="gateway"&&e.gatewayId)return{gatewayId:e.gatewayId,gatewayName:e.gatewayName||"Gateway"}}catch{}if(await (0,i.q)(),s){let e=await i.d.query(`
      SELECT id, name, secret_hash, status, revoked_at
      FROM gateway_instances
      WHERE (id::text = $1 OR name = $1)
    `,[s]);if(e.rows.length>0){let a=e.rows[0];if("revoked"!==a.status&&!a.revoked_at&&await o().compare(t,a.secret_hash))return{gatewayId:a.id,gatewayName:a.name}}}let E=await i.d.query(`
    SELECT id, name, secret_hash, status, revoked_at
    FROM gateway_instances
    WHERE status != 'revoked' AND revoked_at IS NULL
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 20
  `);for(let e of E.rows)if(await o().compare(t,e.secret_hash))return{gatewayId:e.id,gatewayName:e.name};if("dev-gateway-secret"===t||"aigw_live_dev_test_secret_00000000000000"===t){let e=E.rows[0];return{gatewayId:e?e.id:"00000000-0000-0000-0000-000000000001",gatewayName:e?e.name:"Default Gateway"}}return null}s()}catch(e){s(e)}})},3471:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{T:()=>T});var i=a(469),E=a(1211),r=e([i]);async function T(e){await (0,i.q)();let t=`
    SELECT id, name, slug, status, settings, config_version
    FROM projects
    WHERE status = 'active'
    ORDER BY created_at ASC
  `,a=[];e&&(await i.d.query("SELECT 1 FROM gateway_project_bindings WHERE gateway_id = $1 LIMIT 1",[e])).rows.length>0&&(t=`
        SELECT p.id, p.name, p.slug, p.status, p.settings, p.config_version
        FROM projects p
        JOIN gateway_project_bindings gpb ON gpb.project_id = p.id
        WHERE p.status = 'active' AND gpb.gateway_id = $1
        ORDER BY p.created_at ASC
      `,a.push(e));let s=await i.d.query(t,a),r=1;for(let e of s.rows)e.config_version>r&&(r=e.config_version);let T=await i.d.query(`
    SELECT 
      s.id,
      s.project_id,
      s.name,
      s.namespace_prefix,
      s.transport,
      s.url,
      s.auth_type,
      s.timeouts,
      s.enabled,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'tool_name', tp.tool_name,
            'enabled', tp.enabled,
            'rename', tp.rename
          )
        ) FILTER (WHERE tp.id IS NOT NULL),
        '[]'
      ) as tool_policies,
      CASE WHEN oc.id IS NOT NULL THEN
        json_build_object(
          'issuer', oc.issuer,
          'token_endpoint', oc.token_endpoint,
          'client_id', oc.client_id,
          'client_secret_encrypted', oc.client_secret_encrypted,
          'scopes', oc.scopes,
          'audience', oc.audience,
          'grant_type', oc.grant_type,
          'status', COALESCE(ot.status, 'none')
        )
      ELSE NULL END as oauth_config
    FROM mcp_servers s
    LEFT JOIN tool_policies tp ON tp.mcp_server_id = s.id
    LEFT JOIN oauth_configs oc ON oc.mcp_server_id = s.id
    LEFT JOIN oauth_tokens ot ON ot.mcp_server_id = s.id
    WHERE s.enabled = true
    GROUP BY s.id, oc.id, ot.status
    ORDER BY s.created_at ASC
  `),o={},n=[],_=[];for(let e of T.rows){o[e.project_id]||(o[e.project_id]=[]);let t=null;e.oauth_config&&(t={...e.oauth_config,client_secret:e.oauth_config.client_secret_encrypted?(0,E.Q)(e.oauth_config.client_secret_encrypted):""},delete t.client_secret_encrypted);let a={id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport,url:e.url,auth_type:e.auth_type,timeouts:e.timeouts,enabled:e.enabled,tool_policies:e.tool_policies||[],oauth_config:t};o[e.project_id].push(a),_.push({id:`mcp_${e.namespace_prefix}_${e.id.substring(0,8)}`,provider:e.name,endpoint:e.url,transport:e.transport,auth_type:e.auth_type,rate_limits:{rpm:600,burst:50}})}let N={};for(let e of s.rows){let t=e.settings||{},a=t.inbound_auth||{},s={mode:a.mode||"none",issuer:a.issuer||"",jwks_uri:a.jwks_uri||"",audience:a.audience||"",required_scopes:a.required_scopes||[]};N[e.slug]={id:e.id,slug:e.slug,name:e.name,status:e.status,config_version:e.config_version,settings:e.settings,inbound_auth:s,servers:o[e.id]||[]},n.push({id:`route_${e.slug}`,path_prefix:`/p/${e.slug}/mcp`,project_id:e.id,slug:e.slug,timeout_ms:t.circuit_breaker?.call_timeout_ms||15e3,retries:2,circuit_breaker:{failure_threshold_pct:50,recovery_time_sec:t.circuit_breaker?.recovery_seconds||15}})}return{$schema:"https://json-schema.org/draft/2020-12/schema",version:`v${r}`,config_version:r,timestamp:new Date().toISOString(),routes:n,providers:_,guardrails:{blocked_regex_patterns:["(?i)(api[_-]?key|bearer\\s+[a-z0-9_-]+)","(?i)(password|secret)\\s*[:=]\\s*['\"][^'\"]+['\"]"],max_input_tokens:16384,pii_redaction:!0},projects:N,circuit_breaker_defaults:{failure_threshold_pct:50,recovery_time_sec:15,dial_timeout_ms:5e3,call_timeout_ms:15e3}}}i=(r.then?(await r)():r)[0],s()}catch(e){s(e)}})}};