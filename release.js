(function(){
'use strict';
const $=s=>document.querySelector(s);
const ce=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e};
const DEV_API='https://apps-monitor-api.nirav2000-github.workers.dev/app-monitor';
let developerConfig={userTelemetryOptOutVisible:false},developerAdmin=null;
async function loadDeveloperConfig(){
  try{
    const r=await fetch(DEV_API+'/developer-config?app=Snag',{cache:'no-store'});
    if(r.ok)developerConfig={...developerConfig,...await r.json()};
  }catch(e){console.warn('Developer config unavailable',e)}
  renderTelemetryControls();
  return developerConfig;
}
async function detectDeveloperAdmin(){
  if(!window.AppsPasskeyAuth)return false;
  try{
    developerAdmin=AppsPasskeyAuth.create({baseUrl:DEV_API,sessionStoreKey:'app-monitor.admin-session.v2',failureStoreKey:'app-monitor.auth-failures.v2'});
    const restored=developerAdmin.restoreSession();if(!restored)return false;
    const valid=await developerAdmin.validateSession();if(!valid)return false;
    renderDeveloperControls(true);return true;
  }catch(e){console.warn('Developer admin session unavailable',e);return false}
}
function renderTelemetryControls(){
  const row=$('#releaseUserTelemetry');if(!row)return;
  row.classList.toggle('hidden',developerConfig.userTelemetryOptOutVisible!==true);
  if(developerConfig.userTelemetryOptOutVisible===true){
    const v=AppsPrivacy.get(),input=$('#releaseTelemetryEnabled');
    if(input)input.checked=v.analytics===true&&v.personalisedMonitoring===true;
  }
}
function renderDeveloperControls(show){
  const card=$('#releaseDeveloperControls');if(card)card.classList.toggle('hidden',!show);
  if(show&&$('#releaseShowOptOut'))$('#releaseShowOptOut').checked=developerConfig.userTelemetryOptOutVisible===true;
}
async function saveDeveloperConfig(){
  if(!developerAdmin?.session?.token)throw new Error('Developer session is not active. Open App Monitor and sign in with your passkey.');
  const value={app:'Snag',userTelemetryOptOutVisible:$('#releaseShowOptOut')?.checked===true};
  const r=await fetch(DEV_API+'/developer-config',{method:'POST',headers:{'Content-Type':'application/json',...developerAdmin.authHeaders()},body:JSON.stringify(value)});
  if(!r.ok)throw new Error(await r.text());
  developerConfig={...developerConfig,...await r.json()};renderTelemetryControls();renderDeveloperControls(true);return developerConfig;
}

window.SnagCommercial={
  state:{projectId:null,loadedAt:0,stripeConfigured:false,paid:false,plan:'free',status:'free'},
  async load(force=false){
    const c=window.SnagReleaseBridge?.context?.()||{},projectId=c.projectId;
    if(!projectId)return this.state;
    if(!force&&this.state.projectId===projectId&&Date.now()-this.state.loadedAt<30000)return this.state;
    const b=await AppsBilling.status(projectId);
    this.state={...this.state,...b,projectId,loadedAt:Date.now()};
    return this.state;
  },
  async check(feature){
    const c=window.SnagReleaseBridge?.context?.()||{},s=await this.load();
    if(!s.stripeConfigured)return true;
    if(s.paid&&s.plan==='pro')return true;
    if(feature==='createProject'){openGate('Additional live projects require Snag Pro.');return false}
    if(s.paid)return true;
    if(feature==='createSnag'&&(c.snagCount||0)<5)return true;
    openGate(feature==='shareProject'
      ?'Sharing with builders and contractors requires a Home Project licence.'
      :'The free trial includes up to 5 snags. Unlock this property to continue.');
    return false;
  }
};

function openGate(message){
  modal().classList.remove('hidden');
  const el=$('#releaseBillingState');if(el)el.textContent=message;
  SnagReleaseBridge?.toast?.(message);
}
async function wait(){
  for(let i=0;i<100;i++){
    if(window.SnagReleaseBridge&&window.AppsAccount&&window.AppsPrivacy&&window.AppsBilling)return start();
    await new Promise(r=>setTimeout(r,100));
  }
}
function download(name,data){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function modal(){
  let host=$('#releaseOverlay');if(host)return host;
  host=ce('div','release-overlay hidden');host.id='releaseOverlay';
  host.innerHTML=`<div class="release-panel">
    <div style="display:flex;justify-content:space-between;gap:12px">
      <div><span class="section-kicker">ACCOUNT</span><h2>Snag account</h2></div>
      <button id="releaseClose" class="icon-button" type="button">×</button>
    </div>
    <p id="releaseAccountState" class="release-status"></p>
    <div id="releaseAuthFields">
      <label>Email<input id="releaseEmail" type="email" autocomplete="email"></label>
      <label>Password<input id="releasePassword" type="password" minlength="8" autocomplete="current-password"></label>
      <div class="release-actions">
        <button id="releaseProtect" class="primary-button" type="button">Create / protect account</button>
        <button id="releaseSignIn" class="secondary-button" type="button">Sign in</button>
        <button id="releaseReset" class="text-button" type="button">Reset password</button>
      </div>
    </div>
    <div class="divider"></div>
    <div id="releaseSecurityFields">
      <span class="section-kicker">ACCOUNT SECURITY</span>
      <label>Current password<input id="releaseCurrentPassword" type="password" autocomplete="current-password"></label>
      <label>New email<input id="releaseNewEmail" type="email" autocomplete="email"></label>
      <div class="release-actions"><button id="releaseChangeEmail" class="secondary-button" type="button">Change email</button></div>
      <label>New password<input id="releaseNewPassword" type="password" minlength="8" autocomplete="new-password"></label>
      <div class="release-actions"><button id="releaseChangePassword" class="secondary-button" type="button">Change password</button></div>
    </div>
    <div class="divider"></div>
    <div>
      <span class="section-kicker">PROJECT LICENCE</span>
      <h3>Home Project <span class="pricing-pill">£34.99 one-off</span></h3>
      <p class="subtle">Unlimited snags and invited participants for this property. Invited contractors do not pay.</p>
      <div class="release-actions">
        <button id="releaseBuyHome" class="primary-button" type="button">Unlock this project</button>
        <button id="releaseBuyPro" class="secondary-button" type="button">Snag Pro · £12/month</button>
      </div>
      <p id="releaseBillingState" class="release-status"></p>
    </div>
    <div class="divider"></div>
    <div class="release-actions">
      <button id="releaseVerify" class="secondary-button" type="button">Send verification email</button>
      <button id="releaseSignOut" class="secondary-button" type="button">Sign out</button>
      <button id="releaseExport" class="secondary-button" type="button">Export project</button>
      <button id="releaseDeleteProject" class="secondary-button danger" type="button">Delete project</button>
      <button id="releaseDeleteAccount" class="secondary-button danger" type="button">Delete account & data</button>
    </div>
    <div class="divider"></div>
    <p class="microcopy"><a href="./privacy.html" target="_blank">Privacy</a> · <a href="./terms.html" target="_blank">Terms</a></p>
  </div>`;
  document.body.appendChild(host);
  $('#releaseClose').onclick=()=>host.classList.add('hidden');
  host.addEventListener('click',e=>{if(e.target===host)host.classList.add('hidden')});
  return host;
}
function privacyBanner(){return null}
function addSettingsCard(){
  const accountStack=$('#settings-panel-account .settings-panel-stack');if(!accountStack||$('#releaseSettingsCard'))return;
  const c=ce('section','settings-card release-card');c.id='releaseSettingsCard';
  c.innerHTML='<div class="section-kicker">ACCOUNT · PRIVACY · BILLING</div><h3>Release account</h3><p id="releaseSettingsState" class="subtle">Loading…</p><div class="release-actions"><button id="openReleaseAccount" class="primary-button" type="button">Account & billing</button><a class="secondary-button" href="./welcome.html" target="_blank">About Snag</a></div><div id="releaseUserTelemetry" class="hidden" style="margin-top:12px"><label class="switch-row"><input id="releaseTelemetryEnabled" type="checkbox"><span>Share usage diagnostics to help improve Snag</span></label></div><div id="releaseDeveloperControls" class="release-card hidden" style="margin-top:12px"><div class="section-kicker">DEVELOPER CONTROLS</div><h3>Telemetry controls</h3><p class="subtle">Tracking is on by default. This controls whether ordinary users are shown an opt-out switch.</p><label class="switch-row"><input id="releaseShowOptOut" type="checkbox"><span>Show users the telemetry opt-out setting</span></label><button id="releaseSaveDeveloper" class="secondary-button" type="button">Save developer setting</button></div>';
  accountStack.appendChild(c);
  $('#openReleaseAccount').onclick=()=>{modal().classList.remove('hidden');refresh()};
  const telemetry=$('#releaseTelemetryEnabled');if(telemetry)telemetry.onchange=()=>{AppsPrivacy.set({analytics:telemetry.checked,personalisedMonitoring:telemetry.checked});refresh()};
  const saveDeveloper=$('#releaseSaveDeveloper');if(saveDeveloper)saveDeveloper.onclick=async()=>{try{await saveDeveloperConfig();SnagReleaseBridge.toast('Developer telemetry setting saved')}catch(e){SnagReleaseBridge.toast(e.message)}};
}
async function status(){
  const c=SnagReleaseBridge.context(),u=AppsAccount.snapshot().user,s=$('#releaseAccountState'),ss=$('#releaseSettingsState');
  const text=!u?'Connecting…':u.isAnonymous?'Guest access on this device · protect it before paying':(u.email||'Protected account')+(u.emailVerified?' · verified':' · verification pending');
  if(s)s.textContent=text;if(ss)ss.textContent=text;
  const security=$('#releaseSecurityFields');if(security)security.classList.toggle('hidden',!u||u.isAnonymous);
  if(c.projectId){
    try{
      const b=await SnagCommercial.load(true),el=$('#releaseBillingState');
      if(el)el.textContent=b.stripeConfigured
        ?(b.paid?(b.plan==='pro'?'Snag Pro active for this account':'Home Project licence active'):'Free trial · up to 5 snags · sharing locked')
        :'Payments backend is ready; commercial gates remain disabled until Stripe is connected.';
    }catch(e){const el=$('#releaseBillingState');if(el)el.textContent=e.message}
  }
}
function refresh(){
  const u=AppsAccount.snapshot().user;
  if($('#releaseEmail')&&u?.email)$('#releaseEmail').value=u.email;
  status();
}
async function checkout(planId){
  const u=AppsAccount.snapshot().user,c=SnagReleaseBridge.context();
  if(!u||u.isAnonymous){
    modal().classList.remove('hidden');
    $('#releaseAccountState').textContent='Protect this account before purchasing so the licence is recoverable on another device.';
    return;
  }
  try{
    const r=await AppsBilling.checkout(c.projectId,planId,location.origin+location.pathname+'?app=1');
    location.href=r.url;
  }catch(e){SnagReleaseBridge.toast(e.message)}
}
async function start(){
  AppsBilling.configure({endpoint:SnagReleaseBridge.billingEndpoint(),tokenProvider:SnagReleaseBridge.token});
  modal();addSettingsCard();privacyBanner();await loadDeveloperConfig();await detectDeveloperAdmin();renderTelemetryControls();

  $('#releaseProtect').onclick=async()=>{
    try{await AppsAccount.protectOrCreate($('#releaseEmail').value,$('#releasePassword').value);await AppsAccount.sendVerification().catch(()=>{});refresh();SnagReleaseBridge.toast('Account protected')}
    catch(e){SnagReleaseBridge.toast(e.message)}
  };
  $('#releaseSignIn').onclick=async()=>{try{await AppsAccount.signIn($('#releaseEmail').value,$('#releasePassword').value);location.reload()}catch{SnagReleaseBridge.toast('Could not sign in')}};
  $('#releaseReset').onclick=async()=>{try{await AppsAccount.resetPassword($('#releaseEmail').value);SnagReleaseBridge.toast('Password reset email sent')}catch(e){SnagReleaseBridge.toast(e.message)}};
  $('#releaseVerify').onclick=async()=>{try{await AppsAccount.sendVerification();SnagReleaseBridge.toast('Verification email sent')}catch(e){SnagReleaseBridge.toast(e.message)}};
  $('#releaseChangeEmail').onclick=async()=>{
    try{
      const result=await AppsAccount.updateEmailAddress($('#releaseCurrentPassword').value,$('#releaseNewEmail').value);
      $('#releaseCurrentPassword').value='';$('#releaseNewEmail').value='';
      SnagReleaseBridge.toast(result?.verificationSent?'Check the new email address to confirm the change':'Email changed');
    }catch(e){SnagReleaseBridge.toast(e.message)}
  };
  $('#releaseChangePassword').onclick=async()=>{
    try{
      await AppsAccount.updatePassword($('#releaseCurrentPassword').value,$('#releaseNewPassword').value);
      $('#releaseCurrentPassword').value='';$('#releaseNewPassword').value='';
      SnagReleaseBridge.toast('Password changed');
    }catch(e){SnagReleaseBridge.toast(e.message)}
  };
  $('#releaseSignOut').onclick=async()=>{await AppsAccount.signOut();location.reload()};
  $('#releaseBuyHome').onclick=()=>checkout('home_project');
  $('#releaseBuyPro').onclick=()=>checkout('pro');
  $('#releaseExport').onclick=()=>{
    const c=SnagReleaseBridge.context();
    download('snag-'+(c.project?.name||'project').replace(/[^a-z0-9_-]+/gi,'-')+'.json',SnagReleaseBridge.exportCurrentProject());
  };
  $('#releaseDeleteProject').onclick=async()=>{
    const c=SnagReleaseBridge.context(),answer=prompt('Type the project name to permanently delete it:\n\n'+(c.project?.name||''));
    if(answer!==c.project?.name)return;
    try{await SnagReleaseBridge.deleteCurrentProject();SnagCommercial.state.loadedAt=0;SnagReleaseBridge.toast('Project deleted')}
    catch(e){SnagReleaseBridge.toast(e.message)}
  };
  $('#releaseDeleteAccount').onclick=async()=>{
    const u=AppsAccount.snapshot().user;
    if(!confirm('Permanently delete this Snag account and accessible project data?'))return;
    const password=u&&!u.isAnonymous?prompt('Enter your current password:'):'';
    try{await SnagReleaseBridge.deleteAccount(password||'')}catch(e){SnagReleaseBridge.toast(e.message)}
  };

  AppsAccount.onChange(refresh);AppsPrivacy.onChange(refresh);
  const q=new URLSearchParams(location.search);
  if(q.get('checkout')==='success'&&q.get('session_id')){
    try{
      const c=SnagReleaseBridge.context();await AppsBilling.verify(c.projectId,q.get('session_id'));await SnagCommercial.load(true);
      SnagReleaseBridge.toast('Payment confirmed · project unlocked');history.replaceState({},'',location.pathname+'?app=1');
    }catch(e){SnagReleaseBridge.toast(e.message)}
  }
  if(q.get('plan')){modal().classList.remove('hidden');refresh()}
  refresh();
}
wait();
})();