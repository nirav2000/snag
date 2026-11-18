/* Warranty Ease — Cloudflare R2 encrypted snapshot service.
   Never receives plaintext records, credentials, photos or archive passphrases.
   Firebase kk-syllabus ID tokens are verified against Google's JWKs.
   Existing App Monitor passkey sessions are verified by the dedicated App Monitor Worker;
   this Worker never deploys, modifies or stores the shared passkey service.
   No delete endpoint; backups are append-only. */
const ALLOWED_ORIGIN='https://nirav2000.github.io';
const OWNER='2AJSfYdtg5URWHv7HCzpNMmKIlg2';
const PROJECT='kk-syllabus';
const JWK_ENDPOINT='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PASSKEY_SESSION_URL='https://apps-monitor-api.nirav2000-github.workers.dev/app-monitor/auth/session';
const LIMIT=30*1024*1024;
const encoder=new TextEncoder();
let jwks=null,jwksExpiry=0;
function cors(origin){return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(origin===ALLOWED_ORIGIN?{'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'GET,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,X-App-Monitor-Session,Content-Type,X-Warranty-Digest','Access-Control-Max-Age':'1200'}:{})};}
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
const archiveIdValid=id=>/^[A-Za-z0-9-]{5,80}$/.test(id||'');
function objectPath(id){return `warranty-ease/v1/${OWNER}/archives/${id}.encrypted`;}
function err(message,status,origin){return json({error:message},status,origin);}
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
      return json({ok:true,service:'warranty-ease-api',schema:1,passkeyBindingReady,
        ...(authServiceReachable===undefined?{}:{authServiceReachable,authServiceHttpStatus,authServiceErrorType})},200,origin);
    }
    if(!url.pathname.startsWith('/v1/backups'))return err('Not found',404,origin);
    const raw=request.headers.get('Authorization')||'';
    const session=request.headers.get('X-App-Monitor-Session')||'';
    if(!raw.startsWith('Bearer ')&&!session)return err('Sign-in required',401,origin);
    try{
      if(raw.startsWith('Bearer '))await verifyFirebase(raw.slice(7));
      else await verifyPasskeySession(session,env);
    }catch(_){return err('Invalid or expired owner sign-in',401,origin);}
    if(!env.WARRANTY_STORE)return err('Private storage not configured',503,origin);
    if(url.pathname==='/v1/backups'&&request.method==='GET'){
      const prefix=`warranty-ease/v1/${OWNER}/archives/`;
      // R2 lists lexicographically by UUID, not time. Scanning one 100-item
      // page may hide the newest backup once an owner has accumulated >100.
      const objects=[];let cursor,truncated=false;
      for(let page=0;page<10;page++){
        const data=await env.WARRANTY_STORE.list({prefix,limit:1000,...(cursor?{cursor}:{})});
        objects.push(...data.objects);
        truncated=!!data.truncated;
        if(!truncated)break;
        if(!data.cursor)throw Error('R2 did not return a continuation cursor');
        cursor=data.cursor;
      }
      const backups=objects.map(x=>({id:x.key.slice(prefix.length).replace(/\.encrypted$/,''),created:x.uploaded?.toISOString?.()||'',size:x.size||0,sha256:x.customMetadata?.sha256||''})).filter(x=>archiveIdValid(x.id)).sort((a,b)=>b.created.localeCompare(a.created));
      return json({backups:backups.slice(0,100),truncated,backupsCount:objects.length},200,origin);
    }
    const match=url.pathname.match(/^\/v1\/backups\/([A-Za-z0-9-]{5,80})$/);
    if(!match)return err('Not found',404,origin);
    const id=match[1],path=objectPath(id);
    if(request.method==='PUT'){
      if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/octet-stream')return err('Encrypted binary required',415,origin);
      const length=Number(request.headers.get('Content-Length'));
      if(Number.isFinite(length)&&length>LIMIT)return err('Encrypted archive too large',413,origin);
      if(await env.WARRANTY_STORE.head(path))return err('Archive identifier already exists; snapshots are append-only',409,origin);
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
      if(!obj)return err('Snapshot not found',404,origin);
      return new Response(obj.body,{status:200,headers:{...cors(origin),'Content-Type':'application/octet-stream','X-Warranty-Digest':obj.customMetadata?.sha256||''}});
    }
    return err('Method not allowed',405,origin);
  }
};