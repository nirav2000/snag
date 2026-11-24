/* Warranty Ease — private owner-authenticated R2 records and evidence; legacy encrypted archives retained.
   Website login secrets remain separately encrypted. No archive passphrases are transmitted.
   Firebase kk-syllabus ID tokens are verified against Google's JWKs.
   Existing App Monitor passkey sessions are verified by the dedicated App Monitor Worker;
   this Worker never deploys, modifies or stores the shared passkey service.
   No destructive delete endpoint; legacy backups and content-addressed evidence are retained. */
const ALLOWED_ORIGIN='https://nirav2000.github.io';
const OWNER='2AJSfYdtg5URWHv7HCzpNMmKIlg2';
const PROJECT='kk-syllabus';
const SYNC_PREFIX=`warranty-ease/v2/${OWNER}/`;
const MIGRATION_KEY=SYNC_PREFIX+'migration.json';
const JWK_ENDPOINT='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PASSKEY_SESSION_URL='https://apps-monitor-api.nirav2000-github.workers.dev/app-monitor/auth/session';
const LIMIT=30*1024*1024;
const PART_LIMIT=12*1024*1024, MAX_PARTS=12, MAX_TOTAL=PART_LIMIT*MAX_PARTS;
const encoder=new TextEncoder();
let jwks=null,jwksExpiry=0;
function cors(origin){return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(origin===ALLOWED_ORIGIN?{'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'GET,HEAD,PUT,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,X-App-Monitor-Session,Content-Type,X-Warranty-Digest,X-Warranty-Legacy-Head,If-Match,If-None-Match','Access-Control-Expose-Headers':'X-Warranty-Digest,X-Warranty-Format,ETag','Access-Control-Max-Age':'1200'}:{})};}
function json(value,status=200,origin=''){return new Response(JSON.stringify(value),{status,headers:cors(origin)});}
function decodeUrlBase64(value){const b64=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}
async function verifyFirebase(token){
  const parts=token.split('.');if(parts.length!==3)throw new Error('token');
  const header=JSON.parse(new TextDecoder().decode(decodeUrlBase64(parts[0])));
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error('algorithm');
  const payload=JSON.parse(new TextDecoder().decode(decodeUrlBase64(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(payload.aud!==PROJECT||payload.iss!==`https://securetoken.google.com/${PROJECT}`||payload.sub!==OWNER||
     payload.user_id&&payload.user_id!==OWNER||payload.exp<=now||payload.iat>now+60||payload.iat>payload.exp||!payload.sub){throw new Error('identity');}
  if(!jwks||Date.now()>jwksExpiry){
    const response=await fetch(JWK_ENDPOINT,{cache:'no-store'});
    if(!response.ok)throw new Error('jwk-unavailable');
    const body=await response.json();
    if(!Array.isArray(body.keys)||body.keys.length<1)throw new Error('jwk-invalid');
    jwks=body.keys;jwksExpiry=Date.now()+45*60*1000;
  }
  const jwk=jwks.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig');
  if(!jwk)throw new Error('key-unknown');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeUrlBase64(parts[2]),encoder.encode(parts[0]+'.'+parts[1]));
  if(!valid)throw new Error('signature');
  return payload.sub;
}
async function verifyPasskeySession(session,env){
  // Session tokens are opaque capabilities, not Firebase IDs; only App Monitor
  // may confirm they were issued following a hardware/user-verified WebAuthn login.
  if(!/^[A-Za-z0-9._-]{32,160}$/.test(session||''))throw Error('invalid-passkey-session');
  if(!env.APP_MONITOR_AUTH||typeof env.APP_MONITOR_AUTH.fetch!=='function')throw Error('shared-auth-service-binding-missing');
  // Use an account-internal Service Binding. Public workers.dev fetch calls
  // between two Workers on the same zone can return 404/1042 even when healthy.
  const response=await env.APP_MONITOR_AUTH.fetch(new Request(PASSKEY_SESSION_URL,{method:'GET',
    headers:{'X-App-Monitor-Session':session,'Origin':ALLOWED_ORIGIN,'Accept':'application/json'},
    cache:'no-store',redirect:'manual'}));
  if(!response.ok)throw Error('passkey-session-unverified');
  const body=await response.json();
  if(body?.ok!==true||body?.method!=='passkey'||
     !body?.expiresAt||Date.parse(body.expiresAt)<=Date.now())throw Error('passkey-not-authorised');
  return OWNER;
}

// Publicly documented product catalogue. Never accept a caller-supplied fetch URL:
// fixed HTTPS endpoints avoid SSRF and restrict retrieval to model-matched photos.
const MANUFACTURER_PHOTOS=Object.freeze({
 'lg-f4y511wwla1':'https://www.lg.com/content/dam/channel/wcms/uk/images/washing-machines/f4y511wwla1/gallery/1100x730/1100-730_01_Vivace_R350_11kg_White_F4Y3EBP0W_UK_Front.jpg',
 'lg-rhx1009nwk':"https://www.lg.com/content/dam/channel/wcms/nl/1--huishoudelijke-producten-nieuw/stella%27s-stuff/dryers/rhx1009nwk/rhx1009nwk/rhx1009nwk-2010x1334_V2.jpg/jcr%3Acontent/renditions/thum-1600x1062.jpeg",
 'tcl-65c8l':'https://aws-obg-image-lb-1.tcl.com/content/dam/brandsite/region/hr/product/tv/c8l/tcl-65-c8l-hero-front-olympic.png?t=1781059223473&w=800'
});
const MAX_MANUFACTURER_PHOTO_BYTES=8*1024*1024;
async function fetchManufacturerPhoto(id,origin){
 const url=MANUFACTURER_PHOTOS[id];if(!url)return err('No verified manufacturer image for this model',404,origin);
 // This is an owner-only on-demand retrieval for personal reference, never a
 // public rebroadcast, and never authentication or a claim-evidence photograph.
 let response;
 try{response=await fetch(url,{redirect:'manual',headers:{Accept:'image/jpeg,image/png,image/webp'}});}
 catch(_){return err('Manufacturer image temporarily unavailable',502,origin);}
 if(!response.ok)return err('Manufacturer image temporarily unavailable',502,origin);
 const len=Number(response.headers.get('Content-Length')||0);
 if(len>MAX_MANUFACTURER_PHOTO_BYTES)return err('Manufacturer image exceeds supported size',413,origin);
 const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 if(!['image/jpeg','image/png','image/webp'].includes(mime))return err('Manufacturer did not provide a supported image',415,origin);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(!bytes.length||bytes.length>MAX_MANUFACTURER_PHOTO_BYTES)return err('Manufacturer image exceeds supported size',413,origin);
 const valid=mime==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
  mime==='image/png'?bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:
  bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!valid)return err('Manufacturer image format validation failed',415,origin);
 return new Response(bytes,{status:200,headers:{...cors(origin),'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}

const archiveIdValid=id=>/^[A-Za-z0-9-]{5,80}$/.test(id||'');
function objectPath(id){return `warranty-ease/v1/${OWNER}/archives/${id}.encrypted`;}
function manifestPath(id){return `warranty-ease/v1/${OWNER}/archives/${id}.manifest.json`;}
function partPath(id,index){return `warranty-ease/v1/${OWNER}/parts/${id}/${String(index).padStart(3,'0')}.encrypted`;}
function sha256Hex(bytes){return crypto.subtle.digest('SHA-256',bytes).then(h=>Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join(''));}
function err(message,status,origin){return json({error:message},status,origin);}

// R2 listing and object reads are strongly consistent. A migration marker is
// written only after the client has reconciled all initial records.
async function legacyBackups(store){
 const prefix=`warranty-ease/v1/${OWNER}/archives/`;
 const backups=[];let cursor;
 do{
  const page=await store.list({prefix,cursor,limit:1000,include:['customMetadata']});
  for(const x of page.objects){
   const file=x.key.slice(prefix.length),chunked=file.endsWith('.manifest.json');
   if(!chunked&&!file.endsWith('.encrypted'))continue;
   const id=file.slice(0,-(chunked?'.manifest.json'.length:'.encrypted'.length));
   if(!archiveIdValid(id))continue;
   backups.push({id,created:x.uploaded?.toISOString?.()||'',size:chunked?Number(x.customMetadata?.bytes)||0:x.size||0,sha256:x.customMetadata?.sha256||'',format:chunked?'chunked':'single'});
  }
  if(page.truncated&&(!page.cursor||page.cursor===cursor))throw Error('Incomplete legacy archive listing');
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 return backups.sort((a,b)=>b.created.localeCompare(a.created)||b.id.localeCompare(a.id));
}

async function incremental(request,env,url,origin){
 const store=env.WARRANTY_STORE,prefix=SYNC_PREFIX;
 if(url.pathname==='/v2/migration'){
  const saved=await store.get(MIGRATION_KEY);
  const completed=saved?JSON.parse(await new Response(saved.body).text()):null;
  if(request.method==='GET')return json({completed},200,origin);
  if(request.method!=='PUT')return err('Method not allowed',405,origin);
  if(completed)return json({completed},200,origin);
  const legacyHead=request.headers.get('X-Warranty-Legacy-Head');
  if(legacyHead===null||legacyHead&&!archiveIdValid(legacyHead))return err('Invalid legacy archive reference',400,origin);
  const backups=await legacyBackups(store);
  if((backups[0]?.id||'')!==legacyHead)return err('Legacy archive changed during migration',409,origin);
  const migration={legacyHead,completedAt:new Date().toISOString()};
  const result=await store.put(MIGRATION_KEY,JSON.stringify(migration),{onlyIf:{etagDoesNotMatch:'*'}});
  if(!result)return err('Migration already completed concurrently',409,origin);
  return json({completed:migration},200,origin);
 }
 const validRecordId=id=>/^(?:[al]-[a-zA-Z0-9_-]{1,100}|vault)$/.test(id);
 const digestValid=id=>/^[a-f0-9]{64}$/.test(id);
 const m=url.pathname.match(/^\/v2\/(records|files)\/([a-zA-Z0-9_-]{1,110})$/);
 if(url.pathname==='/v2/records'&&request.method==='GET'){
  const objects=[];let cursor;
  do{const page=await store.list({prefix:prefix+'records/',cursor,limit:1000});objects.push(...page.objects.map(o=>({id:o.key.split('/').pop(),etag:o.etag})));if(page.truncated&&(!page.cursor||page.cursor===cursor))throw Error('Incomplete record listing');cursor=page.truncated?page.cursor:undefined;}while(cursor);
  return json({records:objects},200,origin);
 }
 if(!m)return err('Not found',404,origin);
 const [,kind,id]=m;if(kind==='files'?!digestValid(id):!validRecordId(id))return err('Invalid identifier',400,origin);
 const key=prefix+kind+'/'+id;
 if(request.method==='HEAD'&&kind==='files'){
  const obj=await store.head(key);return new Response(null,{status:obj?200:404,headers:cors(origin)});
 }
 if(request.method==='GET'){
  const obj=await store.get(key);if(!obj)return err('Not found',404,origin);
  return new Response(obj.body,{headers:{...cors(origin),'Content-Type':kind==='records'?'application/json':'application/octet-stream','ETag':obj.httpEtag,'X-Content-Type-Options':'nosniff'}});
 }
 if(request.method!=='PUT')return err('Method not allowed',405,origin);
 const limit=kind==='records'?1024*1024:LIMIT;
 const reader=request.body?.getReader();if(!reader)return err('Missing body',400,origin);
 const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();return err('Too large',413,origin);}chunks.push(value);}}
 catch{return err('Incomplete upload',400,origin);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(kind==='files'){
  if(!total||await sha256Hex(bytes)!==id)return err('Digest mismatch',400,origin);
  await store.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'}});
  return json({ok:true},200,origin);
 }
 let record;try{record=JSON.parse(new TextDecoder().decode(bytes));}catch{return err('Invalid JSON',400,origin);}
 if(!record||record.id!==id||record.version!==2||!['appliance','account','vault'].includes(record.kind)||record.kind!==(id==='vault'?'vault':id.startsWith('a-')?'appliance':'account')||typeof record.deleted!=='boolean')return err('Invalid record',400,origin);
 if(record.deleted){if(record.kind==='vault'||!Number.isFinite(Date.parse(record.deletedAt))||record.value!==null)return err('Invalid tombstone',400,origin);}
 else{
  const value=record.value;if(!value||typeof value!=='object'||value.id!==(id==='vault'?'vault':id.slice(2)))return err('Invalid record value',400,origin);
  if(record.kind==='account'&&(!value.secretBlob?.iv||!value.secretBlob?.ciphertext))return err('Encrypted login required',400,origin);
  if(record.kind==='vault'&&(!value.salt||!value.check?.ciphertext))return err('Invalid vault',400,origin);
  if(record.kind==='appliance'){
   if(!Array.isArray(value.files)||value.files.length>250||new Set(value.files.map(f=>f?.id)).size!==value.files.length||value.files.some(f=>!f||typeof f.id!=='string'||!f.id||!digestValid(f.originalHash)||f.previewHash&&!digestValid(f.previewHash)||'blob'in f||'previewBlob'in f||'originalBytes'in f||'previewBytes'in f))return err('Invalid attachments',400,origin);
   for(const hash of new Set(value.files.flatMap(f=>[f.originalHash,f.previewHash]).filter(Boolean))){
    if(!await store.head(prefix+'files/'+hash))return err('Missing attachment',409,origin);
   }
  }
 }
 const match=request.headers.get('If-Match'),create=request.headers.get('If-None-Match')==='*';
 if((!match&&!create)||(match&&create)||match&&!/^[a-fA-F0-9]{32,64}$/.test(match.replace(/^"|"$/g,'')))return err('Revision required',428,origin);
 const result=await store.put(key,bytes,{onlyIf:create?{etagDoesNotMatch:'*'}:{etagMatches:match.replace(/^"|"$/g,'')}});
 if(!result)return err('Revision conflict',412,origin);
 return json({ok:true,etag:result.etag},200,origin);
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'';
    if(origin&&origin!==ALLOWED_ORIGIN)return err('Origin not permitted',403,origin);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
    const url=new URL(request.url);
    if(url.pathname==='/v1/health'&&request.method==='GET'){
      const passkeyBindingReady=typeof env.APP_MONITOR_AUTH?.fetch==='function';
      let authServiceReachable,authServiceHttpStatus=0,authServiceErrorType='';
      // Prove the internal Worker-to-Worker binding without accepting a session
      // or accessing any warranty data; only on an explicit diagnostic request.
      if(url.searchParams.get('checkAuth')==='1'){
        authServiceReachable=false;
        if(passkeyBindingReady){
          try{
            const response=await env.APP_MONITOR_AUTH.fetch(new Request(
              'https://apps-monitor-api.nirav2000-github.workers.dev/health',
              {method:'GET',cache:'no-store',redirect:'manual'}
            ));
            authServiceHttpStatus=response.status;
            if(response.ok){
              const data=await response.json();
              authServiceReachable=data?.ok===true&&data?.service==='apps-monitor-api'&&data?.r2Bound===true;
            }
          }catch(error){authServiceErrorType=(String(error?.name||'FetchError')+': '+String(error?.message||'').replace(/[A-Za-z0-9._-]{40,}/g,'[redacted]')).slice(0,180); /* diagnostic contains no request headers or bodies */ }
        }
      }
      return json({ok:true,service:'warranty-ease-api',schema:2,incrementalSync:true,passkeyBindingReady,
        ...(authServiceReachable===undefined?{}:{authServiceReachable,authServiceHttpStatus,authServiceErrorType})},200,origin);
    }
    if(!url.pathname.startsWith('/v1/backups')&&!url.pathname.startsWith('/v1/product-photos/')&&!url.pathname.startsWith('/v2/'))return err('Not found',404,origin);
    const raw=request.headers.get('Authorization')||'';
    const session=request.headers.get('X-App-Monitor-Session')||'';
    if(!raw.startsWith('Bearer ')&&!session)return err('Sign-in required',401,origin);
    try{
      if(raw.startsWith('Bearer '))await verifyFirebase(raw.slice(7));
      else await verifyPasskeySession(session,env);
    }catch(_){return err('Invalid or expired owner sign-in',401,origin);}
    if(url.pathname.startsWith('/v1/product-photos/')){if(request.method!=='GET')return err('Method not allowed',405,origin);const id=url.pathname.slice('/v1/product-photos/'.length);return fetchManufacturerPhoto(id,origin);}
    if(!env.WARRANTY_STORE)return err('Private storage not configured',503,origin);
    if(url.pathname.startsWith('/v2/')){
      try{return await incremental(request,env,url,origin);}
      catch{return err('Private incremental storage is temporarily unavailable',503,origin);}
    }
    if(url.pathname==='/v1/backups'&&request.method==='GET'){
      const backups=await legacyBackups(env.WARRANTY_STORE);
      const offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0)return err('Invalid archive offset',400,origin);
      const nextOffset=offset+100<backups.length?offset+100:null;
      return json({backups:backups.slice(offset,offset+100),truncated:false,backupsCount:backups.length,nextOffset},200,origin);
    }
    if(['PUT','POST'].includes(request.method)&&await env.WARRANTY_STORE.head(MIGRATION_KEY)){
      return err('Legacy archive sync has ended. Update Warranty Ease to sync this device’s saved changes.',409,origin);
    }
    // Immutable, encrypted fragment transfer. Fragments belong to an archive ID and are
    // invisible to list/restore until its final manifest is safely committed.
    const partMatch=url.pathname.match(/^\/v1\/backups\/([A-Za-z0-9-]{5,80})\/parts\/([0-9]{1,2})$/);
    if(partMatch){
      const id=partMatch[1],index=Number(partMatch[2]);
      if(index>=MAX_PARTS||String(index)!==partMatch[2])return err('Invalid part index',400,origin);
      const path=partPath(id,index);
      if(request.method==='PUT'){
        if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/octet-stream')return err('Encrypted fragment required',415,origin);
        if(await env.WARRANTY_STORE.head(objectPath(id))||await env.WARRANTY_STORE.head(manifestPath(id))||await env.WARRANTY_STORE.head(path))return err('Encrypted snapshot/part already exists',409,origin);
        const part=await request.arrayBuffer();
        if(!part.byteLength||part.byteLength>PART_LIMIT)return err('Fragment exceeds safe maximum',413,origin);
        if(index===0&&new TextDecoder().decode(new Uint8Array(part).slice(0,8))!=='WEASE02!')return err('Expected encrypted Warranty Ease archive',400,origin);
        const sha=await sha256Hex(part);
        if(sha!==request.headers.get('X-Warranty-Digest'))return err('Fragment checksum mismatch',400,origin);
        await env.WARRANTY_STORE.put(path,part,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:sha,part:String(index)}});
        return json({ok:true,id,index,bytes:part.byteLength,sha256:sha},201,origin);
      }
      if(request.method==='GET'){
        const obj=await env.WARRANTY_STORE.get(path);
        if(!obj)return err('Encrypted fragment not found',404,origin);
        return new Response(obj.body,{status:200,headers:{...cors(origin),'Content-Type':'application/octet-stream','X-Warranty-Digest':obj.customMetadata?.sha256||''}});
      }
      return err('Method not allowed',405,origin);
    }
    const complete=url.pathname.match(/^\/v1\/backups\/([A-Za-z0-9-]{5,80})\/complete$/);
    if(complete){
      if(request.method!=='POST')return err('Method not allowed',405,origin);
      const id=complete[1];
      if(await env.WARRANTY_STORE.head(objectPath(id))||await env.WARRANTY_STORE.head(manifestPath(id)))return err('Archive already completed',409,origin);
      const data=await request.json().catch(()=>null);
      if(data?.kind!=='chunked'||data.id!==id||!/^[0-9a-f]{64}$/.test(data.sha256||'')||!Array.isArray(data.parts)||data.parts.length<1||data.parts.length>MAX_PARTS||!Number.isSafeInteger(data.bytes)||data.bytes<49||data.bytes>MAX_TOTAL)return err('Invalid encrypted archive manifest',400,origin);
      let total=0;
      for(let i=0;i<data.parts.length;i++){
        const p=data.parts[i];
        if(!p||p.index!==i||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>PART_LIMIT||!/^[0-9a-f]{64}$/.test(p.sha256||''))return err('Invalid fragment descriptor',400,origin);
        const stored=await env.WARRANTY_STORE.head(partPath(id,i));
        if(!stored||stored.size!==p.bytes||stored.customMetadata?.sha256!==p.sha256)return err('Encrypted archive fragment missing or corrupted',409,origin);
        total+=p.bytes;
      }
      if(total!==data.bytes)return err('Encrypted archive length mismatch',400,origin);
      const payload=JSON.stringify({kind:'chunked',id,sha256:data.sha256,bytes:data.bytes,parts:data.parts});
      await env.WARRANTY_STORE.put(manifestPath(id),encoder.encode(payload),{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:data.sha256,bytes:String(data.bytes),schema:'3'}});
      return json({ok:true,id,format:'chunked',bytes:data.bytes,sha256:data.sha256},201,origin);
    }
    const match=url.pathname.match(/^\/v1\/backups\/([A-Za-z0-9-]{5,80})$/);
    if(!match)return err('Not found',404,origin);
    const id=match[1],path=objectPath(id);
    if(request.method==='PUT'){
      if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/octet-stream')return err('Encrypted binary required',415,origin);
      const length=Number(request.headers.get('Content-Length'));
      if(Number.isFinite(length)&&length>LIMIT)return err('Encrypted archive too large',413,origin);
      if(await env.WARRANTY_STORE.head(path)||await env.WARRANTY_STORE.head(manifestPath(id)))return err('Archive identifier already exists; snapshots are append-only',409,origin);
      const payload=await request.arrayBuffer();
      if(!payload.byteLength||payload.byteLength>LIMIT)return err('Encrypted archive exceeds 30 MB',413,origin);
      const magic=new TextDecoder().decode(new Uint8Array(payload).slice(0,8));
      if(magic!=='WEASE02!')return err('Expected encrypted Warranty Ease archive',400,origin);
      const digest=await crypto.subtle.digest('SHA-256',payload);
      const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if(hex!==request.headers.get('X-Warranty-Digest'))return err('Archive checksum mismatch',400,origin);
      await env.WARRANTY_STORE.put(path,payload,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:hex,schema:'2'}});
      return json({ok:true,id,bytes:payload.byteLength,sha256:hex},201,origin);
    }
    if(request.method==='GET'){
      const obj=await env.WARRANTY_STORE.get(path);
      if(obj)return new Response(obj.body,{status:200,headers:{...cors(origin),'Content-Type':'application/octet-stream','X-Warranty-Digest':obj.customMetadata?.sha256||''}});
      const manifest=await env.WARRANTY_STORE.get(manifestPath(id));
      if(!manifest)return err('Snapshot not found',404,origin);
      return new Response(manifest.body,{status:200,headers:{...cors(origin),'Content-Type':'application/json; charset=utf-8','X-Warranty-Format':'chunked','X-Warranty-Digest':manifest.customMetadata?.sha256||''}});
    }
    return err('Method not allowed',405,origin);
  }
};