// Export UI and permission-aware report preparation for Snag.
import {createSnagWorkbook,listEvidence} from './snag-export.js';
const $=id=>document.getElementById(id);
const info=()=>window.SnagReleaseBridge;
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)}
async function jpegBytes(media){
  const bridge=info(),blob=await bridge.exportMedia(media),bitmap=await createImageBitmap(blob);
  try{
    const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    return new Uint8Array(await (await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Thumbnail conversion failed')),'image/jpeg',.76))).arrayBuffer());
  }finally{bitmap.close()}
}
function setup(){
  const button=document.createElement('button');button.id='snagExportButton';button.className='secondary-button';button.type='button';button.textContent='Export Excel report';
  const host=document.querySelector('#settingsExportHost');if(!host)return;
  const section=document.createElement('section');section.className='settings-card';section.innerHTML='<div class="section-kicker">PROJECT REPORT</div><h3>Export snag schedule</h3><p class="subtle">Create an Excel workbook with embedded photographs, snag details, evidence register and secure links back to Snag. Only the selected project is included.</p><label>Include snags<select id="snagExportScope"><option value="all">All accessible snags (including resolved)</option><option value="open">Unresolved snags</option><option value="filtered">Current snag list filters</option></select></label><label>Recipient<select id="snagExportRecipient"><option value="">Personal copy (all accessible snags)</option></select></label><p class="microcopy">For a contractor, select their joined account. The report will contain only snags they are assigned to. Do not forward a personal report to a contractor.</p><p id="snagExportStatus" class="microcopy" role="status"></p>';
  section.append(button);host.append(section);
  const recipient=$('snagExportRecipient');
  async function refresh(){
    const bridge=info();if(!bridge)return;
    const current=recipient.value;recipient.innerHTML='<option value="">Personal copy (all accessible snags)</option>';
    if(!bridge.context().isAdmin||!bridge.exportMembers)return;
    try{
      const members=await bridge.exportMembers();
      for(const m of members.filter(x=>x.role==='contractor'&&x.uid&&x.inviteId)){
        const o=document.createElement('option');o.value=m.uid;o.textContent=(m.label||m.name||m.uid)+' · Contractor';o.dataset.invite=m.inviteId;recipient.append(o);
      }
      recipient.value=[...recipient.options].some(o=>o.value===current)?current:'';
    }catch(e){$('snagExportStatus').textContent='Contractor list unavailable: '+e.message}
  }
  const settings=$('settingsButton');if(settings)settings.addEventListener('click',()=>refresh());
  button.onclick=async()=>{
    button.disabled=true;const status=$('snagExportStatus');status.textContent='Checking permissions and preparing workbook…';
    try{
      const bridge=info(),context=bridge.context(),scope=$('snagExportScope').value,recipientUid=recipient.value;
      if(!context.projectId)throw new Error('Choose a project first');
      const selection=await bridge.exportSelection({scope,recipientUid});
      if(!selection.snags.length)throw new Error('There are no snags in this report');
      const previews={};let complete=0,missing=0;
      for(const snag of selection.snags){
        const image=listEvidence(snag).map(x=>x.media).find(x=>x.type?.startsWith('image/'));
        if(image){
          try{previews[snag.id]=await jpegBytes(image)}
          catch(e){missing++;console.warn('Could not embed photo',snag.ref,e)}
        }
        complete++;status.textContent='Preparing report '+complete+'/'+selection.snags.length+' · '+missing+' unavailable photos';
      }
      const output=createSnagWorkbook({project:selection.project,snags:selection.snags,base:location.origin+location.pathname,inviteId:selection.inviteId||'',previews});
      download(output.blob,output.filename);
      status.textContent='Downloaded '+output.snagCount+' snags, '+output.photoCount+' photographs and '+output.evidenceCount+' evidence links'+(missing?' · '+missing+' photographs could not be embedded':'')+'.';
    }catch(e){console.error(e);status.textContent='Export failed: '+e.message}
    finally{button.disabled=false}
  };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
