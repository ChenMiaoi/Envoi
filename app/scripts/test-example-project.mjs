import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpath,mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createExampleProject} from '../electron/main/example-project.mjs';
import {detectTool} from '../server/tool-config.mjs';
import {gitLogAt,gitStatusAt} from '../server/git.mjs';
import {compileSnapshot,runtimeInfo} from '../server/compiler.mjs';

test('examples are independent real repositories, with complete history and clean working trees',async()=>{
 const temp=await realpath(await mkdtemp(path.join(tmpdir(),'envoi example test ')));
 const source=path.resolve('../examples/demo'),git=detectTool('git');
 const run=(cwd,...args)=>execFileSync(git,args,{cwd,encoding:'utf8',windowsHide:true});
 try{
  const before=await readFile(path.join(source,'main.tex'));
  const [first,second]=await Promise.all([createExampleProject({source,dataDirectory:temp}),createExampleProject({source,dataDirectory:temp})]);
  assert.notEqual(first,second);assert.equal(path.dirname(first),path.join(temp,'examples'));
  const configs=await Promise.all([first,second].map(async root=>JSON.parse(await readFile(path.join(root,'.envoi/project.json'),'utf8'))));
  assert.notEqual(configs[0].projectId,configs[1].projectId);assert.equal(configs[0].ai,undefined);
  for(const root of [first,second]){
   const log=await gitLogAt(root);assert.equal(log.state,'ready');assert.equal(log.commits.length,5);
   assert.equal((await gitStatusAt(root)).files.length,0);assert.equal(run(root,'remote').trim(),'');
   assert.equal(run(root,'log','--format=%ae').trim().split('\n').every(author=>author==='demo@envoi.invalid'),true);
   for(const commit of log.commits){
    assert.ok(run(root,'show','--format=','--stat',commit.hash).trim());
    const main=run(root,'show',commit.hash+':main.tex');
    for(const [,input] of main.matchAll(/\\input\{([^}]+)\}/g))assert.ok(run(root,'show',commit.hash+':'+input+'.tex'));
   }
   assert.equal((await readFile(path.join(root,'main.tex'))).toString(),before.toString());
  }
  await writeFile(path.join(first,'notes.md'),'Keep my edits');
  assert.equal((await gitStatusAt(first)).files.some(file=>file.path==='notes.md'),true);
  assert.deepEqual(await readFile(path.join(source,'main.tex')),before);
  await assert.rejects(createExampleProject({source:path.join(temp,'missing-template'),dataDirectory:temp}));
  await assert.rejects(createExampleProject({source,dataDirectory:temp,git:null}),/Git/);
  assert.equal((await readdir(path.join(temp,'examples'))).some(name=>name.startsWith('.creating-')),false);
  assert.equal(await readFile(path.join(first,'notes.md'),'utf8'),'Keep my edits');
  const runtime=runtimeInfo({trusted:true});
  if(runtime.available){const result=await compileSnapshot({engine:'pdflatex',main:'main.tex',drafts:[]},{trustedRoot:second,sourceRoot:second});assert.equal(result.ok,true,result.log);assert.ok(result.synctex);console.log('PASS complete generated demo compiles to PDF with SyncTeX');}
  else console.log('SKIP demo compilation:',runtime.error);
 }finally{await rm(temp,{recursive:true,force:true,maxRetries:3});}
});
