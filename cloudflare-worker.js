const WORKER_BUILD='2026.09.23.2230';
const APP_MONITOR_ADMIN_SHA256='51cce3c5c9ce144016d801ae965b77d3adf99d8e39460b60e391dc67059574db';
// Cloudflare Worker for Snag Recorder media + lightweight Firebase usage telemetry.
// Media uses the R2 bucket "snag-media" as SNAG_MEDIA.
// Usage telemetry is stored under _usage/v2/ in the same R2 bucket, so it creates
// no Firestore reads/writes. Each browser overwrites one compact daily snapshot.
const cors=(origin,allowed)=>({
  'Access-Control-Allow-Origin': origin===allowed?origin:allowed,
  'Access-Control-Allow-Methods':'PUT,POST,GET,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type,X-App-Monitor-Key',
  'Access-Control-Max-Age':'86400'
});
const allowedOrigin=(request,env)=>(request.headers.get('Origin')||'')===(env.ALLOWED_ORIGIN||'https://nirav2000.github.io');
async function verifyFirebaseToken(request,env){
  const h=request.headers.get('Authorization')||'';
  if(!h.startsWith('Bearer '))throw new Response('Unauthorized',{status:401});
  const token=h.slice(7);
  const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  if(!r.ok)throw new Response('Unauthorized',{status:401});
  const data=await r.json();if(!data.users?.[0]?.localId)throw new Response('Unauthorized',{status:401});
  return data.users[0];
}
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'');
const validDevice=x=>/^[A-Za-z0-9._-]{8,100}$/.test(x||'');
const validSession=x=>/^[A-Za-z0-9._-]{8,120}$/.test(x||'');
const cleanKey=x=>String(x||'unknown').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,80)||'unknown';
async function sha256(value){const bytes=new TextEncoder().encode(String(value||'')),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function appMonitorAdmin(request){const key=request.headers.get('X-App-Monitor-Key')||'';return key.length>=32&&(await sha256(key))===APP_MONITOR_ADMIN_SHA256}
function mergeUsage(target,out){
  out.version=3;out.targets??={};out.hours??={};out.buckets??={};
  for(const [key,t] of Object.entries(target?.targets||{})){
    const T=out.targets[key]??={project:t.project||'unknown',database:t.database||'(default)',apps:{}};
    for(const [app,a] of Object.entries(t.apps||{})){
      const A=T.apps[app]??={reads:0,writes:0,deletes:0,listeners:0,ops:{}};
      for(const n of ['reads','writes','deletes','listeners'])A[n]+=(Number(a[n])||0);
      for(const [op,o] of Object.entries(a.ops||{})){
        const O=A.ops[op]??={reads:0,writes:0,deletes:0,listeners:0};
        for(const n of ['reads','writes','deletes','listeners'])O[n]+=(Number(o[n])||0);
      }
    }
  }
  for(const [h,v] of Object.entries(target?.hours||{})){
    const H=out.hours[h]??={reads:0,writes:0,deletes:0};
    for(const n of ['reads','writes','deletes'])H[n]+=(Number(v[n])||0);
  }
  for(const [b,v] of Object.entries(target?.buckets||{})){
    const B=out.buckets[b]??={targets:{}};
    for(const [key,t] of Object.entries(v.targets||{})){
      const BT=B.targets[key]??={project:t.project||'unknown',database:t.database||'(default)',apps:{}};
      for(const [app,a] of Object.entries(t.apps||{})){
        const A=BT.apps[app]??={reads:0,writes:0,deletes:0,listeners:0,ops:{}};
        for(const n of ['reads','writes','deletes','listeners'])A[n]+=(Number(a[n])||0);
        for(const [op,o] of Object.entries(a.ops||{})){
          const O=A.ops[op]??={reads:0,writes:0,deletes:0,listeners:0};
          for(const n of ['reads','writes','deletes','listeners'])O[n]+=(Number(o[n])||0);
        }
      }
    }
  }
  return out;
}
async function usageRoute(request,env,headers,url){
  if(!allowedOrigin(request,env))return new Response('Forbidden origin',{status:403,headers});
  headers={...headers,'Cache-Control':'no-store'};
  if(url.pathname==='/usage/health')return Response.json({ok:true,service:'firebase-usage',build:WORKER_BUILD,storage:'r2-daily-snapshots'},{headers});
  if(url.pathname==='/usage/snapshot'&&request.method==='POST'){
    const len=Number(request.headers.get('Content-Length')||0);if(len>256*1024)return new Response('Payload too large',{status:413,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    if(!validDate(body.date)||!validDevice(body.deviceId)||![2,3].includes(body.version))return new Response('Invalid snapshot',{status:400,headers});
    const snapshot={version:3,date:body.date,deviceId:body.deviceId,device:body.device||null,updatedAt:new Date().toISOString(),targets:body.targets||{},hours:body.hours||{},buckets:body.buckets||{}};
    const key='_usage/v2/'+body.date+'/'+body.deviceId+'.json';
    await env.SNAG_MEDIA.put(key,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
    return Response.json({ok:true,date:body.date,updatedAt:snapshot.updatedAt},{headers});
  }
  if(url.pathname==='/usage/day'&&request.method==='GET'){
    const date=url.searchParams.get('date');if(!validDate(date))return new Response('Invalid date',{status:400,headers});
    const prefix='_usage/v2/'+date+'/';let cursor,objects=[],truncated=true;
    while(truncated&&objects.length<1000){
      const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});
      objects.push(...page.objects);truncated=page.truncated;cursor=page.cursor;
    }
    const aggregate={version:3,date,deviceCount:objects.length,targets:{},hours:{},buckets:{},devices:[]};
    for(const item of objects){
      const obj=await env.SNAG_MEDIA.get(item.key);if(!obj)continue;
      try{const snap=JSON.parse(await obj.text());aggregate.devices.push({deviceId:snap.deviceId,device:snap.device||null,updatedAt:snap.updatedAt,targets:snap.targets||{},hours:snap.hours||{},buckets:snap.buckets||{}});mergeUsage(snap,aggregate)}catch{}
    }
    aggregate.generatedAt=new Date().toISOString();
    return Response.json(aggregate,{headers});
  }
  return new Response('Not found',{status:404,headers});
}
async function appMonitorRoute(request,env,headers,url){
  if(!allowedOrigin(request,env))return new Response('Forbidden origin',{status:403,headers});
  headers={...headers,'Cache-Control':'no-store'};
  if(url.pathname==='/app-monitor/health')return Response.json({ok:true,service:'app-monitor',build:WORKER_BUILD,storage:'r2-session-snapshots',adminProtected:true},{headers});
  if(url.pathname==='/app-monitor/session'&&request.method==='POST'){
    const len=Number(request.headers.get('Content-Length')||0);if(len>64*1024)return new Response('Payload too large',{status:413,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    if(body.version!==1||!validDate(body.date)||!validDevice(body.deviceId)||!validSession(body.sessionId)||!body.app)return new Response('Invalid session',{status:400,headers});
    const ip=request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()||'';
    const cf=request.cf||{},observedAt=new Date().toISOString();
    const identity=body.identity&&typeof body.identity==='object'?{uid:String(body.identity.uid||'').slice(0,180),username:String(body.identity.username||'').slice(0,120),provider:String(body.identity.provider||'').slice(0,80),isAnonymous:typeof body.identity.isAnonymous==='boolean'?body.identity.isAnonymous:null}:null;
    const device=body.device&&typeof body.device==='object'?body.device:null;
    const snapshot={version:1,date:body.date,app:String(body.app).slice(0,80),deviceId:body.deviceId,sessionId:body.sessionId,startedAt:String(body.startedAt||observedAt).slice(0,40),lastSeenAt:String(body.lastSeenAt||observedAt).slice(0,40),observedAt,activeMs:Math.max(0,Math.min(Number(body.activeMs)||0,24*60*60*1000)),pageViews:Math.max(1,Math.min(Number(body.pageViews)||1,10000)),path:String(body.path||'').slice(0,500),title:String(body.title||'').slice(0,200),referrer:String(body.referrer||'').slice(0,500),reason:String(body.reason||'').slice(0,40),identity,device,ip,ipHash:ip?await sha256(ip):'',geo:{country:String(cf.country||''),region:String(cf.region||''),city:String(cf.city||''),postalCode:String(cf.postalCode||''),timezone:String(cf.timezone||''),colo:String(cf.colo||''),asn:cf.asn||null}};
    const key='_app-monitor/v1/'+body.date+'/'+cleanKey(body.app)+'/'+body.sessionId+'.json';
    await env.SNAG_MEDIA.put(key,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
    return Response.json({ok:true,observedAt},{headers});
  }
  if(url.pathname==='/app-monitor/day'&&request.method==='GET'){
    if(!(await appMonitorAdmin(request)))return new Response('Unauthorized',{status:401,headers});
    const date=url.searchParams.get('date');if(!validDate(date))return new Response('Invalid date',{status:400,headers});
    const prefix='_app-monitor/v1/'+date+'/';let cursor,objects=[],truncated=true;
    while(truncated&&objects.length<5000){const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});objects.push(...page.objects);truncated=page.truncated;cursor=page.cursor}
    const sessions=[];for(const item of objects){const obj=await env.SNAG_MEDIA.get(item.key);if(!obj)continue;try{sessions.push(JSON.parse(await obj.text()))}catch{}}
    return Response.json({version:1,date,sessionCount:sessions.length,sessions,generatedAt:new Date().toISOString(),truncated:truncated||objects.length>=5000},{headers});
  }
  return new Response('Not found',{status:404,headers});
}

export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin')||'',headers=cors(origin,env.ALLOWED_ORIGIN||'https://nirav2000.github.io');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const url=new URL(request.url),prefix='/objects/';
  if(url.pathname.startsWith('/usage/'))return usageRoute(request,env,headers,url);
  if(url.pathname.startsWith('/app-monitor/'))return appMonitorRoute(request,env,headers,url);
  if(url.pathname==='/health')return Response.json({ok:true,service:'snag-media-api',build:WORKER_BUILD,r2Bound:!!env.SNAG_MEDIA,usageTelemetry:true,appMonitor:true},{headers});
  if(!url.pathname.startsWith(prefix))return new Response('Not found',{status:404,headers});
  if(request.method==='PUT'){try{await verifyFirebaseToken(request,env)}catch(e){if(e instanceof Response){Object.entries(headers).forEach(([k,v])=>e.headers.set(k,v));return e}throw e}}
  const key=url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  if(!key||key.includes('..'))return new Response('Bad key',{status:400,headers});
  if(request.method==='PUT'){
    const length=Number(request.headers.get('Content-Length')||0);if(length>50*1024*1024)return new Response('File too large',{status:413,headers});
    await env.SNAG_MEDIA.put(key,request.body,{httpMetadata:{contentType:request.headers.get('Content-Type')||'application/octet-stream'}});
    return Response.json({key,url:url.origin+'/objects/'+key.split('/').map(encodeURIComponent).join('/')},{headers});
  }
  if(request.method==='GET'){const obj=await env.SNAG_MEDIA.get(key);if(!obj)return new Response('Not found',{status:404,headers});const h=new Headers(headers);obj.writeHttpMetadata(h);h.set('etag',obj.httpEtag);return new Response(obj.body,{headers:h})}
  return new Response('Method not allowed',{status:405,headers});
 }
};