const APP_BUILD='2026.09.21.1415';
const FIREBASE_VERSION='12.2.1';
const LS={state:'snag-recorder-state-v1',firebase:'snag-recorder-firebase-v1',profile:'snag-recorder-profile-v1',access:'snag-recorder-shared-access-v1'};
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=iso=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));
const statusLabel={'open':'Open','in-progress':'In progress','review':'Needs review','resolved':'Resolved'};
const priorityRank={Urgent:0,High:1,Normal:2,Low:3};
let firebase=null, unsubscribe=null, pendingFiles=[], detailId=null, mediaRecorder=null, voiceChunks=[], cameraTestStream=null, cameraTestFacing='environment', cloudStatus={state:'starting',message:'Starting Firebase…'}, latestBuild=null;
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
function render(){renderProject();renderStats();renderFilters();renderList();renderProjects();renderSettings();renderCloudDiagnostics();}
function renderProject(){const p=project();if(!p)return;$('projectName').textContent=p.name;$('projectAddress').textContent=p.address||'No address/context';$('projectTypeLabel').textContent=`${p.type.toUpperCase()} PROJECT`;$('profilePill').textContent=`${profile.role} · ${profile.name}`;const live=cloudStatus.state==='connected',pill=$('syncPill');pill.className=`sync-pill ${live?'connected':'local'}`;pill.innerHTML=`<span class="dot"></span><span>${live?'Live sync':cloudStatus.state==='error'?'Cloud error':'Connecting…'}</span>`;pill.title=cloudStatus.message||'';}
function renderStats(){const s=projectSnags();$('statActive').textContent=s.filter(x=>x.status!=='resolved'&&!x.archived).length;$('statProgress').textContent=s.filter(x=>x.status==='in-progress'&&!x.archived).length;$('statReview').textContent=s.filter(x=>x.status==='review'&&!x.archived).length;$('statResolved').textContent=s.filter(x=>x.status==='resolved').length;document.querySelectorAll('.stat-card').forEach(x=>x.classList.toggle('active',x.dataset.statFilter===view.status));}
function renderFilters(){let n=0;if(view.category!=='all')n++;if(view.priority!=='all')n++;if(view.archived)n++;$('filterCount').textContent=n?`(${n})`:'';$('categoryFilter').value=view.category;$('priorityFilter').value=view.priority;$('archiveFilter').checked=view.archived;$('sortSelect').value=view.sort;}
function thumbHtml(s){const m=s.media?.[0];if(!m)return `<div class="snag-thumb">${s.category==='App / software'?'⌘':s.category==='Business process'?'⇄':'⌂'}</div>`;if(m.type?.startsWith('image'))return `<div class="snag-thumb"><img src="${escapeHtml(m.url)}" alt=""></div>`;if(m.type?.startsWith('video'))return `<div class="snag-thumb"><video src="${escapeHtml(m.url)}" muted playsinline></video></div>`;return `<div class="snag-thumb">♪</div>`;}
function renderList(){const list=getFiltered();const titles={active:'Active snags','in-progress':'In progress',review:'Needs review',resolved:'Resolved archive'};$('listTitle').textContent=titles[view.status]||'Snags';$('snagList').innerHTML=list.map(s=>`<button class="snag-card" data-id="${s.id}" type="button">${thumbHtml(s)}<div><div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.ref)}</span></div><h3>${escapeHtml(s.title)}</h3><div class="snag-foot"><span>${escapeHtml(s.location||'No location')}</span><span>·</span><span>${escapeHtml(s.assignee||'Unassigned')}</span><span>·</span><span>Updated ${fmt(s.updatedAt)}</span></div></div><div class="snag-actions"><span class="activity-count">${(s.updates||[]).length} updates</span></div></button>`).join('');$('emptyState').classList.toggle('hidden',list.length>0);$('snagList').querySelectorAll('.snag-card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));}
function renderProjects(){$('projectList').innerHTML=state.projects.map(p=>`<div class="project-option ${p.id===selectedProjectId?'current':''}"><button type="button" data-project="${p.id}"><strong>${escapeHtml(p.name)}</strong><div class="subtle">${escapeHtml(p.address||p.type)}</div></button><span>${projectSnagCount(p.id)}</span></div>`).join('');$('projectList').querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>selectProject(b.dataset.project));}
function projectSnagCount(pid){return state.snags.filter(s=>s.projectId===pid&&s.status!=='resolved').length;}
function selectProject(id){selectedProjectId=id;state.selectedProjectId=id;saveState();const u=new URL(location.href);u.searchParams.set('project',id);history.replaceState({},'',u);$('projectDialog').close();if(firebase) subscribeFirebase();render();}
function renderSettings(){$('profileNameInput').value=profile.name;$('profileRoleInput').value=profile.role;const raw=localStorage.getItem(LS.firebase)||'';$('firebaseConfigInput').value=raw;const live=!!firebase?.auth?.currentUser;$('firebaseStatusTitle').textContent=live?'Connected':'Local mode';$('firebaseBadge').className=`badge ${live?'good':'neutral'}`;$('firebaseBadge').textContent=live?'Connected':'Not signed in';$('shareWarning').classList.toggle('hidden',live);}
function openDetail(id){detailId=id;const s=state.snags.find(x=>x.id===id);if(!s)return;$('detailRef').textContent=s.ref;$('detailTitle').textContent=s.title;renderDetail(s);$('detailDrawer').classList.remove('hidden');$('backdrop').classList.remove('hidden');$('detailDrawer').setAttribute('aria-hidden','false');}
function closeDetail(){$('detailDrawer').classList.add('hidden');$('backdrop').classList.add('hidden');$('detailDrawer').setAttribute('aria-hidden','true');detailId=null;}
function mediaHtml(items=[]){if(!items.length)return'';return `<div class="media-grid">${items.map(m=>m.type?.startsWith('image')?`<a class="media-item" href="${escapeHtml(m.url)}" target="_blank"><img src="${escapeHtml(m.url)}" alt="Attachment"></a>`:m.type?.startsWith('video')?`<div class="media-item"><video src="${escapeHtml(m.url)}" controls playsinline></video></div>`:m.type?.startsWith('audio')?`<div class="media-item"><audio src="${escapeHtml(m.url)}" controls></audio></div>`:`<a class="media-item" href="${escapeHtml(m.url)}" target="_blank">Open file</a>`).join('')}</div>`;}
function renderDetail(s){$('detailContent').innerHTML=`<section class="detail-hero"><div class="snag-meta"><span class="status-badge status-${s.status}">${statusLabel[s.status]}</span><span class="priority-badge priority-${s.priority}">${s.priority}</span><span>${escapeHtml(s.category)}</span></div>${mediaHtml(s.media)}<p class="detail-description">${escapeHtml(s.description)}</p><div class="detail-info-grid"><div class="info-card"><span>Area / location</span><strong>${escapeHtml(s.location||'—')}</strong></div><div class="info-card"><span>Assigned to</span><strong>${escapeHtml(s.assignee||'—')}</strong></div><div class="info-card"><span>Reported by</span><strong>${escapeHtml(s.createdBy||'—')}</strong></div><div class="info-card"><span>Created</span><strong>${fmt(s.createdAt)}</strong></div></div>${s.outcome?`<div class="info-card"><span>Resolved when</span><strong>${escapeHtml(s.outcome)}</strong></div>`:''}</section><section><h3>Status</h3><div class="status-controls">${Object.entries(statusLabel).map(([k,v])=>`<button type="button" data-status="${k}" class="${s.status===k?'selected':''}">${v}</button>`).join('')}<button type="button" data-archive="1">${s.archived?'Unarchive':'Archive'}</button></div></section><section><h3>Conversation & progress</h3><div class="timeline">${(s.updates||[]).slice().sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map(u=>`<article class="timeline-entry"><div class="timeline-head"><strong>${escapeHtml(u.author)} · ${escapeHtml(u.role||'')}</strong><span>${fmt(u.createdAt)}</span></div>${u.text?`<p>${escapeHtml(u.text)}</p>`:''}${mediaHtml(u.media)}</article>`).join('')||'<div class="empty-inline">No updates yet.</div>'}</div></section><section class="composer"><textarea id="updateText" rows="3" placeholder="Add an instruction, update or reply…"></textarea><div class="capture-actions"><label class="capture-button">📎 Attach<input id="updateFile" type="file" accept="image/*,video/*,audio/*,.pdf" multiple hidden></label><button id="voiceButton" class="capture-button" type="button">🎙 Voice memo</button><button id="sendUpdate" class="primary-button" type="button">Send update</button></div><div id="updatePreview" class="media-preview-strip"></div></section>`;
  $('detailContent').querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>setStatus(s.id,b.dataset.status));$('detailContent').querySelector('[data-archive]').onclick=()=>toggleArchive(s.id);let updateFiles=[];const uf=$('updateFile');uf.onchange=()=>{updateFiles=[...uf.files];renderTempPreview(updateFiles,$('updatePreview'));};$('sendUpdate').onclick=()=>addUpdate(s.id,$('updateText').value,updateFiles);$('voiceButton').onclick=()=>recordVoice(s.id);
}
function renderTempPreview(files,host){host.innerHTML=files.map((f,i)=>`<div class="preview-chip">${f.type.startsWith('image')?`<img src="${URL.createObjectURL(f)}">`:f.type.startsWith('video')?`<video src="${URL.createObjectURL(f)}"></video>`:'♪'}<button type="button" data-i="${i}">×</button></div>`).join('');}
async function optimiseMediaFile(file){if(!file.type?.startsWith('image/')||file.type==='image/gif'||file.size<900000)return file;try{const bitmap=await createImageBitmap(file),max=2000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));return blob?new File([blob],(file.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}):file}catch(e){console.warn('Photo compression failed',e);return file}}
async function uploadToR2(file,pathPrefix){
  if(!window.SNAG_R2_API||!firebase?.auth?.currentUser)throw new Error('R2 upload is not configured');
  const token=await firebase.auth.currentUser.getIdToken();
  const key=`${pathPrefix}/${uid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const response=await fetch(`${window.SNAG_R2_API.replace(/\/$/,'')}/objects/${key.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!response.ok)throw new Error(`R2 upload failed (${response.status})`);
  const data=await response.json();
  return {url:data.url,key:data.key||key,name:file.name,type:file.type,size:file.size,local:false,storage:'r2'};
}
async function prepareMedia(files,pathPrefix){
  const result=[];
  for(const original of files){const file=await optimiseMediaFile(original);if(window.SNAG_R2_API&&firebase?.auth?.currentUser)result.push(await uploadToR2(file,pathPrefix));else{if(file.type?.startsWith('video/'))throw new Error('Video needs cloud sync. Firebase is not connected yet.');if(file.size>2.5*1024*1024)throw new Error('Photo is too large for local mode. Reconnect Firebase and try again.');result.push(await fileToDataUrl(file));}}
  return result;
}
async function createSnag(e){
  e.preventDefault();
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
  const title=enteredTitle||(description.split(/\n|[.!?]/)[0].trim().slice(0,90)||mediaLead);const id=uid(),t=now();$('createSnagSubmit').disabled=true;$('createSnagSubmit').textContent=pendingFiles.length?'Uploading…':'Saving…';try{const media=await prepareMedia(pendingFiles,`snag-projects/${selectedProjectId}/snags/${id}`);const snag={id,projectId:selectedProjectId,ref:nextRef(),title,category:$('snagCategoryInput').value,priority:$('snagPriorityInput').value,location:$('snagLocationInput').value.trim(),assignee:$('snagAssigneeInput').value.trim(),description,outcome:$('snagOutcomeInput').value.trim(),status:'open',archived:false,createdAt:t,updatedAt:t,createdBy:profile.name,media,updates:[{id:uid(),type:'note',text:'Snag recorded.',author:profile.name,role:profile.role,createdAt:t,media:[]} ]};state.snags.push(snag);saveState();if(firebase)await writeSnag(snag);$('snagDialog').close();$('snagForm').reset();pendingFiles=[];$('newMediaPreview').innerHTML='';toast('Snag created');render();openDetail(id);}catch(err){console.error(err);const msg=err?.message||'Could not save the snag';const formError=$('snagFormError');if(formError){formError.textContent=msg;formError.classList.remove('hidden');formError.scrollIntoView({behavior:'smooth',block:'center'});}toast(msg);}finally{$('createSnagSubmit').disabled=false;$('createSnagSubmit').textContent='Create snag';}}
async function addUpdate(id,text,files=[]){text=text.trim();if(!text&&!files.length)return;const s=state.snags.find(x=>x.id===id);const u={id:uid(),type:'note',text,author:profile.name,role:profile.role,createdAt:now(),media:await prepareMedia(files,`snag-projects/${selectedProjectId}/snags/${id}/updates`)};s.updates=s.updates||[];s.updates.push(u);s.updatedAt=u.createdAt;saveState();if(firebase)await writeUpdate(s,u);render();openDetail(id);toast('Update added');}
async function setStatus(id,status){const s=state.snags.find(x=>x.id===id);if(!s||s.status===status)return;s.status=status;s.updatedAt=now();s.resolvedAt=status==='resolved'?s.updatedAt:null;s.updates.push({id:uid(),type:'status',text:`Status changed to ${statusLabel[status]}.`,author:profile.name,role:profile.role,createdAt:s.updatedAt,media:[]});saveState();if(firebase)await writeSnag(s);render();openDetail(id);toast(`Moved to ${statusLabel[status]}`);}
async function toggleArchive(id){const s=state.snags.find(x=>x.id===id);s.archived=!s.archived;s.updatedAt=now();saveState();if(firebase)await writeSnag(s);render();openDetail(id);toast(s.archived?'Archived':'Restored');}
function similarTo(text){const stop=new Set(['the','and','this','that','with','from','into','when','does','not','for','are','was','has','have','home','snag']);const words=new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w=>w.length>3&&!stop.has(w))||[]);return projectSnags().filter(s=>s.status==='resolved').map(s=>{const sw=new Set(`${s.title} ${s.description} ${s.location}`.toLowerCase().match(/[a-z0-9]+/g)||[]);let hits=0;words.forEach(w=>{if(sw.has(w))hits++});return{s,score:words.size?hits/words.size:0};}).filter(x=>x.score>.12).sort((a,b)=>b.score-a.score).slice(0,3);}
function renderSimilar(){const text=`${$('snagTitleInput').value} ${$('snagDescriptionInput').value} ${$('snagLocationInput').value}`;const matches=similarTo(text);$('similarPanel').classList.toggle('hidden',!matches.length);$('similarResults').innerHTML=matches.map(x=>`<div class="similar-item"><strong>${escapeHtml(x.s.ref)} · ${escapeHtml(x.s.title)}</strong><div class="subtle">Resolved ${x.s.resolvedAt?fmt(x.s.resolvedAt):''} · ${escapeHtml(x.s.location||'')}</div></div>`).join('');}


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
async function shareProject(){
  if(!firebase?.auth?.currentUser)return toast('Cloud sharing is not connected yet');
  try{
    const {fsMod,db,auth}=firebase,p=project();
    const projectRef=fsMod.doc(db,'snag_projects',selectedProjectId);
    const projectSnap=await fsMod.getDoc(projectRef);
    if(!projectSnap.exists())await ensureProjectRemote();
    const latest=(await fsMod.getDoc(projectRef)).data();
    if(latest?.ownerUid!==auth.currentUser.uid)return toast('Only the project owner can create an invite');
    const inviteId=randomCapability();
    await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'invites',inviteId),{active:true,role:'contractor',persistent:true,createdAt:now(),createdBy:auth.currentUser.uid});
    const u=new URL(location.href);u.searchParams.set('project',selectedProjectId);u.searchParams.set('invite',inviteId);
    $('shareLinkInput').value=u.toString();$('shareDialog').showModal();
  }catch(e){console.error(e);toast('Could not create a secure invite link');}
}
function randomCapability(){const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function connectFirebase(){try{const raw=$('firebaseConfigInput').value.trim();const cfg=raw?JSON.parse(raw):window.SNAG_FIREBASE_CONFIG;if(!cfg)throw new Error('Missing config');localStorage.setItem(LS.firebase,JSON.stringify(cfg));await initFirebase(cfg);toast('Firebase connected');render();}catch(e){console.error(e);toast('Firebase config could not be connected');}}

function rememberSharedAccess(projectId,inviteId,role){
  if(!projectId||!inviteId)return;
  localStorage.setItem(LS.access,JSON.stringify({projectId,inviteId,role:role||'contractor',savedAt:now()}));
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
async function migrateLocalProjectToCloud(){
  if(!firebase?.auth?.currentUser)return;
  const localSnags=state.snags.filter(s=>s.projectId===selectedProjectId);
  if(!localSnags.length)return;
  for(const snag of localSnags){
    try{
      snag.media=await migrateMediaItems(snag.media,`snag-projects/${selectedProjectId}/snags/${snag.id}`);
      for(const update of (snag.updates||[])){
        update.media=await migrateMediaItems(update.media,`snag-projects/${selectedProjectId}/snags/${snag.id}/updates/${update.id}`);
      }
      await writeSnag(snag);
    }catch(e){
      console.warn('Could not migrate local snag',snag.id,e);
    }
  }
  saveState();
}
async function initFirebase(cfg){
  cloudStatus={state:'starting',message:'Connecting to Firebase…'};render();
  const [appMod,fsMod,authMod]=await Promise.all([import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)]);
  const app=appMod.getApps().length?appMod.getApps()[0]:appMod.initializeApp(cfg),db=fsMod.getFirestore(app),auth=authMod.getAuth(app);
  await auth.authStateReady();
  if(!auth.currentUser){try{await authMod.signInAnonymously(auth);}catch(e){console.error('Anonymous Firebase sign-in failed',e);cloudStatus={state:'error',message:e?.code==='auth/operation-not-allowed'?'Anonymous sign-in is disabled in Firebase Authentication.':(e?.code||e?.message||'Firebase sign-in failed')};render();throw e;}}
  firebase={appMod,fsMod,authMod,app,db,auth};
  if(launchProjectId&&launchInviteId)await joinInvitedProject(launchProjectId,launchInviteId);
  else {await ensureProjectRemote();await migrateLocalProjectToCloud();}
  subscribeFirebase();
  cloudStatus={state:'connected',message:`Shared cloud connected · ${launchInviteId?'invite access':'owner access'} · R2 ${window.SNAG_R2_API?'configured':'not configured'}`};render();
}
async function joinInvitedProject(projectId,inviteId){
  const {fsMod,db,auth}=firebase;
  const inviteSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',projectId,'invites',inviteId));
  if(!inviteSnap.exists()||inviteSnap.data().active!==true)throw new Error('Invite is invalid or has been revoked');
  const role=inviteSnap.data().role||'contractor';
  rememberSharedAccess(projectId,inviteId,role);
  await fsMod.setDoc(fsMod.doc(db,'snag_projects',projectId,'members',auth.currentUser.uid),{uid:auth.currentUser.uid,name:profile.name,role,inviteId,joinedAt:now()},{merge:true});
  const pSnap=await fsMod.getDoc(fsMod.doc(db,'snag_projects',projectId));
  if(!pSnap.exists())throw new Error('Project not found');
  const p={id:projectId,...pSnap.data()};
  const i=state.projects.findIndex(x=>x.id===projectId);if(i>=0)state.projects[i]=p;else state.projects.push(p);
  selectedProjectId=projectId;state.selectedProjectId=projectId;profile={...profile,role:role[0].toUpperCase()+role.slice(1)};localStorage.setItem(LS.profile,JSON.stringify(profile));saveState();
}
async function ensureProjectRemote(){
  if(!firebase?.auth?.currentUser)return;
  const p=project(),{fsMod,db,auth}=firebase;if(!p)return;
  const ref=fsMod.doc(db,'snag_projects',p.id);
  // Bootstrap by writing first. Reading a document that does not yet exist is
  // denied by the owner/member read rule, so a get-before-create deadlocks a
  // brand-new anonymous session with permission-denied.
  await fsMod.setDoc(ref,{...p,ownerUid:auth.currentUser.uid,updatedAt:now()},{merge:true});
  await fsMod.setDoc(
    fsMod.doc(db,'snag_projects',p.id,'members',auth.currentUser.uid),
    {uid:auth.currentUser.uid,name:profile.name,role:'owner',joinedAt:now()},
    {merge:true}
  );
}
async function writeSnag(s){const {fsMod,db}=firebase;const clean={...s};delete clean.updates;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id),clean,{merge:true});for(const u of s.updates||[])await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});}
async function writeUpdate(s,u){const {fsMod,db}=firebase;await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id,'updates',u.id),u,{merge:true});await fsMod.setDoc(fsMod.doc(db,'snag_projects',selectedProjectId,'snags',s.id),{updatedAt:s.updatedAt},{merge:true});}
function subscribeFirebase(){if(!firebase?.auth?.currentUser)return;unsubscribe?.();const {fsMod,db}=firebase;const q=fsMod.query(fsMod.collection(db,'snag_projects',selectedProjectId,'snags'),fsMod.orderBy('updatedAt','desc'));unsubscribe=fsMod.onSnapshot(q,async snap=>{for(const d of snap.docs){const data={id:d.id,...d.data()};const us=await fsMod.getDocs(fsMod.collection(db,'snag_projects',selectedProjectId,'snags',d.id,'updates'));data.updates=us.docs.map(x=>({id:x.id,...x.data()}));const i=state.snags.findIndex(x=>x.id===data.id);if(i>=0)state.snags[i]=data;else state.snags.push(data);}saveState();render();if(detailId)openDetail(detailId);},e=>console.warn('Firestore listener',e));}
function disconnectFirebase(){unsubscribe?.();unsubscribe=null;firebase=null;localStorage.removeItem(LS.firebase);toast('Using local mode');render();}
function renderCloudDiagnostics(){const t=cloudStatus.message||cloudStatus.state;if($('cloudDiagnostics'))$('cloudDiagnostics').textContent=t;if($('buildDialogCloud'))$('buildDialogCloud').textContent=t;if($('runningBuild'))$('runningBuild').textContent='v'+APP_BUILD;if($('buildDialogRunning'))$('buildDialogRunning').textContent='v'+APP_BUILD;const l=latestBuild?.build;if($('latestBuildState'))$('latestBuildState').textContent=l?(l===APP_BUILD?'· latest':'· update available'):'· latest unknown';if($('buildDialogLatest'))$('buildDialogLatest').textContent=l?'v'+l:'Unknown';}
async function checkLatestBuild(){try{const r=await fetch('./version.json?t='+Date.now(),{cache:'no-store'});latestBuild=r.ok?await r.json():null}catch{latestBuild=null}renderCloudDiagnostics()}
async function hardRefreshApp(){try{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('snag-')).map(k=>caches.delete(k)))}catch(e){console.warn(e)}location.reload()}
function bind(){document.querySelectorAll('[data-action="new-snag"]').forEach(b=>b.onclick=newSnag);$('newSnagButton').onclick=newSnag;$('projectButton').onclick=()=>$('projectDialog').showModal();$('settingsButton').onclick=()=>$('settingsDialog').showModal();$('shareButton').onclick=shareProject;$('closeDetail').onclick=closeDetail;$('backdrop').onclick=closeDetail;$('snagForm').addEventListener('submit',createSnag);['photoInput','videoInput','fileInput'].forEach(id=>$(id).onchange=e=>{addPending([...e.target.files]);e.target.value='';});$('liveCameraButton').onclick=openCameraTest;$('cameraTestClose').onclick=closeCameraTest;$('cameraTestSwitch').onclick=switchCameraTest;$('cameraTestShutter').onclick=takeCameraTestPhoto;$('cameraTestLibrary').onclick=()=>$('photoInput').click();$('cameraTestDialog').addEventListener('cancel',e=>{e.preventDefault();closeCameraTest()});$('cameraTestDialog').addEventListener('close',stopCameraTest);$('searchInput').oninput=e=>{view.search=e.target.value;renderList()};$('filterButton').onclick=()=>{$('filterPanel').classList.toggle('hidden');$('filterButton').setAttribute('aria-expanded',!$('filterPanel').classList.contains('hidden'))};$('categoryFilter').onchange=e=>{view.category=e.target.value;render()};$('priorityFilter').onchange=e=>{view.priority=e.target.value;render()};$('archiveFilter').onchange=e=>{view.archived=e.target.checked;render()};$('sortSelect').onchange=e=>{view.sort=e.target.value;renderList()};$('clearFilters').onclick=()=>{view.category='all';view.priority='all';view.archived=false;render()};document.querySelectorAll('.stat-card').forEach(b=>b.onclick=()=>{view.status=b.dataset.statFilter;render()});$('createProjectButton').onclick=()=>{const name=$('newProjectName').value.trim();if(!name)return toast('Give the project a name');const p={id:uid(),name,address:$('newProjectAddress').value.trim(),type:$('newProjectType').value,createdAt:now()};state.projects.push(p);saveState();selectProject(p.id);if(firebase?.auth?.currentUser)ensureProjectRemote().then(()=>subscribeFirebase()).catch(console.error);toast('Project created')};$('saveProfileButton').onclick=()=>{profile={name:$('profileNameInput').value.trim()||'Me',role:$('profileRoleInput').value};localStorage.setItem(LS.profile,JSON.stringify(profile));render();toast('Identity saved')};$('connectFirebaseButton').onclick=connectFirebase;$('disconnectFirebaseButton').onclick=disconnectFirebase;$('retryCloudButton').onclick=()=>initFirebase(window.SNAG_FIREBASE_CONFIG).catch(e=>{console.error(e);render()});$('buildBadge').onclick=()=>{$('buildDialog').showModal();checkLatestBuild()};$('closeBuildDialog').onclick=()=>$('buildDialog').close();$('refreshAppButton').onclick=hardRefreshApp;$('copyShareLink').onclick=async()=>{await navigator.clipboard.writeText($('shareLinkInput').value);toast('Project link copied')};['snagTitleInput','snagDescriptionInput','snagLocationInput'].forEach(id=>$(id).addEventListener('input',renderSimilar));}
bind();render();checkLatestBuild();const cfg=window.SNAG_FIREBASE_CONFIG||JSON.parse(localStorage.getItem(LS.firebase)||'null');if(cfg)initFirebase(cfg).then(render).catch(e=>{console.warn(e);firebase=null;if(cloudStatus.state!=='error')cloudStatus={state:'error',message:e?.code||e?.message||'Firebase connection failed'};render();});
