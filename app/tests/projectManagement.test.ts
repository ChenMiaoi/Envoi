import 'fake-indexeddb/auto';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertCanClose,verifyDeletionTarget,deleteVerifiedProject} from '../src/lib/projectManagement';
import {emptyProject} from '../src/lib/initialProject';
import {installDesktopFixture} from './desktopFixture';
test('closing keeps unsaved-work and busy-operation guards',()=>{
 const dirty={...emptyProject(),id:'real',files:[{id:'a.tex',path:'a.tex',kind:'latex' as const,text:'draft',saved:'disk'}]};
 assert.throws(()=>assertCanClose(dirty,false,false,false),/未保存/);
 assert.throws(()=>assertCanClose(dirty,true,false,true),/等待/);
 assert.doesNotThrow(()=>assertCanClose(dirty,false,false,true));
});
test('native deletion checks the selected path and typed name without asking for a parent folder',async()=>{
 installDesktopFixture();let removed=false;
 window.envoi!.fsList=async()=>{if(removed)throw Error('Missing');return {files:[{path:'main.tex',kind:'latex'}],directories:[]};};
 window.envoi!.fsRemoveTree=async(root)=>{assert.equal(root,'/papers/paper');removed=true;};
 const plan=await verifyDeletionTarget('/papers/paper');
 await assert.rejects(deleteVerifiedProject(plan,'wrong'),/完整/);assert(!removed);
 await deleteVerifiedProject(plan,'paper');assert(removed);
});
test('native deletion rechecks contents and propagates disk failures',async()=>{
 installDesktopFixture();window.envoi!.fsList=async()=>({files:[{path:'main.tex',kind:'latex'}],directories:[]});
 const plan=await verifyDeletionTarget('/papers/paper');
 window.envoi!.fsList=async()=>({files:[],directories:[]});await assert.rejects(deleteVerifiedProject(plan,'paper'),/未找到可验证/);
 window.envoi!.fsList=async()=>({files:[{path:'main.tex',kind:'latex'}],directories:[]});
 window.envoi!.fsRemoveTree=async()=>{throw Error('Disk failure');};await assert.rejects(deleteVerifiedProject(plan,'paper'),/Disk failure/);
});
