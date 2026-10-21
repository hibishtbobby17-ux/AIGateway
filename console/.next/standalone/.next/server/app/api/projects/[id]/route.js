"use strict";(()=>{var e={};e.id=361,e.ids=[361],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2926:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.r(t),r.d(t,{originalPathname:()=>u,patchFetch:()=>n,requestAsyncStorage:()=>L,routeModule:()=>N,serverHooks:()=>d,staticGenerationAsyncStorage:()=>A});var s=r(9303),E=r(8716),T=r(670),i=r(4468),o=e([i]);i=(o.then?(await o)():o)[0];let N=new s.AppRouteRouteModule({definition:{kind:E.x.APP_ROUTE,page:"/api/projects/[id]/route",pathname:"/api/projects/[id]",filename:"route",bundlePath:"app/api/projects/[id]/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\projects\\[id]\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:L,staticGenerationAsyncStorage:A,serverHooks:d}=N,u="/api/projects/[id]/route";function n(){return(0,T.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:A})}a()}catch(e){a(e)}})},4468:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.r(t),r.d(t,{DELETE:()=>N,GET:()=>o,PUT:()=>n,dynamic:()=>L});var s=r(7070),E=r(469),T=r(1183),i=e([E,T]);[E,T]=i.then?(await i)():i;let L="force-dynamic";async function o(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,E.q)();let a=await E.d.query(`
      SELECT id, org_id, name, slug, status, settings, config_version, created_at, updated_at
      FROM projects
      WHERE id = $1 AND org_id = $2
    `,[t.id,r.orgId]);if(0===a.rows.length)return s.NextResponse.json({error:"Project not found"},{status:404});let i=a.rows[0],o=await E.d.query(`
      SELECT 
        s.id,
        s.name,
        s.namespace_prefix,
        s.transport,
        s.url,
        s.auth_type,
        s.timeouts,
        s.enabled,
        s.health_status,
        s.last_checked_at,
        COUNT(p.id)::int as tool_count
      FROM mcp_servers s
      LEFT JOIN tool_policies p ON p.mcp_server_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `,[t.id]);return s.NextResponse.json({project:{...i,servers:o.rows}})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}async function n(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});let{name:a,status:i,settings:o}=await e.json();await (0,E.q)();let n=await E.d.query(`
      UPDATE projects
      SET 
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        settings = COALESCE($3, settings),
        config_version = config_version + 1,
        updated_at = NOW()
      WHERE id = $4 AND org_id = $5
      RETURNING id, org_id, name, slug, status, settings, config_version, updated_at
    `,[a?a.trim():null,i||null,o?JSON.stringify(o):null,t.id,r.orgId]);if(0===n.rows.length)return s.NextResponse.json({error:"Project not found"},{status:404});return s.NextResponse.json({project:n.rows[0]})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}async function N(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,E.q)();let a=await E.d.query("DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id",[t.id,r.orgId]);if(0===a.rows.length)return s.NextResponse.json({error:"Project not found"},{status:404});return s.NextResponse.json({success:!0,deleted_id:t.id})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}a()}catch(e){a(e)}})},469:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{d:()=>N,q:()=>o});var s=r(8678),E=r(2023),T=r.n(E),i=e([s]);s=(i.then?(await i)():i)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new s.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),L=!1;async function o(){if(L)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
    `);let r=await e.query("SELECT id FROM organizations LIMIT 1");t=0===r.rows.length?(await e.query(`
        INSERT INTO organizations (name, slug)
        VALUES ('Default Enterprise', 'default-enterprise')
        RETURNING id
      `)).rows[0].id:r.rows[0].id;let a=process.env.ADMIN_EMAIL||"admin@aigateway.local",s=process.env.ADMIN_PASSWORD||"Admin123!@#",E=await e.query("SELECT id FROM users WHERE email = $1",[a]);if(0===E.rows.length){let r=await T().genSalt(10),E=await T().hash(s,r);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,a,E])}let i=await e.query("SELECT id FROM projects LIMIT 1");0===i.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]),await e.query("COMMIT"),L=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}a()}catch(e){a(e)}})},1183:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{v:()=>T});var s=r(5456),E=e([s]);function T(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let r=e.headers.get("authorization");r?.startsWith("Bearer ")&&(t=r.substring(7))}return t?(0,s.g$)(t):null}s=(E.then?(await E)():E)[0],a()}catch(e){a(e)}})},5456:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{So:()=>A,g$:()=>L,uy:()=>N});var s=r(1482),E=r.n(s),T=r(2023),i=r.n(T),o=r(469),n=e([o]);o=(n.then?(await n)():n)[0];let d=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function N(e){return E().sign(e,d,{expiresIn:"7d"})}function L(e){try{return E().verify(e,d)}catch{return null}}async function A(e,t){await (0,o.q)();let r=await o.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===r.rows.length)return null;let a=r.rows[0];return"active"===a.status&&await i().compare(t,a.password_hash)?{userId:a.id,orgId:a.org_id,email:a.email,name:a.name,role:a.role}:null}a()}catch(e){a(e)}})}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[276,972,23,482],()=>r(2926));module.exports=a})();