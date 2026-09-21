const FIREBASE_VERSION='12.2.1';
const LS={state:'snag-recorder-state-v1',firebase:'snag-recorder-firebase-v1',profile:'snag-recorder-profile-v1'};
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=iso=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));
const statusLabel={'open':'Open','in-progress':'In progress','review':'Needs review','resolved':'Resolved'};
const priorityRank={Urgent:0,High:1,Normal:2,Low:3};
let firebase=null, unsubscribe=null, pendingFiles=[], detailId=null, mediaRecorder=null, voiceChunks=[], cameraStream=null, cameraFacing='environment';
let profile=JSON.parse(localStorage.getItem(LS.profile)||'null')||{name:'Me',role:'Client'};
let state=loadState();
let selectedProjectId=new URL(location.href).searchParams.get('project')||state.selectedProjectId||state.projects[0]?.id;
if(!state.projects.some(p=>p.id===selectedProjectId)) selectedProjectId=state.projects[0]?.id;
state.selectedProjectId=selectedProjectId; saveState();
let view={status:'active',search:'',category:'all',priority:'all',archived:false,sort:'updated'};
const $=id=>document.getElementById(id);
function loadState(){
  const saved=JSON.parse(localStorage.getItem(LS.state)||'null');
  if(saved?.projects) return saved;
  const pid=uid(), sid=uid(), t=now();
  return {selectedProjectId:pid,projects:[{id:pid,name:'My home',address:'Home project',type:'Home',createdAt:t}],snags:[{id:sid,projectId:pid,ref:'S-001',title:'Example snag — tap to see the workflow',category:'Home snag',priority:'Normal',location:'Kitchen',assignee:'Builder',description:'This example shows how each snag keeps evidence, discussion and status together. Delete or resolve it once you start adding real issues.',outcome:'Issue is checked and confirmed complete.',status:'open',archived:false,createdAt:t,updatedAt:t,createdBy:'Me',media:[],updates:[{id:uid(),type:'note',text:'Snag recorded and ready for review.',author:'Me',role:'Client',createdAt:t,media:[]}]}]};
}
function saveState(){localStorage.setItem(LS.state,JSON.stringify(state));}
function project(){return state.projects.find(p=>p.id===selectedProjectId)||state.projects[0];}
function projectSnags(){return state.snags.filter(s=>s.projectId===selectedProjectId);}
function nextRef(){const nums=projectSnags().map(s=>Number((s.ref||'').match(/\d+/)?.[0]||0));return `S-${String((Math.max(0,...nums)+1)).padStart(3,'0')}`;}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;$('toastRegion').append(el);setTimeout(()=>el.remove(),2600);}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({url:r.result,name:file.name,type:file.type,size:file.size,local:true});r.onerror=reject;r.readAsDataURL(file);});}
function getFiltered(){
  let snags=projectSnags().filter(s=>view.archived||!s.archived);
  if(view.status==='active') snags=snags.filter(s=>s.status!=='resolved'); else snags=snags.filter(s=>s.status===view.status);
  if(view.category!=='all') snags=snags.filter(s=>s.category===view.category);
  if(view.priority!=='all') snags=snags.filter(s=>s.priority===view.priority);
  const q=view.search.trim().toLowerCase(); if(q) snags=snags.filter(s=>[s.title,s.description,s.location,s.assignee,...(s.updates||[]).map(u=>u.text)].join(' ').toLowerCase().includes(q));
  snags.sort((a,b)=>view.sort==='priority'?priorityRank[a.priority]-priorityRank[b.priority]:view.sort==='newest'?new Date(b.createdAt)-new Date(a.createdAt):view.sort==='oldest'?new Date(a.createdAt)-new Date(b.createdAt):new Date(b.updatedAt)-new Date(a.updatedAt));
  return snags;
}
function render(){renderProject();renderStats();renderFilters();renderList();renderProjects();renderSettings();}
function renderProject(){const p=project(); if(!p)return; $('projectName').textContent=p.name;$('projectAddress').textContent=p.address||'No address/context';$('projectTypeLabel').textContent=`${p.type.toUpperCase()} PROJECT`;$('profilePill').textContent=`${profile.role} · ${profile.name}`;const pill=$('syncPill');pill.className=`sync-pill ${firebase?'connected':'local'}`;pill.innerHTML=`<span class="dot"></span><span>${firebase?'Live sync':'Local'}</span>`;}
function renderStats(){const s=projectSnags();$('statActive').textContent=s.filter(x=>x.status!=='resolved'&&!x.archived).length;$('statProgress').textContent=s.filter(x=>x.status==='in-progress'&&!x.archived).length;$('statReview').textContent=s.filter(x=>x.status==='review'&&!x.archived).length;$('statResolved').textContent=s.filter(x=>x.status==='resolved').length;document.querySelectorAll('.stat-card').forEach(x=>x.classList.toggle('active',x.dataset.statFilter===view.status));}
function renderFilters(){let n=0;if(view.category!=='all')n++;if(view.priority!=='all')n++;if(view.archived)n++;$('filterCount').textContent=n?`(${n})`:'';$('categoryFilter').value=view.category;$('priorityFilter').value=view.priority;$('archiveFilter').checked=view.archived;$('sortSelect').value=view.sort;}
function thumbHtml(s){const m=s.media?.[0];if(!m)return `<div class="snag-thumb">${s.category==='App / software'?'⌘':s.category==='Business process'?'⇄':'⌂'}</div>`;if(m.type?.startsWith('image'))return `<div class="snag-thumb"><img src="${escapeHtml(m.url)}" alt=""></div>`;if(m.type?.startsWith('video'))return `<div class="snag-thumb"><video src="${escapeHtml(m.url)}" muted playsinline></video></div>`;return `<div class="snag-thumb">♪</div>`;}
function renderList(){const list=getFiltered();const titles={active:'Active snags','in-progress':'In progress',review:'Needs review',resolved:'Resolved archive'};$('listTitle').textContent=titles[view.status]||'Snags';$('snagList').innerHTML=list.map(s=>`<button class="snag-card" data-id="${s.id}" type="button">${thumbHtml(s)}<div><div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.ref)}</span></div><h3>${escapeHtml(s.title)}</h3><div class="snag-foot"><span>${escapeHtml(s.location||'No location')}</span><span>·</span><span>${escapeHtml(s.assignee||'Unassigned')}</span><span>·</span><span>Updated ${fmt(s.updatedAt)}</span></div></div><div class="snag-actions"><span class="activity-count">${(s.updates||[]).length} updates</span></div></button>`).join('');$('emptyState').classList.toggle('hidden',list.length>0);$('snagList').querySelectorAll('.snag-card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));}
function renderProjects(){$('projectList').innerHTML=state.projects.map(p=>`<div class="project-option ${p.id===selectedProjectId?'current':''}"><button type="button" data-project="${p.id}"><strong>${escapeHtml(p.name)}</strong><div class="subtle">${escapeHtml(p.address||p.type)}</div></button><span>${projectSnagCount(p.id)}</span></div>`).join('');$('projectList').querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>selectProject(b.dataset.project));}
function projectSnagCount(pid){return state.snags.filter(s=>s.projectId===pid&&s.status!=='resolved').length;}
function selectProject(id){selectedProjectId=id;state.selectedProjectId=id;saveState();const u=new URL(location.href);u.searchParams.set('project',id);history.replaceState({},'',u);$('projectDialog').close();if(firebase) subscribeFirebase();render();}
function renderSettings(){$('profileNameInput').value=profile.name;$('profileRoleInput').value=profile.role;const raw=localStorage.getItem(LS.firebase)||'';$('firebaseConfigInput').value=raw;$('firebaseStatusTitle').textContent=firebase?'Connected':'Local mode';$('firebaseBadge').className=`badge ${firebase?'good':'neutral'}`;$('firebaseBadge').textContent=firebase?'Connected':'Not connected';$('shareWarning').classList.toggle('hidden',!!firebase);}
function openDetail(id){detailId=id;const s=state.snags.find(x=>x.id===id);if(!s)return;$('detailRef').textContent=s.ref;$('detailTitle').textContent=s.title;renderDetail(s);$('detailDrawer').classList.remove('hidden');$('backdrop').classList.remove('hidden');$('detailDrawer').setAttribute('aria-hidden','false');}
function closeDetail(){$('detailDrawer').classList.add('hidden');$('backdrop').classList.add('hidden');$('detailDrawer').setAttribute('aria-hidden','true');detailId=null;}
function mediaHtml(items=[]){if(!items.length)return'';return `<div class="media-grid">${items.map(m=>m.type?.startsWith('image')?`<a class="media-item" href="${escapeHtml(m.url)}" target="_blank"><img src="${escapeHtml(m.url)}" alt="Attachment"></a>`:m.type?.startsWith('video')?`<div class="media-item"><video src="${escapeHtml(m.url)}" controls playsinline></video></div>`:m.type?.startsWith('audio')?`<div class="media-item"><audio src="${escapeHtml(m.url)}" controls></audio></div>`:`<a class="media-item" href="${escapeHtml(m.url)}" target="_blank">Open file</a>`).join('')}</div>`;}
function renderDetail(s){$('detailContent').innerHTML=`<section class="detail-hero"><div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.category)}</span></div>${mediaHtml(s.media)}<p class="detail-description">${escapeHtml(s.description)}</p><div class="detail-info-grid"><div class="info-card"><span>Area / location</span><strong>${escapeHtml(s.location||'—')}</strong></div><div class="info-card"><span>Assigned to</span><strong>${escapeHtml(s.assignee||'—')}</strong></div><div class="info-card"><span>Reported by</span><strong>${escapeHtml(s.createdBy||'—')}</strong></div><div class="info-card"><span>Created</span><strong>${fmt(s.createdAt)}</strong></div></div>${s.outcome?`<div class="info-card"><span>Resolved when</span><strong>${escapeHtml(s.outcome)}</strong></div>`:''}</section><section><h3>Status</h3><div class="status-controls">${Object.entries(statusLabel).map(([k,v])=>`<button type="button" data-status="${k}" class="${s.status===k?'selected':''}">${v}</button>`).join('')}<button type="button" data-archive="1">${s.archived?'Unarchive':'Archive'}</button></div></section><section><h3>Conversation & progress</h3><div class="timeline">${(s.updates||[]).slice().sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map(u=>`<article class="timeline-entry"><div class="timeline-head"><strong>${escapeHtml(u.author)} · ${escapeHtml(u.role||'')}</strong><span>${fmt(u.createdAt)}</span></div>${u.text?`<p>${escapeHtml(u.text)}</p>`:''}${mediaHtml(u.media)}</article>`).join('')||'<div class="empty-inline">No updates yet.</div>'}</div></section><section class="composer"><textarea id="updateText" rows="3" placeholder="Add an instruction, update or reply…"></textarea><div class="capture-actions"><label class="capture-button">📎 Attach<input id="updateFile" type="file" accept="image/*,video/*,audio/*,.pdf" multiple hidden></label><button id="voiceButton" class="capture-button" type="button">🎙 Voice memo</button><button id="sendUpdate" class="primary-button" type="button">Send update</button></div><div id="updatePreview" class="media-preview-strip"></div></section>`;
  $('detailContent').querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>setStatus(s.id,b.dataset.status));$('detailContent').querySelector('[data-archive]').onclick=()=>toggleArchive(s.id);let updateFiles=[];const uf=$('updateFile');uf.onchange=()=>{updateFiles=[...uf.files];renderTempPreview(updateFiles,$('updatePreview'));};$('sendUpdate').onclick=()=>addUpdate(s.id,$('updateText').value,updateFiles);$('voiceButton').onclick=()=>recordVoice(s.id);
}
function renderTempPreview(files,host){host.innerHTML=files.map((f,i)=>`<div class="preview-chip">${f.type.startsWith('image')?`<img src="${URL.createObjectURL(f)}">`:f.type.startsWith('video')?`<video src="${URL.createObjectURL(f)}"></video>`:'♪'}<button type="button" data-i="${i}">×</button></div>`).join('');}
async function uploadToR2(file,pathPrefix){
  if(!window.SNAG_R2_API||!firebase?.auth?.currentUser)throw new Error('R2 upload is not configured');
  const token=await firebase.auth.currentUser.getIdToken();
  const key=`${pathPrefix}/${uid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const response=await fetch(`${window.SNAG_R2_API.replace(/\/$/,'')}/objects/${key.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!response.ok)throw new Error(`R2 upload failed (${response.status})`);
  const data=await response.json();
  return {url:data.url,key:data.key||key,name:file.name,type:file.type,size:file.size,local:false,storage:'r2'};
}
async function prepareMedia(files,pathPrefix){const result=[];for(const file of files){if(window.SNAG_R2_API&&firebase?.auth?.currentUser)result.push(await uploadToR2(file,pathPrefix));else result.push(await fileToDataUrl(file));}return result;}
async function createSnag(e){e.preventDefault();const submitter=e.submitter;if(submitter?.value==='cancel')return $('snagDialog').close();const title=$('snagTitleInput').value.trim(),description=$('snagDescriptionInput').value.trim();if(!title||!description)return;const id=uid(),t=now();$('createSnagSubmit').disabled=true;$('createSnagSubmit').textContent='Saving…';try{const media=await prepareMedia(pendingFiles,`projects/${selectedProjectId}/snags/${id}`);const snag={id,projectId:selectedProjectId,ref:nextRef(),title,category:$('snagCategoryInput').value,priority:$('snagPriorityInput').value,location:$('snagLocationInput').value.trim(),assignee:$('snagAssigneeInput').value.trim(),description,outcome:$('snagOutcomeInput').value.trim(),status:'open',archived:false,createdAt:t,updatedAt:t,createdBy:profile.name,media,updates:[{id:uid(),type:'note',text:'Snag recorded.',author:profile.name,role:profile.role,createdAt:t,media:[]} ]};state.snags.push(snag);saveState();if(firebase)await writeSnag(snag);$('snagDialog').close();$('snagForm').reset();pendingFiles=[];$('newMediaPreview').innerHTML='';toast('Snag created');render();openDetail(id);}catch(err){console.error(err);toast('Could not save the snag');}finally{$('createSnagSubmit').disabled=false;$('createSnagSubmit').textContent='Create snag';}}
async function addUpdate(id,text,files=[]){text=text.trim();if(!text&&!files.length)return;const s=state.snags.find(x=>x.id===id);const u={id:uid(),type:'note',text,author:profile.name,role:profile.role,createdAt:now(),media:await prepareMedia(files,`projects/${selectedProjectId}/snags/${id}/updates`)};s.updates=s.updates||[];s.updates.push(u);s.updatedAt=u.createdAt;saveState();if(firebase)await writeUpdate(s,u);render();openDetail(id);toast('Update added');}
async function setStatus(id,status){const s=state.snags.find(x=>x.id===id);if(!s||s.status===status)return;s.status=status;s.updatedAt=now();s.resolvedAt=status==='resolved'?s.updatedAt:null;s.updates.push({id:uid(),type:'status',text:`Status changed to ${statusLabel[status]}.`,author:profile.name,role:profile.role,createdAt:s.updatedAt,media:[]});saveState();if(firebase)await writeSnag(s);render();openDetail(id);toast(`Moved to ${statusLabel[status]}`);}
async function toggleArchive(id){const s=state.snags.find(x=>x.id===id);s.archived=!s.archived;s.updatedAt=now();saveState();if(firebase)await writeSnag(s);render();openDetail(id);toast(s.archived?'Archived':'Restored');}
function similarTo(text){const stop=new Set(['the','and','this','that','with','from','into','when','does','not','for','are','was','has','have','home','snag']);const words=new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w=>w.length>3&&!stop.has(w))||[]);return projectSnags().filter(s=>s.status==='resolved').map(s=>{const sw=new Set(`${s.title} ${s.description} ${s.location}`.toLowerCase().match(/[a-z0-9]+/g)||[]);let hits=0;words.forEach(w=>{if(sw.has(w))hits++});return{s,score:words.size?hits/words.size:0};}).filter(x=>x.score>.12).sort((a,b)=>b.score-a.score).slice(0,3);}
function renderSimilar(){const text=`${$('snagTitleInput').value} ${$('snagDescriptionInput').value} ${$('snagLocationInput').value}`;const matches=similarTo(text);$('similarPanel').classList.toggle('hidden',!matches.length);$('similarResults').innerHTML=matches.map(x=>`<div class="similar-item"><strong>${escapeHtml(x.s.ref)} · ${escapeHtml(x.s.title)}</strong><div class="subtle">Resolved ${x.s.resolvedAt?fmt(x.s.resolvedAt):''} · ${escapeHtml(x.s.location||'')}</div></div>`).join('');}

async function openCamera(){
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(isiOS||!navigator.mediaDevices?.getUserMedia){
    $('photoInput').click();
    return;
  }
  $('cameraError').classList.add('hidden');
  $('cameraStarting').classList.remove('hidden');
  $('cameraPreview').classList.remove('ready');
  $('cameraDialog').showModal();
  await startCamera();
}
async function startCamera(){
  stopCameraStream();
  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:{ideal:cameraFacing},width:{ideal:1920},height:{ideal:1440}}
    });
    const video=$('cameraPreview');
    video.srcObject=cameraStream;
    await video.play();
    const ready=()=>{ $('cameraStarting').classList.add('hidden'); video.classList.add('ready'); };
    if(video.readyState>=2) ready(); else video.onloadedmetadata=ready;
  }catch(err){
    console.warn('Camera preview unavailable',err);
    $('cameraStarting').classList.add('hidden');
    $('cameraError').classList.remove('hidden');
  }
}
function stopCameraStream(){
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
  const video=$('cameraPreview');
  if(video){video.srcObject=null;video.classList.remove('ready');}
}
function closeCamera(){
  stopCameraStream();
  if($('cameraDialog').open) $('cameraDialog').close();
}
async function switchCamera(){
  cameraFacing=cameraFacing==='environment'?'user':'environment';
  await startCamera();
}
async function takeCameraPhoto(){
  const video=$('cameraPreview');
  if(!cameraStream||video.readyState<2){
    $('photoInput').click();
    return;
  }
  const canvas=$('cameraCanvas');
  const maxWidth=2000;
  const scale=Math.min(1,maxWidth/video.videoWidth);
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const ctx=canvas.getContext('2d');
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
  if(!blob){toast('Could not capture photo');return;}
  const file=new File([blob],`snag-photo-${Date.now()}.jpg`,{type:'image/jpeg'});
  addPending([file]);
  closeCamera();
}

async function recordVoice(id){if(mediaRecorder?.state==='recording'){mediaRecorder.stop();return;}if(!navigator.mediaDevices?.getUserMedia)return toast('Voice recording is not supported here');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>voiceChunks.push(e.data);mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(voiceChunks,{type:mediaRecorder.mimeType||'audio/webm'});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await addUpdate(id,'Voice memo',[file]);};mediaRecorder.start();$('voiceButton').textContent='■ Stop recording';toast('Recording voice memo…');}catch(e){toast('Microphone permission was not available');}}
function newSnag(){pendingFiles=[];$('newMediaPreview').innerHTML='';$('snagForm').reset();$('similarPanel').classList.add('hidden');$('snagDialog').showModal();}
function addPending(files){pendingFiles=[...pendingFiles,...files];renderTempPreview(pendingFiles,$('newMediaPreview'));$('newMediaPreview').querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{pendingFiles.splice(Number(b.dataset.i),1);addPending([]);});}
function shareProject(){const u=new URL(location.href);u.searchParams.set('project',selectedProjectId);$('shareLinkInput').value=u.toString();$('shareDialog').showModal();}
async function connectFirebase(){try{const raw=$('firebaseConfigInput').value.trim();const cfg=raw?JSON.parse(raw):window.SNAG_FIREBASE_CONFIG;if(!cfg)throw new Error('Missing config');localStorage.setItem(LS.firebase,JSON.stringify(cfg));await initFirebase(cfg);toast('Firebase connected');render();}catch(e){console.error(e);toast('Firebase config could not be connected');}}
async function initFirebase(cfg){const [appMod,fsMod,authMod]=await Promise.all([import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)]);const app=appMod.getApps().length?appMod.getApps()[0]:appMod.initializeApp(cfg);const db=fsMod.getFirestore(app),auth=authMod.getAuth(app);try{if(!auth.currentUser)await authMod.signInAnonymously(auth);}catch(e){console.warn('Anonymous auth not available',e)}firebase={appMod,fsMod,authMod,app,db,auth};await ensureProjectRemote();subscribeFirebase();}
async function ensureProjectRemote(){if(!firebase)return;const p=project(),{fsMod,db,auth}=firebase;await fsMod.setDoc(fsMod.doc(db,'projects',p.id),p,{merge:true});if(auth.currentUser)await fsMod.setDoc(fsMod.doc(db,'projects',p.id,'members',auth.currentUser.uid),{uid:auth.currentUser.uid,name:profile.name,role:profile.role,joinedAt:now()},{merge:true});}
async function writeSnag(s){const {fsMod,db}=firebase;const clean={...s};delete clean.updates;await fsMod.setDoc(fsMod.doc(db,'projects',selectedProjectId,'snags',s.id),clean,{merge:true});for(const u of s.updates||[])await fsMod.setDoc(fsMod.doc(db,'projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});}
async function writeUpdate(s,u){const {fsMod,db}=firebase;await fsMod.setDoc(fsMod.doc(db,'projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});await fsMod.setDoc(fsMod.doc(db,'projects',selectedProjectId,'snags',s.id),{updatedAt:s.updatedAt},{merge:true});}
function subscribeFirebase(){if(!firebase)return;unsubscribe?.();const {fsMod,db}=firebase;const q=fsMod.query(fsMod.collection(db,'projects',selectedProjectId,'snags'),fsMod.orderBy('updatedAt','desc'));unsubscribe=fsMod.onSnapshot(q,async snap=>{for(const d of snap.docs){const data={id:d.id,...d.data()};const us=await fsMod.getDocs(fsMod.collection(db,'projects',selectedProjectId,'snags',d.id,'updates'));data.updates=us.docs.map(x=>({id:x.id,...x.data()}));const i=state.snags.findIndex(x=>x.id===data.id);if(i>=0)state.snags[i]=data;else state.snags.push(data);}saveState();render();if(detailId)openDetail(detailId);},e=>console.warn('Firestore listener',e));}
function disconnectFirebase(){unsubscribe?.();unsubscribe=null;firebase=null;localStorage.removeItem(LS.firebase);toast('Using local mode');render();}
function bind(){document.querySelectorAll('[data-action="new-snag"]').forEach(b=>b.onclick=newSnag);$('newSnagButton').onclick=newSnag;$('projectButton').onclick=()=>$('projectDialog').showModal();$('settingsButton').onclick=()=>$('settingsDialog').showModal();$('shareButton').onclick=shareProject;$('closeDetail').onclick=closeDetail;$('backdrop').onclick=closeDetail;$('snagForm').addEventListener('submit',createSnag);$('cameraButton').onclick=openCamera;$('cameraCancelButton').onclick=closeCamera;$('cameraSwitchButton').onclick=switchCamera;$('cameraShutterButton').onclick=takeCameraPhoto;$('cameraLibraryButton').onclick=()=>$('photoInput').click();$('cameraDialog').addEventListener('close',stopCameraStream);$('cameraDialog').addEventListener('cancel',e=>{e.preventDefault();closeCamera()});['photoInput','videoInput','fileInput'].forEach(id=>$(id).onchange=e=>{addPending([...e.target.files]);if(id==='photoInput'&&$('cameraDialog').open)closeCamera();e.target.value='';});$('searchInput').oninput=e=>{view.search=e.target.value;renderList()};$('filterButton').onclick=()=>{$('filterPanel').classList.toggle('hidden');$('filterButton').setAttribute('aria-expanded',!$('filterPanel').classList.contains('hidden'))};$('categoryFilter').onchange=e=>{view.category=e.target.value;render()};$('priorityFilter').onchange=e=>{view.priority=e.target.value;render()};$('archiveFilter').onchange=e=>{view.archived=e.target.checked;render()};$('sortSelect').onchange=e=>{view.sort=e.target.value;renderList()};$('clearFilters').onclick=()=>{view.category='all';view.priority='all';view.archived=false;render()};document.querySelectorAll('.stat-card').forEach(b=>b.onclick=()=>{view.status=b.dataset.statFilter;render()});$('createProjectButton').onclick=()=>{const name=$('newProjectName').value.trim();if(!name)return toast('Give the project a name');const p={id:uid(),name,address:$('newProjectAddress').value.trim(),type:$('newProjectType').value,createdAt:now()};state.projects.push(p);saveState();selectProject(p.id);toast('Project created')};$('saveProfileButton').onclick=()=>{profile={name:$('profileNameInput').value.trim()||'Me',role:$('profileRoleInput').value};localStorage.setItem(LS.profile,JSON.stringify(profile));render();toast('Identity saved')};$('connectFirebaseButton').onclick=connectFirebase;$('disconnectFirebaseButton').onclick=disconnectFirebase;$('copyShareLink').onclick=async()=>{await navigator.clipboard.writeText($('shareLinkInput').value);toast('Project link copied')};['snagTitleInput','snagDescriptionInput','snagLocationInput'].forEach(id=>$(id).addEventListener('input',renderSimilar));}
bind();render();const cfg=window.SNAG_FIREBASE_CONFIG||JSON.parse(localStorage.getItem(LS.firebase)||'null');if(cfg)initFirebase(cfg).then(render).catch(e=>{console.warn(e);firebase=null;render();});
