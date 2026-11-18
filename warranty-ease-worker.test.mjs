import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const source=await import('./warranty-ease-worker.js');
const worker=source.default;
const owner='2AJSfYdtg5URWHv7HCzpNMmKIlg2';
const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);jwk.kid='test-key';jwk.use='sig';
const prevFetch=globalThis.fetch;
globalThis.fetch=async input=>String(input).includes('googleapis.com/service_accounts')?new Response(JSON.stringify({keys:[jwk]}),{status:200}):prevFetch(input);
const b64=b=>Buffer.from(typeof b==='string'?b:JSON.stringify(b)).toString('base64url');
async function jwt(user=owner){const now=Math.floor(Date.now()/1000);const h=b64({alg:'RS256',typ:'JWT',kid:'test-key'}),p=b64({aud:'kk-syllabus',iss:'https://securetoken.google.com/kk-syllabus',sub:user,user_id:user,iat:now,exp:now+3600});const unsigned=h+'.'+p;const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(unsigned));return unsigned+'.'+Buffer.from(sig).toString('base64url');}
const store=new Map();const env={WARRANTY_STORE:{head:async k=>store.get(k),put:async(k,data,meta)=>store.set(k,{body:data,size:data.byteLength,uploaded:new Date(),customMetadata:meta.customMetadata}),get:async k=>store.get(k),list:async({prefix})=>({objects:[...store].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,size:v.size,uploaded:v.uploaded,customMetadata:v.customMetadata})),truncated:false})}};
const root='https://warranty-ease-api.nirav2000-github.workers.dev/v1';
async function req(path,method='GET',token='',headers={},body){return worker.fetch(new Request(root+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),Origin:'https://nirav2000.github.io',...headers},body}),env);}
assert.equal((await req('/health')).status,200);
assert.equal((await req('/backups')).status,401);
const valid=await jwt();
let r=await req('/backups','GET',valid);assert.equal(r.status,200);assert.equal((await r.json()).backups.length,0);
const payload=new Uint8Array(80);payload.set(new TextEncoder().encode('WEASE02!'));crypto.getRandomValues(payload.subarray(8));
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',payload)).toString('hex');
r=await req('/backups/test-archive','PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':hash},payload);assert.equal(r.status,201,await r.text());
r=await req('/backups','GET',valid);assert.equal((await r.json()).backups.length,1);
r=await req('/backups/test-archive','GET',valid);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),payload);
r=await req('/backups/test-archive','PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':hash},payload);assert.equal(r.status,409);
assert.equal((await req('/backups','GET',await jwt('some-other-user'))).status,401);
console.log('Worker tests passed: owner JWT, encrypted PUT/GET/list, CORS, duplicate protection and unauthorised access denial');
const appSession='S'.repeat(48);
const recoverySession='R'.repeat(48);
const badSession='B'.repeat(48);
// Same-account Worker-to-Worker auth MUST use a Service Binding, never
// a public workers.dev fetch; Cloudflare can reject same-zone subrequests.
const fallbackFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 if(String(input).includes('/app-monitor/auth/session'))throw Error('Unsafe public Worker-to-Worker auth fetch');
 return fallbackFetch(input,options);
};
const expectedAuth='https://apps-monitor-api.nirav2000-github.workers.dev/app-monitor/auth/session';
let boundCalls=0;
env.APP_MONITOR_AUTH={fetch:async input=>{
 boundCalls++;
 assert.equal(input.redirect,'manual','Cloudflare Worker Service Bindings reject redirect:error; never forward credentials to a redirect');
 if(new URL(input.url).pathname==='/health')
   return Response.json({ok:true,service:'apps-monitor-api',r2Bound:true});
 assert.equal(new URL(input.url).toString(),expectedAuth,'Service Binding targets the shared session validation endpoint');
 assert.equal(input.method,'GET');
 assert.equal(input.headers.get('Origin'),'https://nirav2000.github.io');
 const session=input.headers.get('X-App-Monitor-Session');
 if(session===badSession)return new Response('Unauthorized',{status:401});
 const method=session===appSession?'passkey':'recovery';
 return Response.json({ok:true,method,expiresAt:new Date(Date.now()+300000).toISOString()});
}};
const authHealth=await req('/health?checkAuth=1');
assert.equal(authHealth.status,200);
const healthBody=await authHealth.json();
assert.equal(healthBody.passkeyBindingReady,true);
assert.equal(healthBody.authServiceReachable,true,'internal service binding must call the real auth Worker health route');
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':appSession})).status,200,'verified owner passkey may read encrypted backup list');
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':recoverySession})).status,401,'recovery-only session must fail');
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':badSession})).status,401,'unknown session must fail closed');
assert.equal((await req('/backups/test-archive','GET','',{'X-App-Monitor-Session':appSession})).status,200);
let verified=await req('/backups/test-passkey','PUT','',{'X-App-Monitor-Session':appSession,'Content-Type':'application/octet-stream','X-Warranty-Digest':hash},payload);
assert.equal(verified.status,201,'passkey may upload only encrypted archive bytes');
assert.equal((await req('/backups/test-not-encrypted','PUT','',{'X-App-Monitor-Session':appSession,'Content-Type':'application/octet-stream','X-Warranty-Digest':hash},new TextEncoder().encode('private photo plaintext'))).status,400);
assert.ok(boundCalls>=6,'All passkey requests should cross the internal service binding');
env.APP_MONITOR_AUTH={fetch:async()=>new Response('service down',{status:503})};
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':appSession})).status,401,'shared passkey outage must fail closed');
delete env.APP_MONITOR_AUTH;
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':appSession})).status,401,'missing Service Binding must fail closed');
console.log('Internal passkey Service Binding tests passed: owner session, recovery/invalid denied, encrypted upload, upstream/missing binding fail-closed');
