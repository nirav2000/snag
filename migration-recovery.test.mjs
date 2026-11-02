import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('app.js','utf8');
function extract(first,last){
  const i=source.indexOf(first),j=source.indexOf(last,i+first.length);
  assert.ok(i>=0&&j>i,'Expected production source markers: '+first);
  return source.slice(i,j);
}
const migrationSource=extract('async function migrateLegacyProjectIfNeeded(){','function dataUrlToFile(');
const mergeSource=extract('function mergeLegacyIntoLocal(data){','async function registerUserProject(');
const accessSource=extract('function isFirestoreAccessDenied(e){','function firebaseErrorMessage(');

function harness({record=null,readError=null,legacyError=null}={}){
  const calls=[],uid='guest-current',projectId='project-existing';
  const ctx={
    firebase:{auth:{currentUser:{uid,isAnonymous:true}},fsMod:{
      doc:(...a)=>a.join('/'),
      getDoc:async()=>{calls.push('remote-read');if(readError)throw readError;return{exists:()=>false}},
      setDoc:async()=>{calls.push('remote-write')}
    },db:'db'},
    selectedProjectId:projectId,
    window:{SNAG_CLOUD:{legacy:{projectId:'kk-syllabus'}},SNAG_FIREBASE_CONFIG:{projectId:'snag-509418'}},
    migrationFor:()=>record,
    launchInviteId:null,currentMember:null,savedAccess:null,
    diagStep:(...a)=>calls.push(['diag',...a]),
    exportLegacyProject:async()=>{
      calls.push('legacy-read');
      if(legacyError)throw legacyError;
      return{status:'ok',isOwner:true,legacyUid:'old-owner',project:{id:projectId,name:'Old home'},snags:[],invites:[],seen:[],privateNotes:[]};
    },
    mergeLegacyIntoLocal:()=>calls.push('local-merge'),
    snagUserId:()=> 'stable-id',
    adoptSnagUserId:()=>{},
    profile:{name:'Owner'},
    project:()=>({id:projectId,name:'My home'}),
    now:()=>new Date().toISOString(),
    saveMigration:()=>calls.push('migration-completed'),
    firebaseErrorMessage:e=>e?.code||e?.message||String(e),
    withTimeout:async promise=>promise,
    registerUserProject:async()=>calls.push('register-project'),
    joinInvitedProject:async()=>{},
    rememberSharedAccess:()=>{},
    saveState:()=>{},
    state:{projects:[{id:projectId,name:'My home'}],snags:[]}
  };
  vm.createContext(ctx);
  const migrate=vm.runInContext(accessSource+migrationSource+';migrateLegacyProjectIfNeeded',ctx);
  return{migrate,calls,ctx};
}

test('permission denial for an already-migrated project never becomes a cloud write',async()=>{
  const h=harness({readError:{code:'permission-denied',message:'Missing or insufficient permissions'}});
  const status=await h.migrate();
  assert.equal(status.status,'needs-sign-in');
  assert.ok(h.calls.includes('remote-read'));
  assert.ok(!h.calls.includes('remote-write'));
  assert.ok(!h.calls.includes('migration-completed'));
});

test('a different signed-in UID from previous migration requires owner recovery',async()=>{
  const h=harness({record:{status:'complete',role:'owner',primaryUid:'previous-uid'}});
  const status=await h.migrate();
  assert.equal(status.status,'needs-sign-in');
  assert.equal(status.reason,'previous-owner-identity');
  assert.ok(!h.calls.includes('remote-read'));
  assert.ok(!h.calls.includes('remote-write'));
});

test('legacy Firestore permission denial is treated as an access issue, not a fresh project',async()=>{
  const h=harness({legacyError:{code:'firestore/permission-denied'}});
  const status=await h.migrate();
  assert.equal(status.status,'needs-sign-in');
  assert.equal(status.reason,'legacy-permission-denied');
  assert.ok(!h.calls.includes('remote-read'));
  assert.ok(!h.calls.includes('remote-write'));
});

test('offline legacy backend stops migration without creating a substitute project',async()=>{
  const h=harness({legacyError:new Error('Legacy backend unavailable')});
  const status=await h.migrate();
  assert.equal(status.status,'unavailable');
  assert.ok(!h.calls.includes('remote-read'));
  assert.ok(!h.calls.includes('remote-write'));
});

test('previously completed migration with the same UID skips legacy reads',async()=>{
  const h=harness({record:{status:'complete',primaryUid:'guest-current',role:'owner'}});
  const status=await h.migrate();
  assert.equal(status.status,'complete');
  assert.equal(status.role,'owner');
  assert.ok(!h.calls.includes('legacy-read'));
});

test('older legacy snapshots do not overwrite newer local snags or dirty local changes',()=>{
  const local={id:'snag-a',projectId:'project-existing',title:'Most recent local edit',updatedAt:'2026-11-02T17:00:00Z'};
  let dirty={};
  const ctx={
    selectedProjectId:'project-existing',
    state:{projects:[{id:'project-existing',name:'My home'}],snags:[local]},
    dirtyMap:()=>dirty,saveState:()=>{}
  };
  vm.createContext(ctx);
  const merge=vm.runInContext(mergeSource+';mergeLegacyIntoLocal',ctx);
  merge({project:{id:'project-existing'},snags:[{id:'snag-a',title:'Stale remote',updatedAt:'2026-10-01T17:00:00Z'}]});
  assert.equal(ctx.state.snags[0].title,'Most recent local edit');
  dirty={'snag-a':{kind:'snag'}};
  merge({project:{id:'project-existing'},snags:[{id:'snag-a',title:'Even newer remote',updatedAt:'2026-11-05T17:00:00Z'}]});
  assert.equal(ctx.state.snags[0].title,'Most recent local edit');
  dirty={};
  merge({project:{id:'project-existing'},snags:[{id:'snag-a',title:'Newer remote',updatedAt:'2026-11-05T17:00:00Z'}]});
  assert.equal(ctx.state.snags[0].title,'Newer remote');
  assert.equal(ctx.state.snags.length,1);
});

test('permission classifier does not confuse timeouts with access denial',()=>{
  const ctx={};vm.createContext(ctx);
  const detect=vm.runInContext(accessSource+';isFirestoreAccessDenied',ctx);
  assert.equal(detect({code:'permission-denied'}),true);
  assert.equal(detect({code:'firestore/permission-denied'}),true);
  assert.equal(detect({code:'unavailable',message:'temporary offline'}),false);
});
