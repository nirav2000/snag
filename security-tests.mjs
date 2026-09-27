import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,collection,getDocs,query,where} from 'firebase/firestore';
import fs from 'node:fs';

const projectId='demo-snag-rules';
const env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8080}});
const db=u=>env.authenticatedContext(u).firestore();
const owner='owner-a',stranger='owner-b',contractor='trade-c';
const pid='project-1',invite='invite_1234567890123456789012345678901234567890';

try{
  await env.withSecurityRulesDisabled(async ctx=>{
    const x=ctx.firestore();
    await setDoc(doc(x,'snag_projects',pid),{ownerUid:owner,accessModelVersion:2,name:'House'});
    await setDoc(doc(x,'snag_projects',pid,'members',owner),{uid:owner,role:'owner',admin:true});
    await setDoc(doc(x,'snag_projects',pid,'invites',invite),{active:true,role:'contractor',admin:false});
    await setDoc(doc(x,'snag_projects',pid,'members',contractor),{uid:contractor,role:'contractor',admin:false,inviteId:invite});
    await setDoc(doc(x,'snag_projects',pid,'snags','assigned'),{title:'Assigned',createdByUid:owner,assigneeId:contractor,participantUids:[owner,contractor],updatedAt:new Date().toISOString()});
    await setDoc(doc(x,'snag_projects',pid,'snags','private'),{title:'Owner only',createdByUid:owner,assigneeId:null,participantUids:[owner],updatedAt:new Date().toISOString()});
  });

  await assertSucceeds(getDoc(doc(db(owner),'snag_projects',pid)));
  await assertFails(getDoc(doc(db(stranger),'snag_projects',pid)));
  await assertSucceeds(getDoc(doc(db(contractor),'snag_projects',pid,'snags','assigned')));
  await assertFails(getDoc(doc(db(contractor),'snag_projects',pid,'snags','private')));
  await assertSucceeds(getDocs(query(collection(db(contractor),'snag_projects',pid,'snags'),where('participantUids','array-contains',contractor))));
  await assertFails(getDocs(collection(db(contractor),'snag_projects',pid,'snags')));

  await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'snag_projects',pid,'invites',invite),{active:false},{merge:true}));
  await assertFails(getDoc(doc(db(contractor),'snag_projects',pid)));
  await assertFails(getDoc(doc(db(contractor),'snag_projects',pid,'snags','assigned')));

  console.log('Firestore tenant isolation tests passed');
} finally {
  await env.cleanup();
}
