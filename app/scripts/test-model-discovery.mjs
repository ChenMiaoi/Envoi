import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {ModelRegistry,ModelRuntime} from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore,getSupportedThinkingLevels} from '@earendil-works/pi-ai';
import {createModelDiscovery,parseDirectory,registerDiscoveredModels,runtimeModels} from '../server/model-discovery.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'envoi-model-discovery-'));
try{
 let calls=0,fail=false,empty=false,ids=['actual-new-model'],clock=100;
 const metadata={opencode:{npm:'@ai-sdk/openai-compatible',models:{'actual-new-model':{name:'Actual new model',reasoning:true,reasoning_options:[{type:'effort',values:['low','high']}],modalities:{input:['text']},limit:{context:8000,output:1000},cost:{input:1,output:2}}}}};
 const fetcher=async(url,options)=>{calls++;assert.equal(options.method,undefined);assert(!options.headers.Authorization);if(fail)throw Error('network fixture');return new Response(JSON.stringify(url.includes('models.dev')?metadata:{data:(empty?[]:ids).map(id=>({id}))}));};
 const discovery=createModelDiscovery({directory,fetcher,now:()=>clock});
 const first=await discovery.discover('opencode','account-one');assert.equal(first.state,'live');assert.equal(calls,2);
 assert.deepEqual(first.ids,['actual-new-model']);assert.deepEqual(first.models.map(m=>m.id),first.ids);
 const credentials=new InMemoryCredentialStore();await credentials.modify('opencode',async()=>({type:'api_key',key:'account-one'}));const modelRuntime=await ModelRuntime.create({credentials,refreshOnCreate:false});const registry=new ModelRegistry(modelRuntime);
 registerDiscoveredModels(registry,'opencode',first);assert.deepEqual(registry.getAll().filter(m=>m.provider==='opencode').map(m=>m.id),first.ids);
 const discoveredModel=registry.find('opencode','actual-new-model');assert.equal(discoveredModel.api,'openai-completions');assert.equal(discoveredModel.baseUrl,'https://opencode.ai/zen/v1');assert.deepEqual(getSupportedThinkingLevels(discoveredModel),['low','high']);assert.equal((await registry.getApiKeyAndHeaders(discoveredModel)).apiKey,'account-one');assert(!registry.find('opencode','hy3-preview-free'));
 clock+=100;assert.equal((await discovery.discover('opencode','account-one')).state,'cache');assert.equal(calls,2);
 clock+=300001;assert.equal((await discovery.discover('opencode','account-one')).state,'live');assert.equal(calls,3);
 const restart=createModelDiscovery({directory,fetcher,now:()=>clock});assert.equal((await restart.discover('opencode','account-one')).state,'cache');assert.equal(calls,3);
 fail=true;assert.equal((await restart.discover('opencode','account-one',{force:true})).state,'stale');assert.equal((await restart.discover('opencode','account-two')).state,'failed');
 fail=false;empty=true;const retained=await restart.discover('opencode','account-one',{force:true});assert.equal(retained.state,'stale');assert.deepEqual(retained.ids,first.ids);
 empty=false;ids=['actual-new-model','missing-capabilities'];const updated=await restart.discover('opencode','account-one',{force:true});assert.equal(updated.state,'live');assert.deepEqual(updated.unresolved,['missing-capabilities']);
 assert.equal((await restart.discover('not-adapted','account-one')).state,'unsupported');
 assert.throws(()=>parseDirectory('opencode',{data:[{}]}));assert.deepEqual(parseDirectory('google',{models:[{name:'models/good',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}),['good']);
 for(const file of await readdir(directory)){assert(!file.includes('account'));assert(!(await readFile(path.join(directory,file),'utf8')).includes('account-one'));}
 const goMetadata={'opencode-go':{npm:'@ai-sdk/openai-compatible',models:{chat:metadata.opencode.models['actual-new-model'],messages:{...metadata.opencode.models['actual-new-model'],provider:{npm:'@ai-sdk/anthropic'}}}}};
 const goRequests=[];const go=createModelDiscovery({directory:path.join(directory,'go'),fetcher:async(url,options)=>{goRequests.push(url);assert(!options.headers.Authorization);return new Response(JSON.stringify(url.includes('models.dev')?goMetadata:{data:[{id:'chat'},{id:'messages'}]}));}});
 const discovered=await go.discover('opencode-go','private-not-sent');assert.equal(discovered.state,'live');assert(goRequests.includes('https://opencode.ai/zen/go/v1/models'));assert.equal(discovered.models[0].baseUrl,'https://opencode.ai/zen/go/v1');assert.equal(discovered.models[1].baseUrl,'https://opencode.ai/zen/go');assert.equal(discovered.models[1].api,'anthropic-messages');assert.equal(runtimeModels('opencode-go',['unknown'],goMetadata).unresolved[0],'unknown');
 console.log('PASS model discovery: actual directory, runtime replacement/auth/protocol, truthful thinking, persistent account cache, manual refresh, failures/empty preservation, unsupported capabilities');
}finally{await rm(directory,{recursive:true,force:true});}
