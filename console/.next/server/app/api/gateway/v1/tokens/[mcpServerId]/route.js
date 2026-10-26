"use strict";(()=>{var e={};e.id=927,e.ids=[927],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},483:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{originalPathname:()=>d,patchFetch:()=>o,requestAsyncStorage:()=>A,routeModule:()=>N,serverHooks:()=>_,staticGenerationAsyncStorage:()=>L});var T=a(9303),E=a(8716),s=a(670),i=a(3943),n=e([i]);i=(n.then?(await n)():n)[0];let N=new T.AppRouteRouteModule({definition:{kind:E.x.APP_ROUTE,page:"/api/gateway/v1/tokens/[mcpServerId]/route",pathname:"/api/gateway/v1/tokens/[mcpServerId]",filename:"route",bundlePath:"app/api/gateway/v1/tokens/[mcpServerId]/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateway\\v1\\tokens\\[mcpServerId]\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:A,staticGenerationAsyncStorage:L,serverHooks:_}=N,d="/api/gateway/v1/tokens/[mcpServerId]/route";function o(){return(0,s.patchFetch)({serverHooks:_,staticGenerationAsyncStorage:L})}r()}catch(e){r(e)}})},3943:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{POST:()=>N,dynamic:()=>A});var T=a(7070),E=a(469),s=a(1211),i=a(1482),n=a.n(i),o=e([E]);E=(o.then?(await o)():o)[0];let A="force-dynamic",L=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";async function N(e,{params:t}){if(!function(e){let t=e.headers.get("authorization");if(!t?.startsWith("Bearer "))return!1;let a=t.substring(7);try{let e=n().verify(a,L);return e?.type==="gateway"}catch{return!1}}(e))return T.NextResponse.json({error:"Unauthorized gateway"},{status:401});await (0,E.q)();let a=t.mcpServerId,r="true"===e.nextUrl.searchParams.get("force"),i=await E.d.query(`SELECT t.id, t.project_id, t.access_token_encrypted, t.refresh_token_encrypted, t.expires_at, t.status,
            c.token_endpoint, c.client_id, c.client_secret_encrypted
     FROM oauth_tokens t
     JOIN oauth_configs c ON c.mcp_server_id = t.mcp_server_id
     WHERE t.mcp_server_id = $1`,[a]);if(0===i.rows.length)return T.NextResponse.json({error:"reauth_required",message:"No OAuth token found for server"},{status:401});let o=i.rows[0];if("reauth_required"===o.status)return T.NextResponse.json({error:"reauth_required",message:"Downstream requires user re-authorization"},{status:401});let N=Date.now(),A=o.expires_at?new Date(o.expires_at).getTime():0;if(A-N<6e4||r){if(!o.refresh_token_encrypted)return await E.d.query("UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1",[o.id]),T.NextResponse.json({error:"reauth_required",message:"No refresh token available"},{status:401});try{let e;let t=(0,s.Q)(o.refresh_token_encrypted),a=o.token_endpoint,r=o.client_id;o.client_secret_encrypted&&(e=(0,s.Q)(o.client_secret_encrypted));let i=new URLSearchParams({grant_type:"refresh_token",refresh_token:t,client_id:r});e&&i.set("client_secret",e);let n=await fetch(a,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:i.toString()});if(!n.ok)return await E.d.query("UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1",[o.id]),await E.d.query(`UPDATE projects
           SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW()
           WHERE id = $1`,[o.project_id]),T.NextResponse.json({error:"reauth_required",message:"Refresh token rejected by IdP"},{status:401});let N=await n.json(),A=N.access_token,L=N.refresh_token||t,_=N.expires_in||3600,d=new Date(Date.now()+1e3*_),U=(0,s.l)(A),c=(0,s.l)(L);return await E.d.query(`UPDATE oauth_tokens
         SET access_token_encrypted = $1,
             refresh_token_encrypted = $2,
             expires_at = $3,
             status = 'ok',
             updated_at = NOW()
         WHERE id = $4`,[U,c,d,o.id]),T.NextResponse.json({access_token:A,token_type:"Bearer",expires_in:_})}catch(e){return await E.d.query("UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1",[o.id]),T.NextResponse.json({error:"reauth_required",message:`Token refresh failed: ${e.message}`},{status:401})}}let _=(0,s.Q)(o.access_token_encrypted);return T.NextResponse.json({access_token:_,token_type:"Bearer",expires_in:Math.max(1,Math.floor((A-N)/1e3))})}r()}catch(e){r(e)}})},469:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{d:()=>N,q:()=>n});var T=a(8678),E=a(2023),s=a.n(E),i=e([T]);T=(i.then?(await i)():i)[0];let o=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new T.Pool({connectionString:o,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),A=!1;async function n(){if(A)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let r=process.env.ADMIN_EMAIL||"admin@aigateway.local",T=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[r]);if(0===E.rows.length){let a=await s().genSalt(10),E=await s().hash(T,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,r,E])}let i=await e.query("SELECT id FROM projects LIMIT 1");0===i.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let n=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===n.rows.length){let t=await s().genSalt(10),a=await s().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),A=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}r()}catch(e){r(e)}})},1211:(e,t,a)=>{a.d(t,{Q:()=>i,l:()=>s});var r=a(4770),T=a.n(r);let E=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function s(e){let t=T().randomBytes(12),a=T().createCipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),t),r=a.update(e,"utf8","hex");r+=a.final("hex");let s=a.getAuthTag().toString("hex");return`${t.toString("hex")}:${s}:${r}`}function i(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[a,r,s]=t,i=T().createDecipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),Buffer.from(a,"hex"));return i.setAuthTag(Buffer.from(r,"hex")),i.update(s,"hex","utf8")+i.final("utf8")}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[276,972,482,23],()=>a(483));module.exports=r})();