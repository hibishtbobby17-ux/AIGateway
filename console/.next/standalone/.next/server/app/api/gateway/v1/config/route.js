"use strict";(()=>{var e={};e.id=4665,e.ids=[4665],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},70:(e,t,r)=>{r.a(e,async(e,o)=>{try{r.r(t),r.d(t,{originalPathname:()=>g,patchFetch:()=>p,requestAsyncStorage:()=>d,routeModule:()=>u,serverHooks:()=>l,staticGenerationAsyncStorage:()=>_});var n=r(9303),a=r(8716),s=r(670),i=r(2058),c=e([i]);i=(c.then?(await c)():c)[0];let u=new n.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/gateway/v1/config/route",pathname:"/api/gateway/v1/config",filename:"route",bundlePath:"app/api/gateway/v1/config/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateway\\v1\\config\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:d,staticGenerationAsyncStorage:_,serverHooks:l}=u,g="/api/gateway/v1/config/route";function p(){return(0,s.patchFetch)({serverHooks:l,staticGenerationAsyncStorage:_})}o()}catch(e){o(e)}})},2058:(e,t,r)=>{r.a(e,async(e,o)=>{try{r.r(t),r.d(t,{GET:()=>u,dynamic:()=>d});var n=r(7070),a=r(469),s=r(1211),i=r(9805),c=e([a,i]);[a,i]=c.then?(await c)():c;let d="force-dynamic";async function p(e){await (0,a.q)();let t=`
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
      `,r.push(e));let o=await a.d.query(t,r),n=1;if(o.rows.length>0)for(let e of o.rows)e.config_version>n&&(n=e.config_version);let i=await a.d.query(`
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
  `),c={};for(let e of i.rows){c[e.project_id]||(c[e.project_id]=[]);let t=null;if(e.oauth_config){let r;if(e.oauth_config.client_secret_encrypted)try{r=(0,s.Q)(e.oauth_config.client_secret_encrypted)}catch{}t={issuer:e.oauth_config.issuer,token_endpoint:e.oauth_config.token_endpoint,client_id:e.oauth_config.client_id,client_secret:r,scopes:e.oauth_config.scopes||[],audience:e.oauth_config.audience,grant_type:e.oauth_config.grant_type,status:e.oauth_config.status||"none"}}c[e.project_id].push({id:e.id,name:e.name,namespace_prefix:e.namespace_prefix,transport:e.transport,url:e.url,auth_type:e.auth_type,timeouts:e.timeouts,enabled:e.enabled,tool_policies:e.tool_policies||[],oauth_config:t})}let p={};for(let e of o.rows){let t=e.settings?.inbound_auth||{mode:"none"};p[e.slug]={id:e.id,name:e.name,slug:e.slug,status:e.status,settings:e.settings||{},inbound_auth:t,config_version:e.config_version,servers:c[e.id]||[]}}return{config_version:n,generated_at:new Date().toISOString(),projects:p}}async function u(e){try{let t=await (0,i.v)(e);if(!t)return n.NextResponse.json({error:"Unauthorized gateway"},{status:401});let r=e.nextUrl.searchParams.get("since"),o=r?parseInt(r,10):-1,s=e.headers.get("if-none-match"),c=await a.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),u=parseInt(c.rows[0].max_version,10);if(o>=u||s===`"v${u}"`){let e=Date.now();for(;Date.now()-e<3e3;){await new Promise(e=>setTimeout(e,500));let e=await a.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects");if(parseInt(e.rows[0].max_version,10)>u)break}let t=await a.d.query("SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects"),r=parseInt(t.rows[0].max_version,10);if(r<=o)return new n.NextResponse(null,{status:304,headers:{ETag:`"v${r}"`}})}let d=await p(t.gatewayId);return n.NextResponse.json(d,{headers:{ETag:`"v${d.config_version}"`,"Cache-Control":"no-cache"}})}catch(e){return console.error("Config sync error:",e),n.NextResponse.json({error:e.message||"Internal server error"},{status:500})}}o()}catch(e){o(e)}})},1211:(e,t,r)=>{r.d(t,{Q:()=>i,l:()=>s});var o=r(4770),n=r.n(o);let a=process.env.ENCRYPTION_KEY||"default-super-secret-key-32-byte!";function s(e){let t=n().randomBytes(12),r=n().createCipheriv("aes-256-gcm",Buffer.from(a.padEnd(32).slice(0,32)),t),o=r.update(e,"utf8","hex");o+=r.final("hex");let s=r.getAuthTag().toString("hex");return`${t.toString("hex")}:${s}:${o}`}function i(e){let t=e.split(":");if(3!==t.length)throw Error("Invalid ciphertext format");let[r,o,s]=t,i=n().createDecipheriv("aes-256-gcm",Buffer.from(a.padEnd(32).slice(0,32)),Buffer.from(r,"hex"));return i.setAuthTag(Buffer.from(o,"hex")),i.update(s,"hex","utf8")+i.final("utf8")}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),o=t.X(0,[9276,5972,1482,2023,9805],()=>r(70));module.exports=o})();