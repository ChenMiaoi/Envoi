import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,stat,symlink,readlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {atomicProjectWrite,saveProjectFiles} from '../electron/main/file-service.mjs';
import {TaskRegistry} from '../electron/main/task-registry.mjs';
import {watchProjectDirectory} from '../electron/main/project-watch.mjs';
const fixture=async fn=>{const root=await mkdtemp(path.join(tmpdir(),'envoi-files-test-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
test('save checks every baseline before changing files',()=>fixture(async root=>{
 await writeFile(path.join(root,'a.txt'),'old');await writeFile(path.join(root,'b.txt'),'external');
 const result=await saveProjectFiles(root,[{path:'a.txt',text:'new',expectedText:'old'},{path:'b.txt',text:'new',expectedText:'old'}]);
 assert.deepEqual(result.saved,[]);assert.match(result.error,/外部修改/);assert.equal(await readFile(path.join(root,'a.txt'),'utf8'),'old');
 assert.deepEqual((await readdir(root)).sort(),['a.txt','b.txt']);
}));
test('concurrent saves with one baseline cannot overwrite each other',()=>fixture(async root=>{
 await writeFile(path.join(root,'a.txt'),'old');
 const results=await Promise.all(['one','two'].map(text=>saveProjectFiles(root,[{path:'a.txt',text,expectedText:'old'}])));
 assert.equal(results.filter(result=>result.saved.length===1).length,1);assert.equal(results.filter(result=>result.error).length,1);
}));
test('atomic writes preserve executable mode and symlinks',()=>fixture(async root=>{
 await writeFile(path.join(root,'run.sh'),'old',{mode:0o755});await symlink('run.sh',path.join(root,'link.sh'));
 await atomicProjectWrite(root,'link.sh',{text:'new'});
 assert.equal(await readlink(path.join(root,'link.sh')),'run.sh');assert.equal(await readFile(path.join(root,'run.sh'),'utf8'),'new');assert.equal((await stat(path.join(root,'run.sh'))).mode&0o777,0o755);
 await assert.rejects(atomicProjectWrite(root,'../escape',{text:'bad'}));
}));
test('task reservations are immediate and cancellation is owner scoped',async()=>{
 const tasks=new TaskRegistry();let secondSignal;
 const wait=signal=>new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
 const first=tasks.run('first',1,'/a',wait),second=tasks.run('second',2,'/b',signal=>{secondSignal=signal;return wait(signal);});
 await assert.rejects(tasks.run('first',1,'/a',wait),/已有/);
 await tasks.cancel(1);await first;assert.equal(secondSignal.aborted,false);await tasks.cancel(2);await second;assert.equal(tasks.tasks.size,0);
});
test('filesystem watcher reports external edits and closes',()=>fixture(async root=>{
 let close;
 const change=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('watch timeout')),3000);close=watchProjectDirectory(root,event=>{clearTimeout(timer);resolve(event);},{delay:20,maxDelay:100});});
 try{await writeFile(path.join(root,'a.txt'),'external');const event=await change;assert.equal(event.root,root);assert.ok(event.paths.includes('a.txt')||event.paths.includes(''));}finally{close();}
}));
