// Pure, testable snag bulk-change rules. Firestore permissions are additionally enforced server-side.
export const BULK_ACTIONS=Object.freeze({
  assign:'Assign contractor',
  grant:'Add contractor access',
  revoke:'Remove contractor access',
  unassign:'Clear assignment',
  status:'Set status',
  priority:'Set priority',
  category:'Set category',
  location:'Move to room / area',
  archive:'Archive',
  restore:'Unarchive'
});
const STATUSES=new Set(['open','in-progress','review','resolved']);
const PRIORITIES=new Set(['Urgent','High','Normal','Low']);
const CATEGORIES=new Set(['Home snag','App / software','Business process','Other']);
const text=value=>String(value||'').trim();
const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const removeEmpty=values=>[...new Set((values||[]).filter(x=>typeof x==='string'&&x))];
/**
 * Build only the fields to change, retaining unrelated participants and explicit grants.
 * recipient is an active joined contractor already checked by the caller against Firestore.
 */
export function bulkSnagChange(snag,action,{recipient=null,value='',timestamp=new Date().toISOString()}={}){
  if(!snag?.id)throw new Error('Missing snag');
  if(!hasOwn(BULK_ACTIONS,action))throw new Error('Unknown bulk action');
  const existing=removeEmpty(snag.participantUids);
  const explicitlyShared=removeEmpty(snag.sharedWithUids);
  const participants=new Set(existing),shared=new Set(explicitlyShared);
  const patch={updatedAt:timestamp};
  let description='';
  const recipientUid=text(recipient?.uid),recipientName=text(recipient?.label||recipient?.name);
  if(['assign','grant','revoke'].includes(action)&&(!recipientUid||!recipientName||recipient?.role!=='contractor'||recipient?.active!==true)){
    throw new Error('Choose a currently authorised, joined contractor');
  }
  if(action==='assign'){
    const old=text(snag.assigneeId);
    if(old&&old!==recipientUid&&old!==snag.createdByUid&&!shared.has(old))participants.delete(old);
    participants.add(recipientUid);
    patch.assigneeId=recipientUid;
    patch.assignee=recipientName;
    patch.participantUids=[...participants];
    description='Assigned to '+recipientName;
  }else if(action==='grant'){
    participants.add(recipientUid);
    shared.add(recipientUid);
    patch.participantUids=[...participants];
    patch.sharedWithUids=[...shared];
    description='Added '+recipientName+' as a participant';
  }else if(action==='revoke'){
    if(recipientUid===snag.createdByUid)throw new Error('Cannot remove the snag creator');
    participants.delete(recipientUid);shared.delete(recipientUid);
    patch.participantUids=[...participants];
    patch.sharedWithUids=[...shared];
    if(snag.assigneeId===recipientUid){patch.assigneeId=null;patch.assignee=''}
    description='Removed '+recipientName+' from snag access';
  }else if(action==='unassign'){
    const old=text(snag.assigneeId);
    if(old&&old!==snag.createdByUid&&!shared.has(old))participants.delete(old);
    patch.assignee='';
    patch.assigneeId=null;
    patch.participantUids=[...participants];
    description='Cleared contractor assignment';
  }else if(action==='status'){
    if(!STATUSES.has(value))throw new Error('Invalid status');
    patch.status=value;
    patch.resolvedAt=value==='resolved'?timestamp:null;
    description='Changed status to '+({'open':'Open','in-progress':'In progress','review':'Needs review','resolved':'Resolved'})[value];
  }else if(action==='priority'){
    if(!PRIORITIES.has(value))throw new Error('Invalid priority');
    patch.priority=value;
    description='Changed priority to '+value;
  }else if(action==='category'){
    if(!CATEGORIES.has(value))throw new Error('Invalid category');
    patch.category=value;
    description='Changed category to '+value;
  }else if(action==='location'){
    value=text(value);
    if(!value||value.length>120)throw new Error('Enter a room / area (up to 120 characters)');
    patch.location=value;
    description='Moved to '+value;
  }else if(action==='archive'||action==='restore'){
    patch.archived=action==='archive';
    description=action==='archive'?'Archived snag':'Restored snag from archive';
  }
  // Avoid noisy no-op updates/audit entries.
  const changed=Object.entries(patch).some(([key,val])=>
    key!=='updatedAt'&&(
      Array.isArray(val)?JSON.stringify([...val].sort())!==JSON.stringify([...(snag[key]||[])].sort()):
      val!==snag[key]
    )
  );
  return {patch:changed?patch:null,description};
}
