import {_electron} from 'playwright';import {createRequire} from 'node:module';import {mkdtemp,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const temp=await realpath(await mkdtemp(path.join(tmpdir(),'envoi-model-menu-')));let app;
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.resolve('.'),'--user-data-dir='+path.join(temp,'profile')],env:{...process.env,ENVOI_DATA_DIR:path.join(temp,'data')}});
 await app.evaluate(({ipcMain,dialog})=>{
 dialog.showMessageBox=async()=>({response:0});globalThis.catalogFixture={calls:0,models:[],fail:false,checkedAt:Date.now()};
 const settings={provider:'opencode-go',model:null,context:'current',tools:'read'};
 ipcMain.removeHandler('envoi:agent-status');ipcMain.handle('envoi:agent-status',()=>({available:true,runtime:true,providers:[{id:'opencode-go',name:'OpenCode Go',oauth:false,auth:{configured:true},catalog:{state:globalThis.catalogFixture.fail?'failed':'cache',source:'fixture',checkedAt:globalThis.catalogFixture.checkedAt}}],models:globalThis.catalogFixture.models,settings,storage:{}}));
 ipcMain.removeHandler('envoi:agent-request');ipcMain.handle('envoi:agent-request',async(_event,route)=>{
 if(route==='sessions')return {sessions:[],settings};
 if(route==='models/refresh'){globalThis.catalogFixture.calls++;await new Promise(resolve=>setTimeout(resolve,600));if(globalThis.catalogFixture.fail)return {ok:false,error:'Fixture directory unavailable'};globalThis.catalogFixture.checkedAt=Date.now();globalThis.catalogFixture.models=[{id:'fixture-model',provider:'opencode-go',name:'Fixture discovered model',available:true,thinkingLevels:[]}];return {ok:true};}
 throw Error('Unexpected fixture route '+route);
 });});
 const page=await app.firstWindow();await page.getByTestId('welcome-page').waitFor();await page.getByRole('button',{name:/打开示例项目/}).click();await page.getByRole('button',{name:'main.tex',exact:true}).waitFor();
 const menu=page.getByRole('button',{name:'选择模型',exact:true});await menu.click();await page.getByText('正在获取模型列表…',{exact:true}).waitFor();await page.getByRole('button',{name:'Fixture discovered model',exact:true}).waitFor();assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),1);
 await page.keyboard.press('Escape');await menu.click();await page.waitForTimeout(800);assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),1,'populated catalog is not refetched');
 await page.keyboard.press('Escape');await app.evaluate(()=>{globalThis.catalogFixture.checkedAt=Date.now();globalThis.catalogFixture.models=[];globalThis.catalogFixture.fail=true;});await page.evaluate(()=>window.dispatchEvent(new Event('envoi:ai-configured')));await page.waitForTimeout(300);await menu.click();await page.getByText('Fixture directory unavailable',{exact:true}).waitFor();await page.waitForTimeout(800);assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),2,'failed discovery does not loop');
 await page.keyboard.press('Escape');await app.evaluate(()=>{globalThis.catalogFixture.fail=false;});await menu.click();await page.getByRole('button',{name:'Fixture discovered model',exact:true}).waitFor();assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),3,'reopening retries an empty catalog');
 await page.getByRole('button',{name:'刷新模型目录',exact:true}).click();await page.waitForTimeout(900);assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),4);assert.equal(await page.getByText(/尚无模型发现适配/).count(),0);
 await page.keyboard.press('Escape');await app.evaluate(()=>{globalThis.catalogFixture.checkedAt=Date.now()-300001;});await page.evaluate(()=>window.dispatchEvent(new Event('envoi:ai-configured')));await page.waitForTimeout(300);await menu.click();await page.waitForTimeout(1000);assert.equal(await app.evaluate(()=>globalThis.catalogFixture.calls),5,'stale populated catalog refreshes automatically');
 console.log('PASS model menu: automatic discovery, loading, cached options, failure and retry without request loop');
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(temp,{recursive:true,force:true,maxRetries:3});}
