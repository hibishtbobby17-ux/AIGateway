"use strict";(()=>{var e={};e.id=3455,e.ids=[3455,7662],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},6854:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{originalPathname:()=>g,patchFetch:()=>d,requestAsyncStorage:()=>u,routeModule:()=>l,serverHooks:()=>_,staticGenerationAsyncStorage:()=>p});var r=a(9303),o=a(8716),n=a(670),i=a(2537),c=e([i]);i=(c.then?(await c)():c)[0];let l=new r.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/gateways/[id]/route",pathname:"/api/gateways/[id]",filename:"route",bundlePath:"app/api/gateways/[id]/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateways\\[id]\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:u,staticGenerationAsyncStorage:p,serverHooks:_}=l,g="/api/gateways/[id]/route";function d(){return(0,n.patchFetch)({serverHooks:_,staticGenerationAsyncStorage:p})}s()}catch(e){s(e)}})},2537:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{DELETE:()=>u,GET:()=>d,PUT:()=>l,dynamic:()=>p});var r=a(7070),o=a(469),n=a(1183),i=a(7662),c=e([o,n,i]);[o,n,i]=c.then?(await c)():c;let p="force-dynamic";async function d(e,{params:t}){try{if(!(0,n.v)(e))return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let a=await o.d.query(`
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
      WHERE id::text = $1 OR name = $1
    `,[t.id]);if(0===a.rows.length)return r.NextResponse.json({error:"Gateway instance not found"},{status:404});let s=a.rows[0],i=s.id,c=Date.now(),d=s.last_seen_at?new Date(s.last_seen_at).getTime():0,l="active"===s.status&&c-d<18e4,u="https"===s.protocol||s.tls_enabled?"https":"http",p=process.env.GATEWAY_PUBLIC_URL||"http://localhost:8080",_=p;try{let e=new URL(p);e.protocol=u,_=e.origin}catch{_=`${u}://localhost:8080`}let g=await o.d.query("SELECT project_id FROM gateway_project_bindings WHERE gateway_id = $1",[i]),m=g.rows.length>0,y=`
      SELECT id, name, slug, status, settings, config_version, created_at
      FROM projects
      WHERE status = 'active'
    `,h=[];m&&(y+=" AND id = ANY($1::uuid[])",h.push(g.rows.map(e=>e.project_id))),y+=" ORDER BY created_at ASC";let w=await o.d.query(y,h),E=w.rows.map(e=>e.id),f={};if(E.length>0)for(let e of(await o.d.query(`
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
      `,[E])).rows){f[e.project_id]||(f[e.project_id]=[]);let t=(e.url||"").toLowerCase().startsWith("https://");f[e.project_id].push({id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport||"http",url:e.url,protocol:t?"https":"http",tls_enabled:t,auth_type:e.auth_type,enabled:e.enabled,health_status:e.health_status||"healthy",timeouts:e.timeouts||{dial_ms:5e3,call_ms:15e3},tool_policies:e.tool_policies||[],oauth_config:e.oauth_config})}let R=w.rows.map(e=>{let t=e.settings||{},a=t.inbound_auth||{mode:"none",required_scopes:["mcp:tools","mcp:read"]},s=t.rate_limits||{requests_per_minute:600,burst:50},r=t.circuit_breaker||{max_failures:5,recovery_seconds:30},o=f[e.id]||[];return{project_id:e.id,project_name:e.name,slug:e.slug,endpoint_path:`/p/${e.slug}/mcp`,endpoint_url:`${_}/p/${e.slug}/mcp`,oauth_discovery_url:`${_}/p/${e.slug}/.well-known/oauth-protected-resource`,status:e.status,config_version:e.config_version,created_at:e.created_at,inbound_auth:a,rate_limits:s,circuit_breaker:r,downstream_servers:o}}),j=await o.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),b=parseInt(j.rows[0].max_version,10),v=s.metrics?.tls_telemetry||{inbound:{enabled:s.tls_enabled||!1,min_version:s.tls_enabled?"TLS 1.3":"TLS 1.2",cert_mode:s.tls_enabled?"auto_cert":"none",sans:["localhost","127.0.0.1","::1","ai-gateway"],client_auth:"none",has_client_ca:!1},downstream:{insecure_skip_verify:!1,has_custom_ca:!1,has_client_cert:!1,min_version:"TLS 1.2"}};return r.NextResponse.json({gateway:{...s,is_online:l,base_url:_,mode:m?"targeted":"global",target_config_version:b,tls_telemetry:v,total_endpoints:R.length},endpoints:R})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}async function l(e,{params:t}){try{let a=(0,n.v)(e);if(!a)return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let s=await o.d.query(`
      SELECT id, name, metrics, protocol, tls_enabled FROM gateway_instances WHERE id::text = $1 OR name = $1
    `,[t.id]);if(0===s.rows.length)return r.NextResponse.json({error:"Gateway instance not found"},{status:404});let c=s.rows[0],d=c.id,{protocol:l,tls_enabled:u,metrics:p,tls_telemetry:_,bound_project_ids:g}=await e.json(),m=c.metrics||{};p&&(m={...m,...p}),_&&(m.tls_telemetry=_);let y=void 0!==l?l:u?"https":c.protocol,h=void 0!==u?!!u:"https"===y;if(await o.d.query(`
      UPDATE gateway_instances
      SET 
        protocol = $1,
        tls_enabled = $2,
        metrics = $3,
        updated_at = NOW()
      WHERE id = $4
    `,[y,h,JSON.stringify(m),d]),Array.isArray(g))for(let e of(await o.d.query("DELETE FROM gateway_project_bindings WHERE gateway_id = $1",[d]),g))e&&await o.d.query(`
            INSERT INTO gateway_project_bindings (gateway_id, project_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,[d,e]);return await (0,i.logAudit)({orgId:a.orgId,actor:a.email,action:"gateway.update_settings",target:`gateway:${c.name} (${c.id})`,diff:{protocol:y,tls_enabled:h,bound_project_ids:g}}),r.NextResponse.json({success:!0,gateway:{id:d,name:c.name,protocol:y,tls_enabled:h,metrics:m},message:"Gateway configuration updated successfully"})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}async function u(e,{params:t}){try{let a=(0,n.v)(e);if(!a)return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let s=await o.d.query(`
      SELECT id, name FROM gateway_instances WHERE id::text = $1 OR name = $1
    `,[t.id]);if(0===s.rows.length)return r.NextResponse.json({error:"Gateway instance not found"},{status:404});let c=s.rows[0];return await o.d.query("DELETE FROM gateway_instances WHERE id = $1",[c.id]),await (0,i.logAudit)({orgId:a.orgId,actor:a.email,action:"gateway.delete",target:`gateway:${c.name} (${c.id})`}),r.NextResponse.json({success:!0,message:"Gateway instance deleted"})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},1183:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{v:()=>n});var r=a(5456),o=e([r]);function n(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,r.g$)(t):null}r=(o.then?(await o)():o)[0],s()}catch(e){s(e)}})},7662:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{logAudit:()=>n});var r=a(469),o=e([r]);r=(o.then?(await o)():o)[0];let i=new Set(["secret","secret_hash","password","password_hash","client_secret","access_token","refresh_token","token","key","authorization"]);async function n(e){try{let t=e.diff?function e(t){if(null==t||"object"!=typeof t)return t;if(Array.isArray(t))return t.map(t=>e(t));let a={};for(let[s,r]of Object.entries(t))i.has(s.toLowerCase())||s.toLowerCase().includes("secret")||s.toLowerCase().includes("password")?a[s]="[REDACTED]":"object"==typeof r&&null!==r?a[s]=e(r):a[s]=r;return a}(e.diff):{};await r.d.query(`
      INSERT INTO audit_logs (org_id, actor, action, target, timestamp, diff)
      VALUES ($1, $2, $3, $4, NOW(), $5)
    `,[e.orgId,e.actor||"system",e.action,e.target,JSON.stringify(t)])}catch(e){console.error("Failed to write audit log:",e)}}s()}catch(e){s(e)}})}};var t=require("../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,5456],()=>a(6854));module.exports=s})();