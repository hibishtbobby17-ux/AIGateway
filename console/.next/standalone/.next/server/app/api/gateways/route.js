"use strict";(()=>{var e={};e.id=3774,e.ids=[3774],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{e.exports=require("buffer")},4770:e=>{e.exports=require("crypto")},6162:e=>{e.exports=require("stream")},1764:e=>{e.exports=require("util")},8678:e=>{e.exports=import("pg")},6581:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{originalPathname:()=>_,patchFetch:()=>u,requestAsyncStorage:()=>d,routeModule:()=>c,serverHooks:()=>g,staticGenerationAsyncStorage:()=>l});var r=a(9303),n=a(8716),o=a(670),i=a(4165),p=e([i]);i=(p.then?(await p)():p)[0];let c=new r.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/gateways/route",pathname:"/api/gateways",filename:"route",bundlePath:"app/api/gateways/route"},resolvedPagePath:"C:\\Users\\Administrator\\Downloads\\project\\project_alpha\\console\\src\\app\\api\\gateways\\route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:d,staticGenerationAsyncStorage:l,serverHooks:g}=c,_="/api/gateways/route";function u(){return(0,o.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:l})}s()}catch(e){s(e)}})},4165:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.r(t),a.d(t,{GET:()=>l,POST:()=>g,dynamic:()=>_});var r=a(7070),n=a(469),o=a(1183),i=a(2023),p=a.n(i),u=a(4770),c=a.n(u),d=e([n,o]);[n,o]=d.then?(await d)():d;let _="force-dynamic";async function l(e){try{if(!(0,o.v)(e))return r.NextResponse.json({error:"Unauthorized"},{status:401});await (0,n.q)();let t=await n.d.query(`
      SELECT 
        g.id,
        g.name,
        g.last_seen_at,
        g.version,
        g.applied_config_version,
        g.status,
        COALESCE(g.protocol, 'http') as protocol,
        COALESCE(g.tls_enabled, false) as tls_enabled,
        g.revoked_at,
        g.created_at,
        g.updated_at,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name,
              'slug', p.slug,
              'status', p.status,
              'endpoint_path', '/p/' || p.slug || '/mcp',
              'server_count', (SELECT COUNT(*)::int FROM mcp_servers s WHERE s.project_id = p.id AND s.enabled = true)
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as bound_projects
      FROM gateway_instances g
      LEFT JOIN gateway_project_bindings gpb ON gpb.gateway_id = g.id
      LEFT JOIN projects p ON p.id = gpb.project_id AND p.status = 'active'
      GROUP BY g.id
      ORDER BY g.created_at ASC
    `),a=Date.now(),s=process.env.GATEWAY_PUBLIC_URL||"http://localhost:8080",i=t.rows.map(e=>{let t=e.last_seen_at?new Date(e.last_seen_at).getTime():0,r="active"===e.status&&a-t<18e4,n="https"===e.protocol||e.tls_enabled?"https":"http",o=s;try{let e=new URL(s);e.protocol=n,o=e.origin}catch{o=`${n}://localhost:8080`}let i=(e.bound_projects||[]).map(e=>({...e,endpoint_url:`${o}${e.endpoint_path}`}));return{...e,protocol:n,is_online:r,base_url:o,bound_projects:i,total_endpoints:i.length}});return r.NextResponse.json({gateways:i})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}async function g(e){try{let t=(0,o.v)(e);if(!t)return r.NextResponse.json({error:"Unauthorized"},{status:401});let{name:s}=await e.json();if(!s||!s.trim())return r.NextResponse.json({error:"Gateway name is required"},{status:400});await (0,n.q)();let i="aigw_live_"+c().randomBytes(32).toString("hex"),u=await p().genSalt(10),d=await p().hash(i,u),l=(await n.d.query(`
      INSERT INTO gateway_instances (name, secret_hash, status, version)
      VALUES ($1, $2, 'registered', '1.0.0')
      RETURNING id, name, status, version, created_at
    `,[s.trim(),d])).rows[0],{logAudit:g}=await a.e(7662).then(a.bind(a,7662));return await g({orgId:t.orgId,actor:t.email,action:"gateway.create",target:`gateway:${l.name} (${l.id})`,diff:{name:l.name,version:l.version}}),r.NextResponse.json({gateway:l,secret:i},{status:201})}catch(e){return r.NextResponse.json({error:e.message},{status:500})}}s()}catch(e){s(e)}})},1183:(e,t,a)=>{a.a(e,async(e,s)=>{try{a.d(t,{v:()=>o});var r=a(5456),n=e([r]);function o(e){let t=e.cookies.get("gateway_console_session")?.value;if(!t){let a=e.headers.get("authorization");a?.startsWith("Bearer ")&&(t=a.substring(7))}return t?(0,r.g$)(t):null}r=(n.then?(await n)():n)[0],s()}catch(e){s(e)}})}};var t=require("../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),s=t.X(0,[9276,5972,1482,2023,5456],()=>a(6581));module.exports=s})();