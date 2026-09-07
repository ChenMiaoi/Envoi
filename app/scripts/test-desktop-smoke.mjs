import {createRequire} from 'node:module';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {_electron}=require(process.env.ENVOI_PLAYWRIGHT ?? 'playwright');
const temp=await mkdtemp(path.join(tmpdir(),'envoi-desktop-smoke-'));
const root=path.join(temp,'paper');await mkdir(root);
await writeFile(path.join(root,'trusted-extra.tex'),'Local project input');
await writeFile(path.join(root,'main.tex'),'\\documentclass{article}\n\\begin{document}Desktop test\\end{document}');
let instance;
try {
 instance=await _electron.launch({executablePath:process.env.ENVOI_DESKTOP_EXECUTABLE ?? require('electron'),args:[path.resolve('.'), '--user-data-dir='+path.join(temp,'profile')],env:{...process.env,ENVOI_DATA_DIR:path.join(temp,'data')}});
 
 let prompts=0;
 await instance.evaluate(({dialog})=>{globalThis.trustPrompts=0;dialog.showMessageBox=async()=>{globalThis.trustPrompts++;return {response:0,checkboxChecked:false}}});
 const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>!!window.envoi);
 await page.locator('button').first().waitFor(); 
 console.log('loaded',await page.title(), await page.locator('body').innerText().then(t=>t.slice(0,120)));
 await instance.evaluate(({dialog}, root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]})},root);
 await page.evaluate(()=>window.dispatchEvent(new Event('envoi:open-project')));
 await page.getByRole('button',{name:'选择文件夹…',exact:true}).click();
 await page.getByRole('button',{name:'打开当前目录',exact:true}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('main.tex'));
 const result=await page.evaluate(async root=>{
  const bridge=window.envoi;
  const binding=await bridge.bindProject(root);
  await bridge.bindProject(root);
  await bridge.fsWrite(root,'nested/deep/test.txt',{text:'hello'});
  const read=await bridge.fsRead(root,'nested/deep/test.txt');
  await bridge.gitInit(root);const git=await bridge.gitStatus(root);
  const sessions=await bridge.agentRequest('sessions',{projectId:binding.project.id});
  const runtime=await bridge.compilerRuntime();
  let compile;
  if(runtime.available)compile=await bridge.compile({rootPath:root,main:'main.tex',engine:'pdflatex',files:[{path:'main.tex',base64:btoa('\\documentclass{article}\\begin{document}Desktop test\\input{'+root+'/trusted-extra.tex}\\immediate\\write18{echo trusted > "'+root+'/trusted-tool.txt"}\\end{document}')}]});
  let asset;
  if(compile?.ok){await bridge.fsWrite(root,'build/main.pdf',{base64:compile.pdf});const response=await fetch(await bridge.assetUrl(root,'build/main.pdf'));asset={status:response.status,header:new TextDecoder().decode((await response.arrayBuffer()).slice(0,5))};}
  return {binding,read,git,sessions,runtime,compile,asset};
 },root);
 assert.equal(result.read.text,'hello');assert.equal(result.git.state,'ready');assert.equal(result.sessions.settings.tools,'write');
 if(result.runtime.available){assert.equal(result.compile.ok,true,result.compile.log);assert.deepEqual(result.asset,{status:200,header:'%PDF-'});assert.equal((await readFile(path.join(root,'trusted-tool.txt'),'utf8')).trim(),'trusted');}
 // Real external edits must reach the renderer without reopening the directory.
 await writeFile(path.join(root,'external-note.txt'),'external content');
 await page.waitForFunction(()=>document.body.innerText.includes('external-note.txt'));
 const conflict=await page.evaluate(root=>window.envoi.fsSave(root,[{path:'external-note.txt',text:'draft',expectedText:'stale'}]),root);
 assert.equal(conflict.saved.length,0);assert.match(conflict.error,/外部修改/);
 assert.equal(await readFile(path.join(root,'external-note.txt'),'utf8'),'external content');
 if(result.runtime.available){
  const native=await page.evaluate(root=>window.envoi.compile({rootPath:root,main:'main.tex',engine:'pdflatex',drafts:[{path:'main.tex',text:'\\documentclass{article}\\begin{document}Unsaved native draft\\end{document}'}]}),root);
  assert.equal(native.ok,true,native.log);
  assert.match(await readFile(path.join(root,'main.tex'),'utf8'),/Desktop test/);
 }
 if(result.runtime.available){
  await page.evaluate(root=>{
   window.cancelledCompile=window.envoi.compile({rootPath:root,main:'main.tex',engine:'pdflatex',drafts:[{path:'main.tex',text:'\\documentclass{article}\\begin{document}\\immediate\\write18{echo started > "'+root+'/cancel-started.txt"; sleep 30}Cancel test\\end{document}'}]});
  },root);
  await page.waitForFunction(async root=>{try{return (await window.envoi.fsRead(root,'cancel-started.txt')).text?.includes('started');}catch{return false;}},root);
  await page.evaluate(()=>window.envoi.cancelCompile());
  const cancelled=await page.evaluate(()=>window.cancelledCompile);
  assert.equal(cancelled.ok,false);assert.match(cancelled.error,/取消/);
  console.log('PASS: cancellation interrupts running local compiler commands');
 }
 const toolsPid=await instance.evaluate(({app})=>app.getAppMetrics().find(item=>item.name==='Envoi Tools'||item.serviceName==='Envoi Tools')?.pid);
 assert.ok(toolsPid,'Git runs in a dedicated utility process');
 await instance.evaluate((_electron,pid)=>process.kill(pid,'SIGKILL'),toolsPid);
 await page.waitForFunction(async()=>{try{return (await window.envoi.gitRuntime()).available;}catch{return false;}});
 console.log('PASS: backend process isolation and restart after forced exit');
 console.log('PASS: filesystem watch, backend save conflict, native draft compilation');
 prompts=await instance.evaluate(()=>globalThis.trustPrompts);assert.equal(prompts,1);
 await page.reload();await page.locator('button').first().waitFor();if(result.runtime.available)await page.locator('canvas').first().waitFor({timeout:20000});
 if(process.env.ENVOI_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.ENVOI_SMOKE_SCREENSHOT});
 assert.deepEqual(errors,[]);
 console.log('PASS: first trust, repeat binding, nested writes, Git, AI access, compiler', {prompts,compiled:result.compile?.ok});
 await instance.close();instance=null;
 instance=await _electron.launch({executablePath:process.env.ENVOI_DESKTOP_EXECUTABLE ?? require('electron'),args:[path.resolve('.'), '--user-data-dir='+path.join(temp,'profile')],env:{...process.env,ENVOI_DATA_DIR:path.join(temp,'data')}});
 await instance.evaluate(({dialog})=>{globalThis.trustPrompts=0;dialog.showMessageBox=async()=>{globalThis.trustPrompts++;return {response:1}}});
 const reopened=await instance.firstWindow();await reopened.waitForFunction(()=>!!window.envoi);await reopened.locator('button').first().waitFor();
 await reopened.evaluate(root=>window.envoi.bindProject(root),root);
 assert.equal(await instance.evaluate(()=>globalThis.trustPrompts),0);
 console.log('PASS: persisted trust across restart');
 await reopened.waitForFunction(()=>document.body.innerText.includes('main.tex'));
 const editor=reopened.locator('textarea').first();
 await editor.fill('Unsaved text to discard');
 await reopened.evaluate(()=>window.dispatchEvent(new Event('envoi:close-project')));
 assert.equal(await reopened.getByRole('button',{name:'关闭项目',exact:true}).isEnabled(),false);
 await reopened.getByLabel('放弃当前未保存修改').check();
 await reopened.getByRole('button',{name:'关闭项目',exact:true}).click();
 await reopened.waitForFunction(()=>document.body.innerText.includes('未打开项目')&&!document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'));
 await reopened.reload();
 await reopened.waitForFunction(()=>document.body.innerText.includes('未打开项目')&&!document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'));
 await instance.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await reopened.evaluate(()=>window.dispatchEvent(new Event('envoi:open-project')));
 await reopened.getByRole('button',{name:'选择文件夹…',exact:true}).click();
 await reopened.getByRole('button',{name:'打开当前目录',exact:true}).click();
 await reopened.waitForFunction(()=>document.body.innerText.includes('main.tex'));
 assert.equal(await reopened.locator('textarea').first().inputValue().then(text=>text.includes('Unsaved text to discard')),false);
 await reopened.evaluate(()=>window.dispatchEvent(new Event('envoi:manage-projects')));
 await reopened.getByRole('button',{name:'移除记录',exact:true}).click();
 await reopened.getByRole('button',{name:'移除记录',exact:true}).click();
 await reopened.waitForFunction(()=>document.body.innerText.includes('未打开项目')&&!document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'));
 await reopened.waitForFunction(async()=>{const recent=await window.envoi.dataGet('recent');return recent?.value?.length===0;});
 assert.match(await readFile(path.join(root,'main.tex'),'utf8'),/Desktop test/);
 await reopened.reload();
 await reopened.waitForFunction(()=>document.body.innerText.includes('未打开项目')&&!document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'));
 assert.equal((await reopened.evaluate(()=>window.envoi.dataGet('roots'))).value.length,0);
 console.log('PASS: discard-close, empty restart, clean reopen, remove-current without deleting disk files');
 const deleteRoot=path.join(temp,'delete-paper');
 await mkdir(path.join(deleteRoot,'chapters'),{recursive:true});await mkdir(path.join(deleteRoot,'.envoi'));
 await writeFile(path.join(deleteRoot,'chapters','paper.tex'),'Temporary paper');
 await writeFile(path.join(deleteRoot,'.envoi','project.json'),JSON.stringify({main:'chapters/paper.tex'}));
 await instance.evaluate(({dialog},root)=>{dialog.showMessageBox=async()=>({response:0});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},deleteRoot);
 await reopened.evaluate(()=>window.dispatchEvent(new Event('envoi:open-project')));
 await reopened.getByRole('button',{name:'选择文件夹…',exact:true}).click();
 await reopened.getByRole('button',{name:'打开当前目录',exact:true}).click();
 await reopened.getByRole('button',{name:'项目：delete-paper，打开项目管理',exact:true}).click();
 await reopened.getByRole('button',{name:'删除当前目录…',exact:true}).click();
 await reopened.getByRole('button',{name:'检查待删除目录',exact:true}).click();
 await reopened.getByRole('textbox',{name:'确认删除项目目录名',exact:true}).fill('delete-paper');
 await reopened.getByRole('button',{name:'确认永久删除目录',exact:true}).click();
 await reopened.waitForFunction(()=>document.body.innerText.includes('未打开项目'));
 await assert.rejects(readFile(path.join(deleteRoot,'chapters','paper.tex')),error=>error.code==='ENOENT');
 assert.match(await readFile(path.join(root,'main.tex'),'utf8'),/Desktop test/);
 console.log('PASS: verified permanent deletion of nested-entry fixture leaves other project untouched');


} finally {await instance?.close();await rm(temp,{recursive:true,force:true});}
