"use strict";(()=>{var e={};e.id=1378,e.ids=[1378],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},665:e=>{e.exports=require("dns")},8216:e=>{e.exports=require("net")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2152:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{originalPathname:()=>_,patchFetch:()=>u,requestAsyncStorage:()=>c,routeModule:()=>d,serverHooks:()=>m,staticGenerationAsyncStorage:()=>l});var a=r(9303),o=r(8716),i=r(670),n=r(2311),p=e([n]);n=(p.then?(await p)():p)[0];let d=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/projects/[id]/servers/route",pathname:"/api/projects/[id]/servers",filename:"route",bundlePath:"app/api/projects/[id]/servers/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\projects\\[id]\\servers\\route.ts",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:c,staticGenerationAsyncStorage:l,serverHooks:m}=d,_="/api/projects/[id]/servers/route";function u(){return(0,i.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:l})}s()}catch(e){s(e)}})},2311:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{GET:()=>p,POST:()=>u,dynamic:()=>d});var a=r(7070),o=r(469),i=r(1183),n=e([o,i]);[o,i]=n.then?(await n)():n;let d="force-dynamic";async function p(e,{params:t}){try{let r=(0,i.v)(e);if(!r)return a.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let s=await o.d.query("SELECT id FROM projects WHERE id = $1 AND org_id = $2",[t.id,r.orgId]);if(0===s.rows.length)return a.NextResponse.json({error:"Project not found"},{status:404});let n=await o.d.query(`
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
    `,[t.id]);return a.NextResponse.json({servers:n.rows})}catch(e){return a.NextResponse.json({error:e.message},{status:500})}}async function u(e,{params:t}){try{let s=(0,i.v)(e);if(!s)return a.NextResponse.json({error:"Unauthorized"},{status:401});let{name:n,namespace_prefix:p,transport:u,url:d,auth_type:c,timeouts:l,enabled:m}=await e.json();if(!n||!n.trim())return a.NextResponse.json({error:"Server name is required"},{status:400});if(!d||!d.trim())return a.NextResponse.json({error:"Server URL is required"},{status:400});let{validateSSRF:_,SSRFError:h}=await r.e(9398).then(r.bind(r,9398));try{await _(d.trim())}catch(e){if(e instanceof h)return a.NextResponse.json({error:`SSRF Policy Violation: ${e.message}`},{status:400});return a.NextResponse.json({error:`URL Validation Error: ${e.message}`},{status:400})}let g=(p||n).toLowerCase().trim().replace(/[^a-z0-9_]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"");await (0,o.q)();let j=await o.d.query("SELECT id, slug FROM projects WHERE id = $1 AND org_id = $2",[t.id,s.orgId]);if(0===j.rows.length)return a.NextResponse.json({error:"Project not found"},{status:404});let R=j.rows[0].slug,v=(await o.d.query(`
      INSERT INTO mcp_servers (
        project_id, name, namespace_prefix, transport, url, auth_type, timeouts, enabled, health_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `,[t.id,n.trim(),g||"mcp",u||"http",d.trim(),c||"none",JSON.stringify(l||{dial_ms:5e3,call_ms:15e3}),void 0===m||m])).rows[0];await o.d.query("UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE id = $1",[t.id]);let{logAudit:x}=await r.e(7662).then(r.bind(r,7662));return await x({orgId:s.orgId,actor:s.email,action:"server.create",target:`server:${v.name} in project:${R}`,diff:{name:v.name,url:v.url,transport:v.transport,auth_type:v.auth_type}}),a.NextResponse.json({server:v},{status:201})}catch(e){return a.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},1183:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.d(t,{v:()=>i});var a=r(5456),o=e([a]);function i(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let r=e.headers.get("authorization");r?.startsWith("Bearer ")&&(t=r.substring(7))}return t?(0,a.g$)(t):null}a=(o.then?(await o)():o)[0],s()}catch(e){s(e)}})}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,5456],()=>r(2152));module.exports=s})();