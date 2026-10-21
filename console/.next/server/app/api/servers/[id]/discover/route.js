"use strict";(()=>{var e={};e.id=341,e.ids=[341],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2947:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.r(t),r.d(t,{originalPathname:()=>U,patchFetch:()=>n,requestAsyncStorage:()=>N,routeModule:()=>d,serverHooks:()=>A,staticGenerationAsyncStorage:()=>L});var s=r(9303),i=r(8716),T=r(670),o=r(1229),E=e([o]);o=(E.then?(await E)():E)[0];let d=new s.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/servers/[id]/discover/route",pathname:"/api/servers/[id]/discover",filename:"route",bundlePath:"app/api/servers/[id]/discover/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\servers\\[id]\\discover\\route.ts",nextConfigOutput:"standalone",userland:o}),{requestAsyncStorage:N,staticGenerationAsyncStorage:L,serverHooks:A}=d,U="/api/servers/[id]/discover/route";function n(){return(0,T.patchFetch)({serverHooks:A,staticGenerationAsyncStorage:L})}a()}catch(e){a(e)}})},1229:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.r(t),r.d(t,{GET:()=>n,POST:()=>E,dynamic:()=>d});var s=r(7070),i=r(469),T=r(1183),o=e([i,T]);[i,T]=o.then?(await o)():o;let d="force-dynamic";async function E(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,i.q)();let a=await i.d.query(`
      SELECT s.*, p.id as project_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `,[t.id,r.orgId]);if(0===a.rows.length)return s.NextResponse.json({error:"MCP Server not found"},{status:404});let o=a.rows[0],E=o.url;E.includes("localhost:3000")&&(E=E.replace("localhost:3000","127.0.0.1:3000"));let n=new AbortController,d=setTimeout(()=>n.abort(),7e3),N=await fetch(E,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"tools/list",params:{},id:1}),signal:n.signal});if(clearTimeout(d),!N.ok)return s.NextResponse.json({error:`Downstream MCP server returned HTTP ${N.status}`},{status:502});let L=await N.json();if(L.error)return s.NextResponse.json({error:`Downstream JSON-RPC error: ${L.error.message||"Unknown error"}`},{status:502});let A=L.result?.tools||[],U=0,c=await i.d.query("SELECT id, tool_name, enabled, rename FROM tool_policies WHERE mcp_server_id = $1",[t.id]),u=new Map;for(let e of c.rows)u.set(e.tool_name,{id:e.id,enabled:e.enabled,rename:e.rename});let _=[];for(let e of A){let r=u.get(e.name);!r&&(r=(await i.d.query(`
          INSERT INTO tool_policies (mcp_server_id, tool_name, enabled)
          VALUES ($1, $2, true)
          RETURNING id, tool_name, enabled, rename
        `,[t.id,e.name])).rows[0],U++),_.push({id:r?.id,name:e.name,virtual_name:`${o.namespace_prefix}__${r?.rename||e.name}`,description:e.description||"",inputSchema:e.inputSchema||{},enabled:!r||r.enabled,rename:r?.rename||null,server_id:o.id,server_name:o.name,namespace_prefix:o.namespace_prefix})}return await i.d.query(`
      UPDATE mcp_servers
      SET health_status = 'healthy', last_checked_at = NOW()
      WHERE id = $1
    `,[t.id]),U>0&&await i.d.query("UPDATE projects SET config_version = config_version + 1, updated_at = NOW() WHERE id = $1",[o.project_id]),s.NextResponse.json({success:!0,server_id:o.id,server_name:o.name,tools_count:_.length,new_tools_added:U,tools:_})}catch(e){return console.error("Tool discovery failed:",e),s.NextResponse.json({error:e.message||"Discovery request timed out"},{status:500})}}async function n(e,{params:t}){try{let r=(0,T.v)(e);if(!r)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,i.q)();let a=await i.d.query(`
      SELECT 
        p.id,
        p.tool_name,
        p.enabled,
        p.rename,
        s.id as server_id,
        s.name as server_name,
        s.namespace_prefix,
        CONCAT(s.namespace_prefix, '__', COALESCE(p.rename, p.tool_name)) as virtual_name
      FROM tool_policies p
      JOIN mcp_servers s ON s.id = p.mcp_server_id
      JOIN projects pr ON pr.id = s.project_id
      WHERE s.id = $1 AND pr.org_id = $2
      ORDER BY p.tool_name ASC
    `,[t.id,r.orgId]);return s.NextResponse.json({tools:a.rows})}catch(e){return s.NextResponse.json({error:e.message},{status:500})}}a()}catch(e){a(e)}})},469:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{d:()=>d,q:()=>E});var s=r(8678),i=r(2023),T=r.n(i),o=e([s]);s=(o.then?(await o)():o)[0];let n=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,d=new s.Pool({connectionString:n,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),N=!1;async function E(){if(N)return;let e=await d.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:r.rows[0].id;let a=process.env.ADMIN_EMAIL||"admin@aigateway.local",s=process.env.ADMIN_PASSWORD||"Admin123!@#",i=await e.query("SELECT id FROM users WHERE email = $1",[a]);if(0===i.rows.length){let r=await T().genSalt(10),i=await T().hash(s,r);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,a,i])}let o=await e.query("SELECT id FROM projects LIMIT 1");0===o.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]),await e.query("COMMIT"),N=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}a()}catch(e){a(e)}})},1183:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{v:()=>T});var s=r(5456),i=e([s]);function T(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let r=e.headers.get("authorization");r?.startsWith("Bearer ")&&(t=r.substring(7))}return t?(0,s.g$)(t):null}s=(i.then?(await i)():i)[0],a()}catch(e){a(e)}})},5456:(e,t,r)=>{r.a(e,async(e,a)=>{try{r.d(t,{So:()=>L,g$:()=>N,uy:()=>d});var s=r(1482),i=r.n(s),T=r(2023),o=r.n(T),E=r(469),n=e([E]);E=(n.then?(await n)():n)[0];let A=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function d(e){return i().sign(e,A,{expiresIn:"7d"})}function N(e){try{return i().verify(e,A)}catch{return null}}async function L(e,t){await (0,E.q)();let r=await E.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===r.rows.length)return null;let a=r.rows[0];return"active"===a.status&&await o().compare(t,a.password_hash)?{userId:a.id,orgId:a.org_id,email:a.email,name:a.name,role:a.role}:null}a()}catch(e){a(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[276,972,23,482],()=>r(2947));module.exports=a})();