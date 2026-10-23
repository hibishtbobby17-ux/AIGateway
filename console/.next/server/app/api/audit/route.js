"use strict";(()=>{var e={};e.id=701,e.ids=[701],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},6993:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{originalPathname:()=>d,patchFetch:()=>L,requestAsyncStorage:()=>o,routeModule:()=>A,serverHooks:()=>U,staticGenerationAsyncStorage:()=>n});var E=a(9303),r=a(8716),i=a(670),s=a(2975),N=e([s]);s=(N.then?(await N)():N)[0];let A=new E.AppRouteRouteModule({definition:{kind:r.x.APP_ROUTE,page:"/api/audit/route",pathname:"/api/audit",filename:"route",bundlePath:"app/api/audit/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\audit\\route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:o,staticGenerationAsyncStorage:n,serverHooks:U}=A,d="/api/audit/route";function L(){return(0,i.patchFetch)({serverHooks:U,staticGenerationAsyncStorage:n})}T()}catch(e){T(e)}})},2975:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{GET:()=>N,dynamic:()=>L});var E=a(7070),r=a(469),i=a(1183),s=e([r,i]);[r,i]=s.then?(await s)():s;let L="force-dynamic";async function N(e){try{let t=(0,i.v)(e);if(!t)return E.NextResponse.json({error:"Unauthorized"},{status:401});await (0,r.q)();let{searchParams:a}=new URL(e.url),T=a.get("action"),s=a.get("actor"),N=a.get("target"),L=Math.min(parseInt(a.get("limit")||"50",10),200),A=parseInt(a.get("offset")||"0",10),o=`
      SELECT id, org_id, actor, action, target, timestamp, diff
      FROM audit_logs
      WHERE org_id = $1
    `,n=[t.orgId],U=2;T&&(o+=` AND action ILIKE $${U++}`,n.push(`%${T}%`)),s&&(o+=` AND actor ILIKE $${U++}`,n.push(`%${s}%`)),N&&(o+=` AND target ILIKE $${U++}`,n.push(`%${N}%`)),o+=` ORDER BY timestamp DESC LIMIT $${U++} OFFSET $${U++}`,n.push(L,A);let d=await r.d.query(o,n);return E.NextResponse.json({audit_logs:d.rows,count:d.rows.length,limit:L,offset:A})}catch(e){return E.NextResponse.json({error:e.message},{status:500})}}T()}catch(e){T(e)}})},469:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{d:()=>A,q:()=>N});var E=a(8678),r=a(2023),i=a.n(r),s=e([E]);E=(s.then?(await s)():s)[0];let L=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,A=new E.Pool({connectionString:L,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),o=!1;async function N(){if(o)return;let e=await A.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let T=process.env.ADMIN_EMAIL||"admin@aigateway.local",E=process.env.ADMIN_PASSWORD||"Admin123!@#",r=await e.query("SELECT id FROM users WHERE email = $1",[T]);if(0===r.rows.length){let a=await i().genSalt(10),r=await i().hash(E,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,T,r])}let s=await e.query("SELECT id FROM projects LIMIT 1");0===s.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let N=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===N.rows.length){let t=await i().genSalt(10),a=await i().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),o=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}T()}catch(e){T(e)}})},1183:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{v:()=>i});var E=a(5456),r=e([E]);function i(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,E.g$)(t):null}E=(r.then?(await r)():r)[0],T()}catch(e){T(e)}})},5456:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{So:()=>n,g$:()=>o,uy:()=>A});var E=a(1482),r=a.n(E),i=a(2023),s=a.n(i),N=a(469),L=e([N]);N=(L.then?(await L)():L)[0];let U=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function A(e){return r().sign(e,U,{expiresIn:"7d"})}function o(e){try{return r().verify(e,U)}catch{return null}}async function n(e,t){await (0,N.q)();let a=await N.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===a.rows.length)return null;let T=a.rows[0];return"active"===T.status&&await s().compare(t,T.password_hash)?{userId:T.id,orgId:T.org_id,email:T.email,name:T.name,role:T.role}:null}T()}catch(e){T(e)}})}};var t=require("../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),T=t.X(0,[276,972,482,23],()=>a(6993));module.exports=T})();