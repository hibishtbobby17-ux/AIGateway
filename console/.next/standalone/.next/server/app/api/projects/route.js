"use strict";(()=>{var e={};e.id=4871,e.ids=[4871],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},1097:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{originalPathname:()=>j,patchFetch:()=>u,requestAsyncStorage:()=>d,routeModule:()=>c,serverHooks:()=>l,staticGenerationAsyncStorage:()=>g});var a=r(9303),o=r(8716),i=r(670),n=r(2593),p=e([n]);n=(p.then?(await p)():p)[0];let c=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/projects/route",pathname:"/api/projects",filename:"route",bundlePath:"app/api/projects/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\projects\\route.ts",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:d,staticGenerationAsyncStorage:g,serverHooks:l}=c,j="/api/projects/route";function u(){return(0,i.patchFetch)({serverHooks:l,staticGenerationAsyncStorage:g})}s()}catch(e){s(e)}})},2593:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.r(t),r.d(t,{GET:()=>p,POST:()=>u,dynamic:()=>c});var a=r(7070),o=r(469),i=r(1183),n=e([o,i]);[o,i]=n.then?(await n)():n;let c="force-dynamic";async function p(e){try{let t=(0,i.v)(e);if(!t)return a.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let r=await o.d.query(`
      SELECT 
        p.id,
        p.org_id,
        p.name,
        p.slug,
        p.status,
        p.settings,
        p.config_version,
        p.created_at,
        p.updated_at,
        COUNT(DISTINCT s.id)::int as server_count,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', g.id,
              'name', g.name,
              'status', g.status,
              'version', g.version
            )
          ) FILTER (WHERE g.id IS NOT NULL),
          '[]'
        ) as gateways
      FROM projects p
      LEFT JOIN mcp_servers s ON s.project_id = p.id
      LEFT JOIN gateway_project_bindings gpb ON gpb.project_id = p.id
      LEFT JOIN gateway_instances g ON g.id = gpb.gateway_id
      WHERE p.org_id = $1
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `,[t.orgId]);return a.NextResponse.json({projects:r.rows})}catch(e){return console.error("Failed to list projects:",e),a.NextResponse.json({error:e.message||"Database query error"},{status:500})}}async function u(e){try{let t=(0,i.v)(e);if(!t)return a.NextResponse.json({error:"Unauthorized"},{status:401});let{name:s,slug:n,settings:p,gateway_ids:u,gateway_id:c}=await e.json();if(!s||!s.trim())return a.NextResponse.json({error:"Project name is required"},{status:400});let d=(n||s).toLowerCase().trim().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");if(!d)return a.NextResponse.json({error:"Valid slug is required"},{status:400});if(await (0,o.q)(),(await o.d.query("SELECT id FROM projects WHERE slug = $1",[d])).rows.length>0)return a.NextResponse.json({error:`Project slug "${d}" is already taken`},{status:409});let g=(await o.d.query(`
      INSERT INTO projects (org_id, name, slug, status, settings, config_version)
      VALUES ($1, $2, $3, 'active', $4, (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects))
      RETURNING id, org_id, name, slug, status, settings, config_version, created_at, updated_at
    `,[t.orgId,s.trim(),d,JSON.stringify(p||{})])).rows[0],l=[];Array.isArray(u)?l.push(...u.filter(Boolean)):c&&"string"==typeof c&&l.push(c.trim());let j=[];for(let e of l)try{if((await o.d.query("INSERT INTO gateway_project_bindings (gateway_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING gateway_id",[e,g.id])).rows.length>0){let t=await o.d.query("SELECT id, name, status, version FROM gateway_instances WHERE id = $1",[e]);t.rows.length>0&&j.push(t.rows[0])}}catch(e){console.warn("Failed to bind project to gateway:",e)}g.gateways=j;let{logAudit:y}=await r.e(7662).then(r.bind(r,7662));return await y({orgId:t.orgId,actor:t.email,action:"project.create",target:`project:${g.slug} (${g.id})`,diff:{name:g.name,slug:g.slug,status:g.status,gateways:l}}),a.NextResponse.json({project:g},{status:201})}catch(e){return console.error("Failed to create project:",e),a.NextResponse.json({error:e.message||"Server error"},{status:500})}}s()}catch(e){s(e)}})},1183:(e,t,r)=>{r.a(e,async(e,s)=>{try{r.d(t,{v:()=>i});var a=r(5456),o=e([a]);function i(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let r=e.headers.get("authorization");r?.startsWith("Bearer ")&&(t=r.substring(7))}return t?(0,a.g$)(t):null}a=(o.then?(await o)():o)[0],s()}catch(e){s(e)}})}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,5456],()=>r(1097));module.exports=s})();