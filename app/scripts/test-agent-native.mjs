// Isolated protocol fixtures only: no user auth, user projects, or external inference.
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,cp,rm,symlink,readdir,stat} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import http from 'node:http';import {randomBytes} from 'node:crypto';
const fixture=await realpath(await mkdtemp(path.join(os.tmpdir(),'envoi-native-test-')));
process.env.ENVOI_DATA_DIR=path.join(fixture,'data');
const local=await import('../server/local-data.mjs');
const agent=await import('../server/agent.mjs');
const servers=[];
async function serve(handler){const server=http.createServer(handler);servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:`http://127.0.0.1:${server.address().port}`};}
let transportRequests=[];
const held=[];
const transport=await serve(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);transportRequests.push(body);if(JSON.stringify(body.messages).includes('MODEL_REJECT_REQUEST')){res.statusCode=401;res.end(JSON.stringify({error:{message:'Model hy3-preview-free is not supported'}}));return;}res.setHeader('Content-Type','text/event-stream');res.flushHeaders();if(JSON.stringify(body.messages).includes('HOLD_REQUEST')){held.push(res);return;}if(JSON.stringify(body.messages).includes('FAIL_REQUEST')){res.end('data: {"error":{"message":"fixture failure"}}\n\n');return;}const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'gpt-4o',choices:[{index:0,delta,finish_reason}]})+'\n\n');chunk({role:'assistant',content:'Protocol verified'});chunk({},'stop');res.end('data: [DONE]\n\n');});
let middleware=[];
const app=await serve((req,res)=>{let index=0;const next=()=>{const fn=middleware[index++];if(fn)void fn(req,res,next);else {res.statusCode=404;res.end();}};next();});
for(const plugin of [local.localDataPlugin(),agent.agentPlugin()])plugin.configureServer({httpServer:app.server,middlewares:{use(fn){middleware.push(fn);}}});
async function get(api){const response=await fetch(app.url+'/api/envoi/'+api,{headers:{Origin:app.url}});assert.equal(response.status,200);return response.json();}
const ai=await get('agent'),data=await get('data');const {getProviders}=await import('@mariozechner/pi-ai');assert(getProviders().every(id=>ai.providers.some(provider=>provider.id===id)));assert.equal(new Set(ai.providers.map(provider=>provider.id)).size,ai.providers.length);
async function post(api,body,token=api.startsWith('data')?data.token:ai.token){const response=await fetch(app.url+'/api/envoi/'+api,{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json','X-Envoi-Token':token},body:JSON.stringify(body)});return {response,body:response.headers.get('content-type')?.includes('ndjson')?await response.text():await response.json()};}
async function bind(root,copy=false){await mkdir(path.join(root,'.envoi'),{recursive:true});const proof=randomBytes(32).toString('hex'),file=path.join(root,'.envoi','agent-proof-'+proof);await writeFile(file,proof);try{return await post('agent/bind',{directory:root,proof,proofKind:'agent',copy});}finally{await rm(file,{force:true});}}
try{
 assert.equal(agent.normalizeAi({}).tools,'read');
 assert.equal((await post('agent/sessions',{projectId:'global'})).response.status,400);
 const {registerOAuthProvider}=await import('@mariozechner/pi-ai/oauth');registerOAuthProvider({id:'auth-protocol-fixture',name:'Protocol login fixture',async login(callbacks){callbacks.onAuth({url:transport.url+'/authorize'});const answer=await callbacks.onPrompt({message:'Fixture code'});if(answer!=='fixture-code')throw Error('fixture denied');return {access:'fixture-access',refresh:'fixture-refresh',expires:Date.now()+3600000};},async refreshToken(credentials){return credentials;},getApiKey(credentials){return credentials.access;}});
 const oauth=(await post('agent/oauth/start',{provider:'auth-protocol-fixture'})).body;let oauthState=(await post('agent/oauth/status',{id:oauth.id})).body;assert.equal(oauthState.state,'input');assert.equal(oauthState.url,transport.url+'/authorize');await post('agent/oauth/answer',{id:oauth.id,answer:'fixture-code'});oauthState=(await post('agent/oauth/status',{id:oauth.id})).body;assert.equal(oauthState.state,'done');assert(!JSON.stringify(oauthState).includes('fixture-access'));const cancelled=(await post('agent/oauth/start',{provider:'auth-protocol-fixture'})).body;await post('agent/oauth/cancel',{id:cancelled.id});assert.equal((await post('agent/oauth/status',{id:cancelled.id})).body.state,'cancelled');const denied=(await post('agent/oauth/start',{provider:'auth-protocol-fixture'})).body;await post('agent/oauth/answer',{id:denied.id,answer:'wrong'});assert.equal((await post('agent/oauth/status',{id:denied.id})).body.state,'failed');
 const first=path.join(fixture,'paper');await mkdir(first);await writeFile(path.join(first,'main.tex'),'source one');
 const bindings=await Promise.all(Array.from({length:8},()=>bind(first)));assert(bindings.every(result=>result.response.ok));const id=bindings[0].body.project.id;assert(bindings.every(result=>result.body.project.id===id));
 const copy=path.join(fixture,'copy');await cp(first,copy,{recursive:true});assert.match((await bind(copy)).body.error,/身份冲突/);const copyId=(await bind(copy,true)).body.project.id;assert.notEqual(copyId,id);
 const moved=path.join(fixture,'moved');await rename(first,moved);assert.equal((await bind(moved)).body.project.id,id);assert.equal(await local.projectRoot(id),moved);
 const read=agent.projectTools(moved,'read',false);assert.deepEqual(read.map(tool=>tool.name),['project_list','project_read']);assert.equal((await read[1].execute('r',{path:'main.tex'})).content[0].text,'source one');
 assert((await read[0].execute('l',{path:'.'})).content[0].text.includes('main.tex'));
 await writeFile(path.join(moved,'.envoi','secret'),'hidden');await symlink(path.join(moved,'.envoi'),path.join(moved,'alias'),process.platform==='win32'?'junction':'dir');await symlink(fixture,path.join(moved,'external'),process.platform==='win32'?'junction':'dir');
 for(const selected of ['../outside','.envoi/secret','alias','external/data'])await assert.rejects(()=>agent.safeToolPath(moved,selected));
 const write=agent.projectTools(moved,'write',false).find(tool=>tool.name==='project_write');await write.execute('w',{path:'created.tex',content:'written'});assert.equal(await readFile(path.join(moved,'created.tex'),'utf8'),'written');assert(!agent.projectTools(moved,'write',true).some(tool=>tool.name==='project_write'));
 const s=await post('data/store',{store:'preferences',action:'put',value:{font:'a'},expectedRevision:0});assert.equal(s.body.revision,1);
 const race=await Promise.all(['b','c'].map(font=>post('data/store',{store:'preferences',action:'put',value:{font},expectedRevision:1})));assert.deepEqual(race.map(result=>result.response.status).sort(),[200,409]);
 const migration=await post('data/store',{store:'preferences',action:'put',value:{legacy:'preserved'},migrate:true});assert.equal(migration.body.revision,2);await post('data/store',{store:'preferences',action:'put',value:{legacy:'preserved'},migrate:true});assert.equal((await readdir(path.join(local.dataDir,'migration'))).length,1);
 assert.equal((await post('data/store',{store:'preferences',key:'../escape',action:'get'})).response.status,400);assert.equal((await post('data/store',{store:'preferences',action:'get'},'invalid')).response.status,403);
 // Only this temporary app instance gets a loopback protocol fixture model and credential.
 assert((await post('agent/custom-provider',{provider:'protocol-fixture',baseUrl:transport.url+'/v1',api:'openai-completions',model:'gpt-4o'})).response.ok);
 assert.equal((await post('agent/credential',{provider:'protocol-fixture',key:'  !echo forbidden'})).response.status,400);assert((await post('agent/credential',{provider:'protocol-fixture',key:'fixture-only-not-a-real-key'})).response.ok);
 const status=await get('agent');assert(!JSON.stringify(status).includes('fixture-only-not-a-real-key'));if(process.platform!=='win32')assert.equal((await stat(path.join(local.dataDir,'pi/auth.json'))).mode&0o777,0o600);
 assert((await post('agent/settings',{settings:{model:'protocol-fixture/gpt-4o',tools:'read'}})).response.ok);
 const authPath=path.join(local.dataDir,'pi/auth.json'),privateAuth=JSON.parse(await readFile(authPath,'utf8'));await writeFile(authPath,JSON.stringify({...privateAuth,deepseek:{type:'api_key',key:'fixture-only-no-inference'}}));
 const fallbackStatus=await get('agent');assert.equal(fallbackStatus.providers.find(p=>p.id==='deepseek')?.catalog.state,'builtin');assert(fallbackStatus.models.some(m=>m.provider==='deepseek'&&m.available),'configured SDK providers must not disappear without a discovery adapter');
 const chat=await post('agent/chat',{projectId:id,message:'Verify local protocol',dirty:false});assert.equal(chat.response.status,200,JSON.stringify(chat.body));assert(chat.body.includes('Protocol verified'),chat.body);
 assert.deepEqual(transportRequests.at(-1).tools.map(tool=>tool.function.name),['project_list','project_read']);
 const list=(await post('agent/sessions',{projectId:id})).body;assert.equal(list.sessions.length,1);const sessionId=list.activeId;assert(sessionId);const record=(await post('agent/session',{projectId:id,sessionId})).body;assert.equal(record.status,'complete');assert.equal(record.messages[1].text,'Protocol verified');assert(record.piFile);
 assert.equal((await post('agent/session',{projectId:copyId,sessionId})).response.status,400);
 await post('agent/chat',{projectId:id,sessionId,message:'Second turn',dirty:false});assert(transportRequests.at(-1).messages.some(message=>JSON.stringify(message).includes('Verify local protocol')));
 const freshConversation=(await post('agent/new',{projectId:id})).body;assert.equal(freshConversation.messages.length,0);assert.notEqual(freshConversation.id,sessionId);assert.equal((await post('agent/sessions',{projectId:id})).body.activeId,freshConversation.id);const searched=(await post('agent/sessions',{projectId:id,query:'Second turn'})).body;assert.deepEqual(searched.sessions.map(row=>row.id),[sessionId]);assert.equal((await post('agent/session',{projectId:id,sessionId})).body.messages.length,4);assert.equal((await post('agent/sessions',{projectId:id})).body.activeId,sessionId);

 // Paper conversations use project-local storage and never share a transcript with another paper.
 const {libraryRequest}=await import('../server/research-library.mjs');
 await libraryRequest(moved,{action:'import',papers:[{title:'Paper A',notes:'A'},{title:'Paper B',notes:'B'}]});
 const [paperA,paperB]=(await libraryRequest(moved,{action:'list'})).papers;
 const paperChat=await post('agent/chat',{projectId:id,paperId:paperA.id,message:'Discuss Paper A',context:'Paper A source',dirty:false});assert(paperChat.body.includes('Protocol verified'));
 assert.deepEqual(transportRequests.at(-1).tools.map(tool=>tool.function.name),['research_note']);
 const paperRecord=(await libraryRequest(moved,{action:'get',paperId:paperA.id})).state.chat;
 assert.equal(paperRecord.messages[0].text,'Discuss Paper A');assert(paperRecord.piFile);
 assert.equal((await libraryRequest(moved,{action:'get',paperId:paperB.id})).state.chat,undefined);
 await post('agent/chat',{projectId:id,paperId:paperB.id,message:'Discuss Paper B',dirty:false});assert(!JSON.stringify(transportRequests.at(-1).messages).includes('Discuss Paper A'));
 await post('agent/chat',{projectId:id,paperId:paperA.id,sessionId:paperRecord.id,message:'Continue Paper A',dirty:false});assert(JSON.stringify(transportRequests.at(-1).messages).includes('Discuss Paper A'));
 assert.equal((await post('agent/sessions',{projectId:id})).body.sessions.length,2);
 console.log('PASS paper AI: real SDK streaming, dedicated note tool, project-local transcript and per-paper continuation');
 const rejected=await post('agent/chat',{projectId:copyId,message:'MODEL_REJECT_REQUEST',dirty:false});assert.match(rejected.body,/Model hy3-preview-free is not supported/);await post('agent/new',{projectId:copyId});
 const failed=await post('agent/chat',{projectId:copyId,message:'FAIL_REQUEST',dirty:false});assert(failed.body.includes('error'));const failedList=(await post('agent/sessions',{projectId:copyId})).body;assert.equal(failedList.sessions[0].status,'failed');await post('agent/new',{projectId:copyId});
 const controller=new AbortController();const waiting=fetch(app.url+'/api/envoi/agent/chat',{method:'POST',signal:controller.signal,headers:{Origin:app.url,'Content-Type':'application/json','X-Envoi-Token':ai.token},body:JSON.stringify({projectId:id,sessionId,message:'HOLD_REQUEST',dirty:false})});const stream=await waiting;
 assert.equal((await post('agent/new',{projectId:id})).response.status,400);assert.equal((await post('agent/session',{projectId:id,sessionId:freshConversation.id})).response.status,400);
 const concurrent=await post('agent/chat',{projectId:id,message:'cannot overlap',dirty:false});assert.match(concurrent.body.error,/已有任务/);
 const other=await post('agent/chat',{projectId:copyId,message:'Independent project',dirty:false});assert(other.body.includes('Protocol verified'));
 await post('agent/abort',{projectId:id,sessionId});await stream.text();const stopped=(await post('agent/session',{projectId:id,sessionId})).body;assert.equal(stopped.status,'cancelled');
 assert((await post('agent/history/delete',{projectId:id,sessionId,confirm:true})).response.ok);assert.equal((await post('agent/sessions',{projectId:id})).body.activeId,freshConversation.id);assert.equal(await readFile(path.join(moved,'main.tex'),'utf8'),'source one');
 // Pre-rename projects keep their identity through the legacy management directory.
 const legacyConfig=await readFile(path.join(moved,'.envoi/project.json'),'utf8');await rename(path.join(moved,'.envoi'),path.join(moved,'.paperdesk'));
 assert.equal(await local.projectRoot(id),await realpath(moved));
 await rename(path.join(moved,'.paperdesk'),path.join(moved,'.envoi'));assert.equal(await readFile(path.join(moved,'.envoi/project.json'),'utf8'),legacyConfig);
 const replacement=path.join(fixture,'replacement');await rename(moved,replacement);await mkdir(moved);await mkdir(path.join(moved,'.envoi'));await writeFile(path.join(moved,'.envoi/project.json'),JSON.stringify({projectId:id}));await assert.rejects(()=>local.projectRoot(id),/替换/);
 console.log('PASS native AI: identity/move/copy/concurrent proof, actual SDK read/write/path guard, CAS/migration, private credentials, real SDK loopback streaming/history/tools, project isolation and cancellation');
}finally{for(const response of held)response.end();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(fixture,{recursive:true,force:true});}
