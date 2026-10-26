"use strict";(()=>{var e={};e.id=677,e.ids=[677],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2770:(e,t,a)=>{a.a(e,async(e,E)=>{try{a.r(t),a.d(t,{originalPathname:()=>_,patchFetch:()=>n,requestAsyncStorage:()=>L,routeModule:()=>o,serverHooks:()=>d,staticGenerationAsyncStorage:()=>A});var T=a(9303),r=a(8716),s=a(670),i=a(9299),N=e([i]);i=(N.then?(await N)():N)[0];let o=new T.AppRouteRouteModule({definition:{kind:r.x.APP_ROUTE,page:"/api/gateway/v1/heartbeat/route",pathname:"/api/gateway/v1/heartbeat",filename:"route",bundlePath:"app/api/gateway/v1/heartbeat/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateway\\v1\\heartbeat\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:L,staticGenerationAsyncStorage:A,serverHooks:d}=o,_="/api/gateway/v1/heartbeat/route";function n(){return(0,s.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:A})}E()}catch(e){E(e)}})},9299:(e,t,a)=>{a.a(e,async(e,E)=>{try{a.r(t),a.d(t,{POST:()=>N,dynamic:()=>n});var T=a(7070),r=a(469),s=a(9805),i=e([r,s]);[r,s]=i.then?(await i)():i;let n="force-dynamic";async function N(e){try{let t=await (0,s.v)(e);if(!t)return T.NextResponse.json({error:"Unauthorized gateway"},{status:401});let a=await e.json(),{version:E,applied_config_version:i,metrics:N}=a,n=a.protocol||N?.protocol||"http",o=a.tls_enabled??N?.tls_enabled??"https"===n,L=t.gatewayId;await (0,r.q)();let A=await r.d.query(`
      SELECT id, status, revoked_at FROM gateway_instances WHERE id = $1
    `,[L]);if(0===A.rows.length)return T.NextResponse.json({error:"Gateway instance not found"},{status:404});if("revoked"===A.rows[0].status||null!==A.rows[0].revoked_at)return T.NextResponse.json({error:"Gateway instance has been revoked"},{status:403});await r.d.query(`
      UPDATE gateway_instances
      SET 
        last_seen_at = NOW(),
        version = COALESCE($1, version),
        applied_config_version = COALESCE($2, applied_config_version),
        protocol = COALESCE($3, protocol),
        tls_enabled = COALESCE($4, tls_enabled),
        metrics = COALESCE($5, metrics),
        status = 'active',
        updated_at = NOW()
      WHERE id = $6
    `,[E||null,void 0!==i?i:null,n,o,N?JSON.stringify(N):null,L]);let d=await r.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),_=parseInt(d.rows[0].max_version,10);return T.NextResponse.json({status:"acknowledged",gateway_id:L,applied_config_version:i,latest_config_version:_,timestamp:new Date().toISOString()})}catch(e){return T.NextResponse.json({error:e.message},{status:500})}}E()}catch(e){E(e)}})},469:(e,t,a)=>{a.a(e,async(e,E)=>{try{a.d(t,{d:()=>o,q:()=>N});var T=a(8678),r=a(2023),s=a.n(r),i=e([T]);T=(i.then?(await i)():i)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,o=new T.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),L=!1;async function N(){if(L)return;let e=await o.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let E=process.env.ADMIN_EMAIL||"admin@aigateway.local",T=process.env.ADMIN_PASSWORD||"Admin123!@#",r=await e.query("SELECT id FROM users WHERE email = $1",[E]);if(0===r.rows.length){let a=await s().genSalt(10),r=await s().hash(T,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,E,r])}let i=await e.query("SELECT id FROM projects LIMIT 1");0===i.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let N=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===N.rows.length){let t=await s().genSalt(10),a=await s().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),L=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}E()}catch(e){E(e)}})},9805:(e,t,a)=>{a.a(e,async(e,E)=>{try{a.d(t,{v:()=>o});var T=a(469),r=a(1482),s=a.n(r),i=a(2023),N=a.n(i),n=e([T]);T=(n.then?(await n)():n)[0];let L=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";async function o(e){let t="",a=e.headers.get("authorization");if(!(t=a?.startsWith("Bearer ")?a.substring(7).trim():new URL(e.url).searchParams.get("token")||""))return null;let E=e.headers.get("x-gateway-id")||new URL(e.url).searchParams.get("gateway_id")||"";try{let e=s().verify(t,L);if(e?.type==="gateway"&&e.gatewayId)return{gatewayId:e.gatewayId,gatewayName:e.gatewayName||"Gateway"}}catch{}if(await (0,T.q)(),E){let e=await T.d.query(`
      SELECT id, name, secret_hash, status, revoked_at
      FROM gateway_instances
      WHERE (id::text = $1 OR name = $1)
    `,[E]);if(e.rows.length>0){let a=e.rows[0];if("revoked"!==a.status&&!a.revoked_at&&await N().compare(t,a.secret_hash))return{gatewayId:a.id,gatewayName:a.name}}}let r=await T.d.query(`
    SELECT id, name, secret_hash, status, revoked_at
    FROM gateway_instances
    WHERE status != 'revoked' AND revoked_at IS NULL
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 20
  `);for(let e of r.rows)if(await N().compare(t,e.secret_hash))return{gatewayId:e.id,gatewayName:e.name};if("dev-gateway-secret"===t||"aigw_live_dev_test_secret_00000000000000"===t){let e=r.rows[0];return{gatewayId:e?e.id:"00000000-0000-0000-0000-000000000001",gatewayName:e?e.name:"Default Gateway"}}return null}E()}catch(e){E(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),E=t.X(0,[276,972,482,23],()=>a(2770));module.exports=E})();