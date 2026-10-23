"use strict";(()=>{var e={};e.id=521,e.ids=[521],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},8046:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{originalPathname:()=>_,patchFetch:()=>n,requestAsyncStorage:()=>A,routeModule:()=>N,serverHooks:()=>d,staticGenerationAsyncStorage:()=>L});var T=a(9303),E=a(8716),i=a(670),s=a(2769),o=e([s]);s=(o.then?(await o)():o)[0];let N=new T.AppRouteRouteModule({definition:{kind:E.x.APP_ROUTE,page:"/api/servers/[id]/oauth/authorize/route",pathname:"/api/servers/[id]/oauth/authorize",filename:"route",bundlePath:"app/api/servers/[id]/oauth/authorize/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\servers\\[id]\\oauth\\authorize\\route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:A,staticGenerationAsyncStorage:L,serverHooks:d}=N,_="/api/servers/[id]/oauth/authorize/route";function n(){return(0,i.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:L})}r()}catch(e){r(e)}})},2769:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{POST:()=>d,dynamic:()=>_});var T=a(7070),E=a(469),i=a(1211),s=a(1462),o=a(4770),n=a.n(o),N=a(1482),A=a.n(N),L=e([E]);E=(L.then?(await L)():L)[0];let _="force-dynamic",U=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";async function d(e,{params:t}){let a;if(!function(e){let t=e.headers.get("authorization");if(!t?.startsWith("Bearer "))return null;let a=t.substring(7);try{return{userId:A().verify(a,U).userId}}catch{return null}}(e))return T.NextResponse.json({error:"Unauthorized"},{status:401});await (0,E.q)();let r=t.id,o=await E.d.query(`SELECT project_id, issuer, token_endpoint, authorization_endpoint, client_id, client_secret_encrypted, scopes, redirect_uri
     FROM oauth_configs
     WHERE mcp_server_id = $1`,[r]);if(0===o.rows.length)return T.NextResponse.json({error:"OAuth configuration not found for server"},{status:404});let N=o.rows[0],L=N.authorization_endpoint||`${N.issuer}/authorize`,d=N.token_endpoint||`${N.issuer}/token`;if(N.client_secret_encrypted)try{a=(0,i.Q)(N.client_secret_encrypted)}catch{}let _=e.headers.get("host")||"console:3000",c=e.headers.get("x-forwarded-proto")||"http",u=N.redirect_uri||`${c}://${_}/api/oauth/callback`,O=n().randomBytes(32).toString("base64url"),R=n().createHash("sha256").update(O).digest("base64url"),I=n().randomBytes(24).toString("base64url");(0,s.N1)({mcpServerId:r,projectId:N.project_id,state:I,codeVerifier:O,redirectUri:u,tokenEndpoint:d,clientId:N.client_id,clientSecret:a,expiresAt:Date.now()+6e5});let l=new URL(L);l.searchParams.set("client_id",N.client_id),l.searchParams.set("redirect_uri",u),l.searchParams.set("response_type","code"),l.searchParams.set("state",I),l.searchParams.set("code_challenge",R),l.searchParams.set("code_challenge_method","S256");let p=Array.isArray(N.scopes)&&N.scopes.length>0?N.scopes.join(" "):"mcp:tools";return l.searchParams.set("scope",p),T.NextResponse.json({authorization_url:l.toString(),state:I,redirect_uri:u})}r()}catch(e){r(e)}})},469:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{d:()=>N,q:()=>o});var T=a(8678),E=a(2023),i=a.n(E),s=e([T]);T=(s.then?(await s)():s)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new T.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),A=!1;async function o(){if(A)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
      `)).rows[0].id:a.rows[0].id;let r=process.env.ADMIN_EMAIL||"admin@aigateway.local",T=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[r]);if(0===E.rows.length){let a=await i().genSalt(10),E=await i().hash(T,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,r,E])}let s=await e.query("SELECT id FROM projects LIMIT 1");0===s.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await i().genSalt(10),a=await i().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),A=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}r()}catch(e){r(e)}})},1211:(e,t,a)=>{a.d(t,{Q:()=>s,l:()=>i});var r=a(4770),T=a.n(r);let E=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function i(e){let t=T().randomBytes(12),a=T().createCipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),t),r=a.update(e,"utf8","hex");r+=a.final("hex");let i=a.getAuthTag().toString("hex");return`${t.toString("hex")}:${i}:${r}`}function s(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[a,r,i]=t,s=T().createDecipheriv("aes-256-gcm",Buffer.from(E.padEnd(32).slice(0,32)),Buffer.from(a,"hex"));return s.setAuthTag(Buffer.from(r,"hex")),s.update(i,"hex","utf8")+s.final("utf8")}},1462:(e,t,a)=>{a.d(t,{N1:()=>T,QG:()=>E});let r=new Map;function T(e){r.set(e.state,e)}function E(e){let t=function(e){let t=r.get(e);if(t){if(Date.now()>t.expiresAt){r.delete(e);return}return t}}(e);return t&&r.delete(e),t}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[276,972,482,23],()=>a(8046));module.exports=r})();