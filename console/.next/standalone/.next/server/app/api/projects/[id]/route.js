"use strict";(()=>{var e={};e.id=7361,e.ids=[7361],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2926:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{originalPathname:()=>j,patchFetch:()=>d,requestAsyncStorage:()=>p,routeModule:()=>c,serverHooks:()=>g,staticGenerationAsyncStorage:()=>l});var o=r(9303),a=r(8716),n=r(670),i=r(4468),u=e([i]);i=(u.then?(await u)():u)[0];let c=new o.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/projects/[id]/route",pathname:"/api/projects/[id]",filename:"route",bundlePath:"app/api/projects/[id]/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\projects\\[id]\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:p,staticGenerationAsyncStorage:l,serverHooks:g}=c,j="/api/projects/[id]/route";function d(){return(0,n.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:l})}s()}catch(e){s(e)}})},4468:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{DELETE:()=>c,GET:()=>u,PUT:()=>d,dynamic:()=>p});var o=r(7070),a=r(469),n=r(1183),i=e([a,n]);[a,n]=i.then?(await i)():i;let p="force-dynamic";async function u(e,{params:t}){try{let r=(0,n.v)(e);if(!r)return o.NextResponse.json({error:"Unauthorized"},{status:401});await (0,a.q)();let s=await a.d.query(`
      SELECT id, org_id, name, slug, status, settings, config_version, created_at, updated_at
      FROM projects
      WHERE id = $1 AND org_id = $2
    `,[t.id,r.orgId]);if(0===s.rows.length)return o.NextResponse.json({error:"Project not found"},{status:404});let i=s.rows[0],u=await a.d.query(`
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
    `,[t.id]);return o.NextResponse.json({project:{...i,servers:u.rows}})}catch(e){return o.NextResponse.json({error:e.message},{status:500})}}async function d(e,{params:t}){try{let s=(0,n.v)(e);if(!s)return o.NextResponse.json({error:"Unauthorized"},{status:401});let{name:i,status:u,settings:d}=await e.json();await (0,a.q)();let c=await a.d.query(`
      UPDATE projects
      SET 
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        settings = COALESCE($3, settings),
        config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects),
        updated_at = NOW()
      WHERE id = $4 AND org_id = $5
      RETURNING id, org_id, name, slug, status, settings, config_version, updated_at
    `,[i?i.trim():null,u||null,d?JSON.stringify(d):null,t.id,s.orgId]);if(0===c.rows.length)return o.NextResponse.json({error:"Project not found"},{status:404});let p=c.rows[0],{logAudit:l}=await r.e(7662).then(r.bind(r,7662));return await l({orgId:s.orgId,actor:s.email,action:"project.update",target:`project:${p.slug} (${p.id})`,diff:{name:i,status:u,settings:d}}),o.NextResponse.json({project:p})}catch(e){return o.NextResponse.json({error:e.message},{status:500})}}async function c(e,{params:t}){try{let s=(0,n.v)(e);if(!s)return o.NextResponse.json({error:"Unauthorized"},{status:401});await (0,a.q)();let i=await a.d.query("DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id, slug, name",[t.id,s.orgId]);if(0===i.rows.length)return o.NextResponse.json({error:"Project not found"},{status:404});let u=i.rows[0],{logAudit:d}=await r.e(7662).then(r.bind(r,7662));return await d({orgId:s.orgId,actor:s.email,action:"project.delete",target:`project:${u.slug} (${u.id})`}),o.NextResponse.json({success:!0,deleted_id:t.id})}catch(e){return o.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},1183:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.d(t,{v:()=>n});var o=r(5456),a=e([o]);function n(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let r=e.headers.get("authorization");r?.startsWith("Bearer ")&&(t=r.substring(7))}return t?(0,o.g$)(t):null}o=(a.then?(await a)():a)[0],s()}catch(e){s(e)}})}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,5456],()=>r(2926));module.exports=s})();