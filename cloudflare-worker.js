const WORKER_BUILD='2026.09.21.1320';
// Cloudflare Worker for Snag Recorder media.
// Bind the R2 bucket "snag-media" as SNAG_MEDIA.
// Add these Worker secrets/variables:
//   Firebase token verification now uses the dedicated snag-509418 web API key.
//   ALLOWED_ORIGIN=https://nirav2000.github.io
// No R2 access keys are required when using an R2 binding.
const cors=(origin,allowed)=>({
  'Access-Control-Allow-Origin': origin===allowed?origin:allowed,
  'Access-Control-Allow-Methods':'PUT,GET,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type',
  'Access-Control-Max-Age':'86400'
});
async function verifyFirebaseToken(request,env){
  const h=request.headers.get('Authorization')||'';
  if(!h.startsWith('Bearer '))throw new Response('Unauthorized',{status:401});
  const token=h.slice(7);
  const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  if(!r.ok)throw new Response('Unauthorized',{status:401});
  const data=await r.json();if(!data.users?.[0]?.localId)throw new Response('Unauthorized',{status:401});
  return data.users[0];
}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin')||'',headers=cors(origin,env.ALLOWED_ORIGIN||'https://nirav2000.github.io');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const url=new URL(request.url),prefix='/objects/';
  if(url.pathname==='/health')return Response.json({ok:true,service:'snag-media-api',build:WORKER_BUILD,r2Bound:!!env.SNAG_MEDIA},{headers});
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
