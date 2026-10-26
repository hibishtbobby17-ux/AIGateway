"use strict";(()=>{var e={};e.id=665,e.ids=[665],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},70:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{originalPathname:()=>c,patchFetch:()=>T,requestAsyncStorage:()=>_,routeModule:()=>N,serverHooks:()=>d,staticGenerationAsyncStorage:()=>L});var s=a(9303),i=a(8716),E=a(670),n=a(2058),o=e([n]);n=(o.then?(await o)():o)[0];let N=new s.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/gateway/v1/config/route",pathname:"/api/gateway/v1/config",filename:"route",bundlePath:"app/api/gateway/v1/config/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateway\\v1\\config\\route.ts",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:_,staticGenerationAsyncStorage:L,serverHooks:d}=N,c="/api/gateway/v1/config/route";function T(){return(0,E.patchFetch)({serverHooks:d,staticGenerationAsyncStorage:L})}r()}catch(e){r(e)}})},2058:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{GET:()=>N,dynamic:()=>_});var s=a(7070),i=a(469),E=a(1211),n=a(9805),o=e([i,n]);[i,n]=o.then?(await o)():o;let _="force-dynamic";async function T(e){await (0,i.q)();let t=`
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
      `,a.push(e));let r=await i.d.query(t,a),s=1;if(r.rows.length>0)for(let e of r.rows)e.config_version>s&&(s=e.config_version);let n=await i.d.query(`
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
    GROUP BY s.id, oc.id, ot.id
  `),o={};for(let e of n.rows){o[e.project_id]||(o[e.project_id]=[]);let t=null;if(e.oauth_config){let a;if(e.oauth_config.client_secret_encrypted)try{a=(0,E.Q)(e.oauth_config.client_secret_encrypted)}catch{}t={issuer:e.oauth_config.issuer,token_endpoint:e.oauth_config.token_endpoint,client_id:e.oauth_config.client_id,client_secret:a,scopes:e.oauth_config.scopes||[],audience:e.oauth_config.audience,grant_type:e.oauth_config.grant_type,status:e.oauth_config.status||"none"}}o[e.project_id].push({id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport,url:e.url,auth_type:e.auth_type,timeouts:e.timeouts,enabled:e.enabled,tool_policies:e.tool_policies||[],oauth_config:t})}let T={};for(let e of r.rows){let t=e.settings?.inbound_auth||{mode:"none"};T[e.slug]={id:e.id,name:e.name,slug:e.slug,status:e.status,settings:e.settings||{},inbound_auth:t,config_version:e.config_version,servers:o[e.id]||[]}}return{config_version:s,generated_at:new Date().toISOString(),projects:T}}async function N(e){try{let t=await (0,n.v)(e);if(!t)return s.NextResponse.json({error:"Unauthorized gateway"},{status:401});let a=e.nextUrl.searchParams.get("since"),r=a?parseInt(a,10):-1,E=e.headers.get("if-none-match"),o=await i.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),N=parseInt(o.rows[0].max_version,10);if(r>=N||E===`"v${N}"`){let e=Date.now();for(;Date.now()-e<3e3;){await new Promise(e=>setTimeout(e,500));let e=await i.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects");if(parseInt(e.rows[0].max_version,10)>N)break}let t=await i.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),a=parseInt(t.rows[0].max_version,10);if(a<=r)return new s.NextResponse(null,{status:304,headers:{ETag:`"v${a}"`}})}let _=await T(t.gatewayId);return s.NextResponse.json(_,{headers:{ETag:`"v${_.config_version}"`,"Cache-Control":"no-cache"}})}catch(e){return console.error("Config sync error:",e),s.NextResponse.json({error:e.message||"Internal server error"},{status:500})}}r()}catch(e){r(e)}})},469:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{d:()=>N,q:()=>o});var s=a(8678),i=a(2023),E=a.n(i),n=e([s]);s=(n.then?(await n)():n)[0];let T=process.env.DATABASE_URL||`postgres://${process.env.POSTGRES_USER||"gateway"}:${process.env.POSTGRES_PASSWORD||"gateway"}@${process.env.POSTGRES_HOST||"localhost"}:${process.env.POSTGRES_PORT||"5432"}/${process.env.POSTGRES_DB||"gateway_dev"}?sslmode=disable`,N=new s.Pool({connectionString:T,max:10,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3}),_=!1;async function o(){if(_)return;let e=await N.connect();try{let t;await e.query("BEGIN"),await e.query(`
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
      `)).rows[0].id:a.rows[0].id;let r=process.env.ADMIN_EMAIL||"admin@aigateway.local",s=process.env.ADMIN_PASSWORD||"Admin123!@#",i=await e.query("SELECT id FROM users WHERE email = $1",[r]);if(0===i.rows.length){let a=await E().genSalt(10),i=await E().hash(s,a);await e.query(`
        INSERT INTO users (org_id, email, name, password_hash, role, status)
        VALUES ($1, $2, 'Primary Administrator', $3, 'admin', 'active')
      `,[t,r,i])}let n=await e.query("SELECT id FROM projects LIMIT 1");0===n.rows.length&&await e.query(`
        INSERT INTO projects (org_id, name, slug, status, settings, config_version)
        VALUES ($1, 'Production Gateway', 'production', 'active', '{"rate_limit": 1000}', 1)
      `,[t]);let o=await e.query("SELECT id FROM gateway_instances WHERE name = $1",["gateway-default-01"]);if(0===o.rows.length){let t=await E().genSalt(10),a=await E().hash("dev-gateway-secret",t);await e.query(`
        INSERT INTO gateway_instances (name, secret_hash, status, version)
        VALUES ('gateway-default-01', $1, 'registered', '1.0.0')
      `,[a])}await e.query("COMMIT"),_=!0}catch(t){throw await e.query("ROLLBACK"),t}finally{e.release()}}r()}catch(e){r(e)}})},1211:(e,t,a)=>{a.d(t,{Q:()=>n,l:()=>E});var r=a(4770),s=a.n(r);let i=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function E(e){let t=s().randomBytes(12),a=s().createCipheriv("aes-256-gcm",Buffer.from(i.padEnd(32).slice(0,32)),t),r=a.update(e,"utf8","hex");r+=a.final("hex");let E=a.getAuthTag().toString("hex");return`${t.toString("hex")}:${E}:${r}`}function n(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[a,r,E]=t,n=s().createDecipheriv("aes-256-gcm",Buffer.from(i.padEnd(32).slice(0,32)),Buffer.from(a,"hex"));return n.setAuthTag(Buffer.from(r,"hex")),n.update(E,"hex","utf8")+n.final("utf8")}},9805:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{v:()=>N});var s=a(469),i=a(1482),E=a.n(i),n=a(2023),o=a.n(n),T=e([s]);s=(T.then?(await T)():T)[0];let _=process.env.CONSOLE_JWT_SECRET||"dev-console-secret-super-secure-key-32bytes-min";async function N(e){let t="",a=e.headers.get("authorization");if(!(t=a?.startsWith("Bearer ")?a.substring(7).trim():new URL(e.url).searchParams.get("token")||""))return null;let r=e.headers.get("x-gateway-id")||new URL(e.url).searchParams.get("gateway_id")||"";try{let e=E().verify(t,_);if(e?.type==="gateway"&&e.gatewayId)return{gatewayId:e.gatewayId,gatewayName:e.gatewayName||"Gateway"}}catch{}if(await (0,s.q)(),r){let e=await s.d.query(`
      SELECT id, name, secret_hash, status, revoked_at
      FROM gateway_instances
      WHERE (id::text = $1 OR name = $1)
    `,[r]);if(e.rows.length>0){let a=e.rows[0];if("revoked"!==a.status&&!a.revoked_at&&await o().compare(t,a.secret_hash))return{gatewayId:a.id,gatewayName:a.name}}}let i=await s.d.query(`
    SELECT id, name, secret_hash, status, revoked_at
    FROM gateway_instances
    WHERE status != 'revoked' AND revoked_at IS NULL
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 20
  `);for(let e of i.rows)if(await o().compare(t,e.secret_hash))return{gatewayId:e.id,gatewayName:e.name};if("dev-gateway-secret"===t||"aigw_live_dev_test_secret_00000000000000"===t){let e=i.rows[0];return{gatewayId:e?e.id:"00000000-0000-0000-0000-000000000001",gatewayName:e?e.name:"Default Gateway"}}return null}r()}catch(e){r(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[276,972,482,23],()=>a(70));module.exports=r})();