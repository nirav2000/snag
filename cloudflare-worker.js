const WORKER_BUILD='2026.10.04.notifications-v1';
const cors=(origin,allowed)=>({'Access-Control-Allow-Origin':origin===allowed?origin:allowed,'Access-Control-Allow-Methods':'PUT,POST,GET,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'86400'});
const allowedOrigin=(request,env)=>(request.headers.get('Origin')||'')===(env.ALLOWED_ORIGIN||'https://nirav2000.github.io');
async function firebaseIdentity(request,env){const h=request.headers.get('Authorization')||'';if(!h.startsWith('Bearer '))throw new Response('Unauthorized',{status:401});const token=h.slice(7),r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});if(!r.ok)throw new Response('Unauthorized',{status:401});const data=await r.json(),user=data.users?.[0];if(!user?.localId)throw new Response('Unauthorized',{status:401});return{token,user,uid:user.localId}}
const fsBase=env=>`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID||'snag-509418'}/databases/(default)/documents`;
const field=(doc,name)=>doc?.fields?.[name]?.stringValue??doc?.fields?.[name]?.integerValue??doc?.fields?.[name]?.booleanValue??null;
async function projectAccess(projectId,identity,env,{owner=false}={}){const r=await fetch(fsBase(env)+'/snag_projects/'+encodeURIComponent(projectId),{headers:{Authorization:'Bearer '+identity.token}});if(!r.ok)throw new Response(r.status===403?'Forbidden':'Project unavailable',{status:r.status===403?403:404});const doc=await r.json();if(owner&&field(doc,'ownerUid')!==identity.uid)throw new Response('Owner access required',{status:403});return doc}
function projectFromKey(key){const p=key.split('/');return p[0]==='snag-projects'&&p[1]?p[1]:null}
const NOTIFICATION_PREFIX='_notifications/v1/';
async function r2JSON(env,key){const o=await env.SNAG_MEDIA.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function putR2JSON(env,key,value){await env.SNAG_MEDIA.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}})}
function fsValue(v){
 if(!v)return null;
 if(Object.prototype.hasOwnProperty.call(v,'stringValue'))return v.stringValue;
 if(Object.prototype.hasOwnProperty.call(v,'booleanValue'))return v.booleanValue;
 if(Object.prototype.hasOwnProperty.call(v,'integerValue'))return Number(v.integerValue);
 if(Object.prototype.hasOwnProperty.call(v,'doubleValue'))return Number(v.doubleValue);
 if(Object.prototype.hasOwnProperty.call(v,'timestampValue'))return v.timestampValue;
 if(v.arrayValue)return (v.arrayValue.values||[]).map(fsValue);
 if(v.mapValue){const out={};for(const [k,x] of Object.entries(v.mapValue.fields||{}))out[k]=fsValue(x);return out}
 return null;
}
const docValue=(doc,name)=>fsValue(doc?.fields?.[name]);
async function firestoreDoc(path,identity,env){
 const r=await fetch(fsBase(env)+'/'+path,{headers:{Authorization:'Bearer '+identity.token}});
 if(!r.ok)throw new Response(r.status===403?'Forbidden':'Not found',{status:r.status===403?403:404});
 return r.json();
}
async function notificationMember(projectId,uid,identity,env){
 const project=await projectAccess(projectId,identity,env),ownerUid=String(field(project,'ownerUid')||'');
 if(uid===ownerUid)return{uid,role:'owner',admin:true,owner:true};
 const doc=await firestoreDoc('snag_projects/'+encodeURIComponent(projectId)+'/members/'+encodeURIComponent(uid),identity,env);
 return{uid,role:String(docValue(doc,'role')||'member'),admin:docValue(doc,'admin')===true,owner:false,name:String(docValue(doc,'name')||'')};
}
function defaultNotificationPolicy(ownerUid=''){
 return{version:1,ownerUid,billingOwnerUid:ownerUid,allowedChannels:{in_app:true,web_push:true,email:false,telegram:false,whatsapp:false,signal:false,slack:false,discord:false,sms:false,ios_push:false},allowedEvents:{'snag.created':true,'snag.updated':true,'snag.comment_added':true,'snag.status_changed':true},roleChannels:{},roleEvents:{},userChannels:{},userEvents:{},mandatoryEvents:{},updatedAt:null};
}
function defaultNotificationPreferences(identity){
 return{version:1,channels:{in_app:true,web_push:true},events:{'snag.created':true,'snag.updated':true,'snag.comment_added':true,'snag.status_changed':true},destinations:{email:String(identity?.user?.email||'')},updatedAt:null};
}
async function notificationPolicy(projectId,ownerUid,env){return await r2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/policy.json')||defaultNotificationPolicy(ownerUid)}
async function notificationPreferences(projectId,uid,identity,env){return await r2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/members/'+uid+'/preferences.json')||defaultNotificationPreferences(identity)}
function setting(map,key,fallback=true){return Object.prototype.hasOwnProperty.call(map||{},key)?map[key]!==false:fallback}
function notificationAllowed(policy,member,kind,key){
 const global=kind==='channel'?policy.allowedChannels:policy.allowedEvents;
 const roleMap=(kind==='channel'?policy.roleChannels:policy.roleEvents)?.[member.role];
 const userMap=(kind==='channel'?policy.userChannels:policy.userEvents)?.[member.uid];
 if(userMap&&Object.prototype.hasOwnProperty.call(userMap,key))return userMap[key]!==false;
 if(roleMap&&Object.prototype.hasOwnProperty.call(roleMap,key))return roleMap[key]!==false;
 return setting(global,key,kind==='channel'?key==='in_app':true);
}
function effectiveNotification(policy,prefs,member,eventType){
 const channels={};
 for(const key of ['in_app','web_push','email','telegram','whatsapp','signal','slack','discord','sms','ios_push'])channels[key]=notificationAllowed(policy,member,'channel',key)&&setting(prefs.channels,key,key==='in_app');
 const eventAllowed=notificationAllowed(policy,member,'event',eventType);
 return{eventAllowed,channels};
}
async function snagNotificationInbox(env,projectId,uid,limit=80){
 const prefix=NOTIFICATION_PREFIX+'projects/'+projectId+'/inbox/'+uid+'/',page=await env.SNAG_MEDIA.list({prefix,limit:Math.min(200,limit)}),items=[];
 for(const item of page.objects){const x=await r2JSON(env,item.key);if(x)items.push(x)}
 return items.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
async function objectReadAccess(key,identity,env){
  const parts=key.split('/'),projectId=projectFromKey(key);await projectAccess(projectId,identity,env);
  if(parts[2]==='snags'&&parts[3]){
    const r=await fetch(fsBase(env)+'/snag_projects/'+encodeURIComponent(projectId)+'/snags/'+encodeURIComponent(parts[3]),{headers:{Authorization:'Bearer '+identity.token}});
    if(!r.ok)throw new Response(r.status===403?'Forbidden':'Snag unavailable',{status:r.status===403?403:404});
  }
}

function notificationEventText(type,snag){
 const ref=String(docValue(snag,'ref')||'Snag'),title=String(docValue(snag,'title')||''),status=String(docValue(snag,'status')||'');
 if(type==='snag.created')return{title:'New snag · '+ref,body:title||'A new snag was added.'};
 if(type==='snag.updated')return{title:'Snag updated · '+ref,body:title||'A snag was updated.'};
 if(type==='snag.comment_added')return{title:'New snag update · '+ref,body:title||'A new comment or progress update was added.'};
 if(type==='snag.status_changed')return{title:'Status changed · '+ref,body:(title?title+' · ':'')+(status||'Status updated')};
 return{title:'Snag notification',body:title||ref};
}
async function deliverSharedNotification(env,channel,notification,destination){
 const endpoint=String(env.APPS_NOTIFICATION_ENDPOINT||'https://apps-monitor-api.nirav2000-github.workers.dev/notifications/deliver');
 const key=String(env.APPS_NOTIFICATION_INGEST_KEY||'');
 if(!key)return{ok:false,channel,status:'unconfigured'};
 try{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Apps-Notification-Key':key},body:JSON.stringify({channel,notification,destination})});
  const data=await r.json().catch(()=>null);
  return{ok:r.ok,channel,status:r.ok?'sent':(data?.delivery?.result?.status||'failed'),remote:data};
 }catch(error){return{ok:false,channel,status:'failed',error:String(error?.message||error).slice(0,200)}}
}
async function sharedNotificationProviders(env){
 const fallback={in_app:{configured:true,cost:'free'},web_push:{configured:false},email:{configured:false},telegram:{configured:false},whatsapp:{configured:false},signal:{configured:false},slack:{configured:false},discord:{configured:false},sms:{configured:false},ios_push:{configured:false}};
 const key=String(env.APPS_NOTIFICATION_INGEST_KEY||'');if(!key)return fallback;
 const delivery=String(env.APPS_NOTIFICATION_ENDPOINT||'https://apps-monitor-api.nirav2000-github.workers.dev/notifications/deliver'),endpoint=delivery.replace(/\/deliver(?:\?.*)?$/,'/providers');
 try{
  const r=await fetch(endpoint,{headers:{'X-Apps-Notification-Key':key}});
  if(!r.ok)return fallback;
  return (await r.json()).providers||fallback;
 }catch{return fallback}
}
async function sharedNotificationPublicConfig(env){
 const delivery=String(env.APPS_NOTIFICATION_ENDPOINT||'https://apps-monitor-api.nirav2000-github.workers.dev/notifications/deliver'),endpoint=delivery.replace(/\/deliver(?:\?.*)?$/,'/public-config');
 try{
  const r=await fetch(endpoint,{headers:{Accept:'application/json'}});
  if(!r.ok)return{webPush:{configured:false,appId:''}};
  const data=await r.json();return data||{webPush:{configured:false,appId:''}};
 }catch{return{webPush:{configured:false,appId:''}}}
}
async function notificationRoute(request,env,headers,url){
 if(!allowedOrigin(request,env))return new Response('Forbidden origin',{status:403,headers});
 headers={...headers,'Cache-Control':'no-store'};
 let identity;try{identity=await firebaseIdentity(request,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}
 const projectId=String(url.searchParams.get('projectId')||'').slice(0,120);
 if(!projectId)return new Response('projectId required',{status:400,headers});
 let project;try{project=await projectAccess(projectId,identity,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}
 const ownerUid=String(field(project,'ownerUid')||'');
 const actor=await notificationMember(projectId,identity.uid,identity,env);

 if(url.pathname==='/notifications/settings'&&request.method==='GET'){
  const targetUid=String(url.searchParams.get('targetUid')||identity.uid).slice(0,180);
  if(targetUid!==identity.uid&&identity.uid!==ownerUid)return new Response('Owner access required',{status:403,headers});
  let target=actor;
  if(targetUid!==identity.uid)target=await notificationMember(projectId,targetUid,identity,env);
  const [policy,prefs]=await Promise.all([notificationPolicy(projectId,ownerUid,env),notificationPreferences(projectId,targetUid,targetUid===identity.uid?identity:null,env)]);
  const [providers,publicConfig]=await Promise.all([sharedNotificationProviders(env),sharedNotificationPublicConfig(env)]);
  return Response.json({ok:true,projectId,viewer:{uid:identity.uid,role:actor.role,owner:identity.uid===ownerUid},target,policy,preferences:prefs,providers,publicConfig,effective:{channels:Object.fromEntries(Object.keys(defaultNotificationPolicy().allowedChannels).map(k=>[k,notificationAllowed(policy,target,'channel',k)&&setting(prefs.channels,k,k==='in_app')])),events:Object.fromEntries(Object.keys(defaultNotificationPolicy().allowedEvents).map(k=>[k,notificationAllowed(policy,target,'event',k)&&setting(prefs.events,k,true)]))}},{headers});
 }

 if(url.pathname==='/notifications/settings'&&request.method==='POST'){
  let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
  if(body.scope==='policy'){
   if(identity.uid!==ownerUid)return new Response('Owner access required',{status:403,headers});
   const current=await notificationPolicy(projectId,ownerUid,env),next={
    ...current,
    ownerUid,billingOwnerUid:ownerUid,
    allowedChannels:{...current.allowedChannels,...(body.policy?.allowedChannels||{})},
    allowedEvents:{...current.allowedEvents,...(body.policy?.allowedEvents||{})},
    roleChannels:{...current.roleChannels,...(body.policy?.roleChannels||{})},
    roleEvents:{...current.roleEvents,...(body.policy?.roleEvents||{})},
    userChannels:{...current.userChannels,...(body.policy?.userChannels||{})},
    userEvents:{...current.userEvents,...(body.policy?.userEvents||{})},
    mandatoryEvents:{...current.mandatoryEvents,...(body.policy?.mandatoryEvents||{})},
    updatedAt:new Date().toISOString(),updatedBy:identity.uid
   };
   await putR2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/policy.json',next);
   return Response.json({ok:true,policy:next},{headers});
  }
  if(body.scope==='preferences'){
   const targetUid=String(body.targetUid||identity.uid).slice(0,180);
   if(targetUid!==identity.uid&&identity.uid!==ownerUid)return new Response('Owner access required',{status:403,headers});
   const target=targetUid===identity.uid?actor:await notificationMember(projectId,targetUid,identity,env);
   const current=await notificationPreferences(projectId,targetUid,targetUid===identity.uid?identity:null,env),input=body.preferences||{},policy=await notificationPolicy(projectId,ownerUid,env);
   const channels={...current.channels},events={...current.events};
   for(const [key,value] of Object.entries(input.channels||{})){
    if(identity.uid===ownerUid||notificationAllowed(policy,target,'channel',key))channels[key]=value===true;
   }
   for(const [key,value] of Object.entries(input.events||{})){
    if(identity.uid===ownerUid||notificationAllowed(policy,target,'event',key))events[key]=value!==false;
   }
   for(const [key,value] of Object.entries(policy.mandatoryEvents||{}))if(value===true&&notificationAllowed(policy,target,'event',key))events[key]=true;
   const next={
    version:1,uid:targetUid,role:target.role,
    channels,
    events,
    destinations:{...current.destinations,...(input.destinations||{})},
    updatedAt:new Date().toISOString(),updatedBy:identity.uid
   };
   await putR2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/members/'+targetUid+'/preferences.json',next);
   return Response.json({ok:true,preferences:next},{headers});
  }
  return new Response('Unknown settings scope',{status:400,headers});
 }

 if(url.pathname==='/notifications/inbox'&&request.method==='GET'){
  const targetUid=String(url.searchParams.get('targetUid')||identity.uid).slice(0,180);
  if(targetUid!==identity.uid&&identity.uid!==ownerUid)return new Response('Owner access required',{status:403,headers});
  const items=await snagNotificationInbox(env,projectId,targetUid,Number(url.searchParams.get('limit'))||80);
  return Response.json({ok:true,items,unread:items.filter(x=>x.unread!==false).length},{headers});
 }

 if(url.pathname==='/notifications/read'&&request.method==='POST'){
  let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
  const targetUid=String(body.targetUid||identity.uid).slice(0,180);
  if(targetUid!==identity.uid&&identity.uid!==ownerUid)return new Response('Owner access required',{status:403,headers});
  if(body.all===true){
   const items=await snagNotificationInbox(env,projectId,targetUid,200),readAt=new Date().toISOString();
   for(const item of items){if(!item.id||item.unread===false)continue;item.unread=false;item.readAt=readAt;await putR2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/inbox/'+targetUid+'/'+item.id+'.json',item)}
   return Response.json({ok:true,updated:items.filter(x=>x.unread!==false).length},{headers});
  }
  const id=String(body.id||'').replace(/[^A-Za-z0-9._-]/g,'').slice(0,120);
  if(!id)return new Response('id required',{status:400,headers});
  const key=NOTIFICATION_PREFIX+'projects/'+projectId+'/inbox/'+targetUid+'/'+id+'.json',item=await r2JSON(env,key);
  if(!item)return new Response('Not found',{status:404,headers});
  item.unread=false;item.readAt=new Date().toISOString();await putR2JSON(env,key,item);
  return Response.json({ok:true,item},{headers});
 }

 if(url.pathname==='/notifications/event'&&request.method==='POST'){
  let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}
  const type=String(body.type||''),snagId=String(body.snagId||'').slice(0,160),eventId=String(body.eventId||'').replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,180);
  if(!['snag.created','snag.updated','snag.comment_added','snag.status_changed'].includes(type)||!snagId)return new Response('Invalid notification event',{status:400,headers});
  const dedupeId=eventId||type+':'+snagId+':'+Date.now(),dedupeKey=NOTIFICATION_PREFIX+'projects/'+projectId+'/events/'+encodeURIComponent(dedupeId)+'.json';
  if(await r2JSON(env,dedupeKey))return Response.json({ok:true,duplicate:true,eventId:dedupeId},{headers});
  let snag;try{snag=await firestoreDoc('snag_projects/'+encodeURIComponent(projectId)+'/snags/'+encodeURIComponent(snagId),identity,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}
  const participants=Array.isArray(docValue(snag,'participantUids'))?docValue(snag,'participantUids'):[],recipients=[...new Set([ownerUid,...participants].filter(Boolean))].filter(uid=>uid!==identity.uid);
  const text=notificationEventText(type,snag),notificationBase={version:1,id:crypto.randomUUID(),type,app:'snag',projectId,snagId,actorUid:identity.uid,title:text.title,body:text.body,url:String(body.url||'').slice(0,600),createdAt:new Date().toISOString()};
  const policy=await notificationPolicy(projectId,ownerUid,env),deliveries=[];
  for(const uid of recipients){
   const prefs=await notificationPreferences(projectId,uid,null,env),member={uid,role:uid===ownerUid?'owner':String(prefs.role||'member')},effective=effectiveNotification(policy,prefs,member,type);
   if(!effective.eventAllowed||setting(prefs.events,type,true)===false)continue;
   const notification={...notificationBase,id:crypto.randomUUID(),recipientUid:uid,unread:true};
   if(effective.channels.in_app){await putR2JSON(env,NOTIFICATION_PREFIX+'projects/'+projectId+'/inbox/'+uid+'/'+notification.id+'.json',notification);deliveries.push({uid,channel:'in_app',ok:true,status:'stored'})}
   for(const [channel,enabled] of Object.entries(effective.channels)){
    if(channel==='in_app'||enabled!==true)continue;
    const result=await deliverSharedNotification(env,channel,notification,prefs.destinations||{});
    deliveries.push({uid,...result});
   }
  }
  await putR2JSON(env,dedupeKey,{version:1,eventId:dedupeId,type,snagId,actorUid:identity.uid,recipients,deliveries,createdAt:notificationBase.createdAt});
  return Response.json({ok:true,eventId:dedupeId,recipientCount:recipients.length,deliveries},{headers});
 }

 return new Response('Not found',{status:404,headers});
}
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||''),validDevice=x=>/^[A-Za-z0-9._-]{8,100}$/.test(x||'');
function mergeUsage(target,out){out.version=3;out.targets??={};out.hours??={};out.buckets??={};for(const [key,t] of Object.entries(target?.targets||{})){const T=out.targets[key]??={project:t.project||'unknown',database:t.database||'(default)',apps:{}};for(const [app,a] of Object.entries(t.apps||{})){const A=T.apps[app]??={reads:0,writes:0,deletes:0,listeners:0,ops:{}};for(const n of ['reads','writes','deletes','listeners'])A[n]+=(Number(a[n])||0);for(const [op,o] of Object.entries(a.ops||{})){const O=A.ops[op]??={reads:0,writes:0,deletes:0,listeners:0};for(const n of ['reads','writes','deletes','listeners'])O[n]+=(Number(o[n])||0)}}}for(const [h,v] of Object.entries(target?.hours||{})){const H=out.hours[h]??={reads:0,writes:0,deletes:0};for(const n of ['reads','writes','deletes'])H[n]+=(Number(v[n])||0)}for(const [b,v] of Object.entries(target?.buckets||{})){const B=out.buckets[b]??={targets:{}};for(const [key,t] of Object.entries(v.targets||{})){const BT=B.targets[key]??={project:t.project||'unknown',database:t.database||'(default)',apps:{}};for(const [app,a] of Object.entries(t.apps||{})){const A=BT.apps[app]??={reads:0,writes:0,deletes:0,listeners:0,ops:{}};for(const n of ['reads','writes','deletes','listeners'])A[n]+=(Number(a[n])||0);for(const [op,o] of Object.entries(a.ops||{})){const O=A.ops[op]??={reads:0,writes:0,deletes:0,listeners:0};for(const n of ['reads','writes','deletes','listeners'])O[n]+=(Number(o[n])||0)}}}}return out}
async function usageRoute(request,env,headers,url){if(!allowedOrigin(request,env))return new Response('Forbidden origin',{status:403,headers});headers={...headers,'Cache-Control':'no-store'};if(url.pathname==='/usage/health')return Response.json({ok:true,service:'firebase-usage',build:WORKER_BUILD,storage:'r2-daily-snapshots'},{headers});if(url.pathname==='/usage/snapshot'&&request.method==='POST'){const len=Number(request.headers.get('Content-Length')||0);if(len>256*1024)return new Response('Payload too large',{status:413,headers});let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}if(!validDate(body.date)||!validDevice(body.deviceId)||![2,3].includes(body.version))return new Response('Invalid snapshot',{status:400,headers});const snapshot={version:3,date:body.date,deviceId:body.deviceId,device:body.device||null,updatedAt:new Date().toISOString(),targets:body.targets||{},hours:body.hours||{},buckets:body.buckets||{}};await env.SNAG_MEDIA.put('_usage/v2/'+body.date+'/'+body.deviceId+'.json',JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});return Response.json({ok:true,date:body.date,updatedAt:snapshot.updatedAt},{headers})}if(url.pathname==='/usage/day'&&request.method==='GET'){const date=url.searchParams.get('date');if(!validDate(date))return new Response('Invalid date',{status:400,headers});const prefix='_usage/v2/'+date+'/';let cursor,objects=[],truncated=true;while(truncated&&objects.length<1000){const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});objects.push(...page.objects);truncated=page.truncated;cursor=page.cursor}const aggregate={version:3,date,deviceCount:objects.length,targets:{},hours:{},buckets:{},devices:[]};for(const item of objects){const obj=await env.SNAG_MEDIA.get(item.key);if(!obj)continue;try{const snap=JSON.parse(await obj.text());aggregate.devices.push({deviceId:snap.deviceId,device:snap.device||null,updatedAt:snap.updatedAt,targets:snap.targets||{},hours:snap.hours||{},buckets:snap.buckets||{}});mergeUsage(snap,aggregate)}catch{}}aggregate.generatedAt=new Date().toISOString();return Response.json(aggregate,{headers})}return new Response('Not found',{status:404,headers})}
const plans={home_project:{name:'Home Project',mode:'payment',amount:3499,currency:'gbp'},pro:{name:'Snag Pro',mode:'subscription',amount:1200,currency:'gbp',interval:'month'}};
const entitlementKey=projectId=>'_billing/projects/'+projectId+'.json',accountEntitlementKey=accountId=>'_billing/accounts/'+accountId+'.json';
async function readEntitlement(projectId,env){const o=await env.SNAG_MEDIA.get(entitlementKey(projectId));if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function saveEntitlement(projectId,data,env){const value={...data,projectId,updatedAt:new Date().toISOString()};await env.SNAG_MEDIA.put(entitlementKey(projectId),JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});return value}
async function readAccountEntitlement(accountId,env){if(!accountId)return null;const o=await env.SNAG_MEDIA.get(accountEntitlementKey(accountId));if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function saveAccountEntitlement(accountId,data,env){if(!accountId)return null;const value={...data,accountId,updatedAt:new Date().toISOString()};await env.SNAG_MEDIA.put(accountEntitlementKey(accountId),JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});return value}
function hex(bytes){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function validStripeSignature(raw,header,secret){
  if(!secret||!header)return false;const parts=Object.fromEntries(header.split(',').map(x=>x.split('=',2))),t=parts.t,v1=parts.v1;if(!t||!v1)return false;
  if(Math.abs(Date.now()/1000-Number(t))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw));return hex(sig)===v1;
}
async function stripeWebhook(request,env,headers){
  if(!env.STRIPE_WEBHOOK_SECRET)return new Response('Stripe webhook is not configured',{status:503,headers});
  const raw=await request.text(),ok=await validStripeSignature(raw,request.headers.get('Stripe-Signature')||'',env.STRIPE_WEBHOOK_SECRET);if(!ok)return new Response('Invalid signature',{status:400,headers});
  let event;try{event=JSON.parse(raw)}catch{return new Response('Invalid JSON',{status:400,headers})}
  const obj=event.data?.object||{},meta=obj.metadata||{},projectId=meta.projectId,accountId=meta.accountId;
  if(event.type==='checkout.session.completed'&&projectId){
    const data={status:obj.mode==='subscription'?'active':'paid',plan:meta.planId||'home_project',uid:meta.uid||'',stripeCheckoutSessionId:obj.id,stripeCustomerId:obj.customer||'',stripeSubscriptionId:obj.subscription||'',source:'webhook'};
    await saveEntitlement(projectId,data,env);if(data.plan==='pro'&&accountId)await saveAccountEntitlement(accountId,data,env);
  }else if((event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted')&&projectId){
    const active=['active','trialing'].includes(obj.status),data={status:active?'active':obj.status,plan:meta.planId||'pro',uid:meta.uid||'',stripeCustomerId:obj.customer||'',stripeSubscriptionId:obj.id,source:'webhook'};
    await saveEntitlement(projectId,data,env);if(accountId)await saveAccountEntitlement(accountId,data,env);
  }
  return Response.json({received:true},{headers});
}
async function stripe(path,env,{method='GET',body}={}){if(!env.STRIPE_SECRET_KEY)throw new Response('Payments are not configured yet',{status:503});const headers={Authorization:'Bearer '+env.STRIPE_SECRET_KEY};if(body)headers['Content-Type']='application/x-www-form-urlencoded';const r=await fetch('https://api.stripe.com/v1'+path,{method,headers,body});const data=await r.json();if(!r.ok)throw new Response(data?.error?.message||'Stripe request failed',{status:r.status});return data}
async function patchBilling(projectId,identity,env,values){const fields={},masks=[];for(const [k,v] of Object.entries(values)){masks.push('updateMask.fieldPaths='+encodeURIComponent(k));fields[k]=typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)}}const r=await fetch(fsBase(env)+'/snag_projects/'+encodeURIComponent(projectId)+'?'+masks.join('&'),{method:'PATCH',headers:{Authorization:'Bearer '+identity.token,'Content-Type':'application/json'},body:JSON.stringify({fields})});if(!r.ok)throw new Response('Could not save billing entitlement',{status:r.status});return r.json()}
async function billingRoute(request,env,headers,url){let identity;try{identity=await firebaseIdentity(request,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}const projectId=url.searchParams.get('projectId');if(url.pathname==='/billing/entitlement'&&request.method==='GET'){if(!projectId)return new Response('projectId required',{status:400,headers});let doc;try{doc=await projectAccess(projectId,identity,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}let status=field(doc,'billingStatus')||'free',plan=field(doc,'billingPlan')||'free',subscriptionId=field(doc,'stripeSubscriptionId'),accountId=field(doc,'accountId')||'';const entitlement=await readEntitlement(projectId,env),accountEntitlement=await readAccountEntitlement(accountId,env);if(entitlement){status=entitlement.status||status;plan=entitlement.plan||plan;subscriptionId=entitlement.stripeSubscriptionId||subscriptionId}if(accountEntitlement?.plan==='pro'){status=accountEntitlement.status||status;plan='pro';subscriptionId=accountEntitlement.stripeSubscriptionId||subscriptionId}if(subscriptionId&&env.STRIPE_SECRET_KEY){try{const sub=await stripe('/subscriptions/'+encodeURIComponent(subscriptionId),env);status=['active','trialing'].includes(sub.status)?'active':sub.status}catch{}}return Response.json({ok:true,projectId,status,plan,paid:['paid','active','legacy'].includes(status),stripeConfigured:!!env.STRIPE_SECRET_KEY,webhookConfigured:!!env.STRIPE_WEBHOOK_SECRET},{headers:{...headers,'Cache-Control':'no-store'}})}if(url.pathname==='/billing/checkout'&&request.method==='POST'){let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}const plan=plans[body.planId],pid=body.projectId;if(!plan||!pid)return new Response('Invalid plan or project',{status:400,headers});let pdoc;try{pdoc=await projectAccess(pid,identity,env,{owner:true})}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}const accountId=field(pdoc,'accountId')||'';const base=String(body.returnUrl||'').startsWith('https://')?body.returnUrl:(env.ALLOWED_ORIGIN||'https://nirav2000.github.io')+'/snag/',sep=base.includes('?')?'&':'?',form=new URLSearchParams();form.set('mode',plan.mode);form.set('success_url',base+sep+'checkout=success&session_id={CHECKOUT_SESSION_ID}');form.set('cancel_url',base+sep+'checkout=cancel');form.set('line_items[0][quantity]','1');form.set('line_items[0][price_data][currency]',plan.currency);form.set('line_items[0][price_data][unit_amount]',String(plan.amount));form.set('line_items[0][price_data][product_data][name]','Snag · '+plan.name);if(plan.interval){form.set('line_items[0][price_data][recurring][interval]',plan.interval);form.set('subscription_data[metadata][projectId]',pid);form.set('subscription_data[metadata][uid]',identity.uid);form.set('subscription_data[metadata][planId]',body.planId);if(accountId)form.set('subscription_data[metadata][accountId]',accountId)}form.set('metadata[projectId]',pid);form.set('metadata[uid]',identity.uid);form.set('metadata[planId]',body.planId);if(accountId)form.set('metadata[accountId]',accountId);if(identity.user.email)form.set('customer_email',identity.user.email);try{const session=await stripe('/checkout/sessions',env,{method:'POST',body:form});return Response.json({ok:true,url:session.url,sessionId:session.id},{headers})}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}}if(url.pathname==='/billing/verify'&&request.method==='POST'){let body;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400,headers})}if(!body.projectId||!body.sessionId)return new Response('Missing verification data',{status:400,headers});try{await projectAccess(body.projectId,identity,env,{owner:true});const session=await stripe('/checkout/sessions/'+encodeURIComponent(body.sessionId),env);if(session.metadata?.projectId!==body.projectId||session.metadata?.uid!==identity.uid)throw new Response('Checkout does not belong to this project',{status:403});const good=session.payment_status==='paid'||(session.mode==='subscription'&&session.status==='complete');if(!good)throw new Response('Payment is not complete',{status:409});const values={billingStatus:session.mode==='subscription'?'active':'paid',billingPlan:session.metadata?.planId||'home_project',stripeCheckoutSessionId:session.id,billingUpdatedAt:new Date().toISOString()};if(session.customer)values.stripeCustomerId=session.customer;if(session.subscription)values.stripeSubscriptionId=session.subscription;await patchBilling(body.projectId,identity,env,values);const entitlementData={status:values.billingStatus,plan:values.billingPlan,uid:identity.uid,stripeCheckoutSessionId:session.id,stripeCustomerId:session.customer||'',stripeSubscriptionId:session.subscription||'',source:'return-verify'},pdoc=await projectAccess(body.projectId,identity,env,{owner:true}),accountId=field(pdoc,'accountId')||'';await saveEntitlement(body.projectId,entitlementData,env);if(values.billingPlan==='pro'&&accountId)await saveAccountEntitlement(accountId,entitlementData,env);return Response.json({ok:true,...values},{headers})}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}}return new Response('Not found',{status:404,headers})}
export default{async fetch(request,env){const origin=request.headers.get('Origin')||'',headers=cors(origin,env.ALLOWED_ORIGIN||'https://nirav2000.github.io');if(request.method==='OPTIONS')return new Response(null,{status:204,headers});const url=new URL(request.url),prefix='/objects/';if(url.pathname.startsWith('/usage/'))return usageRoute(request,env,headers,url);if(url.pathname.startsWith('/notifications/'))return notificationRoute(request,env,headers,url);if(url.pathname==='/billing/webhook'&&request.method==='POST')return stripeWebhook(request,env,headers);if(url.pathname.startsWith('/billing/'))return billingRoute(request,env,headers,url);if(url.pathname.startsWith('/projects/')&&url.pathname.endsWith('/media')&&request.method==='DELETE'){const parts=url.pathname.split('/').filter(Boolean),projectId=parts[1];try{const identity=await firebaseIdentity(request,env);await projectAccess(projectId,identity,env,{owner:true});const prefix='snag-projects/'+projectId+'/';let cursor,removed=0,truncated=true;while(truncated){const page=await env.SNAG_MEDIA.list({prefix,cursor,limit:1000});if(page.objects.length){await env.SNAG_MEDIA.delete(page.objects.map(x=>x.key));removed+=page.objects.length}truncated=page.truncated;cursor=page.cursor}return Response.json({ok:true,projectId,removed},{headers})}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}}if(url.pathname==='/health')return Response.json({ok:true,service:'snag-media-api',build:WORKER_BUILD,r2Bound:!!env.SNAG_MEDIA,usageTelemetry:true,appMonitor:false,notifications:true,notificationBridgeConfigured:!!env.APPS_NOTIFICATION_INGEST_KEY,stripeConfigured:!!env.STRIPE_SECRET_KEY,stripeWebhookConfigured:!!env.STRIPE_WEBHOOK_SECRET,privateMedia:'v2'},{headers});if(!url.pathname.startsWith(prefix))return new Response('Not found',{status:404,headers});const key=url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');if(!key||key.includes('..'))return new Response('Bad key',{status:400,headers});const projectId=projectFromKey(key);if(!projectId)return new Response('Bad project key',{status:400,headers});if(request.method==='PUT'){try{const identity=await firebaseIdentity(request,env);await projectAccess(projectId,identity,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}const length=Number(request.headers.get('Content-Length')||0);if(length>50*1024*1024)return new Response('File too large',{status:413,headers});await env.SNAG_MEDIA.put(key,request.body,{httpMetadata:{contentType:request.headers.get('Content-Type')||'application/octet-stream'},customMetadata:{access:'private-v2',projectId}});return Response.json({key,url:url.origin+'/objects/'+key.split('/').map(encodeURIComponent).join('/'),private:true},{headers})}if(request.method==='GET'){const obj=await env.SNAG_MEDIA.get(key);if(!obj)return new Response('Not found',{status:404,headers});if(obj.customMetadata?.access==='private-v2'){try{const identity=await firebaseIdentity(request,env);await objectReadAccess(key,identity,env)}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}}const h=new Headers(headers);obj.writeHttpMetadata(h);h.set('etag',obj.httpEtag);h.set('Cache-Control',obj.customMetadata?.access==='private-v2'?'private, max-age=300':'public, max-age=86400');return new Response(obj.body,{headers:h})}if(request.method==='DELETE'){try{const identity=await firebaseIdentity(request,env);await projectAccess(projectId,identity,env,{owner:true});await env.SNAG_MEDIA.delete(key);return Response.json({ok:true,key},{headers})}catch(e){if(e instanceof Response)return new Response(await e.text(),{status:e.status,headers});throw e}}return new Response('Method not allowed',{status:405,headers})}};