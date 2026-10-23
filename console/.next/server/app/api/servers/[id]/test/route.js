"use strict";(()=>{var e={};e.id=974,e.ids=[974],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},665:e=>{e.exports=require("dns")},8216:e=>{e.exports=require("net")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},9457:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{originalPathname:()=>U,patchFetch:()=>n,requestAsyncStorage:()=>L,routeModule:()=>N,serverHooks:()=>d,staticGenerationAsyncStorage:()=>A});var r=a(9303),E=a(8716),s=a(670),i=a(6710),o=e([i]);i=(o.then?(await o)():o)[0];let N=new r.AppRouteRouteModule({definition:{kind:E.x.APP_ROUTE,page:"/api/servers/[id]/test/route",pathname:"/api/servers/[id]/test",filename:"route",bundlePath:"app/api/servers/[id]/test/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\servers\\[id]\\test\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:L,staticGenerationAsyncStorage:A,serverHooks:d}=N,U="/api/servers/[id]/test/route";function n(){return(0,s.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:A})}T()}catch(e){T(e)}})},6710:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.r(t),a.d(t,{POST:()=>o,dynamic:()=>n});var r=a(7070),E=a(469),s=a(1183),i=e([E,s]);[E,s]=i.then?(await i)():i;let n="force-dynamic";async function o(e,{params:t}){try{let T=(0,s.v)(e);if(!T)return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,E.q)();let i=await E.d.query(`
      SELECT s.*
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `,[t.id,T.orgId]);if(0===i.rows.length)return r.NextResponse.json({error:"MCP Server not found"},{status:404});let o=i.rows[0].url,{validateSSRF:n,SSRFError:N}=await a.e(398).then(a.bind(a,9398));try{await n(o)}catch(e){return r.NextResponse.json({success:!1,status:"unhealthy",error:`SSRF Policy Violation: ${e.message}`,checked_url:o},{status:400})}o.includes("localhost:3000")&&(o=o.replace("localhost:3000","127.0.0.1:3000"));let L=Date.now(),A="unhealthy",d=0,U=null;try{let e=new AbortController,t=setTimeout(()=>e.abort(),6e3),a=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"AI-Console-Inspector",version:"1.0.0"}},id:1}),signal:e.signal});if(clearTimeout(t),d=Date.now()-L,a.ok){let e=await a.json();e.result?(A="healthy",U=e.result.serverInfo||null):A="healthy"}else A="unhealthy"}catch(e){d=Date.now()-L,A="unhealthy"}return await E.d.query(`
      UPDATE mcp_servers
      SET health_status = $1, last_checked_at = NOW()
      WHERE id = $2
    `,[A,t.id]),r.NextResponse.json({success:"healthy"===A,status:A,latency_ms:d,server_info:U,checked_url:o})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}T()}catch(e){T(e)}})},469:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{d:()=>N,q:()=>o});var r=a(8678),E=a(2023),s=a.n(E),i=e([r]);r=(i.then?(await i)():i)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new r.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),L=!1;async function o(){if(L)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let T=process.env.ADMIN_EMAIL||"admin@aigateway.local",r=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[T]);if(0===E.rows.length){let a=await s().genSalt(10),E=await s().hash(r,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,T,E])}let i=await e.query("SELECT id FROM projects LIMIT 1");0===i.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await s().genSalt(10),a=await s().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),L=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}T()}catch(e){T(e)}})},1183:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{v:()=>s});var r=a(5456),E=e([r]);function s(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,r.g$)(t):null}r=(E.then?(await E)():E)[0],T()}catch(e){T(e)}})},5456:(e,t,a)=>{a.a(e,async(e,T)=>{try{a.d(t,{So:()=>A,g$:()=>L,uy:()=>N});var r=a(1482),E=a.n(r),s=a(2023),i=a.n(s),o=a(469),n=e([o]);o=(n.then?(await n)():n)[0];let d=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function N(e){return E().sign(e,d,{expiresIn:"7d"})}function L(e){try{return E().verify(e,d)}catch{return null}}async function A(e,t){await (0,o.q)();let a=await o.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===a.rows.length)return null;let T=a.rows[0];return"active"===T.status&&await i().compare(t,T.password_hash)?{userId:T.id,orgId:T.org_id,email:T.email,name:T.name,role:T.role}:null}T()}catch(e){T(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),T=t.X(0,[276,972,482,23],()=>a(9457));module.exports=T})();