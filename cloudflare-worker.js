import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
const WORKER_BUILD='2026.09.24.1210';
const APP_MONITOR_RP_ID='nirav2000.github.io',APP_MONITOR_ORIGIN='https://nirav2000.github.io',APP_MONITOR_SECURITY='_app-monitor/v2/security/',APP_MONITOR_SESSION_MS=12*60*60*1000,APP_MONITOR_CHALLENGE_MS=5*60*1000,APP_MONITOR_BOOTSTRAP_MS=30*60*1000;
// Cloudflare Worker for Snag Recorder media + lightweight Firebase usage telemetry.
// Media uses the R2 bucket "snag-media" as SNAG_MEDIA.
// Usage telemetry is stored under _usage/v2/ in the same R2 bucket, so it creates
// no Firestore reads/writes. Each browser overwrites one compact daily snapshot.
const cors=(origin,allowed)=>({
  'Access-Control-Allow-Origin': origin===allowed?origin:allowed,
  'Access-Control-Allow-Methods':'PUT,POST,GET,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type,X-App-Monitor-Key,X-App-Monitor-Session,X-App-Monitor-Bootstrap',
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
const b64uBytes=bytes=>{let s='';for(const b of bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')};
const bytesB64u=s=>{const p=String(s||'').replace(/-/g,'+').replace(/_/g,'/'),raw=atob(p+'='.repeat((4-p.length%4)%4)),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out};
const randomSecret=(n=32)=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return b64uBytes(b)};
async function getJSON(env,key){const o=await env.SNAG_MEDIA.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function putJSON(env,key,value){await env.SNAG_MEDIA.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}})}
async function listJSON(env,prefix,limit=5000){let cursor,objects=[],truncated=true;while(truncated&&objects.length<limit){const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});objects.push(...page.objects);truncated=page.truncated;cursor=page.cursor}const out=[];for(const item of objects){const x=await getJSON(env,item.key);if(x)out.push(x)}return out}
async function appMonitorCredential(request,env){
  const key=request.headers.get('X-App-Monitor-Key')||'';if(key.length<32)return {ok:false};
  const hash=await sha256(key),recovery=await getJSON(env,APP_MONITOR_SECURITY+'recovery.json');
  if(recovery){return {ok:recovery.hash===hash,hash,master:recovery.hash===hash,recovery:true}}
  const obj=await env.SNAG_MEDIA.get('_app-monitor/v1/_tokens/'+hash+'.json');
  return {ok:!!obj,hash,master:false,legacyDevice:!!obj};
}
async function issueAppMonitorSession(env,method='passkey',label='App Monitor'){
  const token=randomSecret(32),hash=await sha256(token),now=Date.now(),record={version:2,hash,method,label,createdAt:new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString(),expiresAt:new Date(now+APP_MONITOR_SESSION_MS).toISOString()};
  await putJSON(env,APP_MONITOR_SECURITY+'sessions/'+hash+'.json',record);return {token,expiresAt:record.expiresAt,method};
}
async function appMonitorSession(request,env){
  const token=request.headers.get('X-App-Monitor-Session')||'';if(token.length<32)return {ok:false};
  const hash=await sha256(token),key=APP_MONITOR_SECURITY+'sessions/'+hash+'.json',record=await getJSON(env,key);if(!record)return {ok:false};
  if(Date.parse(record.expiresAt)<=Date.now()){await env.SNAG_MEDIA.delete(key);return {ok:false,expired:true}}
  if(Date.now()-Date.parse(record.lastSeenAt||record.createdAt)>15*60*1000){record.lastSeenAt=new Date().toISOString();await putJSON(env,key,record)}
  return {ok:true,hash,record};
}
async function appMonitorAdmin(request,env){const s=await appMonitorSession(request,env);if(s.ok)return true;return (await appMonitorCredential(request,env)).ok}
async function appMonitorPasskeys(env){return listJSON(env,APP_MONITOR_SECURITY+'passkeys/')}
async function bootstrapProof(request,record){const secret=request.headers.get('X-App-Monitor-Bootstrap')||'';if(!record?.proofHash||secret.length<32)return false;return (await sha256(secret))===record.proofHash}
async function saveChallenge(env,kind,challenge,sessionHash=''){const id=randomSecret(18),record={version:2,id,kind,challenge,sessionHash,createdAt:new Date().toISOString()};await putJSON(env,APP_MONITOR_SECURITY+'challenges/'+id+'.json',record);return id}
async function takeChallenge(env,id,kind){const key=APP_MONITOR_SECURITY+'challenges/'+String(id||'')+'.json',x=await getJSON(env,key);if(!x||x.kind!==kind||Date.now()-Date.parse(x.createdAt)>APP_MONITOR_CHALLENGE_MS)return null;await env.SNAG_MEDIA.delete(key);return x}
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
    const identity=body.identity&&typeof body.identity==='object'?{uid:String(body.identity.uid||'').slice(0,180),username:String(body.identity.username||'').slice(0,120),provider:String(body.identity.provider||'').slice(0,80),isAnonymous:typeof body.identity.isAnonymous==='boolean'?body.identity.isAnonymous:null,globalUid:String(body.identity.globalUid||'').slice(0,180),appUid:String(body.identity.appUid||'').slice(0,180),appProvider:String(body.identity.appProvider||'').slice(0,80),source:String(body.identity.source||'').slice(0,80)}:null;
    const device=body.device&&typeof body.device==='object'?body.device:null;
    const snapshot={version:1,date:body.date,app:String(body.app).slice(0,80),deviceId:body.deviceId,sessionId:body.sessionId,startedAt:String(body.startedAt||observedAt).slice(0,40),lastSeenAt:String(body.lastSeenAt||observedAt).slice(0,40),observedAt,activeMs:Math.max(0,Math.min(Number(body.activeMs)||0,24*60*60*1000)),pageViews:Math.max(1,Math.min(Number(body.pageViews)||1,10000)),path:String(body.path||'').slice(0,500),title:String(body.title||'').slice(0,200),referrer:String(body.referrer||'').slice(0,500),reason:String(body.reason||'').slice(0,40),identity,device,ip,ipHash:ip?await sha256(ip):'',geo:{country:String(cf.country||''),region:String(cf.region||''),city:String(cf.city||''),postalCode:String(cf.postalCode||''),timezone:String(cf.timezone||''),colo:String(cf.colo||''),asn:cf.asn||null}};
    const key='_app-monitor/v1/'+body.date+'/'+cleanKey(body.app)+'/'+body.sessionId+'.json';
    await env.SNAG_MEDIA.put(key,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
    return Response.json({ok:true,observedAt},{headers});
  }
  if(url.pathname==='/app-monitor/security/status'&&request.method==='GET'){
    const passkeys=await appMonitorPasskeys(env),recovery=await getJSON(env,APP_MONITOR_SECURITY+'recovery.json');
    return Response.json({ok:true,passkeyCount:passkeys.length,bootstrapNeeded:passkeys.length===0,recoveryConfigured:!!recovery,recoveryNeedsRotation:!!recovery?.migratedFromLegacy,sessionHours:APP_MONITOR_SESSION_MS/3600000},{headers});
  }
  if(url.pathname==='/app-monitor/bootstrap/request'&&request.method==='POST'){
    const passkeys=await appMonitorPasskeys(env);if(passkeys.length)return new Response('Bootstrap disabled',{status:409,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const secret=String(body.secret||'');if(secret.length<32||secret.length>220)return new Response('Invalid setup proof',{status:400,headers});
    const currentKey=APP_MONITOR_SECURITY+'bootstrap-current.json',current=await getJSON(env,currentKey);
    if(current&&!current.used&&Date.parse(current.expiresAt)>Date.now()){
      const approval=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-approvals/'+current.id+'.json');
      if(approval)return new Response('An approved setup request is already in progress',{status:409,headers});
      await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'bootstrap-approvals/'+current.id+'.json');
    }
    const id=randomSecret(18),now=Date.now(),record={version:2,id,proofHash:await sha256(secret),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+APP_MONITOR_BOOTSTRAP_MS).toISOString(),used:false};
    await putJSON(env,currentKey,record);
    return Response.json({ok:true,requestId:id,expiresAt:record.expiresAt},{headers});
  }
  if(url.pathname==='/app-monitor/bootstrap/status'&&request.method==='GET'){
    const passkeys=await appMonitorPasskeys(env);if(passkeys.length)return Response.json({ok:true,bootstrapNeeded:false,approved:false},{headers});
    const id=String(url.searchParams.get('requestId')||'');if(!/^[A-Za-z0-9_-]{12,80}$/.test(id))return new Response('Invalid request',{status:400,headers});
    const req=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-current.json');
    if(!req||req.id!==id||req.used||Date.parse(req.expiresAt)<=Date.now())return Response.json({ok:true,bootstrapNeeded:true,approved:false,expired:true},{headers});
    if(!await bootstrapProof(request,req))return new Response('Invalid setup proof',{status:401,headers});
    const approval=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-approvals/'+id+'.json');
    return Response.json({ok:true,bootstrapNeeded:true,approved:!!approval,expiresAt:req.expiresAt,approvedAt:approval?.approvedAt||null},{headers});
  }
  if(url.pathname==='/app-monitor/bootstrap/register/options'&&request.method==='POST'){
    const passkeys=await appMonitorPasskeys(env);if(passkeys.length)return new Response('Bootstrap disabled',{status:409,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const id=String(body.requestId||'');if(!/^[A-Za-z0-9_-]{12,80}$/.test(id))return new Response('Invalid request',{status:400,headers});
    const req=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-current.json'),approval=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-approvals/'+id+'.json');
    if(!req||req.id!==id||req.used||Date.parse(req.expiresAt)<=Date.now()||!approval||!await bootstrapProof(request,req))return new Response('Setup request not approved',{status:401,headers});
    const options=await generateRegistrationOptions({rpName:'Nirav App Monitor',rpID:APP_MONITOR_RP_ID,userName:'nirav',userDisplayName:'Nirav',userID:new TextEncoder().encode('app-monitor-admin'),attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'}});
    const challengeId=await saveChallenge(env,'bootstrap-register',options.challenge,id);return Response.json({challengeId,options},{headers});
  }
  if(url.pathname==='/app-monitor/bootstrap/register/verify'&&request.method==='POST'){
    const passkeys=await appMonitorPasskeys(env);if(passkeys.length)return new Response('Bootstrap disabled',{status:409,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const id=String(body.requestId||''),challenge=await takeChallenge(env,body.challengeId,'bootstrap-register');
    if(!challenge||challenge.sessionHash!==id)return new Response('Challenge expired',{status:401,headers});
    const req=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-current.json'),approval=await getJSON(env,APP_MONITOR_SECURITY+'bootstrap-approvals/'+id+'.json');
    if(!req||req.id!==id||req.used||Date.parse(req.expiresAt)<=Date.now()||!approval||!await bootstrapProof(request,req))return new Response('Setup request not approved',{status:401,headers});
    try{
      const verification=await verifyRegistrationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin:APP_MONITOR_ORIGIN,expectedRPID:APP_MONITOR_RP_ID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
      if(!verification.verified||!verification.registrationInfo)return new Response('Passkey not verified',{status:400,headers});
      const info=verification.registrationInfo,credential=info.credential,record={version:2,id:credential.id,publicKey:b64uBytes(credential.publicKey),counter:credential.counter,transports:credential.transports||body.response?.response?.transports||[],deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,label:String(body.label||'First passkey').slice(0,120),createdAt:new Date().toISOString(),lastUsedAt:null};
      await putJSON(env,APP_MONITOR_SECURITY+'passkeys/'+await sha256(record.id)+'.json',record);
      req.used=true;req.usedAt=new Date().toISOString();await putJSON(env,APP_MONITOR_SECURITY+'bootstrap-current.json',req);
      await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'bootstrap-approvals/'+id+'.json');
      await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'recovery.json');
      const session=await issueAppMonitorSession(env,'passkey',record.label||'First passkey');
      return Response.json({ok:true,...session,passkey:{id:record.id,label:record.label,deviceType:record.deviceType,backedUp:record.backedUp,createdAt:record.createdAt},recoveryInvalidated:true},{headers});
    }catch(e){return new Response('Passkey registration failed: '+String(e?.message||e),{status:400,headers})}
  }
  if(url.pathname==='/app-monitor/auth/recovery'&&request.method==='POST'){
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const token=String(body.token||''),auth=await appMonitorCredential(new Request(request.url,{headers:{'X-App-Monitor-Key':token}}),env);
    if(!auth.ok)return new Response('Unauthorized',{status:401,headers});
    const session=await issueAppMonitorSession(env,'recovery','Recovery sign-in');return Response.json({ok:true,...session,migrated:!!auth.migrated,legacyDevice:!!auth.legacyDevice},{headers});
  }
  if(url.pathname==='/app-monitor/auth/session'&&request.method==='GET'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    return Response.json({ok:true,expiresAt:session.record.expiresAt,method:session.record.method,label:session.record.label},{headers});
  }
  if(url.pathname==='/app-monitor/auth/logout'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(session.ok)await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'sessions/'+session.hash+'.json');
    return Response.json({ok:true},{headers});
  }
  if(url.pathname==='/app-monitor/auth/passkey/options'&&request.method==='POST'){
    const passkeys=await appMonitorPasskeys(env);if(!passkeys.length)return new Response('No passkeys registered',{status:404,headers});
    const options=await generateAuthenticationOptions({rpID:APP_MONITOR_RP_ID,userVerification:'required',allowCredentials:passkeys.map(p=>({id:p.id,transports:p.transports||[]}))});
    const challengeId=await saveChallenge(env,'authenticate',options.challenge);return Response.json({challengeId,options},{headers});
  }
  if(url.pathname==='/app-monitor/auth/passkey/verify'&&request.method==='POST'){
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const challenge=await takeChallenge(env,body.challengeId,'authenticate');if(!challenge)return new Response('Challenge expired',{status:401,headers});
    const passkey=(await appMonitorPasskeys(env)).find(p=>p.id===body.response?.id);if(!passkey)return new Response('Unknown passkey',{status:401,headers});
    try{
      const verification=await verifyAuthenticationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin:APP_MONITOR_ORIGIN,expectedRPID:APP_MONITOR_RP_ID,requireUserVerification:true,credential:{id:passkey.id,publicKey:bytesB64u(passkey.publicKey),counter:Number(passkey.counter)||0,transports:passkey.transports||[]}});
      if(!verification.verified)return new Response('Passkey not verified',{status:401,headers});
      passkey.counter=verification.authenticationInfo.newCounter;passkey.lastUsedAt=new Date().toISOString();await putJSON(env,APP_MONITOR_SECURITY+'passkeys/'+await sha256(passkey.id)+'.json',passkey);
      const session=await issueAppMonitorSession(env,'passkey',passkey.label||'Passkey');return Response.json({ok:true,...session},{headers});
    }catch(e){return new Response('Passkey verification failed',{status:401,headers})}
  }
  if(url.pathname==='/app-monitor/passkeys/register/options'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    const passkeys=await appMonitorPasskeys(env),options=await generateRegistrationOptions({rpName:'Nirav App Monitor',rpID:APP_MONITOR_RP_ID,userName:'nirav',userDisplayName:'Nirav',userID:new TextEncoder().encode('app-monitor-admin'),attestationType:'none',supportedAlgorithmIDs:[-7,-257],excludeCredentials:passkeys.map(p=>({id:p.id,transports:p.transports||[]})),authenticatorSelection:{residentKey:'required',userVerification:'required'}});
    const challengeId=await saveChallenge(env,'register',options.challenge,session.hash);return Response.json({challengeId,options},{headers});
  }
  if(url.pathname==='/app-monitor/passkeys/register/verify'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const challenge=await takeChallenge(env,body.challengeId,'register');if(!challenge||challenge.sessionHash!==session.hash)return new Response('Challenge expired',{status:401,headers});
    try{
      const verification=await verifyRegistrationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin:APP_MONITOR_ORIGIN,expectedRPID:APP_MONITOR_RP_ID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
      if(!verification.verified||!verification.registrationInfo)return new Response('Passkey not verified',{status:400,headers});
      const info=verification.registrationInfo,credential=info.credential,record={version:2,id:credential.id,publicKey:b64uBytes(credential.publicKey),counter:credential.counter,transports:credential.transports||body.response?.response?.transports||[],deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,label:String(body.label||'Passkey').slice(0,120),createdAt:new Date().toISOString(),lastUsedAt:null};
      await putJSON(env,APP_MONITOR_SECURITY+'passkeys/'+await sha256(record.id)+'.json',record);return Response.json({ok:true,passkey:{id:record.id,label:record.label,deviceType:record.deviceType,backedUp:record.backedUp,createdAt:record.createdAt}},{headers});
    }catch(e){return new Response('Passkey registration failed: '+String(e?.message||e),{status:400,headers})}
  }
  if(url.pathname==='/app-monitor/security/info'&&request.method==='GET'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    const passkeys=(await appMonitorPasskeys(env)).map(p=>({id:p.id,label:p.label||'Passkey',deviceType:p.deviceType,backedUp:p.backedUp,createdAt:p.createdAt,lastUsedAt:p.lastUsedAt}));
    const sessions=(await listJSON(env,APP_MONITOR_SECURITY+'sessions/')).filter(s=>Date.parse(s.expiresAt)>Date.now()).map(s=>({hash:s.hash,label:s.label,method:s.method,createdAt:s.createdAt,lastSeenAt:s.lastSeenAt,expiresAt:s.expiresAt,current:s.hash===session.hash}));
    const recovery=await getJSON(env,APP_MONITOR_SECURITY+'recovery.json');return Response.json({ok:true,passkeys,sessions,recovery:{configured:!!recovery,needsRotation:!!recovery?.migratedFromLegacy,updatedAt:recovery?.updatedAt||recovery?.createdAt||null}},{headers});
  }
  if(url.pathname==='/app-monitor/security/recovery'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const token=String(body.token||'');if(token.length<32||token.length>220)return new Response('Recovery token must be 32-220 characters',{status:400,headers});
    await putJSON(env,APP_MONITOR_SECURITY+'recovery.json',{version:2,hash:await sha256(token),updatedAt:new Date().toISOString(),migratedFromLegacy:false});return Response.json({ok:true},{headers});
  }
  if(url.pathname==='/app-monitor/security/revoke-passkey'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const id=String(body.id||'');if(!id)return new Response('Missing passkey',{status:400,headers});
    await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'passkeys/'+await sha256(id)+'.json');return Response.json({ok:true},{headers});
  }
  if(url.pathname==='/app-monitor/security/revoke-all-sessions'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    const sessions=await listJSON(env,APP_MONITOR_SECURITY+'sessions/');let revoked=0;
    for(const s of sessions){if(s.hash&&/^[a-f0-9]{64}$/.test(s.hash)){await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'sessions/'+s.hash+'.json');revoked++}}
    return Response.json({ok:true,revoked},{headers});
  }
  if(url.pathname==='/app-monitor/security/revoke-session'&&request.method==='POST'){
    const session=await appMonitorSession(request,env);if(!session.ok)return new Response('Unauthorized',{status:401,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const hash=String(body.hash||'');if(!/^[a-f0-9]{64}$/.test(hash))return new Response('Invalid session',{status:400,headers});
    await env.SNAG_MEDIA.delete(APP_MONITOR_SECURITY+'sessions/'+hash+'.json');return Response.json({ok:true,current:hash===session.hash},{headers});
  }
  if(url.pathname==='/app-monitor/token'&&request.method==='POST'){
    const auth=await appMonitorCredential(request,env);if(!auth.ok)return new Response('Unauthorized',{status:401,headers});
    const len=Number(request.headers.get('Content-Length')||0);if(len>16*1024)return new Response('Payload too large',{status:413,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const token=String(body.token||''),label=String(body.label||'App Monitor device').trim().slice(0,120);
    if(token.length<32||token.length>220)return new Response('Token must be 32-220 characters',{status:400,headers});
    const hash=await sha256(token),record={version:1,hash,label,createdAt:new Date().toISOString(),createdByMaster:auth.master===true};
    await env.SNAG_MEDIA.put('_app-monitor/v1/_tokens/'+hash+'.json',JSON.stringify(record),{httpMetadata:{contentType:'application/json'}});
    if(body.replaceCurrent===true&&!auth.master&&auth.hash!==hash)await env.SNAG_MEDIA.delete('_app-monitor/v1/_tokens/'+auth.hash+'.json');
    return Response.json({ok:true,label,replaced:body.replaceCurrent===true&&!auth.master},{headers});
  }
  if(url.pathname==='/app-monitor/token'&&request.method==='DELETE'){
    const auth=await appMonitorCredential(request,env);if(!auth.ok)return new Response('Unauthorized',{status:401,headers});
    if(auth.master)return new Response('Master recovery token cannot be revoked here',{status:400,headers});
    await env.SNAG_MEDIA.delete('_app-monitor/v1/_tokens/'+auth.hash+'.json');
    return Response.json({ok:true,revoked:true},{headers});
  }
  if(url.pathname==='/app-monitor/aliases'&&request.method==='GET'){
    if(!(await appMonitorAdmin(request,env)))return new Response('Unauthorized',{status:401,headers});
    const prefix='_app-monitor/v1/_aliases/';let cursor,objects=[],truncated=true;
    while(truncated&&objects.length<5000){const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});objects.push(...page.objects);truncated=page.truncated;cursor=page.cursor}
    const aliases=[];for(const item of objects){const obj=await env.SNAG_MEDIA.get(item.key);if(!obj)continue;try{aliases.push(JSON.parse(await obj.text()))}catch{}}
    return Response.json({version:1,aliases,generatedAt:new Date().toISOString()},{headers});
  }
  if(url.pathname==='/app-monitor/alias'&&request.method==='POST'){
    if(!(await appMonitorAdmin(request,env)))return new Response('Unauthorized',{status:401,headers});
    const len=Number(request.headers.get('Content-Length')||0);if(len>16*1024)return new Response('Payload too large',{status:413,headers});
    let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
    const type=String(body.type||''),id=String(body.id||'').trim(),person=String(body.person||'').trim().slice(0,120);
    if(!['device','auth','session'].includes(type)||!id||id.length>220)return new Response('Invalid alias',{status:400,headers});
    const key='_app-monitor/v1/_aliases/'+type+'/'+await sha256(id)+'.json';
    if(!person){await env.SNAG_MEDIA.delete(key);return Response.json({ok:true,removed:true,type,id},{headers})}
    const alias={version:1,type,id,person,updatedAt:new Date().toISOString()};
    await env.SNAG_MEDIA.put(key,JSON.stringify(alias),{httpMetadata:{contentType:'application/json'}});
    return Response.json({ok:true,alias},{headers});
  }
  if(url.pathname==='/app-monitor/day'&&request.method==='GET'){
    if(!(await appMonitorAdmin(request,env)))return new Response('Unauthorized',{status:401,headers});
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