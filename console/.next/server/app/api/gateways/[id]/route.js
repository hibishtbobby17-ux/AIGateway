"use strict";(()=>{var e={};e.id=455,e.ids=[455,662],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},6854:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{originalPathname:()=>c,patchFetch:()=>T,requestAsyncStorage:()=>d,routeModule:()=>_,serverHooks:()=>L,staticGenerationAsyncStorage:()=>N});var r=a(9303),i=a(8716),o=a(670),E=a(2537),n=e([E]);E=(n.then?(await n)():n)[0];let _=new r.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/gateways/[id]/route",pathname:"/api/gateways/[id]",filename:"route",bundlePath:"app/api/gateways/[id]/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateways\\[id]\\route.ts",nextConfigOutput:"standalone",userland:E}),{requestAsyncStorage:d,staticGenerationAsyncStorage:N,serverHooks:L}=_,c="/api/gateways/[id]/route";function T(){return(0,o.patchFetch)({serverHooks:L,staticGenerationAsyncStorage:N})}s()}catch(e){s(e)}})},2537:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{DELETE:()=>_,GET:()=>T,dynamic:()=>d});var r=a(7070),i=a(469),o=a(1183),E=a(7662),n=e([i,o,E]);[i,o,E]=n.then?(await n)():n;let d="force-dynamic";async function T(e,{params:t}){try{if(!(0,o.v)(e))return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,i.q)();let a=await i.d.query(`
      SELECT 
        id, 
        name, 
        last_seen_at, 
        version, 
        applied_config_version, 
        status, 
        COALESCE(protocol, 'http') as protocol,
        COALESCE(tls_enabled, false) as tls_enabled,
        COALESCE(metrics, '{}'::jsonb) as metrics,
        revoked_at, 
        created_at, 
        updated_at
      FROM gateway_instances
      WHERE id = $1
    `,[t.id]);if(0===a.rows.length)return r.NextResponse.json({error:"Gateway instance not found"},{status:404});let s=a.rows[0],E=Date.now(),n=s.last_seen_at?new Date(s.last_seen_at).getTime():0,T="active"===s.status&&E-n<18e4,_="https"===s.protocol||s.tls_enabled?"https":"http",d=process.env.GATEWAY_PUBLIC_URL||"http://localhost:8080",N=d;try{let e=new URL(d);e.protocol=_,N=e.origin}catch{N=`${_}://localhost:8080`}let L=await i.d.query("SELECT project_id FROM gateway_project_bindings WHERE gateway_id = $1",[t.id]),c=L.rows.length>0,A=`
      SELECT id, name, slug, status, settings, config_version, created_at
      FROM projects
      WHERE status = 'active'
    `,u=[];c&&(A+=" AND id = ANY($1::uuid[])",u.push(L.rows.map(e=>e.project_id))),A+=" ORDER BY created_at ASC";let l=await i.d.query(A,u),U=l.rows.map(e=>e.id),p={};if(U.length>0)for(let e of(await i.d.query(`
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
              'scopes', oc.scopes,
              'grant_type', oc.grant_type
            )
          ELSE NULL END as oauth_config
        FROM mcp_servers s
        LEFT JOIN tool_policies tp ON tp.mcp_server_id = s.id
        LEFT JOIN oauth_configs oc ON oc.mcp_server_id = s.id
        WHERE s.project_id = ANY($1::uuid[])
        GROUP BY s.id, oc.id
        ORDER BY s.created_at ASC
      `,[U])).rows){p[e.project_id]||(p[e.project_id]=[]);let t=(e.url||"").toLowerCase().startsWith("https://");p[e.project_id].push({id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport||"http",url:e.url,protocol:t?"https":"http",tls_enabled:t,auth_type:e.auth_type,enabled:e.enabled,health_status:e.health_status||"healthy",timeouts:e.timeouts||{dial_ms:5e3,call_ms:15e3},tool_policies:e.tool_policies||[],oauth_config:e.oauth_config})}let R=l.rows.map(e=>{let t=e.settings||{},a=t.inbound_auth||{mode:"none",required_scopes:["mcp:tools","mcp:read"]},s=t.rate_limits||{requests_per_minute:600,burst:50},r=t.circuit_breaker||{max_failures:5,recovery_seconds:30},i=p[e.id]||[];return{project_id:e.id,project_name:e.name,slug:e.slug,endpoint_path:`/p/${e.slug}/mcp`,endpoint_url:`${N}/p/${e.slug}/mcp`,oauth_discovery_url:`${N}/p/${e.slug}/.well-known/oauth-protected-resource`,status:e.status,config_version:e.config_version,created_at:e.created_at,inbound_auth:a,rate_limits:s,circuit_breaker:r,downstream_servers:i}}),O=await i.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),I=parseInt(O.rows[0].max_version,10),S=s.metrics?.tls_telemetry||{inbound:{enabled:s.tls_enabled||!1,min_version:s.tls_enabled?"TLS 1.3":"TLS 1.2",cert_mode:s.tls_enabled?"auto_cert":"none",sans:["localhost","127.0.0.1","::1","ai-gateway"],client_auth:"none",has_client_ca:!1},downstream:{insecure_skip_verify:!1,has_custom_ca:!1,has_client_cert:!1,min_version:"TLS 1.2"}};return r.NextResponse.json({gateway:{...s,is_online:T,base_url:N,mode:c?"targeted":"global",target_config_version:I,tls_telemetry:S,total_endpoints:R.length},endpoints:R})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}async function _(e,{params:t}){try{let a=(0,o.v)(e);if(!a)return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,i.q)();let s=await i.d.query(`
      SELECT id, name FROM gateway_instances WHERE id = $1
    `,[t.id]);if(0===s.rows.length)return r.NextResponse.json({error:"Gateway instance not found"},{status:404});let n=s.rows[0];return await i.d.query("DELETE FROM gateway_instances WHERE id = $1",[t.id]),await (0,E.logAudit)({orgId:a.orgId,actor:a.email,action:"gateway.delete",target:`gateway:${n.name} (${n.id})`}),r.NextResponse.json({success:!0,message:"Gateway instance deleted"})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},469:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{d:()=>_,q:()=>n});var r=a(8678),i=a(2023),o=a.n(i),E=e([r]);r=(E.then?(await E)():E)[0];let T=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,_=new r.Pool({connectionString:T,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),d=!1;async function n(){if(d)return;let e=await _.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let s=process.env.ADMIN_EMAIL||"admin@aigateway.local",r=process.env.ADMIN_PASSWORD||"Admin123!@#",i=await e.query("SELECT id FROM users WHERE email = $1",[s]);if(0===i.rows.length){let a=await o().genSalt(10),i=await o().hash(r,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,s,i])}let E=await e.query("SELECT id FROM projects LIMIT 1");0===E.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let n=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===n.rows.length){let t=await o().genSalt(10),a=await o().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),d=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}s()}catch(e){s(e)}})},1183:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{v:()=>o});var r=a(5456),i=e([r]);function o(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,r.g$)(t):null}r=(i.then?(await i)():i)[0],s()}catch(e){s(e)}})},7662:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{logAudit:()=>o});var r=a(469),i=e([r]);r=(i.then?(await i)():i)[0];let E=new Set(["secret","secret_hash","password","password_hash","client_secret","access_token","refresh_token","token","key","authorization"]);async function o(e){try{let t=e.diff?function e(t){if(null==t||"object"!=typeof t)return t;if(Array.isArray(t))return t.map(t=>e(t));let a={};for(let[s,r]of Object.entries(t))E.has(s.toLowerCase())||s.toLowerCase().includes("secret")||s.toLowerCase().includes("password")?a[s]="[REDACTED]":"object"==typeof r&&null!==r?a[s]=e(r):a[s]=r;return a}(e.diff):{};await r.d.query(`
      INSERT INTO audit_logs (org_id, actor, action, target, timestamp, diff)
      VALUES ($1, $2, $3, $4, NOW(), $5)
    `,[e.orgId,e.actor||"system",e.action,e.target,JSON.stringify(t)])}catch(e){console.error("Failed to write audit log:",e)}}s()}catch(e){s(e)}})},5456:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{So:()=>N,g$:()=>d,uy:()=>_});var r=a(1482),i=a.n(r),o=a(2023),E=a.n(o),n=a(469),T=e([n]);n=(T.then?(await T)():T)[0];let L=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";function _(e){return i().sign(e,L,{expiresIn:"7d"})}function d(e){try{return i().verify(e,L)}catch{return null}}async function N(e,t){await (0,n.q)();let a=await n.d.query("SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1",[e.toLowerCase().trim()]);if(0===a.rows.length)return null;let s=a.rows[0];return"active"===s.status&&await E().compare(t,s.password_hash)?{userId:s.id,orgId:s.org_id,email:s.email,name:s.name,role:s.role}:null}s()}catch(e){s(e)}})}};var t=require("../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),s=t.X(0,[276,972,482,23],()=>a(6854));module.exports=s})();