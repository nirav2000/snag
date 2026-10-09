const APP_BUILD='2026.10.09.1620';
const FIREBASE_VERSION='12.2.1';
const LS={state:'snag-recorder-state-v1',firebase:'snag-recorder-firebase-v1',profile:'snag-recorder-profile-v1',access:'snag-recorder-shared-access-v1',guide:'snag-recorder-guide-v1',guidesEnabled:'snag-recorder-guides-enabled-v1',dirty:'snag-recorder-dirty-v1',userId:'snag-recorder-user-id-v1',migration:'snag-recorder-migration-v2',notificationPrompt:'snag-notification-choice-v1'};
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=iso=>{const d=new Date(iso);if(!iso||Number.isNaN(d.getTime()))return 'time unavailable';try{return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(d)}catch{return 'time unavailable'}};
const statusLabel={'open':'Open','in-progress':'In progress','review':'Needs review','resolved':'Resolved'};
const priorityRank={Urgent:0,High:1,Normal:2,Low:3};
let firebase=null, unsubscribe=null, privateNotesUnsubscribe=null, seenUnsubscribe=null, currentMember=null, firebaseRun=0, cloudDiag=[], seenState={}, currentNav='home', pendingFiles=[], detailId=null, mediaRecorder=null, voiceChunks=[], cameraTestStream=null, cameraTestFacing='environment', cloudStatus={state:'starting',message:'Starting Firebase…'}, latestBuild=null, annotationState={source:null,mode:null,index:null,updateId:null,history:[],colour:'#ef4444',image:null}, legacyBridgeFrame=null, legacyBridgeReadyPromise=null;
let snagNotifications=null,snagNotificationModule=null,snagNotificationState=null;
let profile=JSON.parse(localStorage.getItem(LS.profile)||'null')||{name:'Me',role:'Client'};
let state=loadState();
const launchUrl=new URL(location.href);
const savedAccess=(()=>{try{return JSON.parse(localStorage.getItem(LS.access)||'null')}catch{return null}})();
const launchProjectId=launchUrl.searchParams.get('project')||savedAccess?.projectId||null;
const launchInviteId=launchUrl.searchParams.get('invite')||((savedAccess?.projectId===launchProjectId)?savedAccess?.inviteId:null);
let selectedProjectId=launchProjectId||state.selectedProjectId||state.projects[0]?.id;
if(!launchProjectId&&!state.projects.some(p=>p.id===selectedProjectId)) selectedProjectId=state.projects[0]?.id;
if(state.projects.some(p=>p.id===selectedProjectId)){state.selectedProjectId=selectedProjectId;saveState();}
let view={status:'active',search:'',category:'all',priority:'all',archived:false,sort:'updated'};
const $=id=>document.getElementById(id);
function loadState(){
  const saved=JSON.parse(localStorage.getItem(LS.state)||'null');
  if(saved?.projects) return saved;
  const pid=uid(), sid=uid(), t=now();
  return {selectedProjectId:pid,projects:[{id:pid,name:'My home',address:'Home project',type:'Home',createdAt:t}],snags:[{id:sid,projectId:pid,ref:'S-001',title:'Example snag — tap to see the workflow',category:'Home snag',priority:'Normal',location:'Kitchen',assignee:'Builder',description:'This example shows how each snag keeps evidence, discussion and status together. Delete or resolve it once you start adding real issues.',outcome:'Issue is checked and confirmed complete.',status:'open',archived:false,createdAt:t,updatedAt:t,createdBy:'Me',media:[],updates:[{id:uid(),type:'note',text:'Snag recorded and ready for review.',author:'Me',role:'Client',createdAt:t,media:[]}]}]};
}
function saveState(){localStorage.setItem(LS.state,JSON.stringify(state));}
function dirtyMap(){try{return JSON.parse(localStorage.getItem(LS.dirty)||'{}')}catch{return {}}}
function markDirty(id,kind='snag'){const d=dirtyMap();d[id]={kind,at:now()};localStorage.setItem(LS.dirty,JSON.stringify(d))}
function clearDirty(id){const d=dirtyMap();delete d[id];localStorage.setItem(LS.dirty,JSON.stringify(d))}
function pendingDirty(){const d=dirtyMap();return Object.keys(d).map(id=>state.snags.find(s=>s.id===id)).filter(Boolean)}
function snagUserId(){let id=localStorage.getItem(LS.userId);if(!id){id=uid();localStorage.setItem(LS.userId,id)}return id}
function adoptSnagUserId(id){if(id)localStorage.setItem(LS.userId,id);return snagUserId()}
function stableAccountId(){return 'acct_'+snagUserId().replace(/[^A-Za-z0-9_-]/g,'').slice(0,80)}
let projectMemberCache={projectId:null,at:0,rows:[]};
async function loadProjectMembers(force=false){
  if(!firebase?.auth?.currentUser)return [];
  if(!force&&projectMemberCache.projectId===selectedProjectId&&Date.now()-projectMemberCache.at<30000)return projectMemberCache.rows;
  const {fsMod,db}=firebase,snap=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'members')),rows=snap.docs.map(d=>({id:d.id,...d.data()}));
  projectMemberCache={projectId:selectedProjectId,at:Date.now(),rows};return rows;
}
async function resolveAssigneeIdentity(label){
  const target=String(label||'').trim().toLowerCase();if(!target||!firebase||!isAdmin())return null;
  const rows=await loadProjectMembers();
  return rows.find(x=>[x.label,x.name,x.role].some(v=>String(v||'').trim().toLowerCase()===target))||null;
}
async function applySnagAccess(s,{newRecord=false}={}){
  const currentUid=firebase?.auth?.currentUser?.uid||s.createdByUid||null;
  if(newRecord&&!s.createdByUid)s.createdByUid=currentUid;
  if(isAdmin()){
    const match=await resolveAssigneeIdentity(s.assignee);
    s.assigneeId=match?.uid||match?.id||null;
  }
  const participants=new Set((s.participantUids||[]).filter(Boolean));
  if(s.createdByUid)participants.add(s.createdByUid);
  if(s.assigneeId)participants.add(s.assigneeId);
  if(newRecord&&currentUid)participants.add(currentUid);
  s.participantUids=[...participants];
  return s;
}
async function ensureAccountRemote(){
  if(!firebase?.auth?.currentUser)return null;
  const {fsMod,db,auth}=firebase,id=stableAccountId(),ref=fsMod.doc(db,'snag_accounts',id);
  try{
    const snap=await fsMod.getDoc(ref);
    if(!snap.exists())await fsMod.setDoc(ref,{accountId:id,ownerUid:auth.currentUser.uid,ownerSnagUserId:snagUserId(),createdAt:now(),updatedAt:now(),plan:'free'});
    else if(snap.data().ownerUid===auth.currentUser.uid)await fsMod.setDoc(ref,{updatedAt:now()},{merge:true});
  }catch(e){console.warn('Account record is waiting for the release security rules',e)}
  return id;
}
async function upgradeProjectAccessModel(){
  if(!firebase?.auth?.currentUser||!isProjectOwner())return false;
  const p=project();if(!p||Number(p.accessModelVersion||0)>=2)return false;
  const {fsMod,db}=firebase,rows=await loadProjectMembers(true),memberByLabel=new Map();
  for(const m of rows)for(const v of [m.label,m.name])if(v)memberByLabel.set(String(v).trim().toLowerCase(),m.uid||m.id);
  const q=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'snags'));
  for(const d of q.docs){
    const data={id:d.id,...d.data()},participants=new Set((data.participantUids||[]).filter(Boolean));
    if(data.createdByUid)participants.add(data.createdByUid);
    const assigned=memberByLabel.get(String(data.assignee||'').trim().toLowerCase());
    if(assigned){data.assigneeId=assigned;participants.add(assigned)}
    await fsMod.setDoc(d.ref,{assigneeId:data.assigneeId||null,participantUids:[...participants]},{merge:true});
  }
  await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId),{accessModelVersion:2,accessModelUpdatedAt:now()},{merge:true});
  p.accessModelVersion=2;p.accessModelUpdatedAt=now();saveState();return true;
}
function migrationMap(){try{return JSON.parse(localStorage.getItem(LS.migration)||'{}')}catch{return {}}}
function saveMigration(projectId,data){const m=migrationMap();m[projectId]={...(m[projectId]||{}),...data,updatedAt:now()};localStorage.setItem(LS.migration,JSON.stringify(m))}
function migrationFor(projectId){return migrationMap()[projectId]||null}

function project(){return state.projects.find(p=>p.id===selectedProjectId)||state.projects[0];}
function projectLocations(){const p=project();return p?.locations?.length?p.locations:['Kitchen','Living room','Dining room','Hall','Landing','Bathroom','Bedroom 1','Bedroom 2','Bedroom 3','Garden','Garage','Loft'];}
function projectAssignees(){const p=project();return p?.assignees?.length?p.assignees:['Builder','Electrician','Plumber','Carpenter','Decorator','Glazier','Client'];}

const privateMediaRuntimeCache=new Map();
let privateMediaObserver=null;
function mediaVariant(item,variant='full'){
  if(variant==='preview'&&item?.previewKey)return{...item,key:item.previewKey,url:item.previewUrl||'',type:item.previewType||'image/jpeg'};
  return item;
}
function mediaAttr(item,attr='src',variant='full'){
  const source=mediaVariant(item,variant);
  if(source?.storage==='r2'&&source.key)return `${attr}="" data-private-media-key="${escapeHtml(source.key)}" data-private-media-attr="${attr}"`;
  return `${attr}="${escapeHtml(source?.url||'')}"`;
}
async function privateMediaBlob(item){
  if(!item?.key||!firebase?.auth?.currentUser)throw new Error('Private media is unavailable');
  const token=await firebase.auth.currentUser.getIdToken();
  const r=await fetch(`${window.SNAG_R2_API.replace(/\/$/,'')}/objects/${item.key.split('/').map(encodeURIComponent).join('/')}`,{headers:{Authorization:`Bearer ${token}`},cache:'default'});
  if(!r.ok)throw new Error('Private media could not be loaded ('+r.status+')');
  return r.blob();
}
async function privateMediaRuntimeUrl(item){
  if(!item)return '';
  if(item.storage!=='r2'||!item.key)return item.url||'';
  if(privateMediaRuntimeCache.has(item.key))return privateMediaRuntimeCache.get(item.key);
  const blob=await privateMediaBlob(item),url=URL.createObjectURL(blob);privateMediaRuntimeCache.set(item.key,url);return url;
}
async function hydratePrivateMediaElement(el){
  const key=el.dataset.privateMediaKey,attr=el.dataset.privateMediaAttr||'src';
  if(!key||el.dataset.privateMediaLoaded==='1'||el.dataset.privateMediaLoading==='1')return;
  el.dataset.privateMediaLoading='1';
  try{
    const url=await privateMediaRuntimeUrl({storage:'r2',key});el.setAttribute(attr,url);el.dataset.privateMediaLoaded='1';
  }catch(error){console.warn('Private media hydrate failed',key,error)}
  finally{delete el.dataset.privateMediaLoading}
}
function ensurePrivateMediaObserver(){
  if(privateMediaObserver||!('IntersectionObserver'in window))return privateMediaObserver;
  privateMediaObserver=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){privateMediaObserver.unobserve(entry.target);hydratePrivateMediaElement(entry.target)}
  },{rootMargin:'240px 0px'});
  return privateMediaObserver;
}
async function hydratePrivateMedia(root=document){
  const els=[...root.querySelectorAll('[data-private-media-key]')].filter(el=>el.dataset.privateMediaLoaded!=='1');
  const observer=ensurePrivateMediaObserver();
  for(const el of els){
    if(!observer||el.closest('dialog[open]')||el.getClientRects().length&&el.getBoundingClientRect().top<innerHeight+240)hydratePrivateMediaElement(el);
    else observer.observe(el);
  }
}

const SNAG_NOTIFICATION_EVENTS=[
  {id:'snag.created',label:'New snag added'},
  {id:'snag.updated',label:'Snag details changed'},
  {id:'snag.comment_added',label:'New comment or progress update'},
  {id:'snag.status_changed',label:'Snag status changed'}
];
async function notificationModule(){
  if(snagNotificationModule)return snagNotificationModule;
  snagNotificationModule=await import('https://nirav2000.github.io/Apps/notifications/v1/index.js');
  return snagNotificationModule;
}
async function snagNotificationRequest(path,{method='GET',body}={}){
  if(!firebase?.auth?.currentUser||!window.SNAG_R2_API)return null;
  const token=await firebase.auth.currentUser.getIdToken(),sep=path.includes('?')?'&':'?';
  const response=await fetch(window.SNAG_R2_API.replace(/\/$/,'')+path+sep+'projectId='+encodeURIComponent(selectedProjectId),{
    method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,cache:'no-store'
  });
  if(!response.ok)throw new Error('Notification service '+response.status);
  return response.json();
}
async function ensureSnagNotifications(){
  if(!firebase?.auth?.currentUser)return null;
  const mod=await notificationModule();
  const transport={
    policy:async()=>((await snagNotificationRequest('/notifications/settings'))?.policy||{}),
    preferences:async(scope,userId)=>((await snagNotificationRequest('/notifications/settings?targetUid='+encodeURIComponent(userId||firebase.auth.currentUser.uid)))?.preferences||{}),
    savePreferences:async(scope,userId,preferences)=>((await snagNotificationRequest('/notifications/settings',{method:'POST',body:{scope:'preferences',targetUid:userId,preferences}}))?.preferences||preferences),
    inbox:async(scope,userId,{limit=80}={})=>((await snagNotificationRequest('/notifications/inbox?targetUid='+encodeURIComponent(userId||firebase.auth.currentUser.uid)+'&limit='+limit))?.items||[]),
    markRead:async(scope,userId,id)=>((await snagNotificationRequest('/notifications/read',{method:'POST',body:{targetUid:userId,id}}))?.item||null),
    unreadCount:async(scope,userId)=>Number((await snagNotificationRequest('/notifications/inbox?targetUid='+encodeURIComponent(userId||firebase.auth.currentUser.uid)+'&limit=200'))?.unread||0),
    readiness:async()=>{const s=await snagNotificationRequest('/notifications/settings');return{core:{status:'ready'},production:{status:'ready'},providers:s?.providers||{},publicConfig:s?.publicConfig||{}}},
    emit:async event=>snagNotificationRequest('/notifications/event',{method:'POST',body:{type:event.type,snagId:event.data?.snagId,eventId:event.id,url:event.url}})
  };
  snagNotifications=mod.createNotifications({app:'snag',transport,eventTypes:SNAG_NOTIFICATION_EVENTS.map(x=>x.id)});
  return snagNotifications;
}
async function emitSnagNotification(type,snag,eventId){
  try{
    const client=await ensureSnagNotifications();if(!client||!snag?.id)return null;
    const url=new URL(location.origin+location.pathname);url.searchParams.set('project',selectedProjectId);
    return client.emit(type,{id:eventId||undefined,scopeId:selectedProjectId,actorId:firebase.auth.currentUser.uid,recipients:[],title:snag.title||'Snag update',url:url.toString(),data:{snagId:snag.id}});
  }catch(error){console.warn('Shared notification emit failed without blocking Snag',error);return null}
}
async function mountSnagNotificationSettings(){
  const root=$('myNotificationSettings');if(!root)return;
  if(!firebase?.auth?.currentUser){root.innerHTML='<p class="subtle">Connect to the project cloud to manage notifications.</p>';return}
  try{
    const mod=await notificationModule(),client=await ensureSnagNotifications(),uid=firebase.auth.currentUser.uid,state=await snagNotificationRequest('/notifications/settings');
    snagNotificationState=state;
    await mod.mountRecipientPreferences(root,{client,scopeId:selectedProjectId,userId:uid,role:state?.target?.role||currentMember?.role||'member',eventTypes:SNAG_NOTIFICATION_EVENTS,respectReadiness:true,visibleChannels:['in_app','web_push']});
    const push=$('enableWebPushNotifications'),status=$('webPushRegistrationStatus'),cfg=state?.publicConfig?.webPush;
    const pwa=await import('https://nirav2000.github.io/Apps/pwa/v1/index.js').then(x=>x.pwaReadiness({scope:'./'})).catch(()=>({ios:false,standalone:false}));
    const needsInstall=pwa.ios&&!pwa.standalone;
    push.disabled=!cfg?.configured||needsInstall;
    status.textContent=needsInstall?'Install/open Snag from the Home Screen before enabling push.':(cfg?.configured?'Ready to request notification permission on this device.':'Browser push provider setup is incomplete.');
  }catch(error){root.innerHTML='<p class="subtle">Notification settings are temporarily unavailable.</p>';console.warn(error)}
}
async function enableSnagWebPush(){
  const status=$('webPushRegistrationStatus');
  try{
    const mod=await notificationModule(),client=await ensureSnagNotifications(),state=snagNotificationState||await snagNotificationRequest('/notifications/settings'),cfg=state?.publicConfig?.webPush;
    if(!cfg?.configured){status.textContent='Browser push provider setup is incomplete.';return}
    const result=await mod.registerWebPush({firebaseConfig:cfg.firebaseConfig,vapidKey:cfg.vapidKey,serviceWorkerUrl:'./firebase-messaging-sw.js',serviceWorkerScope:'./'});
    if(!result.ok){status.textContent='Push was not enabled: '+result.reason;return}
    const uid=firebase.auth.currentUser.uid,prefs=await client.preferences(selectedProjectId,uid);prefs.destinations=prefs.destinations||{};prefs.channels=prefs.channels||{};
    const ids=new Set(Array.isArray(prefs.destinations.fcmInstallationIds)?prefs.destinations.fcmInstallationIds:[]);ids.add(result.installationId);prefs.destinations.fcmInstallationIds=[...ids].slice(-20);prefs.channels.web_push=true;
    await client.savePreferences(selectedProjectId,uid,prefs);status.textContent='Browser push enabled on this device.';await mountSnagNotificationSettings();
  }catch(error){status.textContent='Could not enable browser push: '+String(error?.message||error)}
}

function notificationPromptKey(){return LS.notificationPrompt+':'+(firebase?.auth?.currentUser?.uid||snagUserId())}
function notificationChoicePresented(){return localStorage.getItem(notificationPromptKey())==='1'}
function markNotificationChoicePresented(){localStorage.setItem(notificationPromptKey(),'1')}
async function maybePresentNotificationChoice(){
  if(!firebase?.auth?.currentUser||notificationChoicePresented()||!$('notificationChoiceDialog'))return;
  try{
    const state=await snagNotificationRequest('/notifications/settings');
    if(!state)return;
    markNotificationChoicePresented();
    setTimeout(()=>{if(!$('notificationChoiceDialog').open)$('notificationChoiceDialog').showModal()},250);
  }catch(error){console.warn('Notification choice could not be presented yet',error)}
}
async function acceptInitialNotifications(){
  $('notificationChoiceDialog')?.close();
  await enableSnagWebPush();
  if($('webPushRegistrationStatus')?.textContent.includes('Home Screen')){
    $('settingsDialog')?.showModal();
    $('notificationSettingsCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
}
function deferInitialNotifications(){$('notificationChoiceDialog')?.close()}

async function requireCommercialAccess(feature){
  if(!window.SnagCommercial?.check)return true;
  try{return await window.SnagCommercial.check(feature)}catch(e){console.warn('Commercial access check failed open',e);return true}
}

function renderQuickSuggestions(){
  if($('locationSuggestions'))$('locationSuggestions').innerHTML=projectLocations().map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
  if($('assigneeSuggestions'))$('assigneeSuggestions').innerHTML=projectAssignees().map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
}
function projectSnags(){return state.snags.filter(s=>s.projectId===selectedProjectId);}
function isProjectOwner(){return !!(firebase?.auth?.currentUser&&project()?.ownerUid===firebase.auth.currentUser.uid);}
function isAdmin(){return isProjectOwner()||currentMember?.admin===true||currentMember?.role==='owner';}
function canSeeSnag(s){
  if(isAdmin()||!currentMember)return true;
  if(currentMember.role!=='contractor'||Number(project()?.accessModelVersion||0)<2)return true;
  const me=firebase?.auth?.currentUser?.uid;
  return !!me&&(s.participantUids||[]).includes(me);
}
function visibleProjectSnags(){return projectSnags().filter(canSeeSnag);}
function lastActivityAt(s){let t=s.updatedAt||s.createdAt;for(const u of (s.updates||[])){if(new Date(u.createdAt)>new Date(t))t=u.createdAt;}return t;}
function isUnread(s){const seen=seenState[s.id];return !seen||new Date(lastActivityAt(s))>new Date(seen);}
function unreadSnags(){return visibleProjectSnags().filter(isUnread);}
async function markSnagSeen(snagId){
  const s=state.snags.find(x=>x.id===snagId);if(!s)return;
  const at=lastActivityAt(s);seenState[snagId]=at;renderUnreadIndicators();
  if(!firebase?.auth?.currentUser)return;
  try{const {fsMod,db,auth}=firebase;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'members',auth.currentUser.uid,'seen',snagId),{snagId,lastSeenAt:at,updatedAt:now()},{merge:true});}catch(e){console.warn('Could not save seen state',e)}
}
function renderUnreadIndicators(){
  const n=unreadSnags().length;
  if($('notificationBadge')){$('notificationBadge').textContent=n;$('notificationBadge').classList.toggle('hidden',n===0)}
  if($('homeNavDot'))$('homeNavDot').classList.toggle('hidden',n===0);
  if($('snagsNavDot'))$('snagsNavDot').classList.toggle('hidden',n===0);
}
async function subscribeSeenState(){
  seenUnsubscribe?.();seenState={};if(!firebase?.auth?.currentUser)return;
  const {fsMod,db,auth}=firebase;
  const q=fsMod.query(fsMod.collection(db,'snag_projects',selectedProjectId,'members',auth.currentUser.uid,'seen'));
  seenUnsubscribe=fsMod.onSnapshot(q,snap=>{seenState={};snap.forEach(d=>{const x=d.data();if(x?.lastSeenAt)seenState[d.id]=x.lastSeenAt});render();},e=>console.warn('Seen-state listener',e));
}
function setNav(name){
  if(name==='notes'){openMyNotes();name='home'}
  else if(name==='more'){$('settingsDialog').showModal();name='home'}
  currentNav=name;
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
  $('homeSummary')?.classList.toggle('hidden',name!=='home');
  $('snagsView')?.classList.toggle('hidden',name!=='snags');
  $('roomsView')?.classList.toggle('hidden',name!=='rooms');
  if(name==='rooms')renderRooms();
}
function renderRooms(){
  const host=$('roomGrid');if(!host)return;
  const rooms=projectLocations();
  host.innerHTML=rooms.map(room=>{const rs=visibleProjectSnags().filter(s=>(s.location||'').toLowerCase()===room.toLowerCase()),open=rs.filter(s=>s.status==='open').length,progress=rs.filter(s=>s.status==='in-progress').length,review=rs.filter(s=>s.status==='review').length,unread=rs.filter(isUnread).length,photo=project()?.roomCovers?.[room]||rs.map(s=>s.media?.find(m=>m.type?.startsWith('image'))).find(Boolean);return `<button class="room-card" type="button" data-room="${escapeHtml(room)}">${photo?`<img loading="lazy" decoding="async" ${mediaAttr(photo,'src','preview')} alt="">`:'<div class="room-placeholder">⌂</div>'}<div class="room-card-copy"><strong>${escapeHtml(room)}</strong><span>${open?open+' open ':''}${progress?progress+' in progress ':''}${review?review+' review ':''}${!rs.length?'All clear':''}</span></div>${unread?`<i class="room-unread-dot"></i>`:''}</button>`;}).join('');
  host.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>{view.search=b.dataset.room;setNav('snags');$('searchInput').value=view.search;renderList();});
}

function nextRef(){const nums=projectSnags().map(s=>Number((s.ref||'').match(/\d+/)?.[0]||0));return `S-${String((Math.max(0,...nums)+1)).padStart(3,'0')}`;}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;$('toastRegion').append(el);setTimeout(()=>el.remove(),2600);}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({url:r.result,name:file.name,type:file.type,size:file.size,local:true});r.onerror=reject;r.readAsDataURL(file);});}
function getFiltered(){
  let snags=visibleProjectSnags().filter(s=>view.archived||!s.archived);
  if(view.status==='active') snags=snags.filter(s=>s.status!=='resolved'); else snags=snags.filter(s=>s.status===view.status);
  if(view.category!=='all') snags=snags.filter(s=>s.category===view.category);
  if(view.priority!=='all') snags=snags.filter(s=>s.priority===view.priority);
  const q=view.search.trim().toLowerCase(); if(q){const terms=q.split(/\s+/).filter(Boolean);snags=snags.map(s=>{const ref=(s.ref||'').toLowerCase(),hay=[s.ref,s.title,s.description,s.location,s.assignee,s.category,...(s.updates||[]).map(u=>u.text)].join(' ').toLowerCase();let score=0;for(const term of terms){if(ref===term||ref.replace(/[^a-z0-9]/g,'')===term.replace(/[^a-z0-9]/g,''))score+=100;else if(ref.includes(term))score+=50;if((s.location||'').toLowerCase()===term)score+=35;else if((s.location||'').toLowerCase().includes(term))score+=20;if((s.title||'').toLowerCase().includes(term))score+=18;if((s.description||'').toLowerCase().includes(term))score+=12;if(hay.includes(term))score+=5;}return{s,score}}).filter(x=>x.score>0).sort((x,y)=>y.score-x.score).map(x=>x.s);}
  snags.sort((a,b)=>view.sort==='priority'?priorityRank[a.priority]-priorityRank[b.priority]:view.sort==='newest'?new Date(b.createdAt)-new Date(a.createdAt):view.sort==='oldest'?new Date(a.createdAt)-new Date(b.createdAt):new Date(b.updatedAt)-new Date(a.updatedAt));
  return snags;
}
function render(){renderProject();renderStats();renderFilters();renderHomeActiveSnags();renderRecentActivity();renderList();renderRooms();renderProjects();renderSettings();renderQuickSuggestions();renderUnreadIndicators();renderCloudDiagnostics();queueMicrotask(()=>hydratePrivateMedia(document));}
function renderProject(){const p=project();if(!p)return;const cover=$('projectCover');if(cover){cover.classList.toggle('hidden',!p.coverImage?.url);cover.innerHTML=p.coverImage?.url?`<img ${mediaAttr(p.coverImage)} alt="Project cover">`:'';const removeCover=$('removeProjectCoverButton');if(removeCover)removeCover.classList.toggle('hidden',!p.coverImage?.url);}$('projectName').textContent=p.name;$('projectAddress').textContent=p.address||'No address/context';$('projectTypeLabel').textContent=`${p.type.toUpperCase()} PROJECT`;$('profilePill').textContent=`${profile.role} · ${profile.name}`;const live=cloudStatus.state==='connected',pill=$('syncPill');pill.className=`sync-pill ${live?'connected':'local'}`;pill.innerHTML=`<span class="dot"></span><span>${live?'Live sync':cloudStatus.state==='error'?'Cloud error':'Connecting…'}</span>`;pill.title=cloudStatus.message||'';}
function renderStats(){const s=visibleProjectSnags(),active=s.filter(x=>x.status!=='resolved'&&!x.archived),progress=s.filter(x=>x.status==='in-progress'&&!x.archived),review=s.filter(x=>x.status==='review'&&!x.archived),resolved=s.filter(x=>x.status==='resolved');$('statActive').textContent=active.length;$('statProgress').textContent=progress.length;$('statReview').textContent=review.length;$('statResolved').textContent=resolved.length;if($('heroUnresolved'))$('heroUnresolved').textContent=active.length;if($('heroRequireAction'))$('heroRequireAction').textContent=s.filter(x=>['open','review'].includes(x.status)&&!x.archived).length;if($('heroRecentlyUpdated')){const cutoff=Date.now()-86400000;$('heroRecentlyUpdated').textContent=s.filter(x=>new Date(x.updatedAt).getTime()>=cutoff).length;}document.querySelectorAll('.stat-card').forEach(x=>x.classList.toggle('active',x.dataset.statFilter===view.status));}
function renderFilters(){let n=0;if(view.category!=='all')n++;if(view.priority!=='all')n++;if(view.archived)n++;$('filterCount').textContent=n?`(${n})`:'';$('categoryFilter').value=view.category;$('priorityFilter').value=view.priority;$('archiveFilter').checked=view.archived;$('sortSelect').value=view.sort;}
function thumbHtml(s){const m=s.media?.[0];if(!m)return `<div class="snag-thumb">${s.category==='App / software'?'⌘':s.category==='Business process'?'⇄':'⌂'}</div>`;if(m.type?.startsWith('image'))return `<div class="snag-thumb"><img loading="lazy" decoding="async" ${mediaAttr(m,'src','preview')} alt=""></div>`;if(m.type?.startsWith('video'))return `<div class="snag-thumb"><video ${mediaAttr(m)} muted playsinline></video></div>`;return '<div class="snag-thumb">♪</div>';}
function activityThumb(s,u){const m=u?.media?.find(x=>x.type?.startsWith('image'))||s.media?.find(x=>x.type?.startsWith('image'));return m?`<div class="activity-thumb"><img loading="lazy" decoding="async" ${mediaAttr(m,'src','preview')} alt=""></div>`:'<div class="activity-thumb activity-placeholder">⌂</div>';}
function activityKind(item){
  if(!item.u)return 'new-snag';
  if(item.u.type==='status'&&/review/i.test(item.u.text||''))return 'review';
  if(item.u.type==='status')return 'status';
  if(item.u.media?.length)return 'media';
  return 'message';
}
function renderRecentActivity(){
  const host=$('recentActivity');if(!host)return;
  const items=[];for(const s of visibleProjectSnags()){items.push({s,u:null,at:s.createdAt,label:'Snag added'});for(const u of (s.updates||[]))items.push({s,u,at:u.createdAt,label:u.type==='status'?u.text:(u.media?.length?'Photo / attachment added':'New message')});}
  items.sort((x,y)=>new Date(y.at)-new Date(x.at));const recent=items.slice(0,6);
  host.innerHTML=recent.length?recent.map(x=>`<button class="activity-row activity-${activityKind(x)}" type="button" data-activity-snag="${x.s.id}"><span class="activity-type-dot ${activityKind(x)}"></span>${activityThumb(x.s,x.u)}<span class="activity-copy"><strong>${escapeHtml(x.s.ref)} · ${escapeHtml(x.s.title)}</strong><small>${escapeHtml(x.label||'Update')} · ${fmt(x.at)}</small></span>${isUnread(x.s)?'<span class="unread-count-dot"></span>':''}</button>`).join(''):'<div class="empty-inline">Nothing new.</div>';
  host.querySelectorAll('[data-activity-snag]').forEach(b=>b.onclick=()=>openDetail(b.dataset.activitySnag));
  const unread=unreadSnags().length,summary=$('newActivitySummary');if(summary)summary.textContent=unread?`${unread} item${unread===1?'':'s'} new for you`:'Nothing new for you';
}
function renderHomeActiveSnags(){
  const host=$('homeActiveSnags');if(!host)return;
  const items=visibleProjectSnags().filter(s=>s.status!=='resolved'&&!s.archived).sort((x,y)=>new Date(y.updatedAt)-new Date(x.updatedAt)).slice(0,5);
  host.innerHTML=items.length?items.map((s,i)=>`<button class="home-snag-row handover-snag-row" type="button" data-home-snag="${s.id}">
    <span class="handover-index">${String(i+1).padStart(2,'0')}</span>
    ${thumbHtml(s)}
    <span class="home-snag-copy">
      <span class="handover-ref">${escapeHtml(s.ref)} · ${escapeHtml((s.location||'NO LOCATION').toUpperCase())}</span>
      <strong class="handover-title">${escapeHtml(s.title)}</strong>
      <span class="handover-meta-line"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span>${escapeHtml(s.assignee||'Unassigned')}</span><span>· Updated ${fmt(s.updatedAt)}</span></span>
    </span>
    <span class="chevron">›</span>
  </button>`).join(''):'<div class="empty-inline">No unresolved issues.</div>';
  host.querySelectorAll('[data-home-snag]').forEach(b=>b.onclick=()=>openDetail(b.dataset.homeSnag));
}
const bulkSelection=new Set();
let bulkMode=false;
let bulkSourceContractor='';
let bulkBusy=false;
function bulkSelectionChanged(){const visible=new Set(getFiltered().map(s=>s.id));for(const id of [...bulkSelection])if(!state.snags.some(s=>s.id===id&&s.projectId===selectedProjectId))bulkSelection.delete(id);renderList()}
function renderBulkControls(){
  const panel=$('bulkControls');if(!panel)return;
  const toggle=$('bulkModeToggle');if(toggle){toggle.hidden=!isAdmin();toggle.textContent=bulkMode?'Done editing':'Select / bulk edit';toggle.setAttribute('aria-pressed',String(bulkMode))}
  const list=getFiltered().filter(s=>!bulkSourceContractor||s.assigneeId===bulkSourceContractor||s.assignee===bulkSourceContractor),ids=list.map(s=>s.id),count=ids.filter(id=>bulkSelection.has(id)).length,admin=isAdmin();
  panel.hidden=!admin||!bulkMode;
  if(!admin){bulkSelection.clear();return}
  $('bulkCount').textContent=bulkSelection.size?bulkSelection.size+' selected':'Select snags for bulk changes';
  $('bulkAll').checked=!!ids.length&&count===ids.length;
  $('bulkAll').indeterminate=count>0&&count<ids.length;
  $('bulkActions').hidden=!bulkSelection.size;
  $('bulkApply').disabled=bulkBusy||!bulkSelection.size;
  $('bulkSelectAll').disabled=!ids.length||bulkBusy;
  $('bulkClear').disabled=!bulkSelection.size||bulkBusy;
}
async function bulkRefreshContractors(){
  const select=$('bulkContractor');if(!select)return;
  const previous=select.value;select.replaceChildren(new Option('Choose a joined contractor',''));
  if(!isAdmin()||!firebase?.auth?.currentUser)return;
  const {fsMod,db}=firebase,rows=await loadProjectMembers(true);
  const invites=new Map();
  const snap=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'invites'));
  snap.docs.forEach(d=>invites.set(d.id,d.data()));
  for(const m of rows){
    if(m.role!=='contractor'||!m.inviteId||invites.get(m.inviteId)?.active!==true)continue;
    const option=new Option(m.label||m.name||m.uid||m.id,m.uid||m.id);
    select.add(option);
  }
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  const source=$('bulkFromContractor');if(source){const old=source.value;source.replaceChildren(new Option('All contractors',''),new Option('Unassigned','__unassigned__'),...[...select.options].filter(o=>o.value).map(o=>new Option(o.textContent,o.value)));source.value=[...source.options].some(o=>o.value===old)?old:'';}
}
function bulkActionFields(){
  const action=$('bulkAction').value,contractor=['assign','grant','revoke'].includes(action),choice=['status','priority','category'].includes(action),location=action==='location';
  $('bulkFromWrap').hidden=action!=='assign';$('bulkContractor').hidden=!contractor;$('bulkValue').hidden=!choice;$('bulkLocation').hidden=!location;
  if(choice){
    const choices=action==='status'?[['open','Open'],['in-progress','In progress'],['review','Needs review'],['resolved','Resolved']]:action==='priority'?['Urgent','High','Normal','Low'].map(x=>[x,x]):['Home snag','App / software','Business process','Other'].map(x=>[x,x]);
    $('bulkValue').replaceChildren(...choices.map(([value,label])=>new Option(label,value)));
  }
}
async function bulkApplyChanges(){
  if(bulkBusy||!isAdmin()||!firebase?.auth?.currentUser||cloudStatus.state!=='connected')return toast('Cloud admin access is required for bulk changes');
  const projectId=selectedProjectId,action=$('bulkAction').value,recipientUid=$('bulkContractor').value,value=action==='location'?$('bulkLocation').value:$('bulkValue').value;
  const ids=[...bulkSelection].filter(id=>state.snags.some(s=>s.id===id&&s.projectId===projectId));
  if(!ids.length)return;
  const recipientActions=['assign','grant','revoke'].includes(action);
  if(recipientActions&&!recipientUid)return toast('Select a contractor');
  const members=recipientActions?await loadProjectMembers(true):[];
  const recipientMember=members.find(m=>(m.uid||m.id)===recipientUid);
  let recipient=null;
  if(recipientActions){
    const {fsMod,db}=firebase,inviteId=recipientMember?.inviteId;
    if(!inviteId)throw new Error('Contractor has not joined the project');
    const invite=await fsMod.getDoc(fsMod.doc(db,'snag_projects',projectId,'invites',inviteId));
    recipient={uid:recipientUid,label:recipientMember.label||recipientMember.name||recipientUid,role:recipientMember.role,active:invite.exists()&&invite.data().active===true};
    if(!recipient.active)throw new Error('Contractor invitation is no longer active');
  }
  const {bulkSnagChange}=await import('./snag-bulk.mjs?v=2026.10.08.1345');
  const candidates=ids.map(id=>state.snags.find(s=>s.id===id)).filter(Boolean);
  const changes=candidates.map(s=>({s,...bulkSnagChange(s,action,{recipient,value,timestamp:now()})})).filter(x=>x.patch);
  if(!changes.length)return toast('No changes needed');
  const summary=changes.length+' snags · '+$('bulkAction').selectedOptions[0].textContent+(recipient?' · '+recipient.label:'');
  if(!confirm('Apply this change to '+summary+'?'+(recipientActions?'\n\nThis changes access to private snag records and media.':'')))return;
  bulkBusy=true;renderBulkControls();
  let successes=0;const failures=[];
  try{
    const {fsMod,db,auth}=firebase;
    for(const item of changes){
      if(projectId!==selectedProjectId){failures.push('Project changed during update');break}
      const ref=fsMod.doc(db,'snag_projects',projectId,'snags',item.s.id);
      try{
        // Recheck the live document and derive the change from its current permissions.
        const current=await fsMod.getDoc(ref);
        if(!current.exists())throw new Error('Snag no longer exists');
        const live={id:current.id,...current.data()};
        const result=bulkSnagChange(live,action,{recipient,value,timestamp:now()});
        if(!result.patch){bulkSelection.delete(item.s.id);continue}
        const update={id:uid(),type:action==='status'?'status':'edit',text:'Bulk change: '+result.description,author:profile.name,authorUid:auth.currentUser.uid,role:profile.role,createdAt:result.patch.updatedAt,media:[]};
        // Commit the fields and their audit entry together.
        const batch=fsMod.writeBatch(db);
        batch.update(ref,result.patch);
        batch.set(fsMod.doc(db,'snag_projects',projectId,'snags',live.id,'updates',update.id),update);
        await batch.commit();
        Object.assign(item.s,result.patch);
        item.s.updates=item.s.updates||[];item.s.updates.push(update);
        clearDirty(item.s.id);successes++;bulkSelection.delete(item.s.id);
      }catch(error){failures.push((item.s.ref||item.s.id)+': '+(error?.message||error))}
      $('bulkProgress').textContent='Saved '+successes+' / '+changes.length+(failures.length?' · '+failures.length+' failed':'');
    }
    saveState();render();
    $('bulkProgress').textContent=successes+' saved'+(failures.length?' · '+failures.length+' failed: '+failures.slice(0,3).join('; '):'');
    if(successes)toast(successes+' snags updated');
  }finally{bulkBusy=false;renderBulkControls()}
}
function setupBulk(){
  if(!$('bulkControls'))return;
  $('bulkModeToggle').onclick=()=>{bulkMode=!bulkMode;bulkSelection.clear();bulkSourceContractor='';$('bulkFromContractor').value='';renderList();if(bulkMode)bulkRefreshContractors().catch(console.warn)};
  $('bulkFromContractor').onchange=e=>{bulkSourceContractor=e.target.value;bulkSelection.clear();renderList()};
  $('bulkAddContractor').onclick=()=>{shareProject().catch(e=>toast(e.message));$('bulkProgress').textContent='Create a contractor invitation. Once they join, return here to assign their snags.'};
  $('bulkSelectAll').onclick=()=>{getFiltered().forEach(s=>bulkSelection.add(s.id));renderList()};
  $('bulkClear').onclick=()=>{bulkSelection.clear();renderList()};
  $('bulkAll').onchange=e=>{getFiltered().forEach(s=>e.target.checked?bulkSelection.add(s.id):bulkSelection.delete(s.id));renderList()};
  $('bulkAction').onchange=bulkActionFields;
  $('bulkApply').onclick=()=>bulkApplyChanges().catch(e=>{$('bulkProgress').textContent=e.message;toast(e.message)});
  $('bulkContractor').onfocus=()=>bulkRefreshContractors().catch(e=>{$('bulkProgress').textContent=e.message});
  bulkActionFields();
}

function renderList(){const list=getFiltered().filter(s=>!bulkMode||!bulkSourceContractor||(bulkSourceContractor==='__unassigned__'?!s.assigneeId&&!s.assignee:(s.assigneeId===bulkSourceContractor||s.assignee===bulkSourceContractor)));renderBulkControls();const titles={active:'Active snags','in-progress':'In progress',review:'Needs review',resolved:'Resolved archive'};$('listTitle').textContent=titles[view.status]||'Snags';$('snagList').innerHTML=list.map(s=>`<div class="bulk-snag-row ${bulkMode&&isAdmin()?'bulk-active':''}"><label class="bulk-row-select" title="Select ${escapeHtml(s.ref)}"><input type="checkbox" data-bulk-snag="${escapeHtml(s.id)}" aria-label="Select snag ${escapeHtml(s.ref)}" ${bulkSelection.has(s.id)?'checked':''} ${!bulkMode||!isAdmin()?'disabled':''}></label><button class="snag-card" data-id="${s.id}" type="button">${thumbHtml(s)}<div class="snag-card-body"><div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.ref)}</span></div><h3>${escapeHtml(s.title)}</h3><div class="snag-foot"><span>${escapeHtml(s.location||'No location')}</span><span>·</span><span>${escapeHtml(s.assignee||'Unassigned')}</span><span>·</span><span>Updated ${fmt(s.updatedAt)}</span></div></div><div class="snag-actions">${isUnread(s)?`<span class="card-unread-dot" title="New activity"></span>`:""}<span class="activity-count">${(s.updates||[]).length} updates</span></div></button></div>`).join('');$('emptyState').classList.toggle('hidden',list.length>0);$('snagList').querySelectorAll('.snag-card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));$('snagList').querySelectorAll('[data-bulk-snag]').forEach(el=>el.onchange=()=>{if(el.checked)bulkSelection.add(el.dataset.bulkSnag);else bulkSelection.delete(el.dataset.bulkSnag);renderList()});}
function renderProjects(){$('projectList').innerHTML=state.projects.map(p=>`<div class="project-option ${p.id===selectedProjectId?'current':''}"><button type="button" data-project="${p.id}"><strong>${escapeHtml(p.name)}</strong><div class="subtle">${escapeHtml(p.address||p.type)}</div></button><span>${projectSnagCount(p.id)}</span></div>`).join('');$('projectList').querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>selectProject(b.dataset.project));}
function projectSnagCount(pid){return state.snags.filter(s=>s.projectId===pid&&s.status!=='resolved').length;}
function selectProject(id){selectedProjectId=id;state.selectedProjectId=id;saveState();const u=new URL(location.href);u.searchParams.set('project',id);history.replaceState({},'',u);$('projectDialog').close();if(firebase) subscribeFirebase();render();}
function renderSettings(){const p=project();if($('guidesEnabledInput'))$('guidesEnabledInput').checked=guidesEnabled();if($('projectLocationsInput'))$('projectLocationsInput').value=(p?.locations||[]).join('\n');if($('projectAssigneesInput'))$('projectAssigneesInput').value=(p?.assignees||[]).join('\n');$('profileNameInput').value=profile.name;$('profileRoleInput').value=profile.role;const cfg=window.SNAG_FIREBASE_CONFIG||null;if($('firebaseConfigInput')){$('firebaseConfigInput').value=cfg?JSON.stringify(cfg,null,2):'';$('firebaseConfigInput').readOnly=true}const user=firebase?.auth?.currentUser,live=!!user;$('firebaseStatusTitle').textContent=live?'Connected':'Local mode';$('firebaseBadge').className=`badge ${live?'good':'neutral'}`;$('firebaseBadge').textContent=live?'Connected':'Not signed in';$('shareWarning').classList.toggle('hidden',live);if($('accountProtectionStatus')){$('accountProtectionStatus').textContent=!user?'Cloud connection required':user.isAnonymous?'Temporary access on this device':'Protected account · '+(user.email||user.providerData?.[0]?.providerId||'signed in');$('accountProtectionStatus').className=user&&!user.isAnonymous?'notice success':'notice'}if($('protectAccountFields'))$('protectAccountFields').classList.toggle('hidden',!!user&&!user.isAnonymous);if($('protectedAccountActions'))$('protectedAccountActions').classList.toggle('hidden',!user||user.isAnonymous);mountSnagNotificationSettings();}
function openDetail(id){detailId=id;const s=state.snags.find(x=>x.id===id);if(!s)return;markSnagSeen(id);$('detailRef').textContent=s.ref;$('detailTitle').textContent=s.title;renderDetail(s);$('detailDrawer').classList.remove('hidden');$('backdrop').classList.remove('hidden');$('detailDrawer').setAttribute('aria-hidden','false');queueMicrotask(()=>hydratePrivateMedia($('detailDrawer')));}
function closeDetail(){$('detailDrawer').classList.add('hidden');$('backdrop').classList.add('hidden');$('detailDrawer').setAttribute('aria-hidden','true');detailId=null;}
function mediaHtml(items=[],context='snag'){if(!items.length)return'';return `<div class="media-grid">${items.map((m,i)=>m.type?.startsWith('image')?`<div class="media-item media-image-card"><a ${mediaAttr(m,'href')} target="_blank"><img decoding="async" ${mediaAttr(m)} alt="Attachment"></a><div class="media-version-actions"><button type="button" data-annotate-media="${i}" data-media-context="${escapeHtml(context)}">✎ Mark up</button>${m.originalUrl?`<a ${mediaAttr({url:m.originalUrl,key:m.originalKey,storage:m.storage},'href')} target="_blank">View original</a>`:''}</div></div>`:m.type?.startsWith('video')?`<div class="media-item"><video ${mediaAttr(m)} controls playsinline></video></div>`:m.type?.startsWith('audio')?`<div class="media-item"><audio ${mediaAttr(m)} controls></audio></div>`:`<a class="media-item" ${mediaAttr(m,'href')} target="_blank">Open file</a>`).join('')}</div>`;}
function renderDetail(s){
  $('detailContent').innerHTML=`
    <section class="detail-hero compact-detail-hero">
      <div class="detail-quick-actions"><button type="button" id="detailAddPhoto" class="quick-action primary-quick">📷 Add photo</button><button type="button" id="detailEditSnag" class="quick-action">✎ Edit</button><button type="button" id="detailGuide" class="quick-action">? Help</button></div>
      <div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.category)}</span></div>
      ${mediaHtml(s.media,'snag')}
      ${s.description?`<p class="detail-description">${escapeHtml(s.description)}</p>`:''}
    </section>
    <section class="conversation-primary">
      <div class="conversation-heading"><div><span class="section-kicker">SHARED THREAD</span><h3>Conversation & progress</h3></div><span class="activity-count">${(s.updates||[]).length} updates</span></div>
      <section class="composer primary-composer">
        <textarea id="updateText" rows="4" placeholder="Add an instruction, update or reply…"></textarea>
        <div class="composer-actions">
          <label class="capture-button">📎 Attach<input id="updateFile" type="file" accept="image/*,video/*,audio/*,.pdf" multiple hidden></label><select id="evidenceType" class="evidence-select" aria-label="Evidence type"><option value="progress">Progress</option><option value="after">After / completed</option><option value="evidence">Evidence</option></select>
          <button id="voiceButton" class="capture-button" type="button">🎙 Voice memo</button>
          <button id="sendUpdate" class="primary-button send-update-wide" type="button">Send update</button>
        </div>
        <div id="updatePreview" class="media-preview-strip"></div>
      </section>
      <div class="timeline">${(s.updates||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(u=>`<article class="timeline-entry"><div class="timeline-head"><strong>${escapeHtml(u.author)} · ${escapeHtml(u.role||'')}</strong><span>${fmt(u.createdAt)}</span></div>${u.text?`<p>${escapeHtml(u.text)}</p>`:''}${mediaHtml(u.media,'update:'+u.id)}</article>`).join('')||'<div class="empty-inline">No updates yet.</div>'}</div>
    </section>
    <section class="status-section"><h3>Status</h3><div class="status-controls">${Object.entries(statusLabel).map(([k,v])=>`<button type="button" data-status="${k}" class="${s.status===k?'selected':''}">${v}</button>`).join('')}${isAdmin()?`<button type="button" data-archive="1">${s.archived?'Unarchive':'Archive'}</button>`:''}</div></section>
    <details class="issue-details">
      <summary>Issue details</summary>
      <div class="detail-info-grid">
        <div class="info-card"><span>Area / location</span><strong>${escapeHtml(s.location||'—')}</strong></div>
        <div class="info-card"><span>Assigned to</span><strong>${escapeHtml(s.assignee||'—')}</strong></div>
        <div class="info-card"><span>Reported by</span><strong>${escapeHtml(s.createdBy||'—')}</strong></div>
        <div class="info-card"><span>Created</span><strong>${fmt(s.createdAt)}</strong></div>
      </div>
      ${s.outcome?`<div class="info-card"><span>Resolved when</span><strong>${escapeHtml(s.outcome)}</strong></div>`:''}
    </details>`;
  $('detailContent').querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>setStatus(s.id,b.dataset.status));
  const archiveButton=$('detailContent').querySelector('[data-archive]');if(archiveButton)archiveButton.onclick=()=>toggleArchive(s.id);
  let updateFiles=[];const uf=$('updateFile');
  uf.onchange=()=>{updateFiles=[...uf.files];renderTempPreview(updateFiles,$('updatePreview'));};
  $('sendUpdate').onclick=()=>addUpdate(s.id,$('updateText').value,updateFiles,$('evidenceType')?.value||'progress');$('detailAddPhoto').onclick=()=>$('updateFile')?.click();$('detailEditSnag').onclick=()=>openEditSnag(s.id);$('detailGuide').onclick=()=>showGuide('snag');
  $('voiceButton').onclick=()=>recordVoice(s.id);
  $('detailContent').querySelectorAll('[data-annotate-media]').forEach(b=>b.onclick=()=>annotateExistingMedia(s.id,b.dataset.mediaContext,Number(b.dataset.annotateMedia)));
}


function openEditSnag(id){const s=state.snags.find(x=>x.id===id);if(!s)return;$('editSnagHeading').textContent=`Edit ${s.ref}`;$('editSnagTitle').value=s.title||'';$('editSnagPriority').value=s.priority||'Normal';$('editSnagCategory').value=s.category||'Home snag';$('editSnagLocation').value=s.location||'';$('editSnagAssignee').value=s.assignee||'';$('editSnagDescription').value=s.description||'';$('editSnagOutcome').value=s.outcome||'';$('editSnagForm').dataset.snagId=id;$('editSnagDialog').showModal();}
async function saveSnagEdit(e){
  e.preventDefault();const id=$('editSnagForm').dataset.snagId,s=state.snags.find(x=>x.id===id);if(!s)return;
  const before={title:s.title,priority:s.priority,category:s.category,location:s.location,assignee:s.assignee,description:s.description,outcome:s.outcome},after={title:$('editSnagTitle').value.trim()||s.title,priority:$('editSnagPriority').value,category:$('editSnagCategory').value,location:$('editSnagLocation').value.trim(),assignee:$('editSnagAssignee').value.trim(),description:$('editSnagDescription').value.trim(),outcome:$('editSnagOutcome').value.trim()};if(!isAdmin())after.assignee=before.assignee;
  const labels={title:'Title',priority:'Priority',category:'Category',location:'Room',assignee:'Assigned to',description:'Description',outcome:'Requested outcome'},changes=Object.keys(after).filter(k=>String(before[k]||'')!==String(after[k]||'')).map(k=>`${labels[k]} changed`);
  Object.assign(s,after);if(isAdmin()){const match=await resolveAssigneeIdentity(s.assignee);s.assigneeId=match?.uid||match?.id||null;const participants=new Set((s.participantUids||[]).filter(Boolean));if(s.createdByUid)participants.add(s.createdByUid);if(s.assigneeId)participants.add(s.assigneeId);s.participantUids=[...participants]}
  s.updatedAt=now();if(changes.length){s.updates=s.updates||[];s.updates.push({id:uid(),type:'edit',text:changes.join(' · '),author:profile.name,authorUid:firebase?.auth?.currentUser?.uid||null,role:profile.role,createdAt:s.updatedAt,media:[]});}
  markDirty(s.id);saveState();if(firebase){await writeSnag(s);clearDirty(s.id);if(changes.length)await emitSnagNotification('snag.updated',s,'snag.updated:'+s.id+':'+s.updatedAt);}await markSnagSeen(id);$('editSnagDialog').close();render();openDetail(id);toast(changes.length?'Snag updated':'No changes');
}
function guideKey(kind){return `${LS.guide}:${selectedProjectId}:${kind}`;}
function showGuide(kind='owner'){const contractor=kind==='contractor'||(!isAdmin()&&currentMember?.role==='contractor');$('guideTitle').textContent=contractor?'Your quick guide':'Snag quick guide';$('guideContent').innerHTML=contractor?`<div class="guide-step"><b>1</b><div><strong>Check what is assigned to you</strong><p>Red dots mean something changed since you last looked.</p></div></div><div class="guide-step"><b>2</b><div><strong>Reply on the snag</strong><p>Keep questions and updates in Conversation & progress.</p></div></div><div class="guide-step"><b>3</b><div><strong>Add progress and after photos</strong><p>Tap Add photo and choose Progress or After / completed.</p></div></div><div class="guide-step"><b>4</b><div><strong>Update status</strong><p>Move work to In progress and Needs review when ready to check.</p></div></div>`:`<div class="guide-step"><b>+</b><div><strong>Add a snag</strong><p>Take a photo first if that is quickest. Details can be edited later.</p></div></div><div class="guide-step"><b>●</b><div><strong>Look for new activity</strong><p>Dots show changes you have not seen.</p></div></div><div class="guide-step"><b>✎</b><div><strong>Edit at any time</strong><p>Change room, assignee, priority, description or requested outcome.</p></div></div><div class="guide-step"><b>📷</b><div><strong>Keep the evidence</strong><p>Add Progress and After photos. Mark up a copy while retaining the original.</p></div></div>`;$('guideDialog').dataset.kind=contractor?'contractor':'owner';$('guideDialog').showModal();}
function guidesEnabled(){return localStorage.getItem(LS.guidesEnabled)!=='0';}function maybeShowFirstGuide(kind){if(guidesEnabled()&&!localStorage.getItem(guideKey(kind)))showGuide(kind);}
function finishGuide(){const kind=$('guideDialog').dataset.kind||'owner';localStorage.setItem(guideKey(kind),'1');$('guideDialog').close();}

async function removeProjectCover(){const p=project();if(!p?.coverImage)return;delete p.coverImage;p.updatedAt=now();saveState();if(firebase)await ensureProjectRemote();render();toast('Project photo removed');}
async function setProjectCover(file){if(!file)return;try{const p=project(),media=(await prepareMedia([file],`snag-projects/${selectedProjectId}/project`))[0];p.coverImage=media;p.updatedAt=now();saveState();if(firebase)await ensureProjectRemote();render();toast('Project photo updated');}catch(e){console.error(e);toast('Could not save project photo');}}
function openRoomManager(){const p=project(),rooms=projectLocations(),host=$('roomManagerList');host.innerHTML=rooms.map(room=>{const count=projectSnags().filter(s=>(s.location||'').toLowerCase()===room.toLowerCase()).length;const opts=rooms.filter(x=>x.toLowerCase()!==room.toLowerCase()).map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');return `<div class="room-manager-row"><div><strong>${escapeHtml(room)}</strong><small>${count} snag${count===1?'':'s'}</small></div><select data-room-target="${escapeHtml(room)}"><option value="">Merge into…</option>${opts}</select><button class="secondary-button" data-merge-room="${escapeHtml(room)}">Merge</button>${count===0?`<button class="text-button danger-text" data-remove-room="${escapeHtml(room)}">Remove</button>`:''}</div>`;}).join('');host.querySelectorAll('[data-merge-room]').forEach(b=>b.onclick=()=>mergeRoom(b.dataset.mergeRoom,b.parentElement.querySelector('[data-room-target]').value));host.querySelectorAll('[data-remove-room]').forEach(b=>b.onclick=()=>removeRoom(b.dataset.removeRoom));$('roomManagerDialog').showModal();}
async function mergeRoom(from,to){if(!to)return toast('Choose the room to merge into');const p=project();for(const s of projectSnags().filter(x=>(x.location||'').toLowerCase()===from.toLowerCase())){s.location=to;s.updatedAt=now();s.updates=s.updates||[];s.updates.push({id:uid(),type:'edit',text:`Room merged from ${from} into ${to}.`,author:profile.name,role:profile.role,createdAt:s.updatedAt,media:[]});if(firebase)await writeSnag(s);}p.locations=projectLocations().filter(x=>x.toLowerCase()!==from.toLowerCase());if(p.roomCovers?.[from]&&!p.roomCovers?.[to]){p.roomCovers=p.roomCovers||{};p.roomCovers[to]=p.roomCovers[from];delete p.roomCovers[from];}p.updatedAt=now();saveState();if(firebase)await ensureProjectRemote();render();openRoomManager();toast(`${from} merged into ${to}`);}
async function removeRoom(room){const p=project();if(projectSnags().some(s=>(s.location||'').toLowerCase()===room.toLowerCase()))return toast('Merge this room first — it still has snags');p.locations=projectLocations().filter(x=>x.toLowerCase()!==room.toLowerCase());if(p.roomCovers)delete p.roomCovers[room];p.updatedAt=now();saveState();if(firebase)await ensureProjectRemote();render();openRoomManager();toast('Room removed');}
function renderTempPreview(files,host){host.innerHTML=files.map((f,i)=>`<div class="preview-chip">${f.type.startsWith('image')?`<img src="${URL.createObjectURL(f)}"><button type="button" class="preview-annotate" data-annotate-file="${i}">✎</button>`:f.type.startsWith('video')?`<video src="${URL.createObjectURL(f)}"></video>`:'♪'}<button type="button" data-i="${i}">×</button></div>`).join('');host.querySelectorAll('[data-annotate-file]').forEach(b=>b.onclick=e=>{e.stopPropagation();openAnnotationForPending(files,Number(b.dataset.annotateFile),host)});}
async function optimiseMediaFile(file){if(!file.type?.startsWith('image/')||file.type==='image/gif'||file.size<900000)return file;try{const bitmap=await createImageBitmap(file),max=2000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));return blob?new File([blob],(file.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}):file}catch(e){console.warn('Photo compression failed',e);return file}}
async function makePreviewFile(file,max=480){
  if(!file?.type?.startsWith('image/')||file.type==='image/gif')return null;
  try{
    const bitmap=await createImageBitmap(file),scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    if(scale>=1&&file.size<180000){bitmap.close?.();return new File([file],(file.name||'preview').replace(/\.[^.]+$/,'')+'-preview'+((file.name||'').match(/\.[^.]+$/)?.[0]||'.jpg'),{type:file.type||'image/jpeg'})}
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.74));
    return blob?new File([blob],(file.name||'preview').replace(/\.[^.]+$/,'')+'-preview.jpg',{type:'image/jpeg'}):null;
  }catch(error){console.warn('Preview generation failed',error);return null}
}
async function uploadToR2(file,pathPrefix){
  if(!window.SNAG_R2_API||!firebase?.auth?.currentUser)throw new Error('R2 upload is not configured');
  const token=await firebase.auth.currentUser.getIdToken();
  const key=`${pathPrefix}/${uid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const response=await withTimeout(fetch(`${window.SNAG_R2_API.replace(/\/$/,'')}/objects/${key.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type||'application/octet-stream'},body:file}),10000,'Media upload');
  if(!response.ok)throw new Error(`R2 upload failed (${response.status})`);
  const data=await response.json();
  return {url:data.url,key:data.key||key,name:file.name,type:file.type,size:file.size,local:false,storage:'r2'};
}
async function uploadMediaWithPreview(file,pathPrefix){
  const media=await uploadToR2(file,pathPrefix);
  if(!file.type?.startsWith('image/')||file.type==='image/gif')return media;
  const preview=await makePreviewFile(file);
  if(!preview)return media;
  try{
    const p=await uploadToR2(preview,pathPrefix+'/previews');
    media.previewUrl=p.url;media.previewKey=p.key;media.previewType=p.type;media.previewSize=p.size;
  }catch(error){console.warn('Preview upload failed; keeping full image available',error)}
  return media;
}

async function prepareMedia(files,pathPrefix){
  const result=[];
  for(const original of files){
    const file=await optimiseMediaFile(original);
    if(window.SNAG_R2_API&&firebase?.auth?.currentUser){
      if(original._originalFile){
        const base=await optimiseMediaFile(original._originalFile);
        const originalMedia=await uploadToR2(base,pathPrefix+'/originals');
        const annotated=await uploadMediaWithPreview(file,pathPrefix);
        annotated.originalUrl=originalMedia.url;annotated.originalKey=originalMedia.key;annotated.annotated=true;
        result.push(annotated);
      }else result.push(await uploadMediaWithPreview(file,pathPrefix));
    }else{
      if(file.type?.startsWith('video/'))throw new Error('Video needs cloud sync. Firebase is not connected yet.');
      if(file.size>2.5*1024*1024)throw new Error('Photo is too large for local mode. Reconnect Firebase and try again.');
      const local=await fileToDataUrl(file);
      if(original._originalFile){const o=await fileToDataUrl(await optimiseMediaFile(original._originalFile));local.originalUrl=o.url;local.annotated=true;}
      result.push(local);
    }
  }
  return result;
}
async function backfillMediaPreviews(limit=4){
  if(!firebase?.auth?.currentUser||!window.SNAG_R2_API||!isAdmin())return;
  let remaining=Math.max(0,Number(limit)||0),changed=false;
  for(const snag of visibleProjectSnags()){
    if(!remaining)break;
    let snagMediaChanged=false;
    for(const item of snag.media||[]){
      if(!remaining)break;if(!item?.type?.startsWith('image/')||item.previewKey||item.storage!=='r2'||!item.key)continue;
      try{
        const blob=await privateMediaBlob(item),file=new File([blob],item.name||'image.jpg',{type:blob.type||item.type||'image/jpeg'}),preview=await makePreviewFile(file);
        if(!preview)continue;
        const p=await uploadToR2(preview,`snag-projects/${selectedProjectId}/snags/${snag.id}/previews`);
        Object.assign(item,{previewUrl:p.url,previewKey:p.key,previewType:p.type,previewSize:p.size});remaining--;snagMediaChanged=true;changed=true;
      }catch(error){console.warn('Preview backfill skipped',item.key,error)}
    }
    if(snagMediaChanged)await firebase.fsMod.setDoc(firebase.fsMod.doc(firebase.db,'snag_projects',selectedProjectId,'snags',snag.id),{media:snag.media},{merge:true});
    for(const update of snag.updates||[]){
      if(!remaining)break;let updateChanged=false;
      for(const item of update.media||[]){
        if(!remaining)break;if(!item?.type?.startsWith('image/')||item.previewKey||item.storage!=='r2'||!item.key)continue;
        try{
          const blob=await privateMediaBlob(item),file=new File([blob],item.name||'image.jpg',{type:blob.type||item.type||'image/jpeg'}),preview=await makePreviewFile(file);
          if(!preview)continue;
          const p=await uploadToR2(preview,`snag-projects/${selectedProjectId}/snags/${snag.id}/updates/${update.id}/previews`);
          Object.assign(item,{previewUrl:p.url,previewKey:p.key,previewType:p.type,previewSize:p.size});remaining--;updateChanged=true;changed=true;
        }catch(error){console.warn('Update preview backfill skipped',item.key,error)}
      }
      if(updateChanged)await firebase.fsMod.setDoc(firebase.fsMod.doc(firebase.db,'snag_projects',selectedProjectId,'snags',snag.id,'updates',update.id),{media:update.media},{merge:true});
    }
  }
  if(changed){saveState();render()}
}

async function createSnag(e){
  e.preventDefault();
  if(!await requireCommercialAccess('createSnag'))return;
  const submitter=e.submitter;
  if(submitter?.value==='cancel')return $('snagDialog').close();
  const description=$('snagDescriptionInput').value.trim();
  const enteredTitle=$('snagTitleInput').value.trim();
  const hasMedia=pendingFiles.length>0;
  const error=$('snagFormError');
  error.classList.add('hidden'); error.textContent='';
  if(!enteredTitle&&!description&&!hasMedia){
    error.textContent='Add a photo/video, a title, or a short description before creating the snag.';
    error.classList.remove('hidden');
    error.scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  const mediaLead=pendingFiles[0]?.type?.startsWith('video/')?'Video snag':pendingFiles[0]?.type?.startsWith('image/')?'Photo snag':'New snag';
  const title=enteredTitle||(description.split(/\n|[.!?]/)[0].trim().slice(0,90)||mediaLead);const id=uid(),t=now();$('createSnagSubmit').disabled=true;$('createSnagSubmit').textContent=pendingFiles.length?'Uploading…':'Saving…';try{const media=await prepareMedia(pendingFiles,`snag-projects/${selectedProjectId}/snags/${id}`);const assignee=$('snagAssigneeInput').value.trim(),match=await resolveAssigneeIdentity(assignee),creatorUid=firebase?.auth?.currentUser?.uid||null,assigneeId=match?.uid||match?.id||null,participantUids=[...new Set([creatorUid,assigneeId].filter(Boolean))];const snag={id,projectId:selectedProjectId,ref:nextRef(),title,category:$('snagCategoryInput').value,priority:$('snagPriorityInput').value,location:$('snagLocationInput').value.trim(),assignee,assigneeId,participantUids,description,outcome:$('snagOutcomeInput').value.trim(),status:'open',archived:false,createdAt:t,updatedAt:t,createdBy:profile.name,createdByUid:creatorUid,media,updates:[{id:uid(),type:'note',text:'Snag recorded.',author:profile.name,authorUid:creatorUid,role:profile.role,createdAt:t,media:[]} ]};state.snags.push(snag);markDirty(snag.id);saveState();if(firebase){await writeSnag(snag);clearDirty(snag.id);await emitSnagNotification('snag.created',snag,'snag.created:'+snag.id);}await markSnagSeen(id);$('snagDialog').close();$('snagForm').reset();pendingFiles=[];$('newMediaPreview').innerHTML='';toast('Snag created');render();openDetail(id);}catch(err){console.error(err);const msg=err?.message||'Could not save the snag';const formError=$('snagFormError');if(formError){formError.textContent=msg;formError.classList.remove('hidden');formError.scrollIntoView({behavior:'smooth',block:'center'});}toast(msg);}finally{$('createSnagSubmit').disabled=false;$('createSnagSubmit').textContent='Create snag';}}
async function addUpdate(id,text,files=[],evidenceType='progress'){text=text.trim();if(!text&&!files.length)return;const s=state.snags.find(x=>x.id===id);const u={id:uid(),type:'note',evidenceType,text,author:profile.name,authorUid:firebase?.auth?.currentUser?.uid||null,role:profile.role,createdAt:now(),media:await prepareMedia(files,`snag-projects/${selectedProjectId}/snags/${id}/updates`)};s.updates=s.updates||[];s.updates.push(u);s.updatedAt=u.createdAt;markDirty(s.id);saveState();if(firebase){await writeUpdate(s,u);clearDirty(s.id);await emitSnagNotification('snag.comment_added',s,'snag.comment_added:'+u.id);}await markSnagSeen(id);render();openDetail(id);toast('Update added');}
async function setStatus(id,status){const s=state.snags.find(x=>x.id===id);if(!s||s.status===status)return;s.status=status;s.updatedAt=now();s.resolvedAt=status==='resolved'?s.updatedAt:null;markDirty(s.id);s.updates.push({id:uid(),type:'status',text:`Status changed to ${statusLabel[status]}.`,author:profile.name,role:profile.role,createdAt:s.updatedAt,media:[]});saveState();if(firebase){await writeSnag(s);clearDirty(s.id);await emitSnagNotification('snag.status_changed',s,'snag.status_changed:'+s.id+':'+s.updatedAt);}await markSnagSeen(id);render();openDetail(id);toast(`Moved to ${statusLabel[status]}`);}
async function toggleArchive(id){const s=state.snags.find(x=>x.id===id);s.archived=!s.archived;s.updatedAt=now();markDirty(s.id);saveState();if(firebase){await writeSnag(s);clearDirty(s.id);}render();openDetail(id);toast(s.archived?'Archived':'Restored');}
function similarTo(text){const stop=new Set(['the','and','this','that','with','from','into','when','does','not','for','are','was','has','have','home','snag']);const words=new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w=>w.length>3&&!stop.has(w))||[]);return projectSnags().filter(s=>s.status==='resolved').map(s=>{const sw=new Set(`${s.title} ${s.description} ${s.location}`.toLowerCase().match(/[a-z0-9]+/g)||[]);let hits=0;words.forEach(w=>{if(sw.has(w))hits++});return{s,score:words.size?hits/words.size:0};}).filter(x=>x.score>.12).sort((a,b)=>b.score-a.score).slice(0,3);}
function renderSimilar(){const text=`${$('snagTitleInput').value} ${$('snagDescriptionInput').value} ${$('snagLocationInput').value}`;const matches=similarTo(text);$('similarPanel').classList.toggle('hidden',!matches.length);$('similarResults').innerHTML=matches.map(x=>`<div class="similar-item"><strong>${escapeHtml(x.s.ref)} · ${escapeHtml(x.s.title)}</strong><div class="subtle">Resolved ${x.s.resolvedAt?fmt(x.s.resolvedAt):''} · ${escapeHtml(x.s.location||'')}</div></div>`).join('');}



function loadImageSource(src){return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});}
function annotationCanvas(){return $('annotationCanvas');}
function redrawAnnotation(){
  const canvas=annotationCanvas(),ctx=canvas.getContext('2d'),img=annotationState.image;if(!img)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  for(const stroke of annotationState.history){ctx.strokeStyle=stroke.colour;ctx.lineWidth=Math.max(4,canvas.width/180);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();stroke.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
}
async function openAnnotation(src,meta){
  try{
    annotationState={...annotationState,...meta,history:[],colour:'#ef4444',source:src};
    const img=await loadImageSource(src);annotationState.image=img;
    const canvas=annotationCanvas(),max=1800,scale=Math.min(1,max/img.naturalWidth);
    canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
    redrawAnnotation();$('annotateDialog').showModal();
  }catch(e){console.error(e);toast('Could not open this image for markup');}
}
function openAnnotationForPending(files,index,host){const f=files[index];if(!f?.type?.startsWith('image/'))return;openAnnotation(URL.createObjectURL(f),{mode:'pending',files,index,host,originalFile:f._originalFile||f});}
async function annotateExistingMedia(snagId,context,index){
  const snag=state.snags.find(x=>x.id===snagId);if(!snag)return;
  let item,update=null;if(context.startsWith('update:')){const updateId=context.slice(7);update=(snag.updates||[]).find(u=>u.id===updateId);item=update?.media?.[index];}else item=snag.media?.[index];
  if(!item?.type?.startsWith('image/'))return;
  const src=await privateMediaRuntimeUrl(item),original=await privateMediaRuntimeUrl({url:item.originalUrl||item.url,key:item.originalKey||item.key,storage:item.storage});
  await openAnnotation(src,{mode:'existing',snagId,context,index,item,updateId:update?.id||null,originalUrl:original});
}
function pointerPos(e,canvas){const r=canvas.getBoundingClientRect(),p=e.touches?.[0]||e;return{x:(p.clientX-r.left)*canvas.width/r.width,y:(p.clientY-r.top)*canvas.height/r.height};}
function bindAnnotationCanvas(){
  const canvas=annotationCanvas();let drawing=false,stroke=null;
  const start=e=>{e.preventDefault();drawing=true;stroke={colour:annotationState.colour,points:[pointerPos(e,canvas)]};annotationState.history.push(stroke);};
  const move=e=>{if(!drawing)return;e.preventDefault();stroke.points.push(pointerPos(e,canvas));redrawAnnotation();};
  const end=e=>{if(!drawing)return;e?.preventDefault?.();drawing=false;redrawAnnotation();};
  canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
}
async function saveAnnotation(){
  const canvas=annotationCanvas();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)return toast('Could not save markup');
  const annotated=new File([blob],`annotated-${Date.now()}.jpg`,{type:'image/jpeg'});
  if(annotationState.mode==='pending'){
    annotated._originalFile=annotationState.originalFile;
    annotationState.files[annotationState.index]=annotated;
    if(annotationState.files===pendingFiles)pendingFiles=annotationState.files;
    renderTempPreview(annotationState.files,annotationState.host);
    $('annotateDialog').close();toast('Markup saved · original preserved');return;
  }
  if(annotationState.mode==='existing'){
    const snag=state.snags.find(x=>x.id===annotationState.snagId);if(!snag)return;
    const uploaded=(await prepareMedia([Object.assign(annotated,{_originalFile:null})],`snag-projects/${selectedProjectId}/snags/${snag.id}/annotations`))[0];
    uploaded.originalUrl=annotationState.originalUrl;uploaded.annotated=true;
    if(annotationState.context.startsWith('update:')){
      const u=(snag.updates||[]).find(x=>x.id===annotationState.updateId);u.media[annotationState.index]={...u.media[annotationState.index],...uploaded};await writeUpdate(snag,u);
    }else{
      snag.media[annotationState.index]={...snag.media[annotationState.index],...uploaded};await writeSnag(snag);
    }
    snag.updatedAt=now();saveState();$('annotateDialog').close();render();openDetail(snag.id);toast('Markup saved · original preserved');
  }
}
function cameraDiag(message){const d=$('cameraDiagnostics');if(d)d.textContent=message||'';}
function stopCameraTest(){
  if(cameraTestStream){cameraTestStream.getTracks().forEach(t=>t.stop());cameraTestStream=null;}
  const v=$('cameraTestPreview');if(v){v.srcObject=null;v.classList.remove('ready');}
}
async function startCameraTest(){
  stopCameraTest();
  const status=$('cameraTestStatus'),video=$('cameraTestPreview');
  status.classList.remove('hidden');status.textContent='Requesting camera…';cameraDiag('');
  if(!window.isSecureContext){status.textContent='Camera needs a secure HTTPS page.';cameraDiag('window.isSecureContext = false');return;}
  if(!navigator.mediaDevices?.getUserMedia){status.textContent='This browser does not expose getUserMedia.';return;}
  try{
    const constraints={audio:false,video:{facingMode:{ideal:cameraTestFacing},width:{ideal:1920},height:{ideal:1440}}};
    cameraTestStream=await navigator.mediaDevices.getUserMedia(constraints);
    const track=cameraTestStream.getVideoTracks()[0];
    video.muted=true;video.playsInline=true;video.autoplay=true;video.srcObject=cameraTestStream;
    await video.play();
    await new Promise((resolve,reject)=>{
      if(video.readyState>=2&&video.videoWidth>0)return resolve();
      const timer=setTimeout(()=>reject(new Error('No video frames arrived within 5 seconds')),5000);
      video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve()},{once:true});
    });
    status.classList.add('hidden');video.classList.add('ready');
    const settings=track?.getSettings?.()||{};
    cameraDiag(`Camera active · ${settings.width||video.videoWidth}×${settings.height||video.videoHeight} · track ${track?.readyState||'unknown'}`);
  }catch(err){
    console.error('Camera test failed',err);
    const name=err?.name||'CameraError',msg=err?.message||'Unknown camera error';
    status.classList.remove('hidden');
    if(name==='NotAllowedError'){
      const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
      status.innerHTML=isiOS
        ? '<strong>Camera access is blocked</strong><span>On iPhone/iPad, open Settings → Apps → Safari → Camera and choose Ask or Allow. Then return here and try again. Safari may not show a permission popup if Camera is already set to Deny.</span>'
        : '<strong>Camera access is blocked</strong><span>Allow camera access for this site in your browser settings, then try again.</span>';
      cameraDiag('HTTPS: '+window.isSecureContext+' · camera permission blocked (NotAllowedError)');
    }else{
      status.innerHTML='<strong>Camera preview failed</strong><span>'+escapeHtml(name)+': '+escapeHtml(msg)+'</span>';
      cameraDiag('HTTPS: '+window.isSecureContext+' · permission/device error: '+name);
    }
  }
}
async function openCameraTest(){
  $('cameraTestDialog').showModal();
  await startCameraTest();
}
function closeCameraTest(){stopCameraTest();if($('cameraTestDialog').open)$('cameraTestDialog').close();}
async function switchCameraTest(){cameraTestFacing=cameraTestFacing==='environment'?'user':'environment';await startCameraTest();}
async function takeCameraTestPhoto(){
  const video=$('cameraTestPreview');if(!cameraTestStream||video.readyState<2||!video.videoWidth){toast('No live camera frame is available');return;}
  const canvas=$('cameraTestCanvas'),maxWidth=2000,scale=Math.min(1,maxWidth/video.videoWidth);
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
  if(!blob)return toast('Could not capture the camera frame');
  addPending([new File([blob],`snag-photo-${Date.now()}.jpg`,{type:'image/jpeg'})]);closeCameraTest();toast('Photo attached');
}

async function recordVoice(id){if(mediaRecorder?.state==='recording'){mediaRecorder.stop();return;}if(!navigator.mediaDevices?.getUserMedia)return toast('Voice recording is not supported here');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>voiceChunks.push(e.data);mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(voiceChunks,{type:mediaRecorder.mimeType||'audio/webm'});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await addUpdate(id,'Voice memo',[file]);};mediaRecorder.start();$('voiceButton').textContent='■ Stop recording';toast('Recording voice memo…');}catch(e){toast('Microphone permission was not available');}}
function newSnag(){pendingFiles=[];$('newMediaPreview').innerHTML='';$('snagForm').reset();$('similarPanel').classList.add('hidden');$('snagFormError')?.classList.add('hidden');$('snagDialog').showModal();}
function addPending(files){pendingFiles=[...pendingFiles,...files];renderTempPreview(pendingFiles,$('newMediaPreview'));$('newMediaPreview').querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{pendingFiles.splice(Number(b.dataset.i),1);addPending([]);});}
function settingsTab(tab,{focus=false}={}){
  for(const button of document.querySelectorAll('[data-settings-tab]')){
    const active=button.dataset.settingsTab===tab;
    button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    if(active&&focus)button.focus();
  }
  for(const panel of document.querySelectorAll('.settings-panel'))panel.hidden=panel.id!=='settings-panel-'+tab;
}
function inviteUrl(id){
  const url=new URL(location.origin+location.pathname);
  url.searchParams.set('project',selectedProjectId);
  url.searchParams.set('invite',id);
  return url.toString();
}
function shareInvitationText(label){
  return 'You have been invited to '+(project()?.name||'a Snag project')+' on Snag'+(label?' ('+label+')':'')+'. Open this private invitation link to join:';
}
function selectedInvitation(){
  const url=$('shareLinkInput')?.value?.trim();
  if(!url)throw new Error('Create or select an invitation first');
  const parsed=new URL(url,location.href);
  if(parsed.origin!==location.origin||parsed.pathname!==location.pathname||!parsed.searchParams.get('invite')||parsed.searchParams.get('project')!==selectedProjectId)throw new Error('Invitation link is not valid for this project');
  return {url:parsed.toString(),label:$('shareInviteDescription')?.dataset.label||''};
}
function showInvitationLink(inviteId,label,role){
  $('shareLinkInput').value=inviteUrl(inviteId);
  $('shareInviteDescription').textContent=(project()?.name||'Project')+' · '+label+' · '+(role||'contractor');
  $('shareInviteDescription').dataset.label=label;
  $('shareInviteReady').hidden=false;
  $('shareInviteReady').scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function copyInvitationLink(){
  try{
    const {url}=selectedInvitation();
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);
    else{
      const field=$('shareLinkInput');field.focus();field.select();
      if(!document.execCommand?.('copy'))throw new Error('Clipboard unavailable; select and copy the link');
    }
    toast('Invitation link copied');
  }catch(e){toast(e.message)}
}
async function shareInvitationNative(){
  let invite;
  try{invite=selectedInvitation()}catch(e){toast(e.message);return}
  const payload={title:'Snag project invitation',text:shareInvitationText(invite.label),url:invite.url};
  if(typeof navigator.share==='function'){
    try{await navigator.share(payload);return}
    catch(e){if(e?.name==='AbortError')return;console.warn('Native sharing unavailable',e)}
  }
  await copyInvitationLink();
  toast('Link copied. Paste it into WhatsApp, Messages or Mail.');
}
function shareInvitationChannel(channel){
  let invite;
  try{invite=selectedInvitation()}catch(e){toast(e.message);return}
  const message=shareInvitationText(invite.label)+' '+invite.url;
  let url;
  if(channel==='whatsapp')url='https://wa.me/?text='+encodeURIComponent(message);
  else if(channel==='email')url='mailto:?subject='+encodeURIComponent('Snag project invitation')+'&body='+encodeURIComponent(message);
  else if(channel==='messages')url='sms:&body='+encodeURIComponent(message);
  else return;
  // Must remain a direct click-driven navigation to avoid iOS popup blockers.
  if(channel==='messages'||channel==='email')location.href=url;
  else window.open(url,'_blank','noopener,noreferrer');
}
async function shareProject(){
  if(!await requireCommercialAccess('shareProject'))return;
  if(!firebase?.auth?.currentUser)return toast('Cloud sharing is not connected yet');
  $('shareLabelInput').value='';$('shareRoleInput').value='contractor';$('shareAdminInput').checked=false;
  $('shareLinkInput').value='';$('shareInviteReady').hidden=true;
  $('shareProjectName').textContent=project()?.name||'Your project';
  $('shareWarning').classList.add('hidden');
  $('shareDialog').showModal();
  await renderAccessLinks();
}
async function createShareLink(){
  if(!await requireCommercialAccess('shareProject'))return;
  if(!firebase?.auth?.currentUser)return toast('Cloud sharing is not connected yet');
  const btn=$('createShareLinkButton');btn.disabled=true;btn.textContent='Creating…';
  try{
    const {fsMod,db,auth}=firebase,projectRef=fsMod.doc(db,'snag_projects',selectedProjectId);
    const snap=await withTimeout(fsMod.getDoc(projectRef),7000,'Project access check');
    if(!snap.exists())throw new Error('Project is not available in the cloud');
    if(snap.data()?.ownerUid!==auth.currentUser.uid)throw new Error('Only the project owner can create access links');
    const inviteId=randomCapability(),label=$('shareLabelInput').value.trim()||'Contractor access',role=$('shareRoleInput').value,admin=$('shareAdminInput').checked;
    await withTimeout(fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'invites',inviteId),{active:true,label,role,admin,persistent:true,createdAt:now(),createdBy:auth.currentUser.uid}),9000,'Create access link');
    showInvitationLink(inviteId,label,role);
    await renderAccessLinks();
    toast('Unique invitation created. Share it with your contractor.');
  }catch(e){console.error(e);$('shareWarning').textContent=firebaseErrorMessage(e);$('shareWarning').classList.remove('hidden');toast(firebaseErrorMessage(e))}
  finally{btn.disabled=false;btn.textContent='Create unique link'}
}
async function renderAccessLinks(){
  const host=$('accessLinkList');if(!host||!firebase?.auth?.currentUser)return;
  try{
    const {fsMod,db,q}=firebase,query=fsMod.query(fsMod.collection(db,'snag_projects',selectedProjectId,'invites'));
    const snap=await fsMod.getDocs(query),rows=[];snap.forEach(d=>rows.push({id:d.id,...d.data()}));
    rows.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    host.innerHTML=rows.length?rows.map(x=>'<div class="access-link-row"><div class="access-link-info"><strong>'+escapeHtml(x.label||'Access link')+'</strong><span>'+escapeHtml(x.role||'contractor')+(x.admin?' · Admin':'')+' · '+(x.active?'Active':'Revoked')+'</span></div><div class="access-link-buttons">'+(x.active?'<button type="button" data-share-invite="'+escapeHtml(x.id)+'" class="share-again-button">Share</button><button type="button" data-revoke-invite="'+escapeHtml(x.id)+'" class="share-revoke-button">Revoke</button>':'')+'</div></div>').join(''):'<p class="share-help">No invitations yet. Create a unique link above.</p>';
    host.querySelectorAll('[data-share-invite]').forEach(button=>button.onclick=()=>{
      const item=rows.find(x=>x.id===button.dataset.shareInvite);
      if(item)showInvitationLink(item.id,item.label||'Contractor access',item.role);
    });
    host.querySelectorAll('[data-revoke-invite]').forEach(button=>button.onclick=async()=>{
      if(!confirm('Revoke this invitation and remove linked access?'))return;
      try{await revokeInvite(button.dataset.revokeInvite);
        if($('shareLinkInput').value===inviteUrl(button.dataset.revokeInvite)){$('shareLinkInput').value='';$('shareInviteReady').hidden=true}
      }catch(e){toast(firebaseErrorMessage(e))}
    });
  }catch(e){host.innerHTML='<p class="share-help">Only the project owner can manage invitations.</p>';}
}
async function revokeInvite(inviteId){
  const {fsMod,db}=firebase;await fsMod.updateDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'invites',inviteId),{active:false,revokedAt:now(),revokedBy:firebase.auth.currentUser.uid});
  const q=fsMod.query(fsMod.collection(db,'snag_projects',selectedProjectId,'members'),fsMod.where('inviteId','==',inviteId)),snap=await fsMod.getDocs(q);
  for(const d of snap.docs)await fsMod.deleteDoc(d.ref);
  projectMemberCache={projectId:null,at:0,rows:[]};await renderAccessLinks();toast(`Access revoked${snap.size?' for '+snap.size+' joined member'+(snap.size===1?'':'s'):''}`);
}
function randomCapability(){const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function connectFirebase(){try{const cfg=window.SNAG_FIREBASE_CONFIG;if(!cfg)throw new Error('Missing central config');localStorage.setItem(LS.firebase,JSON.stringify(cfg));await initFirebase(cfg);toast('Firebase connected');render();}catch(e){console.error(e);toast('Firebase config could not be connected');}}

function rememberSharedAccess(projectId,inviteId,role){
  if(!projectId||!inviteId)return;
  localStorage.setItem(LS.access,JSON.stringify({projectId,inviteId,role:role||'contractor',savedAt:now()}));
}
function ensureLegacyBridge(){
  if(!window.SNAG_CLOUD?.legacy)return Promise.resolve({authenticated:false});
  if(legacyBridgeReadyPromise)return legacyBridgeReadyPromise;
  legacyBridgeReadyPromise=new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');legacyBridgeFrame=frame;frame.hidden=true;frame.setAttribute('aria-hidden','true');
    const timer=setTimeout(()=>{window.removeEventListener('message',onMessage);reject(new Error('Legacy migration bridge timed out'))},10000);
    function onMessage(event){
      if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.source!=='snag-legacy-bridge'||event.data?.type!=='ready')return;
      clearTimeout(timer);window.removeEventListener('message',onMessage);resolve(event.data);
    }
    window.addEventListener('message',onMessage);frame.src='legacy-bridge.html?v='+encodeURIComponent(APP_BUILD);document.body.appendChild(frame);
  });
  return legacyBridgeReadyPromise;
}
async function exportLegacyProject(projectId){
  const ready=await ensureLegacyBridge();
  if(!ready?.authenticated)return {status:'no-session'};
  const requestId=uid();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{window.removeEventListener('message',onMessage);reject(new Error('Legacy project export timed out'))},15000);
    function onMessage(event){
      if(event.origin!==location.origin||event.source!==legacyBridgeFrame?.contentWindow||event.data?.source!=='snag-legacy-bridge'||event.data?.type!=='export-result'||event.data?.requestId!==requestId)return;
      clearTimeout(timer);window.removeEventListener('message',onMessage);if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.data);
    }
    window.addEventListener('message',onMessage);
    legacyBridgeFrame.contentWindow.postMessage({source:'snag-current-app',type:'export-project',requestId,projectId},location.origin);
  });
}
function mergeLegacyIntoLocal(data){
  if(!data?.project)return;
  const legacyProject={...data.project,id:data.project.id||selectedProjectId},localProject=state.projects.find(p=>p.id===selectedProjectId);
  const mergedProject={...legacyProject,...(localProject||{}),id:selectedProjectId};
  const pi=state.projects.findIndex(p=>p.id===selectedProjectId);if(pi>=0)state.projects[pi]=mergedProject;else state.projects.push(mergedProject);
  const dirty=dirtyMap();
  for(const remote of data.snags||[]){
    const snag={...remote,id:remote.id,projectId:selectedProjectId},i=state.snags.findIndex(x=>x.id===snag.id);
    if(i<0)state.snags.push(snag);else if(!dirty[snag.id])state.snags[i]=snag;
  }
  saveState();
}
async function registerUserProject(projectId,role='member',stableId=snagUserId()){
  if(!firebase?.auth?.currentUser)return;
  const {fsMod,db,auth}=firebase,uidNow=auth.currentUser.uid;
  await fsMod.setDoc(fsMod.doc(db,'snag_users',uidNow),{uid:uidNow,snagUserId:stableId,lastSeenAt:now(),protected:!auth.currentUser.isAnonymous,email:auth.currentUser.email||null},{merge:true});
  await fsMod.setDoc(fsMod.doc(db,'snag_users',uidNow,'projects',projectId),{projectId,role,lastSeenAt:now()},{merge:true});
}
async function restoreProjectsForCurrentUser(){
  if(!firebase?.auth?.currentUser)return 0;
  const {fsMod,db,auth}=firebase,uidNow=auth.currentUser.uid;
  try{
    const profileSnap=await fsMod.getDoc(fsMod.doc(db,'snag_users',uidNow));if(profileSnap.exists())adoptSnagUserId(profileSnap.data().snagUserId);
    const refs=await fsMod.getDocs(fsMod.collection(db,'snag_users',uidNow,'projects'));let restored=0;
    for(const d of refs.docs){
      try{const pSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',d.id));if(!pSnap.exists())continue;const p={id:d.id,...pSnap.data()},i=state.projects.findIndex(x=>x.id===d.id);if(i>=0)state.projects[i]=p;else state.projects.push(p);restored++;}catch(e){}
    }
    if(restored){const known=refs.docs.find(d=>state.projects.some(p=>p.id===d.id));if(known){selectedProjectId=known.id;state.selectedProjectId=known.id}saveState()}
    return restored;
  }catch(e){console.warn('Could not restore protected projects',e);return 0}
}
async function migrateLegacyProjectIfNeeded(){
  if(!firebase?.auth?.currentUser||!window.SNAG_CLOUD?.legacy||window.SNAG_CLOUD.legacy.projectId===window.SNAG_FIREBASE_CONFIG?.projectId)return {status:'none'};
  const newUid=firebase.auth.currentUser.uid,record=migrationFor(selectedProjectId);
  if(record?.status==='complete'&&record?.primaryUid===newUid)return {status:'complete',role:record.role||'owner'};
  diagStep('Legacy migration','running','Checking kk-syllabus read-only archive');
  let legacy;
  try{legacy=await exportLegacyProject(selectedProjectId)}catch(e){diagStep('Legacy migration','error',e.message);return {status:'unavailable'}}
  if(!legacy||legacy.status!=='ok'){diagStep('Legacy migration','ok',legacy?.status==='no-session'?'No previous Firebase session on this device':'No legacy project found');return {status:legacy?.status||'none'}}

  mergeLegacyIntoLocal(legacy);
  const stableId=legacy.member?.snagUserId||legacy.project?.ownerSnagUserId||snagUserId();adoptSnagUserId(stableId);
  const {fsMod,db,auth}=firebase,projectId=selectedProjectId;
  if(legacy.isOwner){
    const ref=fsMod.doc(db,'snag_projects',projectId);
    let snap=await fsMod.getDoc(ref);
    if(!snap.exists()){
      const p={...legacy.project,...project(),id:undefined,ownerUid:newUid,ownerSnagUserId:stableId,legacyOwnerUid:legacy.legacyUid,migratedFrom:'kk-syllabus',migratedAt:now(),updatedAt:now()};delete p.id;
      await fsMod.setDoc(ref,p);
      snap=await fsMod.getDoc(ref);
    }else if(snap.data().ownerUid!==newUid){
      throw new Error('This project has already been migrated by a different Firebase identity');
    }
    await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'members',newUid),{uid:newUid,snagUserId:stableId,name:profile.name,role:'owner',admin:true,legacyUid:legacy.legacyUid,joinedAt:legacy.member?.joinedAt||now(),migratedAt:now()},{merge:true});
    for(const invite of legacy.invites||[]){const {id,...data}=invite;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'invites',id),data,{merge:true})}
    for(const snag of legacy.snags||[]){const {updates=[],id,...data}=snag;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'snags',id),{...data,projectId},{merge:true});for(const update of updates){const {id:uid2,...u}=update;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'snags',id,'updates',uid2),u,{merge:true})}}
    for(const seen of legacy.seen||[]){const {id,...data}=seen;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'members',newUid,'seen',id),data,{merge:true})}
    for(const note of legacy.privateNotes||[]){const {id,...data}=note;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'private_notes',id),{...data,authorUid:newUid,legacyAuthorUid:legacy.legacyUid},{merge:true})}
    currentMember={uid:newUid,snagUserId:stableId,name:profile.name,role:'owner',admin:true};
    await registerUserProject(projectId,'owner',stableId);
    saveMigration(projectId,{status:'complete',role:'owner',legacyUid:legacy.legacyUid,primaryUid:newUid});
    diagStep('Legacy migration','ok',`${legacy.snags?.length||0} snags and ${legacy.invites?.length||0} access links migrated`);
    return {status:'complete',role:'owner'};
  }

  const member=legacy.member,inviteId=member?.inviteId||((savedAccess?.projectId===projectId)?savedAccess?.inviteId:null);
  if(inviteId){
    try{
      await joinInvitedProject(projectId,inviteId);
      const memberRef=fsMod.doc(db,'snag_projects',projectId,'members',newUid);
      await fsMod.setDoc(memberRef,{snagUserId:stableId,legacyUid:legacy.legacyUid,migratedAt:now()},{merge:true});
      for(const seen of legacy.seen||[]){const {id,...data}=seen;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'members',newUid,'seen',id),data,{merge:true})}
      for(const note of legacy.privateNotes||[]){const {id,...data}=note;await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'private_notes',id),{...data,authorUid:newUid,legacyAuthorUid:legacy.legacyUid},{merge:true})}
      await registerUserProject(projectId,member?.role||'member',stableId);
      saveMigration(projectId,{status:'complete',role:'member',legacyUid:legacy.legacyUid,primaryUid:newUid});
      diagStep('Legacy migration','ok','Existing member access restored');
      return {status:'complete',role:'member'};
    }catch(e){
      console.warn('Project owner has not migrated the shared project yet',e);
    }
  }
  saveMigration(projectId,{status:'waiting',role:'member',legacyUid:legacy.legacyUid,primaryUid:newUid});
  diagStep('Legacy migration','waiting','Legacy data loaded locally; waiting for the project owner to migrate shared access');
  return {status:'waiting',role:'member'};
}
function dataUrlToFile(item){
  if(!item?.url?.startsWith('data:'))return null;
  const [head,data]=item.url.split(',');
  const mime=(head.match(/data:([^;]+)/)||[])[1]||item.type||'application/octet-stream';
  const binary=head.includes(';base64')?atob(data):decodeURIComponent(data);
  const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new File([bytes],item.name||('attachment-'+Date.now()),{type:mime});
}
async function migrateMediaItems(items,pathPrefix){
  const out=[];
  for(const item of (items||[])){
    if(item?.storage==='r2'||(!item?.local&&!item?.url?.startsWith('data:'))){out.push(item);continue;}
    const file=dataUrlToFile(item);
    if(!file){out.push(item);continue;}
    const optimised=await optimiseMediaFile(file);
    out.push(await uploadToR2(optimised,pathPrefix));
  }
  return out;
}
async function migrateLocalProjectToCloud(uploadAll=false){
  if(!firebase?.auth?.currentUser)return {total:0,written:0,mediaFailed:0,failed:0};
  const pending=uploadAll?state.snags.filter(s=>s.projectId===selectedProjectId):pendingDirty().filter(s=>s.projectId===selectedProjectId);
  let written=0,failed=0,mediaFailed=0;
  if(!pending.length){diagStep('Pending uploads','ok','0 local changes');return {total:0,written:0,mediaFailed:0,failed:0}}
  for(const snag of pending){
    const label=`Pending · ${snag.ref||snag.id}`;diagStep(label,'running','Uploading local change');
    try{
      const cloudSnag={...snag,media:await migrateMediaItems(snag.media,`snag-projects/${selectedProjectId}/snags/${snag.id}`),updates:[]};
      for(const update of (snag.updates||[]))cloudSnag.updates.push({...update,media:await migrateMediaItems(update.media,`snag-projects/${selectedProjectId}/snags/${snag.id}/updates`)});
      await withTimeout(writeSnag(cloudSnag),12000,`${label} write`);
      Object.assign(snag,cloudSnag);clearDirty(snag.id);written++;diagStep(label,'ok','Synced');
    }catch(e){failed++;diagStep(label,'error',firebaseErrorMessage(e));console.warn('Pending snag retained',snag.id,e)}
  }
  saveState();
  return {total:pending.length,written,mediaFailed,failed};
}
function resetCloudDiag(){cloudDiag=[];renderCloudDiagnostics()}
function diagStep(name,state='running',detail=''){const old=cloudDiag.find(x=>x.name===name);if(old){old.state=state;old.detail=detail;old.at=Date.now()}else cloudDiag.push({name,state,detail,at:Date.now()});renderCloudDiagnostics()}
function diagHtml(){return cloudDiag.map(x=>`<div class="diag-row"><span class="diag-state diag-${x.state}">${x.state==='ok'?'✓':x.state==='error'?'!':x.state==='waiting'?'…':'•'}</span><span><strong>${escapeHtml(x.name)}</strong>${x.detail?`<small>${escapeHtml(x.detail)}</small>`:''}</span></div>`).join('')}
async function diagnosticFetch(url,label,ms=7000){const t=performance.now();try{const r=await withTimeout(fetch(url,{cache:'no-store',mode:'cors'}),ms,label);return {ok:r.ok,status:r.status,ms:Math.round(performance.now()-t)}}catch(e){return {ok:false,error:e?.message||String(e),ms:Math.round(performance.now()-t)}}}
async function withTimeout(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label+' timed out')),ms))]);}finally{clearTimeout(timer)}}
function firebaseErrorMessage(e){
  const code=e?.code||'';
  if(code==='permission-denied'||code==='firestore/permission-denied')return 'Firestore permission denied';
  if(code==='auth/operation-not-allowed')return 'Anonymous sign-in is disabled';
  if(code==='auth/network-request-failed')return 'Firebase network request failed';
  return code||e?.message||'Firebase connection failed';
}
function firebaseUsageLabel(path=''){
  const p=String(path||'');
  if(p.includes('/updates'))return 'snag updates';
  if(p.includes('/private_notes'))return 'private notes';
  if(p.includes('/invites'))return 'access invites';
  if(p.includes('/members/')&&p.includes('/seen'))return 'seen state';
  if(p.includes('/members'))return 'project members';
  if(p.includes('/snags'))return 'snags';
  if(p.startsWith('snag_users/')&&p.includes('/projects'))return 'user project registry';
  if(p.startsWith('snag_users/'))return 'user identity';
  if(p.startsWith('snag_projects/'))return 'project';
  return p.split('/')[0]||'firestore';
}
function instrumentFirestoreModule(raw){
  const labels=new WeakMap(),mon=()=>window.FirebaseUsageMonitor;
  const remember=ref=>{if(ref&&typeof ref==='object')labels.set(ref,firebaseUsageLabel(ref.path||''));return ref};
  const label=ref=>labels.get(ref)||firebaseUsageLabel(ref?.path||'');
  const wrapped={...raw};
  wrapped.doc=(...a)=>remember(raw.doc(...a));
  wrapped.collection=(...a)=>remember(raw.collection(...a));
  wrapped.query=(ref,...a)=>{const q=raw.query(ref,...a);labels.set(q,label(ref));return q};
  wrapped.getDoc=async ref=>{const x=await raw.getDoc(ref);mon()?.read(1,label(ref),'Snag','snag-509418','(default)');return x};
  wrapped.getDocs=async ref=>{const x=await raw.getDocs(ref);mon()?.read(Math.max(1,x.size||0),label(ref),'Snag','snag-509418','(default)');return x};
  wrapped.setDoc=async(...a)=>{const x=await raw.setDoc(...a);mon()?.write(1,label(a[0]),'Snag','snag-509418','(default)');return x};
  wrapped.updateDoc=async(...a)=>{const x=await raw.updateDoc(...a);mon()?.write(1,label(a[0]),'Snag','snag-509418','(default)');return x};
  wrapped.deleteDoc=async(...a)=>{const x=await raw.deleteDoc(...a);mon()?.del(1,label(a[0]),'Snag','snag-509418','(default)');return x};
  wrapped.onSnapshot=(ref,next,error,complete)=>{
    mon()?.listener(1,label(ref),'Snag','snag-509418','(default)');
    let first=true;
    const counted=snap=>{
      let n=1;
      if(Array.isArray(snap?.docs)){n=first?Math.max(1,snap.size||0):Math.max(0,snap.docChanges?.().length||0)}
      if(n)mon()?.read(n,label(ref),'Snag','snag-509418','(default)');
      first=false;return typeof next==='function'?next(snap):next?.next?.(snap);
    };
    if(typeof next==='function')return raw.onSnapshot(ref,counted,error,complete);
    return raw.onSnapshot(ref,{next:counted,error:e=>next?.error?.(e),complete:()=>next?.complete?.()});
  };
  return wrapped;
}
async function initFirebase(cfg){
  const run=++firebaseRun;resetCloudDiag();
  const watchdog=setTimeout(()=>{if(run===firebaseRun&&cloudStatus.state==='starting'){const active=cloudDiag.find(x=>x.state==='running');if(active)diagStep(active.name,'error','No response after 18 seconds');cloudStatus={state:'error',message:`Stopped at: ${active?.name||'unknown stage'} · tap for diagnostics`};render();}},18000);
  cloudStatus={state:'starting',message:'Running Firebase diagnostics…'};diagStep('Firebase libraries','running','Testing Google Firebase CDN');
  let appMod,fsMod,authMod,app,db,auth;
  try{
    const cdn=await diagnosticFetch(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,'Firebase CDN');
    if(run!==firebaseRun)return;
    if(!cdn.ok)throw new Error(`Firebase CDN failed: ${cdn.error||'HTTP '+cdn.status}`);
    diagStep('Firebase libraries','ok',`${cdn.ms} ms`);
    [appMod,fsMod,authMod]=await withTimeout(Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]),12000,'Firebase module import');
    if(run!==firebaseRun)return;
    fsMod=instrumentFirestoreModule(fsMod);

    app=appMod.getApps().length?appMod.getApps()[0]:appMod.initializeApp(cfg);
    try{db=fsMod.initializeFirestore(app,{experimentalForceLongPolling:true,useFetchStreams:false})}catch(e){db=fsMod.getFirestore(app)}auth=authMod.getAuth(app);firebase={appMod,fsMod,authMod,app,db,auth};window.AppsAccount?.bindFirebase?.({auth,authMod,app:'Snag'});diagStep('Firestore transport','ok','Forced long polling');
    diagStep('Authentication','running','Restoring this device identity');
    try{await withTimeout(auth.authStateReady(),7000,'Firebase auth state')}catch(e){console.warn(e)}
    authMod.onAuthStateChanged(auth,user=>window.AppsAuth?.setAppIdentity(user,{app:'Snag'}));
    if(!auth.currentUser)await withTimeout(authMod.signInAnonymously(auth),10000,'Anonymous sign-in');
     window.AppMonitor?.identify?.({uid:auth.currentUser.uid,username:profile.name,provider:auth.currentUser.providerData?.[0]?.providerId||(auth.currentUser.isAnonymous?'anonymous':'firebase'),isAnonymous:auth.currentUser.isAnonymous});
    if(run!==firebaseRun)return;
    diagStep('Authentication','ok',`${auth.currentUser.isAnonymous?'guest':'protected'} ${auth.currentUser.uid.slice(0,8)}…`);
    localStorage.setItem(LS.firebase,JSON.stringify(cfg));
    await restoreProjectsForCurrentUser();
    await loadCurrentMember();
    const legacyMigration=await migrateLegacyProjectIfNeeded();
    if(legacyMigration?.status==='waiting'){
      cloudStatus={state:'connected',message:'Legacy project loaded locally · waiting for owner migration · your local changes will be retained'};
      clearTimeout(watchdog);render();return;
    }

    diagStep('Firestore project','running',selectedProjectId);
    if(launchProjectId&&launchInviteId){
      await withTimeout(joinInvitedProject(launchProjectId,launchInviteId),9000,'Project invite');
      diagStep('Firestore project','ok','Invite accepted');
      const pending=await migrateLocalProjectToCloud();
      cloudStatus={state:'connected',message:`Shared cloud connected · invite access · ${pending.written}/${pending.total} local changes synced · R2 ${window.SNAG_R2_API?'configured':'not configured'}`};
    }else if(legacyMigration?.role==='member'||(currentMember&&currentMember.role!=='owner')){
      await loadCurrentMember();
      diagStep('Firestore project','ok','Existing member access restored');
      const pending=await migrateLocalProjectToCloud();
      cloudStatus={state:'connected',message:`Shared cloud connected · restored member access · ${pending.written}/${pending.total} local changes synced · R2 ${window.SNAG_R2_API?'configured':'not configured'}`};
    }else{
      const projectSetup=await withTimeout(ensureProjectRemote(),9000,'Project setup');
      if(projectSetup?.created!==true)await upgradeProjectAccessModel();
      diagStep('Firestore project','ok','Owner project available');
      diagStep('Snag sync','running',projectSetup?.created?'Publishing local project to the new cloud':'Publishing local changes');
      let migration={written:0,total:0,mediaFailed:0};
      try{migration=await migrateLocalProjectToCloud(projectSetup?.created===true);diagStep('Pending local changes',migration.failed?'error':'ok',`${migration.written}/${migration.total} uploaded${migration.failed?' · '+migration.failed+' retained':''}`)}
      catch(e){diagStep('Snag sync','error',firebaseErrorMessage(e));console.warn('Local migration incomplete',e)}
      cloudStatus={state:'connected',message:`Shared cloud connected · owner access · ${migration.written}/${migration.total} local snags synced · R2 ${window.SNAG_R2_API?'configured':'not configured'}`};
    }
    await loadCurrentMember();
    saveMigration(selectedProjectId,{status:'complete',role:currentMember?.role==='owner'?'owner':'member',primaryUid:auth.currentUser.uid});
    diagStep('Live listener','running','Starting realtime updates');
    try{await withTimeout(subscribeFirebase(),9000,'Live listener');diagStep('Live listener','ok','Listening')}catch(e){diagStep('Live listener','error',firebaseErrorMessage(e));console.warn(e)}
    clearTimeout(watchdog);if(run!==firebaseRun)return;
    const linkedSnag=launchUrl.searchParams.get('snag');
    if(linkedSnag){try{const doc=await fsMod.getDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',linkedSnag));if(doc.exists()){const found={id:doc.id,...doc.data()};const ups=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'snags',linkedSnag,'updates'));found.updates=ups.docs.map(x=>({id:x.id,...x.data()}));const i=state.snags.findIndex(x=>x.id===linkedSnag);if(i>=0)state.snags[i]=found;else state.snags.push(found);render();openDetail(linkedSnag)}}catch(e){console.warn('Linked snag is not accessible',e);toast('This snag is not available to your account')}}
    if(!launchInviteId)setTimeout(()=>maybeShowFirstGuide('owner'),700);render();setTimeout(()=>maybePresentNotificationChoice(),900);setTimeout(()=>backfillMediaPreviews(4),3200);
  }catch(e){
    clearTimeout(watchdog);if(run!==firebaseRun)return;
    const active=cloudDiag.find(x=>x.state==='running');if(active)diagStep(active.name,'error',firebaseErrorMessage(e));
    console.error('Firebase startup failed',e);cloudStatus={state:'error',message:`${firebaseErrorMessage(e)} · tap for diagnostics`};render();throw e;
  }
}
async function joinInvitedProject(projectId,inviteId){
  const {fsMod,db,auth}=firebase;
  const inviteSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',projectId,'invites',inviteId));
  if(!inviteSnap.exists()||inviteSnap.data().active!==true)throw new Error('Invite is invalid or has been revoked');
  const invite=inviteSnap.data(),role=invite.role||'contractor';
  rememberSharedAccess(projectId,inviteId,role);
  currentMember={uid:auth.currentUser.uid,snagUserId:snagUserId(),name:profile.name,role,admin:invite.admin===true,label:invite.label||'',inviteId,joinedAt:now()};await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'members',auth.currentUser.uid),currentMember,{merge:true});await registerUserProject(projectId,role,currentMember.snagUserId);
  const pSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',projectId));
  if(!pSnap.exists())throw new Error('Project not found');
  const p={id:projectId,...pSnap.data()};
  const i=state.projects.findIndex(x=>x.id===projectId);if(i>=0)state.projects[i]=p;else state.projects.push(p);
  selectedProjectId=projectId;state.selectedProjectId=projectId;profile={...profile,role:role[0].toUpperCase()+role.slice(1)};localStorage.setItem(LS.profile,JSON.stringify(profile));saveState();setTimeout(()=>maybeShowFirstGuide(role==='contractor'?'contractor':'owner'),500);
}
async function ensureProjectRemote(){
  if(!firebase?.auth?.currentUser)return;const p=project(),{fsMod,db,auth}=firebase;if(!p)return;
  const accountId=await ensureAccountRemote(),ref=fsMod.doc(db,'snag_projects',p.id),memberRef=fsMod.doc(db,'snag_projects',p.id,'members',auth.currentUser.uid);
  let snap;try{snap=await withTimeout(fsMod.getDoc(ref),7000,'Project read')}catch(e){throw e}
  if(snap.exists()){const remote=snap.data();if(remote.ownerUid!==auth.currentUser.uid)throw new Error('Project owner does not match this Firebase identity');const patch={};if(!remote.accountId)patch.accountId=accountId;if(!remote.billingStatus)patch.billingStatus='legacy';if(Object.keys(patch).length)await fsMod.setDoc(ref,{...patch,updatedAt:now()},{merge:true});Object.assign(p,remote,patch);saveState();const member=await withTimeout(fsMod.getDoc(memberRef),7000,'Membership read');if(!member.exists())await fsMod.setDoc(memberRef,{uid:auth.currentUser.uid,snagUserId:snagUserId(),name:profile.name,role:'owner',admin:true,joinedAt:now()},{merge:true});await registerUserProject(p.id,'owner',snagUserId());return{created:false}}
  const cloudProject={...p,ownerUid:auth.currentUser.uid,ownerSnagUserId:snagUserId(),accountId,billingStatus:'trial',accessModelVersion:2,updatedAt:now()};await fsMod.setDoc(ref,cloudProject,{merge:true});Object.assign(p,cloudProject);saveState();await fsMod.setDoc(memberRef,{uid:auth.currentUser.uid,snagUserId:snagUserId(),name:profile.name,role:'owner',admin:true,joinedAt:now()},{merge:true});await registerUserProject(p.id,'owner',snagUserId());return{created:true};
}
async function writeSnag(s){const {fsMod,db}=firebase;await applySnagAccess(s,{newRecord:!s.createdByUid});const clean={...s};delete clean.updates;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id),clean,{merge:true});for(const u of s.updates||[])await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});}
async function writeUpdate(s,u){const {fsMod,db,auth}=firebase;u.authorUid=u.authorUid||auth.currentUser.uid;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id),{updatedAt:s.updatedAt},{merge:true});}
async function subscribeFirebase(){
  if(!firebase?.auth?.currentUser)return;unsubscribe?.();await loadCurrentMember();await subscribeSeenState();
  const {fsMod,db,auth}=firebase,col=fsMod.collection(db,'snag_projects',selectedProjectId,'snags'),restricted=currentMember?.role==='contractor'&&Number(project()?.accessModelVersion||0)>=2;
  const q=restricted?fsMod.query(col,fsMod.where('participantUids','array-contains',auth.currentUser.uid)):fsMod.query(col,fsMod.orderBy('updatedAt','desc'));
  unsubscribe=fsMod.onSnapshot(q,async snap=>{
    const projectAtSnapshot=selectedProjectId,allowedIds=new Set();
    for(const d of snap.docs){
      allowedIds.add(d.id);const data={id:d.id,...d.data()},existing=state.snags.find(x=>x.id===data.id);
      try{const us=await fsMod.getDocs(fsMod.collection(db,'snag_projects',projectAtSnapshot,'snags',d.id,'updates'));data.updates=us.docs.map(x=>({id:x.id,...x.data()}))}
      catch(e){console.warn('Could not refresh snag updates',d.id,e);data.updates=existing?.updates||[]}
      const i=state.snags.findIndex(x=>x.id===data.id);if(i>=0)state.snags[i]=data;else state.snags.push(data);clearDirty(data.id);
    }
    if(projectAtSnapshot!==selectedProjectId)return;
    if(restricted)state.snags=state.snags.filter(x=>x.projectId!==projectAtSnapshot||allowedIds.has(x.id));saveState();render();if(detailId)openDetail(detailId);
  },e=>console.warn('Firestore listener',e));
}

async function loadCurrentMember(){if(!firebase?.auth?.currentUser)return;try{const {fsMod,db,auth}=firebase,s=await fsMod.getDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'members',auth.currentUser.uid));currentMember=s.exists()?{id:s.id,...s.data()}:null;if(currentMember?.snagUserId)adoptSnagUserId(currentMember.snagUserId)}catch{currentMember=null}}
async function openMyNotes(){if(!firebase?.auth?.currentUser)return toast('Cloud connection required');$('myNotesDialog').showModal();subscribePrivateNotes();}
function subscribePrivateNotes(){
  privateNotesUnsubscribe?.();const {fsMod,db,auth}=firebase;
  const q=fsMod.query(fsMod.collection(db,'snag_projects',selectedProjectId,'private_notes'),fsMod.where('authorUid','==',auth.currentUser.uid));
  privateNotesUnsubscribe=fsMod.onSnapshot(q,snap=>{const notes=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));$('privateNotesList').innerHTML=notes.length?notes.map(n=>`<article class="private-note-card"><div><strong>${escapeHtml(n.authorName||'Note')}</strong><span>${fmt(n.createdAt)}</span></div><p>${escapeHtml(n.text)}</p>${n.snagRef?`<small>${escapeHtml(n.snagRef)}</small>`:''}</article>`).join(''):'<p class="subtle">No private notes yet.</p>';},e=>{$('privateNotesList').innerHTML='<p class="subtle">Private notes are unavailable until the security update finishes deploying.</p>';console.warn(e)});
}
async function addPrivateNote(){const text=$('privateNoteText').value.trim();if(!text)return;const {fsMod,db,auth}=firebase;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'private_notes',uid()),{text,authorUid:auth.currentUser.uid,authorSnagUserId:snagUserId(),authorName:profile.name,createdAt:now()});$('privateNoteText').value='';}
async function protectAccessWithEmail(){
  if(!firebase?.auth?.currentUser)return toast('Cloud connection required');
  const email=$('protectEmailInput')?.value.trim(),password=$('protectPasswordInput')?.value||'';
  if(!email||password.length<6)return toast('Enter an email and a password of at least 6 characters');
  try{
    const {authMod,auth}=firebase;
    if(!auth.currentUser.isAnonymous)return toast('This access is already protected');
    const credential=authMod.EmailAuthProvider.credential(email,password);
    await authMod.linkWithCredential(auth.currentUser,credential);
    await registerUserProject(selectedProjectId,currentMember?.role||'owner',snagUserId());
    try{await authMod.sendEmailVerification(auth.currentUser)}catch(e){console.warn('Verification email could not be sent',e)}
    toast('Access protected. A verification email has been sent.');renderSettings();
  }catch(e){console.error(e);toast(e?.code==='auth/email-already-in-use'?'That email already has a protected Snag account. Use Sign in instead.':firebaseErrorMessage(e))}
}
async function signInProtectedAccess(){
  if(!firebase)return toast('Cloud connection required');
  const email=$('protectEmailInput')?.value.trim(),password=$('protectPasswordInput')?.value||'';
  if(!email||!password)return toast('Enter your email and password');
  try{
    const {authMod,auth}=firebase;await authMod.signInWithEmailAndPassword(auth,email,password);
    const restored=await restoreProjectsForCurrentUser();await loadCurrentMember();if(restored)await subscribeFirebase();
    toast(restored?'Protected access restored':'Signed in. No saved Snag projects were found yet.');render();
  }catch(e){console.error(e);toast('Could not sign in with that email and password')}
}
async function sendProtectedPasswordReset(){
  if(!firebase)return toast('Cloud connection required');const email=$('protectEmailInput')?.value.trim();if(!email)return toast('Enter your email first');
  try{await firebase.authMod.sendPasswordResetEmail(firebase.auth,email);toast('Password reset email sent')}catch(e){console.error(e);toast('Could not send password reset email')}
}
function disconnectFirebase(){unsubscribe?.();unsubscribe=null;firebase=null;localStorage.removeItem(LS.firebase);toast('Using local mode');render();}
const VERSION_LAB=[
  {label:'Handover 1115',build:'2026.09.22.1115',ref:'c227e76ef12324ff0dccecce49047a5bfa799255',note:'Premium Handover design'},
  {label:'Stable 1930',build:'2026.09.21.1930',ref:'0be2c35c91f62e52190625fc38a4b0ba7b1e9321',note:'Pre-Handover interface'},
  {label:'Dashboard 1815',build:'2026.09.21.1815',ref:'3da8b61b8bcd5bfbd809fcd96e7ac13e6a08aa0c',note:'Apple-style dashboard'},
  {label:'Stable 1755',build:'2026.09.21.1755',ref:'50da66392b4f1c6bd8203d941b84677242b5951c',note:'Earlier stable layout'}
];
const VERSION_CATALOG=[{"build":"2026.09.22.1510","ref":"d4fc666f930ba06947481005c57d17d389819f05","date":"22 Sep 2026 · 12:34 BST"},{"build":"2026.09.22.1435","ref":"bb9da8cd5505348eea34fb737c2f538cae9b80fa","date":"22 Sep 2026 · 12:26 BST"},{"build":"2026.09.22.1410","ref":"1a9ad5ce7de7fbd08853a04aa18b9d45a973fd1d","date":"22 Sep 2026 · 12:21 BST"},{"build":"2026.09.22.1345","ref":"d8d1a6e05564979777eeded2a39bb1081c0447e3","date":"22 Sep 2026 · 12:16 BST"},{"build":"2026.09.22.1325","ref":"47ab414ff4e1d8776ad684a9c94c0679c5dd861e","date":"22 Sep 2026 · 12:08 BST"},{"build":"2026.09.22.1305","ref":"a3905367debb869326fd7e407ac77545d13f0910","date":"22 Sep 2026 · 12:03 BST"},{"build":"2026.09.22.1235","ref":"484e15d004784ed99b218e3a47a7dd7f62950d53","date":"22 Sep 2026 · 11:54 BST"},{"build":"2026.09.22.1205","ref":"f8eebcee5192be2efeb10073c9bb2e7907744aac","date":"22 Sep 2026 · 11:48 BST"},{"build":"2026.09.22.1145","ref":"f0340aa92ce61e535b9dc2fe2bbc6870975899db","date":"22 Sep 2026 · 11:44 BST"},{"build":"2026.09.22.1115","ref":"31c45d379ae9b0c60d6631105456df160203ba72","date":"22 Sep 2026 · 11:24 BST"},{"build":"2026.09.21.1930","ref":"0be2c35c91f62e52190625fc38a4b0ba7b1e9321","date":"21 Sep 2026 · 23:24 BST"},{"build":"2026.09.21.1905","ref":"3b31372b8bae445118c8b4bcf063a94bc6b7b542","date":"21 Sep 2026 · 23:04 BST"},{"build":"2026.09.21.1835","ref":"b524ec9af9cf38ebb0e2410461b5dbcac30e0d0c","date":"21 Sep 2026 · 22:49 BST"},{"build":"2026.09.21.1815","ref":"3da8b61b8bcd5bfbd809fcd96e7ac13e6a08aa0c","date":"21 Sep 2026 · 15:53 BST"},{"build":"2026.09.21.1755","ref":"50da66392b4f1c6bd8203d941b84677242b5951c","date":"21 Sep 2026 · 15:36 BST"},{"build":"2026.09.21.1745","ref":"640921c3600150b3bff62fdbf683357090fbe637","date":"21 Sep 2026 · 15:31 BST"},{"build":"2026.09.21.1735","ref":"218442999dfd4431f574c69ab8a0a70814405cbd","date":"21 Sep 2026 · 15:25 BST"},{"build":"2026.09.21.1725","ref":"dc169e44466d1f2c5d415fd6723800510e088217","date":"21 Sep 2026 · 15:22 BST"},{"build":"2026.09.21.1715","ref":"4145a1f255a8da9e79159e7aeb71e74394d2fdd0","date":"21 Sep 2026 · 15:15 BST"},{"build":"2026.09.21.1635","ref":"ed5d2669d44220c4b5483d515f419f9328601bcb","date":"21 Sep 2026 · 14:59 BST"},{"build":"2026.09.21.1605","ref":"5babe749c8350e834faacb6bd0d46618b2f39f8c","date":"21 Sep 2026 · 14:40 BST"},{"build":"2026.09.21.1535","ref":"0958627899d5464d0753a799ba0e76ce2a8b70c1","date":"21 Sep 2026 · 14:31 BST"},{"build":"2026.09.21.1500","ref":"ff8c34ecd9e3dab2cc4282108eb16800807b882c","date":"21 Sep 2026 · 14:27 BST"}];
function versionPrefs(){try{return JSON.parse(localStorage.getItem('snag-version-prefs-v1')||'{}')}catch{return {}}}
function saveVersionPrefs(p){localStorage.setItem('snag-version-prefs-v1',JSON.stringify(p))}
function setVersionFlag(build,flag,value){const p=versionPrefs();p[build]={...(p[build]||{}),[flag]:value};saveVersionPrefs(p);renderVersionLab()}
function renderVersionLab(){
  const host=$('versionLabList');if(!host)return;const prefs=versionPrefs(),showHidden=$('showHiddenVersions')?.checked===true;
  const rows=VERSION_CATALOG.filter(v=>showHidden||!prefs[v.build]?.hidden).map(v=>{
    const p=prefs[v.build]||{},release=p.release===true||v.build==='2026.09.21.1930';
    return `<div class="version-lab-row version-manage-row"><a href="./version-lab.html?ref=${encodeURIComponent(v.ref)}&build=${encodeURIComponent(v.build)}" target="_blank"><span><strong>v${escapeHtml(v.build)}</strong><small>${escapeHtml(v.date)} · ${v.ref.slice(0,7)}${release?' · RELEASE':''}</small></span><span>Open ↗</span></a><div class="version-actions"><button type="button" data-release-version="${v.build}">${release?'Release ✓':'Mark release'}</button><button type="button" data-hide-version="${v.build}">${p.hidden?'Restore':'Hide'}</button></div></div>`;
  }).join('');
  host.innerHTML=`<label class="version-filter"><input id="showHiddenVersions" type="checkbox" ${showHidden?'checked':''}> Show hidden versions</label>`+rows;
  $('showHiddenVersions').onchange=renderVersionLab;
  host.querySelectorAll('[data-release-version]').forEach(b=>b.onclick=()=>setVersionFlag(b.dataset.releaseVersion,'release',!(versionPrefs()[b.dataset.releaseVersion]?.release)));
  host.querySelectorAll('[data-hide-version]').forEach(b=>b.onclick=()=>setVersionFlag(b.dataset.hideVersion,'hidden',true));
}
function renderCloudDiagnostics(){if($('firebaseStageDiagnostics'))$('firebaseStageDiagnostics').innerHTML=diagHtml();if($('buildBadge'))$('buildBadge').textContent='v'+APP_BUILD;if($('mobileBuildBadge'))$('mobileBuildBadge').textContent='v'+APP_BUILD;const t=cloudStatus.message||cloudStatus.state;if($('cloudDiagnostics'))$('cloudDiagnostics').textContent=t;if($('buildDialogCloud'))$('buildDialogCloud').textContent=t;if($('runningBuild'))$('runningBuild').textContent='v'+APP_BUILD;if($('buildDialogRunning'))$('buildDialogRunning').textContent='v'+APP_BUILD;const l=latestBuild?.build;if($('latestBuildState'))$('latestBuildState').textContent=l?(l===APP_BUILD?'· latest':'· update available'):'· latest unknown';if($('buildDialogLatest'))$('buildDialogLatest').textContent=l?'v'+l:'Unknown';}
async function checkLatestBuild(){
  try{
    const r=await fetch('./version.json?t='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    latestBuild=r.ok?await r.json():null;
    if(latestBuild?.build&&latestBuild.build!==APP_BUILD){
      const key='snag-auto-updated-'+latestBuild.build;
      if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');await hardRefreshApp();return}
    }
  }catch(e){latestBuild=null;console.warn('Build check failed',e)}
  renderCloudDiagnostics()
}
async function hardRefreshApp(){
  try{
    if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()))}
    if('caches'in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('snag-')).map(k=>caches.delete(k)))}
  }catch(e){console.warn(e)}
  const u=new URL(location.href);u.searchParams.set('_build',Date.now());location.replace(u.toString());
}
function bind(){setupBulk();
  document.querySelectorAll('[data-settings-tab]').forEach(button=>{button.onclick=()=>settingsTab(button.dataset.settingsTab);button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-settings-tab]')],i=tabs.indexOf(button),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;settingsTab(tabs[next].dataset.settingsTab,{focus:true})}});
  $('settingsManageSharing').onclick=()=>{$('settingsDialog').close();shareProject().catch(e=>toast(e.message))};
  $('shareNativeButton').onclick=shareInvitationNative;
  $('shareWhatsApp').onclick=()=>shareInvitationChannel('whatsapp');
  $('shareMessages').onclick=()=>shareInvitationChannel('messages');
  $('shareEmail').onclick=()=>shareInvitationChannel('email');bindAnnotationCanvas();if($('notificationChoiceEnable'))$('notificationChoiceEnable').onclick=acceptInitialNotifications;if($('notificationChoiceLater'))$('notificationChoiceLater').onclick=deferInitialNotifications;if($('enableWebPushNotifications'))$('enableWebPushNotifications').onclick=enableSnagWebPush;$('editSnagForm').onsubmit=saveSnagEdit;$('closeGuideButton').onclick=finishGuide;$('finishGuideButton').onclick=finishGuide;if($('homeSearchInput'))$('homeSearchInput').onchange=e=>{view.search=e.target.value;setNav('snags');$('searchInput').value=view.search;renderList()};if($('homeFilterButton'))$('homeFilterButton').onclick=()=>{setNav('snags');$('filterPanel').classList.remove('hidden')};if($('homeGridButton'))$('homeGridButton').onclick=()=>setNav('snags');if($('seeAllSnags'))$('seeAllSnags').onclick=()=>setNav('snags');document.querySelectorAll('.bottom-nav [data-nav]').forEach(b=>b.onclick=()=>setNav(b.dataset.nav));if($('notificationButton'))$('notificationButton').onclick=()=>{setNav('home');setTimeout(()=>$('recentActivity')?.scrollIntoView({behavior:'smooth',block:'start'}),30)};$('feedbackButton').onclick=()=>{if(window.openSnagFeedback)window.openSnagFeedback();else toast('Feedback tool is loading…')};$('closeMyNotes').onclick=()=>$('myNotesDialog').close();$('addPrivateNote').onclick=addPrivateNote;$('annotationCancel').onclick=()=>$('annotateDialog').close();$('annotationSave').onclick=saveAnnotation;$('annotationUndo').onclick=()=>{annotationState.history.pop();redrawAnnotation()};$('annotationClear').onclick=()=>{annotationState.history=[];redrawAnnotation()};document.querySelectorAll('[data-annotation-tool]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-annotation-tool]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');annotationState.colour=b.dataset.annotationTool==='yellow'?'#facc15':b.dataset.annotationTool==='black'?'#111827':'#ef4444'});document.querySelectorAll('[data-action="new-snag"]').forEach(b=>b.onclick=newSnag);$('newSnagButton').onclick=newSnag;$('projectButton').onclick=()=>$('projectDialog').showModal();$('projectCoverInput').onchange=e=>{const f=e.target.files?.[0];e.target.value='';if(f)setProjectCover(f)};$('removeProjectCoverButton').onclick=removeProjectCover;$('manageRoomsButton').onclick=openRoomManager;$('openRoomManagerButton').onclick=openRoomManager;$('closeRoomManager').onclick=()=>$('roomManagerDialog').close();$('guidesEnabledInput').onchange=e=>{localStorage.setItem(LS.guidesEnabled,e.target.checked?'1':'0');toast(e.target.checked?'Quick guides enabled':'Quick guides disabled')};$('showGuideNowButton').onclick=()=>showGuide(isAdmin()?'owner':'contractor');$('settingsButton').onclick=()=>$('settingsDialog').showModal();$('shareButton').onclick=shareProject;if($('syncPill'))$('syncPill').onclick=()=>{$('buildDialog').showModal();renderVersionLab();checkLatestBuild()};$('closeDetail').onclick=closeDetail;$('backdrop').onclick=closeDetail;$('snagForm').addEventListener('submit',createSnag);['photoInput','videoInput','fileInput'].forEach(id=>$(id).onchange=e=>{addPending([...e.target.files]);e.target.value='';});$('liveCameraButton').onclick=openCameraTest;$('cameraTestClose').onclick=closeCameraTest;$('cameraTestSwitch').onclick=switchCameraTest;$('cameraTestShutter').onclick=takeCameraTestPhoto;$('cameraTestLibrary').onclick=()=>$('photoInput').click();$('cameraTestDialog').addEventListener('cancel',e=>{e.preventDefault();closeCameraTest()});$('cameraTestDialog').addEventListener('close',stopCameraTest);$('searchInput').oninput=e=>{view.search=e.target.value;renderList()};$('filterButton').onclick=()=>{$('filterPanel').classList.toggle('hidden');$('filterButton').setAttribute('aria-expanded',!$('filterPanel').classList.contains('hidden'))};$('categoryFilter').onchange=e=>{view.category=e.target.value;render()};$('priorityFilter').onchange=e=>{view.priority=e.target.value;render()};$('archiveFilter').onchange=e=>{view.archived=e.target.checked;render()};$('sortSelect').onchange=e=>{view.sort=e.target.value;renderList()};$('clearFilters').onclick=()=>{view.category='all';view.priority='all';view.archived=false;render()};document.querySelectorAll('.stat-card').forEach(b=>b.onclick=()=>{view.status=b.dataset.statFilter;setNav('snags');render()});$('createProjectButton').onclick=async()=>{if(!await requireCommercialAccess('createProject'))return;const name=$('newProjectName').value.trim();if(!name)return toast('Give the project a name');const p={id:uid(),name,address:$('newProjectAddress').value.trim(),type:$('newProjectType').value,createdAt:now()};state.projects.push(p);saveState();selectProject(p.id);if(firebase?.auth?.currentUser)ensureProjectRemote().then(()=>subscribeFirebase()).catch(console.error);toast('Project created')};$('saveProjectSetupButton').onclick=async()=>{const p=project();p.locations=$('projectLocationsInput').value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);p.assignees=$('projectAssigneesInput').value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);p.updatedAt=now();saveState();if(firebase)await ensureProjectRemote();render();toast('Project setup saved')};$('createShareLinkButton').onclick=createShareLink;$('saveProfileButton').onclick=()=>{profile={name:$('profileNameInput').value.trim()||'Me',role:$('profileRoleInput').value};localStorage.setItem(LS.profile,JSON.stringify(profile));if(firebase?.auth?.currentUser)window.AppMonitor?.identify?.({uid:firebase.auth.currentUser.uid,username:profile.name,provider:firebase.auth.currentUser.providerData?.[0]?.providerId||(firebase.auth.currentUser.isAnonymous?'anonymous':'firebase'),isAnonymous:firebase.auth.currentUser.isAnonymous});render();toast('Identity saved')};if($('protectEmailButton'))$('protectEmailButton').onclick=protectAccessWithEmail;if($('signInProtectedButton'))$('signInProtectedButton').onclick=signInProtectedAccess;if($('resetProtectedPasswordButton'))$('resetProtectedPasswordButton').onclick=sendProtectedPasswordReset;$('connectFirebaseButton').onclick=connectFirebase;$('disconnectFirebaseButton').onclick=disconnectFirebase;$('retryCloudButton').onclick=()=>initFirebase(window.SNAG_FIREBASE_CONFIG).catch(e=>{console.error(e);render()});if($('buildBadge'))$('buildBadge').onclick=()=>{$('buildDialog').showModal();renderVersionLab();checkLatestBuild()};if($('mobileBuildBadge'))$('mobileBuildBadge').onclick=()=>{$('buildDialog').showModal();renderVersionLab();checkLatestBuild()};$('closeBuildDialog').onclick=()=>$('buildDialog').close();$('refreshAppButton').onclick=hardRefreshApp;$('copyShareLink').onclick=copyInvitationLink;['snagTitleInput','snagDescriptionInput','snagLocationInput'].forEach(id=>$(id).addEventListener('input',renderSimilar));}

async function deleteOwnSeen(projectId,memberUid){
  const {fsMod,db}=firebase;try{const seen=await fsMod.getDocs(fsMod.collection(db,'snag_projects',projectId,'members',memberUid,'seen'));for(const d of seen.docs)await fsMod.deleteDoc(d.ref)}catch{}
}
async function deleteProjectCloud(projectId){
  if(!firebase?.auth?.currentUser)throw new Error('Cloud connection required');
  const {fsMod,db,auth}=firebase,pRef=fsMod.doc(db,'snag_projects',projectId),pSnap=await fsMod.getDoc(pRef);if(!pSnap.exists())return;
  const owner=pSnap.data().ownerUid===auth.currentUser.uid;
  if(!owner){await deleteOwnSeen(projectId,auth.currentUser.uid);try{await fsMod.deleteDoc(fsMod.doc(db,'snag_projects',projectId,'members',auth.currentUser.uid))}catch{}try{await fsMod.deleteDoc(fsMod.doc(db,'snag_users',auth.currentUser.uid,'projects',projectId))}catch{}return}
  const snags=await fsMod.getDocs(fsMod.collection(db,'snag_projects',projectId,'snags'));for(const d of snags.docs){const ups=await fsMod.getDocs(fsMod.collection(d.ref,'updates'));for(const u of ups.docs)await fsMod.deleteDoc(u.ref);await fsMod.deleteDoc(d.ref)}
  for(const colName of ['private_notes','invites']){const q=await fsMod.getDocs(fsMod.collection(db,'snag_projects',projectId,colName));for(const d of q.docs)await fsMod.deleteDoc(d.ref)}
  const members=await fsMod.getDocs(fsMod.collection(db,'snag_projects',projectId,'members'));for(const m of members.docs){await deleteOwnSeen(projectId,m.id);await fsMod.deleteDoc(m.ref)}
  const token=await auth.currentUser.getIdToken();try{await fetch(`${window.SNAG_R2_API.replace(/\/$/,'')}/projects/${encodeURIComponent(projectId)}/media`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}})}catch(e){console.warn('Project media purge failed',e)}
  await fsMod.deleteDoc(pRef);try{await fsMod.deleteDoc(fsMod.doc(db,'snag_users',auth.currentUser.uid,'projects',projectId))}catch{}
}
async function purgeCurrentUserData(){
  if(!firebase?.auth?.currentUser)throw new Error('No signed-in account');
  const {fsMod,db,auth}=firebase,refs=await fsMod.getDocs(fsMod.collection(db,'snag_users',auth.currentUser.uid,'projects'));for(const d of refs.docs)await deleteProjectCloud(d.id);
  try{await fsMod.deleteDoc(fsMod.doc(db,'snag_accounts',stableAccountId()))}catch{}
  try{await fsMod.deleteDoc(fsMod.doc(db,'snag_users',auth.currentUser.uid))}catch{}
}
async function snagExportSelection({scope='all',recipientUid=''}={}){
  const pid=selectedProjectId,p=project();if(!p)throw new Error('No project selected');
  let rows;
  if(firebase?.auth?.currentUser){
    const {fsMod,db,auth}=firebase,restricted=currentMember?.role==='contractor'&&Number(p.accessModelVersion||0)>=2;
    const col=fsMod.collection(db,'snag_projects',pid,'snags');
    const q=restricted?fsMod.query(col,fsMod.where('participantUids','array-contains',auth.currentUser.uid)):col;
    const snap=await fsMod.getDocs(q);
    rows=await Promise.all(snap.docs.map(async d=>{
      const data={id:d.id,...d.data()};
      const updates=await fsMod.getDocs(fsMod.collection(db,'snag_projects',pid,'snags',d.id,'updates'));
      data.updates=updates.docs.map(u=>({id:u.id,...u.data()}));return data;
    }));
  }else{
    if(recipientUid)throw new Error('Contractor exports require a cloud connection');
    rows=visibleProjectSnags();
  }
  let inviteId='';
  if(recipientUid){
    if(!isAdmin()||!firebase?.auth?.currentUser)throw new Error('Only an administrator can export for a contractor');
    const {fsMod,db}=firebase,memberSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',pid,'members',recipientUid));
    if(!memberSnap.exists()||memberSnap.data().role!=='contractor')throw new Error('Contractor membership not found');
    const member=memberSnap.data();inviteId=member.inviteId;
    const inviteSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',pid,'invites',inviteId));
    if(!inviteSnap.exists()||inviteSnap.data().active!==true)throw new Error('Contractor invitation was revoked');
    rows=rows.filter(s=>(s.participantUids||[]).includes(recipientUid));
  }
  if(scope==='open')rows=rows.filter(s=>s.status!=='resolved'&&!s.archived);
  else if(scope==='filtered'){
    const ids=new Set(getFiltered().map(s=>s.id));rows=rows.filter(s=>ids.has(s.id));
  }
  return{project:{id:pid,name:p.name,address:p.address},snags:rows,inviteId};
}
async function snagExportMembers(){
  if(!isAdmin()||!firebase?.auth?.currentUser)return [];
  const {fsMod,db}=firebase,snap=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'members'));
  return snap.docs.map(d=>({uid:d.id,...d.data()}));
}
async function snagExportMedia(m){
  if(m?.storage==='r2'&&m.key)return privateMediaBlob(mediaVariant(m,'preview'));
  if(m?.url&&(/^(data:image\/|blob:)/.test(m.url)))return(await fetch(m.url)).blob();
  throw new Error('Media is not available as an authenticated image');
}
window.SnagReleaseBridge={
 build:APP_BUILD,
 context:()=>({projectId:selectedProjectId,project:{...project()},projectCount:state.projects.length,snagCount:projectSnags().length,member:currentMember?{...currentMember}:null,isOwner:isProjectOwner(),isAdmin:isAdmin(),cloud:cloudStatus,user:firebase?.auth?.currentUser||null}),
 token:async()=>firebase?.auth?.currentUser?.getIdToken(),
 exportSelection:snagExportSelection,exportMembers:snagExportMembers,exportMedia:snagExportMedia,
 exportCurrentProject:()=>({exportedAt:now(),appBuild:APP_BUILD,project:{...project()},snags:state.snags.filter(x=>x.projectId===selectedProjectId)}),
 deleteCurrentProject:async()=>{const id=selectedProjectId;await deleteProjectCloud(id);state.snags=state.snags.filter(x=>x.projectId!==id);state.projects=state.projects.filter(x=>x.id!==id);if(!state.projects.length)state.projects=[{id:uid(),name:'My home',address:'',type:'Home',createdAt:now()}];selectedProjectId=state.projects[0].id;state.selectedProjectId=selectedProjectId;saveState();render();return true},
 deleteAccount:async password=>{const {authMod,auth}=firebase;if(!auth.currentUser)throw new Error('No signed-in account');if(!auth.currentUser.isAnonymous){const c=authMod.EmailAuthProvider.credential(auth.currentUser.email,password);await authMod.reauthenticateWithCredential(auth.currentUser,c)}await purgeCurrentUserData();await authMod.deleteUser(auth.currentUser);localStorage.removeItem(LS.state);localStorage.removeItem(LS.profile);localStorage.removeItem(LS.access);location.href='./welcome.html?deleted=1'},
 refresh:()=>render(),toast,billingEndpoint:()=>window.SNAG_R2_API
};
window.dispatchEvent(new CustomEvent('snag-release:ready',{detail:{build:APP_BUILD}}));

function syncVisualViewport(){
  const vv=window.visualViewport,h=Math.max(320,Math.round(vv?.height||window.innerHeight||document.documentElement.clientHeight||0)),
    bottom=Math.max(0,Math.round((window.innerHeight||h)-((vv?.height||h)+(vv?.offsetTop||0))));
  document.documentElement.style.setProperty('--snag-visual-height',h+'px');
  document.documentElement.style.setProperty('--snag-visual-bottom',bottom+'px');
}
syncVisualViewport();window.addEventListener('resize',syncVisualViewport);window.visualViewport?.addEventListener('resize',syncVisualViewport);window.visualViewport?.addEventListener('scroll',syncVisualViewport);document.addEventListener('focusout',()=>setTimeout(syncVisualViewport,120));

bind();render();checkLatestBuild();const cfg=window.SNAG_FIREBASE_CONFIG||JSON.parse(localStorage.getItem(LS.firebase)||'null');if(cfg){localStorage.setItem(LS.firebase,JSON.stringify(cfg));initFirebase(cfg).then(render).catch(e=>{console.warn(e);if(cloudStatus.state!=='error')cloudStatus={state:'error',message:firebaseErrorMessage(e)};render();});}
