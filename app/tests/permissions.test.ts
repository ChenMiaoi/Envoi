import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizedRoots, rememberRoot, recentProjects, rememberProject, ensurePermission } from '../src/lib/recentProjects';
test('granted root permission is reused without requesting again',async()=>{
 let requests=0;
 const handle={queryPermission:async()=> 'granted',requestPermission:async()=>{requests++;return 'granted';}} as unknown as FileSystemDirectoryHandle;
 assert(await ensurePermission(handle));assert.equal(requests,0);
});
test('expired permission requests renewal and denial is propagated',async()=>{
 let requests=0;
 const handle={queryPermission:async()=> 'prompt',requestPermission:async()=>{requests++;return 'denied';}} as unknown as FileSystemDirectoryHandle;
 assert.equal(await ensurePermission(handle),false);assert.equal(requests,1);
});
test('authorized-root storage is separate from recent child projects and deduplicates',async()=>{
 // Plain serializable stand-ins exercise storage logic; Chrome itself serializes real handles.
 const make=(name:string)=>{
  const object={name,kind:'directory'};
  Object.defineProperty(object,'isSameEntry',{enumerable:false,value:async(other:{name:string})=>other.name===name});
  return object as unknown as FileSystemDirectoryHandle;
 };
 const root=make('authorized-parent'), child=make('paper-child');
 await rememberRoot(root);await rememberProject(child);await rememberRoot(root);
 assert.deepEqual((await authorizedRoots()).map(x=>x.name),['authorized-parent']);
 assert.deepEqual((await recentProjects()).map(x=>x.name),['paper-child']);
});
