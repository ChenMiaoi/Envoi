import 'fake-indexeddb/auto';import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertCanClose,verifyDeletionTarget,deleteVerifiedProject} from '../src/lib/projectManagement';import {emptyProject} from '../src/lib/initialProject';import {saveSession,restoreSession} from '../src/lib/projectSession';import {forgetRecentProject,recentProjects} from '../src/lib/recentProjects';
function fixture(){let exists=true,removed=0;const target={name:'paper',async *entries(){yield ['main.tex',{kind:'file'}];},queryPermission:async()=> 'granted',getFileHandle:async()=>{throw new DOMException('Missing','NotFoundError');},isSameEntry:async(other:unknown)=>other===target} as unknown as FileSystemDirectoryHandle;const parent={name:'papers',queryPermission:async()=> 'granted',isSameEntry:async()=>false,resolve:async()=>['paper'],getDirectoryHandle:async()=>{if(!exists)throw new DOMException('Missing','NotFoundError');return target;},removeEntry:async(name:string,options:{recursive:boolean})=>{assert.equal(name,'paper');assert(options.recursive);exists=false;removed++;}} as unknown as FileSystemDirectoryHandle;return {target,parent,count:()=>removed};}
test('closing guards dirty work and running actions, explicit empty session does not reopen recent project',async()=>{
 const dirty={...emptyProject(),id:'real',files:[{id:'a.tex',path:'a.tex',kind:'latex' as const,text:'draft',saved:'disk'}]};assert.throws(()=>assertCanClose(dirty,false,false,false),/未保存/);assert.throws(()=>assertCanClose(dirty,true,false,true),/等待/);assert.throws(()=>assertCanClose(dirty,false,true,true),/等待/);assert.doesNotThrow(()=>assertCanClose(dirty,false,false,true));
 await saveSession(emptyProject());assert.equal((await restoreSession()).project?.id,'empty');
});
test('directory deletion requires exact direct-child identity and typed confirmation',async()=>{
 const f=fixture(),plan=await verifyDeletionTarget(f.parent,f.target);assert.equal(plan.label,'papers / paper');assert.equal(f.count(),0);await assert.rejects(deleteVerifiedProject(plan,'wrong'),/完整/);assert.equal(f.count(),0);await deleteVerifiedProject(plan,'paper');assert.equal(f.count(),1);
});
test('deletion rejects parent/root, traversal, stale replacement, permissions and application repository',async()=>{
 const f=fixture();await assert.rejects(verifyDeletionTarget({...f.parent,isSameEntry:async()=>true} as unknown as FileSystemDirectoryHandle,f.target),/父目录本身/);
 await assert.rejects(verifyDeletionTarget({...f.parent,resolve:async()=>['other','paper']} as unknown as FileSystemDirectoryHandle,f.target),/直接父目录/);
 await assert.rejects(verifyDeletionTarget(f.parent,{...f.target,name:'../paper'} as FileSystemDirectoryHandle),/名称无效/);
 await assert.rejects(verifyDeletionTarget({...f.parent,getDirectoryHandle:async()=>({isSameEntry:async()=>false})} as unknown as FileSystemDirectoryHandle,f.target),/替换/);
 await assert.rejects(verifyDeletionTarget({...f.parent,queryPermission:async()=> 'denied'} as unknown as FileSystemDirectoryHandle,f.target),/权限/);
 const repository={...f.target,getFileHandle:async()=>({})} as FileSystemDirectoryHandle;await assert.rejects(verifyDeletionTarget({...f.parent,getDirectoryHandle:async()=>({...repository,isSameEntry:async()=>true})} as unknown as FileSystemDirectoryHandle,repository),/代码仓库/);assert.equal(f.count(),0);
});
test('partial/native deletion failure is not marked successful',async()=>{const f=fixture();const parent={...f.parent,removeEntry:async()=>{throw Error('Denied');}} as FileSystemDirectoryHandle;const plan=await verifyDeletionTarget(parent,f.target);await assert.rejects(deleteVerifiedProject(plan,'paper'),/可能已有部分文件/);assert.equal(f.count(),0);});
test('remove recent deletes one record only, without filesystem operations',async()=>{
 const request=indexedDB.open('paperdesk-projects',2);const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onupgradeneeded=()=>{for(const name of ['recent','roots'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const id='remove-test-'+crypto.randomUUID(),keep='keep-test-'+crypto.randomUUID();await new Promise<void>(resolve=>{const tx=db.transaction('recent','readwrite');tx.objectStore('recent').put({id,name:'remove',updated:1,directory:{name:'remove'}});tx.objectStore('recent').put({id:keep,name:'keep',updated:2,directory:{name:'keep'}});tx.oncomplete=()=>resolve();});db.close();await forgetRecentProject(id);const entries=await recentProjects();assert(!entries.some(entry=>entry.id===id));assert(entries.some(entry=>entry.id===keep));
});

test('a validated plan is rechecked before deletion; unrecognized folders are refused',async()=>{
 const f=fixture(),plan=await verifyDeletionTarget(f.parent,f.target);
 f.parent.getDirectoryHandle=async()=>({isSameEntry:async()=>false}) as unknown as FileSystemDirectoryHandle;
 await assert.rejects(deleteVerifiedProject(plan,'paper'),/替换/);assert.equal(f.count(),0);
 const other=fixture();other.target.entries=async function*(){};
 await assert.rejects(verifyDeletionTarget(other.parent,other.target),/未找到可验证/);assert.equal(other.count(),0);
});
