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
const store=new Map();
const env={WARRANTY_STORE:{
 head:async key=>store.get(key),
 async put(key,data,{onlyIf,customMetadata}={}){
  const body=typeof data==='string'?new TextEncoder().encode(data):data;
  const etag=Buffer.from(await crypto.subtle.digest('SHA-256',body)).toString('hex');
  if(onlyIf?.etagDoesNotMatch==='*'&&store.has(key)||onlyIf?.etagMatches&&store.get(key)?.etag!==onlyIf.etagMatches)return null;
  const value={body,size:body.byteLength,uploaded:new Date(),customMetadata,etag,httpEtag:'"'+etag+'"'};
  store.set(key,value);
  return value;
 },
 get:async key=>store.get(key),
 list:async({prefix})=>({objects:[...store].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({...value,key})),truncated:false})
}};
const root='https://warranty-ease-api.nirav2000-github.workers.dev';
async function request(path,method='GET',token='',headers={},body){return worker.fetch(new Request(root+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),Origin:'https://nirav2000.github.io',...headers},body}),env);}
const req=(path,...args)=>request('/v1'+path,...args);
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

const originalPhotoFetch=globalThis.fetch;
const imagesRequested=[];
globalThis.fetch=async(input,options={})=>{
 const url=String(input);
 if(url.startsWith('https://www.lg.com/content/dam/')||url.startsWith('https://aws-obg-image-lb-1.tcl.com/')){
   imagesRequested.push(url);
   assert.equal(options.redirect,'manual','never follow unvalidated manufacturer redirects');
   return new Response(Uint8Array.from([0xff,0xd8,0xff,0xe0,0,0,0,1]),{headers:{'Content-Type':'image/jpeg'}});
 }
 return originalPhotoFetch(input,options);
};
assert.equal((await req('/product-photos/lg-f4y511wwla1','GET','',{'X-App-Monitor-Session':appSession})).status,200);
assert.equal((await req('/product-photos/lg-rhx1009nwk','GET','',{'X-App-Monitor-Session':appSession})).status,200);
assert.equal((await req('/product-photos/tcl-65c8l','GET','',{'X-App-Monitor-Session':appSession})).status,200);
assert.equal(imagesRequested.length,3);
assert.equal((await req('/product-photos/not-approved','GET','',{'X-App-Monitor-Session':appSession})).status,404);
assert.equal((await req('/product-photos/lg-f4y511wwla1','GET')).status,401);
assert.equal((await req('/product-photos/lg-f4y511wwla1','POST','',{'X-App-Monitor-Session':appSession})).status,405);
globalThis.fetch=originalPhotoFetch;
console.log('Manufacturer image importer: three approved IDs only, passkey gate, no arbitrary URL proxy');

const authBinding=env.APP_MONITOR_AUTH;
env.APP_MONITOR_AUTH={fetch:async()=>new Response('service down',{status:503})};
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':appSession})).status,401,'shared passkey outage must fail closed');
delete env.APP_MONITOR_AUTH;
assert.equal((await req('/backups','GET','',{'X-App-Monitor-Session':appSession})).status,401,'missing Service Binding must fail closed');
console.log('Internal passkey Service Binding tests passed: owner session, recovery/invalid denied, encrypted upload, upstream/missing binding fail-closed');
// Encrypted multipart backup: only completed manifests appear in the backup list.
const multiId='test-chunked';
const p0=new Uint8Array(80);p0.set(new TextEncoder().encode('WEASE02!'));crypto.getRandomValues(p0.subarray(8));
const p1=new Uint8Array(44);crypto.getRandomValues(p1);
const partHash=async part=>Buffer.from(await crypto.subtle.digest('SHA-256',part)).toString('hex');
const h0=await partHash(p0),h1=await partHash(p1);
let chunkRes=await req(`/backups/${multiId}/parts/0`,'PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':h0},p0);
assert.equal(chunkRes.status,201,await chunkRes.text());
chunkRes=await req(`/backups/${multiId}/parts/1`,'PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':h1},p1);
assert.equal(chunkRes.status,201,await chunkRes.text());
assert.equal((await (await req('/backups','GET',valid)).json()).backups.some(x=>x.id===multiId),false,'incomplete upload must never be visible as a backup');
const joined=new Uint8Array(p0.length+p1.length);joined.set(p0);joined.set(p1,p0.length);
const multiManifest={kind:'chunked',id:multiId,sha256:await partHash(joined),bytes:joined.length,parts:[{index:0,bytes:p0.length,sha256:h0},{index:1,bytes:p1.length,sha256:h1}]};
chunkRes=await req(`/backups/${multiId}/complete`,'POST',valid,{'Content-Type':'application/json'},JSON.stringify(multiManifest));
assert.equal(chunkRes.status,201,await chunkRes.text());
const multiList=(await (await req('/backups','GET',valid)).json()).backups;
assert.equal(multiList.some(x=>x.id===multiId&&x.format==='chunked'&&x.size===joined.length),true);
chunkRes=await req(`/backups/${multiId}`,'GET',valid);
assert.equal(chunkRes.headers.get('X-Warranty-Format'),'chunked');
assert.equal((await chunkRes.json()).parts.length,2);
chunkRes=await req(`/backups/${multiId}/parts/1`,'GET',valid);
assert.deepEqual(new Uint8Array(await chunkRes.arrayBuffer()),p1);
assert.equal((await req(`/backups/${multiId}/parts/0`,'PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':h0},p0)).status,409);
assert.equal((await req(`/backups/${multiId}/complete`,'POST',valid,{'Content-Type':'application/json'},JSON.stringify(multiManifest))).status,409);
assert.equal((await req(`/backups/evil-bad/parts/0`,'PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':await partHash(new Uint8Array(65))},new Uint8Array(65))).status,400);
console.log('Multipart R2 archive tests passed: fragments invisible until complete, immutable manifest, checksum and encrypted-magic enforcement');

env.APP_MONITOR_AUTH=authBinding;
const ownerHeaders={'X-App-Monitor-Session':appSession};
const v2=(path,method='GET',headers={},body)=>request('/v2'+path,method,'',{...ownerHeaders,...headers},body);
assert.equal((await request('/v2/records')).status,401);
assert.equal((await v2('/records')).status,200);
const file='/files/'+hash,record='/records/a-appliance';
const newRecord={id:'a-appliance',version:2,kind:'appliance',deleted:false,value:{id:'appliance',files:[{id:'receipt',originalHash:hash}]}};
const create={'Content-Type':'application/json','If-None-Match':'*'};
assert.equal((await v2(record,'PUT',create,JSON.stringify(newRecord))).status,409);
assert.equal((await v2(file,'PUT',{},new Uint8Array([1,2,3]))).status,400);
assert.equal((await v2(file,'PUT',{},payload)).status,200);
assert.equal((await v2(file,'HEAD')).status,200);
assert.equal((await v2(record,'PUT',{},JSON.stringify(newRecord))).status,428);
const first=await v2(record,'PUT',create,JSON.stringify(newRecord));
assert.equal(first.status,200,await first.clone().text());
const tag=(await first.json()).etag;
assert.equal((await v2(record,'PUT',create,JSON.stringify(newRecord))).status,412);
const update={'Content-Type':'application/json','If-Match':'"'+tag+'"'};
const tombstone={...newRecord,deleted:true,deletedAt:new Date().toISOString(),value:null};
assert.equal((await v2(record,'PUT',update,JSON.stringify(tombstone))).status,200);
assert.equal((await v2(record,'PUT',update,JSON.stringify(newRecord))).status,412);
assert.equal((await (await v2(record)).json()).deleted,true);
assert.deepEqual(new Uint8Array(await (await v2(file)).arrayBuffer()),payload);
assert.equal((await v2('/migration','PUT',{'X-Warranty-Legacy-Head':'wrong-id'})).status,409);
const latest=(await (await req('/backups','GET',valid)).json()).backups[0].id;
const migration=await v2('/migration','PUT',{'X-Warranty-Legacy-Head':latest});
assert.equal(migration.status,200);
assert.equal((await migration.json()).completed.legacyHead,latest);
assert.equal((await req('/backups/old-client-write','PUT',valid,{'Content-Type':'application/octet-stream','X-Warranty-Digest':hash},payload)).status,409);
assert.deepEqual(new Uint8Array(await (await req('/backups/test-archive','GET',valid)).arrayBuffer()),payload);
console.log('Incremental R2 tests passed: authenticated revisions, immutable evidence, deletion and legacy migration fence');
