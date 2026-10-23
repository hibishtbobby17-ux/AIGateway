"use strict";(()=>{var e={};e.id=378,e.ids=[378],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},665:e=>{e.exports=require("dns")},8216:e=>{e.exports=require("net")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2152:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{originalPathname:()=>_,patchFetch:()=>n,requestAsyncStorage:()=>L,routeModule:()=>N,serverHooks:()=>d,staticGenerationAsyncStorage:()=>A});var s=a(9303),E=a(8716),T=a(670),i=a(2311),o=e([i]);i=(o.then?(await o)():o)[0];let N=new s.AppRouteRouteModule({definition:{kind:E.x.APP_ROUTE,page:"/api/projects/[id]/servers/route",pathname:"/api/projects/[id]/servers",filename:"route",bundlePath:"app/api/projects/[id]/servers/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\projects\\[id]\\servers\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:L,staticGenerationAsyncStorage:A,serverHooks:d}=N,_="/api/projects/[id]/servers/route";function n(){return(0,T.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:A})}r()}catch(e){r(e)}})},2311:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{GET:()=>o,POST:()=>n,dynamic:()=>N});var s=a(7070),E=a(469),T=a(1183),i=e([E,T]);[E,T]=i.then?(await i)():i;let N="force-dynamic";async function o(e,{params:t}){try{let a=(0,T.v)(e);if(!a)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,E.q)();let r=await E.d.query("SELECT id FROM projects WHERE id = $1 AND org_id = $2",[t.id,a.orgId]);if(0===r.rows.length)return s.NextResponse.json({error:"Project not found"},{status:404});let i=await E.d.query(`
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
        s.health_status,
        s.last_checked_at,
        s.created_at,
        s.updated_at,
        COUNT(p.id)::int as tools_count
      FROM mcp_servers s
      LEFT JOIN tool_policies p ON p.mcp_server_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `,[t.id]);return s.NextResponse.json({servers:i.rows})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}async function n(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});let{name:i,namespace_prefix:o,transport:n,url:N,auth_type:L,timeouts:A,enabled:d}=await e.json();if(!i||!i.trim())return s.NextResponse.json({error:"Server name is required"},{status:400});if(!N||!N.trim())return s.NextResponse.json({error:"Server URL is required"},{status:400});let{validateSSRF:_,SSRFError:U}=await a.e(398).then(a.bind(a,9398));try{await _(N.trim())}catch(e){if(e instanceof U)return s.NextResponse.json({error:`SSRF Policy Violation: ${e.message}`},{status:400});return s.NextResponse.json({error:`URL Validation Error: ${e.message}`},{status:400})}let u=(o||i).toLowerCase().trim().replace(/[^a-z0-9_]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");await (0,E.q)();let R=await E.d.query("SELECT id, slug FROM projects WHERE id = $1 AND org_id = $2",[t.id,r.orgId]);if(0===R.rows.length)return s.NextResponse.json({error:"Project not found"},{status:404});let c=R.rows[0].slug,O=(await E.d.query(`
      INSERT INTO mcp_servers (
        project_id, name, namespace_prefix, transport, url, auth_type, timeouts, enabled, health_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `,[t.id,i.trim(),u||"mcp",n||"http",N.trim(),L||"none",JSON.stringify(A||{dial_ms:5e3,call_ms:15e3}),void 0===d||d])).rows[0];await E.d.query("UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE id = $1",[t.id]);let{logAudit:p}=await a.e(662).then(a.bind(a,7662));return await p({orgId:r.orgId,actor:r.email,action:"server.create",target:`server:${O.name} in project:${c}`,diff:{name:O.name,url:O.url,transport:O.transport,auth_type:O.auth_type}}),s.NextResponse.json({server:O},{status:201})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}r()}catch(e){r(e)}})},469:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{d:()=>N,q:()=>o});var s=a(8678),E=a(2023),T=a.n(E),i=e([s]);s=(i.then?(await i)():i)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new s.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),L=!1;async function o(){if(L)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let r=process.env.ADMIN_EMAIL||"admin@aigateway.local",s=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[r]);if(0===E.rows.length){let a=await T().genSalt(10),E=await T().hash(s,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,r,E])}let i=await e.query("SELECT id FROM projects LIMIT 1");0===i.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await T().genSalt(10),a=await T().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),L=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}r()}catch(e){r(e)}})},1183:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{v:()=>T});var s=a(5456),E=e([s]);function T(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,s.g$)(t):null}s=(E.then?(await E)():E)[0],r()}catch(e){r(e)}})},5456:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{So:()=>A,g$:()=>L,uy:()=>N});var s=a(1482),E=a.n(s),T=a(2023),i=a.n(T),o=a(469),n=e([o]);o=(n.then?(await n)():n)[0];let d=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function N(e){return E().sign(e,d,{expiresIn:"7d"})}function L(e){try{return E().verify(e,d)}catch{return null}}async function A(e,t){await (0,o.q)();let a=await o.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===a.rows.length)return null;let r=a.rows[0];return"active"===r.status&&await i().compare(t,r.password_hash)?{userId:r.id,orgId:r.org_id,email:r.email,name:r.name,role:r.role}:null}r()}catch(e){r(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[276,972,482,23],()=>a(2152));module.exports=r})();