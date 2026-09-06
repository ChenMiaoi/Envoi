import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {AuthStorage,ModelRegistry} from '@mariozechner/pi-coding-agent';
import {getSupportedThinkingLevels} from '@mariozechner/pi-ai';
import {createModelDiscovery,parseDirectory,registerDiscoveredModels} from '../server/model-discovery.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'envoi-model-discovery-'));
try{
 let calls=0,fail=false,empty=false,ids=['actual-new-model'],clock=100;
 const metadata={opencode:{npm:'@ai-sdk/openai-compatible',models:{'actual-new-model':{name:'Actual new model',reasoning:true,reasoning_options:[{type:'effort',values:['low','high']}],modalities:{input:['text']},limit:{context:8000,output:1000},cost:{input:1,output:2}}}}};
 const fetcher=async(url,options)=>{calls++;assert.equal(options.method,undefined);assert(!options.headers.Authorization);if(fail)throw Error('network fixture');return new Response(JSON.stringify(url.includes('models.dev')?metadata:{data:(empty?[]:ids).map(id=>({id}))}));};
 const discovery=createModelDiscovery({directory,fetcher,now:()=>clock});
 const first=await discovery.discover('opencode','account-one');assert.equal(first.state,'live');assert.equal(calls,2);
 assert.deepEqual(first.ids,['actual-new-model']);assert.deepEqual(first.models.map(m=>m.id),first.ids);
 const auth=AuthStorage.inMemory({opencode:{type:'api_key',key:'account-one'}}),registry=ModelRegistry.inMemory(auth);
 registerDiscoveredModels(registry,'opencode',first);assert.deepEqual(registry.getAll().filter(m=>m.provider==='opencode').map(m=>m.id),first.ids);
 const runtime=registry.find('opencode','actual-new-model');assert.equal(runtime.api,'openai-completions');assert.equal(runtime.baseUrl,'https://opencode.ai/zen/v1');assert.deepEqual(getSupportedThinkingLevels(runtime),['low','high']);assert.equal((await registry.getApiKeyAndHeaders(runtime)).apiKey,'account-one');assert(!registry.find('opencode','hy3-preview-free'));
 clock+=999999999;assert.equal((await discovery.discover('opencode','account-one')).state,'cache');assert.equal(calls,2);
 const restart=createModelDiscovery({directory,fetcher,now:()=>clock});assert.equal((await restart.discover('opencode','account-one')).state,'cache');assert.equal(calls,2);
 fail=true;assert.equal((await restart.discover('opencode','account-one',{force:true})).state,'stale');assert.equal((await restart.discover('opencode','account-two')).state,'failed');
 fail=false;empty=true;const retained=await restart.discover('opencode','account-one',{force:true});assert.equal(retained.state,'stale');assert.deepEqual(retained.ids,first.ids);
 empty=false;ids=['actual-new-model','missing-capabilities'];const updated=await restart.discover('opencode','account-one',{force:true});assert.equal(updated.state,'live');assert.deepEqual(updated.unresolved,['missing-capabilities']);
 assert.equal((await restart.discover('not-adapted','account-one')).state,'unsupported');
 assert.throws(()=>parseDirectory('opencode',{data:[{}]}));assert.deepEqual(parseDirectory('google',{models:[{name:'models/good',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}),['good']);
 for(const file of await readdir(directory)){assert(!file.includes('account'));assert(!(await readFile(path.join(directory,file),'utf8')).includes('account-one'));}
 console.log('PASS model discovery: actual directory, runtime replacement/auth/protocol, truthful thinking, persistent account cache, manual refresh, failures/empty preservation, unsupported capabilities');
}finally{await rm(directory,{recursive:true,force:true});}
