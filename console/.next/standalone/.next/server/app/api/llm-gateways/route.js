"use strict";(()=>{var e={};e.id=1974,e.ids=[1974],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},7063:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{originalPathname:()=>y,patchFetch:()=>l,requestAsyncStorage:()=>p,routeModule:()=>c,serverHooks:()=>g,staticGenerationAsyncStorage:()=>d});var s=a(9303),o=a(8716),n=a(670),i=a(4226),u=e([i]);i=(u.then?(await u)():u)[0];let c=new s.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/llm-gateways/route",pathname:"/api/llm-gateways",filename:"route",bundlePath:"app/api/llm-gateways/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\llm-gateways\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:p,staticGenerationAsyncStorage:d,serverHooks:g}=c,y="/api/llm-gateways/route";function l(){return(0,n.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:d})}r()}catch(e){r(e)}})},4226:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.r(t),a.d(t,{GET:()=>u,POST:()=>l,dynamic:()=>c});var s=a(7070),o=a(469),n=a(1183),i=e([o,n]);[o,n]=i.then?(await i)():i;let c="force-dynamic";async function u(e){try{let t=(0,n.v)(e);if(!t)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let a=await o.d.query(`
      SELECT 
        id, 
        name, 
        slug, 
        status, 
        inbound_auth, 
        primary_backend, 
        fallback_backends, 
        routing_strategy, 
        guardrails, 
        metrics, 
        created_at, 
        updated_at
      FROM llm_gateways
      WHERE org_id = $1
      ORDER BY created_at ASC
    `,[t.orgId]);return s.NextResponse.json({gateways:a.rows})}catch(e){return console.error("Failed to list LLM gateways:",e),s.NextResponse.json({error:e.message||"Failed to list LLM gateways"},{status:500})}}async function l(e){try{let t=(0,n.v)(e);if(!t)return s.NextResponse.json({error:"Unauthorized"},{status:401});await (0,o.q)();let{name:a,slug:r,inbound_auth:i,primary_backend:u,fallback_backends:l=[],routing_strategy:c="priority_fallback",guardrails:p={}}=await e.json();if(!a||!r)return s.NextResponse.json({error:"Name and slug are required"},{status:400});let d=r.toLowerCase().trim().replace(/[^a-z0-9_-]/g,"-").replace(/^-+|-+$/g,"");if(!d)return s.NextResponse.json({error:"Invalid gateway slug"},{status:400});if((await o.d.query("SELECT id FROM llm_gateways WHERE slug = $1",[d])).rows.length>0)return s.NextResponse.json({error:`An LLM Gateway with slug "${d}" already exists`},{status:409});let g=await o.d.query(`
      INSERT INTO llm_gateways (
        org_id, 
        name, 
        slug, 
        status, 
        inbound_auth, 
        primary_backend, 
        fallback_backends, 
        routing_strategy, 
        guardrails, 
        metrics
      )
      VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,[t.orgId,a.trim(),d,JSON.stringify(i||{mode:"api_key",allow_api_key:!0}),JSON.stringify(u||{}),JSON.stringify(l),c,JSON.stringify(p),JSON.stringify({tokens_processed:0,requests_total:0,prompt_tokens:0,completion_tokens:0,fallback_events:0,avg_latency_ms:0})]);return s.NextResponse.json({gateway:g.rows[0]},{status:201})}catch(e){return console.error("Failed to create LLM gateway:",e),s.NextResponse.json({error:e.message||"Failed to create LLM gateway"},{status:500})}}r()}catch(e){r(e)}})},1183:(e,t,a)=>{a.a(e,async(e,r)=>{try{a.d(t,{v:()=>n});var s=a(5456),o=e([s]);function n(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,s.g$)(t):null}s=(o.then?(await o)():o)[0],r()}catch(e){r(e)}})}};var t=require("../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[9276,5972,1482,2023,5456],()=>a(7063));module.exports=r})();