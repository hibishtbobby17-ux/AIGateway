"use strict";(()=>{var e={};e.id=4341,e.ids=[4341],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},2947:(e,r,t)=>{t.a(e,async(e,s)=>{try{t.r(r),t.d(r,{originalPathname:()=>_,patchFetch:()=>p,requestAsyncStorage:()=>c,routeModule:()=>l,serverHooks:()=>m,staticGenerationAsyncStorage:()=>u});var o=t(9303),a=t(8716),n=t(670),i=t(1229),d=e([i]);i=(d.then?(await d)():d)[0];let l=new o.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/servers/[id]/discover/route",pathname:"/api/servers/[id]/discover",filename:"route",bundlePath:"app/api/servers/[id]/discover/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\servers\\[id]\\discover\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:c,staticGenerationAsyncStorage:u,serverHooks:m}=l,_="/api/servers/[id]/discover/route";function p(){return(0,n.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:u})}s()}catch(e){s(e)}})},1229:(e,r,t)=>{t.a(e,async(e,s)=>{try{t.r(r),t.d(r,{GET:()=>p,POST:()=>d,dynamic:()=>l});var o=t(7070),a=t(469),n=t(1183),i=e([a,n]);[a,n]=i.then?(await i)():i;let l="force-dynamic";async function d(e,{params:r}){try{let t=(0,n.v)(e);if(!t)return o.NextResponse.json({error:"Unauthorized"},{status:401});await (0,a.q)();let s=await a.d.query(`
      SELECT s.*, p.id as project_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `,[r.id,t.orgId]);if(0===s.rows.length)return o.NextResponse.json({error:"MCP Server not found"},{status:404});let i=s.rows[0],d=i.url;d.includes("localhost:3000")&&(d=d.replace("localhost:3000","127.0.0.1:3000"));let p=new AbortController,l=setTimeout(()=>p.abort(),7e3),c=await fetch(d,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"tools/list",params:{},id:1}),signal:p.signal});if(clearTimeout(l),!c.ok)return o.NextResponse.json({error:`Downstream MCP server returned HTTP ${c.status}`},{status:502});let u=await c.json();if(u.error)return o.NextResponse.json({error:`Downstream JSON-RPC error: ${u.error.message||"Unknown error"}`},{status:502});let m=u.result?.tools||[],_=0,v=await a.d.query("SELECT id, tool_name, enabled, rename FROM tool_policies WHERE mcp_server_id = $1",[r.id]),h=new Map;for(let e of v.rows)h.set(e.tool_name,{id:e.id,enabled:e.enabled,rename:e.rename});let E=[];for(let e of m){let t=h.get(e.name);!t&&(t=(await a.d.query(`
          INSERT INTO tool_policies (mcp_server_id, tool_name, enabled)
          VALUES ($1, $2, true)
          RETURNING id, tool_name, enabled, rename
        `,[r.id,e.name])).rows[0],_++),E.push({id:t?.id,name:e.name,virtual_name:`${i.namespace_prefix}__${t?.rename||e.name}`,description:e.description||"",inputSchema:e.inputSchema||{},enabled:!t||t.enabled,rename:t?.rename||null,server_id:i.id,server_name:i.name,namespace_prefix:i.namespace_prefix})}return await a.d.query(`
      UPDATE mcp_servers
      SET health_status = 'healthy', last_checked_at = NOW()
      WHERE id = $1
    `,[r.id]),_>0&&await a.d.query("UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE id = $1",[i.project_id]),o.NextResponse.json({success:!0,server_id:i.id,server_name:i.name,tools_count:E.length,new_tools_added:_,tools:E})}catch(e){return console.error("Tool discovery failed:",e),o.NextResponse.json({error:e.message||"Discovery request timed out"},{status:500})}}async function p(e,{params:r}){try{let t=(0,n.v)(e);if(!t)return o.NextResponse.json({error:"Unauthorized"},{status:401});await (0,a.q)();let s=await a.d.query(`
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
    `,[r.id,t.orgId]);return o.NextResponse.json({tools:s.rows})}catch(e){return o.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},1183:(e,r,t)=>{t.a(e,async(e,s)=>{try{t.d(r,{v:()=>n});var o=t(5456),a=e([o]);function n(e){let r=e.cookies.get("gateway_console_session")?.value;if(!r){let t=e.headers.get("authorization");t?.startsWith("Bearer ")&&(r=t.substring(7))}return r?(0,o.g$)(r):null}o=(a.then?(await a)():a)[0],s()}catch(e){s(e)}})}};var r=require("../../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),s=r.X(0,[9276,5972,1482,2023,5456],()=>t(2947));module.exports=s})();