import {translate} from '@/i18n/runtime';
import {envoi,ipcError} from '@/lib/desktop';
import {rememberGitPath} from './gitBinding';
export interface AiConfig {provider?:string|null;thinking?:string|null;model:string|null;context:'none'|'current';tools:'none'|'read'|'write'}
export interface ModelCatalog {state:string;source:string;visibility?:string;checkedAt?:number;error?:string;message?:string;unresolved?:number}
export interface AgentStatus {available:boolean;runtime:boolean;error?:string;providers:{id:string;name:string;oauth:boolean;apiKey?:boolean;catalog?:ModelCatalog;auth:{configured:boolean;source?:string}}[];models:{id:string;provider:string;name:string;thinkingLevels:string[];available:boolean;unavailableReason?:string}[];settings:AiConfig;storage:{dataDir:string;credentials:string;kind:string}}
export interface AgentMessage{id:string;role:'user'|'assistant';text:string;tools?:{name:string;phase:string;isError?:boolean}[];error?:string}
export interface AgentRecord{created?:number;id:string;name:string;messages:AgentMessage[];status:string;running?:boolean;count?:number}
export async function agentStatus():Promise<AgentStatus>{
 try{return await envoi().agentStatus() as unknown as AgentStatus;}catch(error){throw ipcError(error);}
}
export async function agentRequest<T=unknown>(route:string,body:unknown,signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const result=await envoi().agentRequest(route,body).catch(error=>{throw ipcError(error);});
 if(result&&typeof result==='object'&&(result as {ok?:boolean}).ok===false)throw Error((result as {error?:string}).error??translate('ai.operationFailed'));
 return result as T;
}
const bindings=new Map<string,Promise<{ok:boolean;project:{id:string;path:string;name:string}}>>();
// 绑定成功后记录 projectId→rootPath，供项目删除流程清理（gitBinding）。
export async function bindProject(rootPath:string,options:{copy?:boolean}={}){
 const copy=options.copy??false,previous=bindings.get(rootPath);
 if(!copy&&previous)return previous;
 const promise=(async()=>{
  const result=await envoi().bindProject(rootPath,{copy}).catch(error=>{throw ipcError(error);});
  if(result.ok)await rememberGitPath(result.project.id,result.project.path).catch(error=>{window.dispatchEvent(new CustomEvent('envoi:storage-warning',{detail:(error as Error).message}));});
  return result;
 })();
 bindings.set(rootPath,promise);
 try{return await promise;}finally{if(bindings.get(rootPath)===promise)bindings.delete(rootPath); }
}
export type ChatEvent={type:'delta'|'thinking';text:string}|{type:'session';id:string}|{type:'tool';phase:string;name:string;isError?:boolean}|{type:'done'}|{type:'error';message:string};
export async function* agentChat(message:string,options:{projectId:string;sessionId?:string;paperId?:string;context?:string;dirty:boolean;signal?:AbortSignal}):AsyncGenerator<ChatEvent>{
 type Item={event:ChatEvent}|{end:true;error?:Error};
 const items:Item[]=[];let wake:(()=>void)|undefined,sessionId=options.sessionId;
 const push=(item:Item)=>{items.push(item);const notify=wake;wake=undefined;notify?.();};
 const unsubscribe=envoi().onAgentEvent(event=>{
  if(event.projectId!==options.projectId)return;
  const rest={...event};delete (rest as Partial<typeof event>).projectId;
  const chatEvent=rest as unknown as ChatEvent;
  if(chatEvent.type==='session')sessionId=chatEvent.id;
  push({event:chatEvent});
  if(chatEvent.type==='done'||chatEvent.type==='error')push({end:true});
 });
 const abort=()=>{void agentRequest('abort',{projectId:options.projectId,sessionId}).catch(()=>{});push({end:true,error:new DOMException('Aborted','AbortError')});};
 options.signal?.addEventListener('abort',abort,{once:true});
 try{
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const start=await envoi().agentChat({projectId:options.projectId,sessionId:options.sessionId,paperId:options.paperId,context:options.context,dirty:options.dirty,message}).catch(error=>{throw ipcError(error);});
  if(!start.ok)throw Error(translate('ai.requestFailed'));
  for(;;){
   while(items.length){const item=items.shift()!;if('end' in item){if(item.error)throw item.error;return;}yield item.event;}
   await new Promise<void>(resolve=>{wake=resolve;});
  }
 }finally{options.signal?.removeEventListener('abort',abort);unsubscribe();}
}

const catalogRefreshes=new Map<string,Promise<unknown>>();
export function refreshModelCatalog(provider:string){
 const pending=catalogRefreshes.get(provider);if(pending)return pending;
 const request=agentRequest('models/refresh',{provider}).finally(()=>{catalogRefreshes.delete(provider);});
 catalogRefreshes.set(provider,request);return request;
}
