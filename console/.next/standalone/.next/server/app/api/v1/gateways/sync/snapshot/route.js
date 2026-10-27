"use strict";(()=>{var e={};e.id=3683,e.ids=[3683],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},5261:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{originalPathname:()=>g,patchFetch:()=>p,requestAsyncStorage:()=>d,routeModule:()=>u,serverHooks:()=>l,staticGenerationAsyncStorage:()=>_});var a=r(9303),o=r(8716),i=r(670),n=r(7895),c=e([n]);n=(c.then?(await c)():c)[0];let u=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/v1/gateways/sync/snapshot/route",pathname:"/api/v1/gateways/sync/snapshot",filename:"route",bundlePath:"app/api/v1/gateways/sync/snapshot/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\v1\\gateways\\sync\\snapshot\\route.ts",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:d,staticGenerationAsyncStorage:_,serverHooks:l}=u,g="/api/v1/gateways/sync/snapshot/route";function p(){return(0,i.patchFetch)({serverHooks:l,staticGenerationAsyncStorage:_})}s()}catch(e){s(e)}})},7895:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{GET:()=>c,dynamic:()=>p});var a=r(7070),o=r(9805),i=r(3471),n=e([o,i]);[o,i]=n.then?(await n)():n;let p="force-dynamic";async function c(e){try{let t=await (0,o.v)(e);if(!t)return a.NextResponse.json({error:"Unauthorized: invalid or missing gateway key"},{status:401});let r=await (0,i.T)(t.gatewayId),s=`"${r.version}"`,n=e.headers.get("if-none-match");if(n&&(n===s||n===r.version))return new a.NextResponse(null,{status:304,headers:{ETag:s,"Cache-Control":"no-cache, must-revalidate"}});return a.NextResponse.json(r,{status:200,headers:{ETag:s,"Cache-Control":"no-cache, must-revalidate","X-Gateway-ID":t.gatewayId}})}catch(e){return console.error("Error serving gateway sync snapshot:",e),a.NextResponse.json({error:e.message||"Internal server error generating snapshot"},{status:500})}}s()}catch(e){s(e)}})},1211:(e,t,r)=>{r.d(t,{Q:()=>n,l:()=>i});var s=r(4770),a=r.n(s);let o=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function i(e){let t=a().randomBytes(12),r=a().createCipheriv("aes-256-gcm",Buffer.from(o.padEnd(32).slice(0,32)),t),s=r.update(e,"utf8","hex");s+=r.final("hex");let i=r.getAuthTag().toString("hex");return`${t.toString("hex")}:${i}:${s}`}function n(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[r,s,i]=t,n=a().createDecipheriv("aes-256-gcm",Buffer.from(o.padEnd(32).slice(0,32)),Buffer.from(r,"hex"));return n.setAuthTag(Buffer.from(s,"hex")),n.update(i,"hex","utf8")+n.final("utf8")}},3471:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.d(t,{T:()=>n});var a=r(469),o=r(1211),i=e([a]);async function n(e){await (0,a.q)();let t=`
    SELECT id, name, slug, status, settings, config_version
    FROM projects
    WHERE status = 'active'
    ORDER BY created_at ASC
  `,r=[];e&&(await a.d.query("SELECT 1 FROM gateway_project_bindings WHERE gateway_id = $1 LIMIT 1",[e])).rows.length>0&&(t=`
        SELECT p.id, p.name, p.slug, p.status, p.settings, p.config_version
        FROM projects p
        JOIN gateway_project_bindings gpb ON gpb.project_id = p.id
        WHERE p.status = 'active' AND gpb.gateway_id = $1
        ORDER BY p.created_at ASC
      `,r.push(e));let s=await a.d.query(t,r),i=1;for(let e of s.rows)e.config_version>i&&(i=e.config_version);let n=await a.d.query(`
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
    GROUP BY s.id, oc.id, ot.status
    ORDER BY s.created_at ASC
  `),c={},p=[],u=[];for(let e of n.rows){c[e.project_id]||(c[e.project_id]=[]);let t=null;e.oauth_config&&(t={...e.oauth_config,client_secret:e.oauth_config.client_secret_encrypted?(0,o.Q)(e.oauth_config.client_secret_encrypted):""},delete t.client_secret_encrypted);let r={id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport,url:e.url,auth_type:e.auth_type,timeouts:e.timeouts,enabled:e.enabled,tool_policies:e.tool_policies||[],oauth_config:t};c[e.project_id].push(r),u.push({id:`mcp_${e.namespace_prefix}_${e.id.substring(0,8)}`,provider:e.name,endpoint:e.url,transport:e.transport,auth_type:e.auth_type,rate_limits:{rpm:600,burst:50}})}let d={};for(let e of s.rows){let t=e.settings||{},r=t.inbound_auth||{},s={mode:r.mode||"none",issuer:r.issuer||"",jwks_uri:r.jwks_uri||"",audience:r.audience||"",required_scopes:r.required_scopes||[]};d[e.slug]={id:e.id,slug:e.slug,name:e.name,status:e.status,config_version:e.config_version,settings:e.settings,inbound_auth:s,servers:c[e.id]||[]},p.push({id:`route_${e.slug}`,path_prefix:`/p/${e.slug}/mcp`,project_id:e.id,slug:e.slug,timeout_ms:t.circuit_breaker?.call_timeout_ms||15e3,retries:2,circuit_breaker:{failure_threshold_pct:50,recovery_time_sec:t.circuit_breaker?.recovery_seconds||15}})}return{$schema:"https://json-schema.org/draft/2020-12/schema",version:`v${i}`,config_version:i,timestamp:new Date().toISOString(),routes:p,providers:u,guardrails:{blocked_regex_patterns:["(?i)(api[_-]?key|bearer\\s+[a-z0-9_-]+)","(?i)(password|secret)\\s*[:=]\\s*['\"][^'\"]+['\"]"],max_input_tokens:16384,pii_redaction:!0},projects:d,circuit_breaker_defaults:{failure_threshold_pct:50,recovery_time_sec:15,dial_timeout_ms:5e3,call_timeout_ms:15e3}}}a=(i.then?(await i)():i)[0],s()}catch(e){s(e)}})}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,9805],()=>r(5261));module.exports=s})();