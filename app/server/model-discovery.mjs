import {createHash} from 'node:crypto';
import path from 'node:path';
import {atomicJson,jsonFile} from './local-data.mjs';
import {providerFailure} from './provider-validation.mjs';
export const discoveryAdapters={
 opencode:{url:'https://opencode.ai/zen/v1/models',baseUrl:'https://opencode.ai/zen/v1',public:true},
 openai:{url:'https://api.openai.com/v1/models',baseUrl:'https://api.openai.com/v1',api:'openai-responses'},
 anthropic:{url:'https://api.anthropic.com/v1/models?limit=1000',baseUrl:'https://api.anthropic.com',api:'anthropic-messages'},
 google:{url:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',baseUrl:'https://generativelanguage.googleapis.com',api:'google-generative-ai'},
};
const protocols={'@ai-sdk/openai':'openai-responses','@ai-sdk/anthropic':'anthropic-messages','@ai-sdk/google':'google-generative-ai','@ai-sdk/openai-compatible':'openai-completions'};
const levels=['off','minimal','low','medium','high','xhigh'];
export function parseDirectory(provider,body){
 const rows=provider==='google'?body?.models:body?.data;
 if(!Array.isArray(rows)||rows.some(row=>typeof (row.id??row.name)!=='string'))throw Error('模型目录响应格式无效');
 return [...new Set(rows.filter(row=>provider!=='google'||row.supportedGenerationMethods?.includes('generateContent')).map(row=>String(row.id??row.name).replace(/^models\//,'')))];
}
export function runtimeModels(provider,ids,metadata){
 const adapter=discoveryAdapters[provider],catalog=metadata?.[provider],models=[],unresolved=[];
 for(const id of ids){const item=catalog?.models?.[id],api=adapter.api??protocols[item?.provider?.npm??catalog?.npm];
 if(!item||!api||!Number.isFinite(item.limit?.context)||!Number.isFinite(item.limit?.output)||!Array.isArray(item.modalities?.input)||!Number.isFinite(item.cost?.input)||!Number.isFinite(item.cost?.output)){unresolved.push(id);continue;}
 const effort=item.reasoning_options?.find(option=>option.type==='effort')?.values??[];
 const thinkingLevelMap=Object.fromEntries(levels.map(level=>[level,effort.includes(level)?level:null]));
 models.push({id,name:item.name||id,api,baseUrl:api==='anthropic-messages'&&provider==='opencode'?'https://opencode.ai/zen':adapter.baseUrl,reasoning:item.reasoning===true,thinkingLevelMap,input:item.modalities.input.filter(value=>['text','image'].includes(value)),contextWindow:item.limit.context,maxTokens:item.limit.output,cost:{input:item.cost.input,output:item.cost.output,cacheRead:item.cost.cache_read??0,cacheWrite:item.cost.cache_write??0},...(api==='openai-completions'?{compat:{supportsReasoningEffort:effort.length>0}}:{})});
 }
 return {models,unresolved};
}
export function createModelDiscovery({directory,fetcher=fetch,now=Date.now,ttl=300000}={}){
 const memory=new Map(),pending=new Map();let metadataFlight;
 const readJson=async(url,headers={})=>{const response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(12000)});const raw=await response.text();if(!response.ok)throw Error(providerFailure(raw,response.status,Object.values(headers)).message);return JSON.parse(raw);};
 const metadata=()=>metadataFlight??=(readJson('https://models.dev/api.json').catch(error=>{metadataFlight=undefined;throw error;}).finally(()=>{setTimeout(()=>{metadataFlight=undefined;},ttl).unref?.();}));
 async function discover(provider,key,{force=false}={}){
 const adapter=discoveryAdapters[provider];if(!adapter)return {state:'unsupported',message:'此服务商尚无可用的模型发现适配，请手动配置真实模型标识。',source:'manual'};
 const account=createHash('sha256').update(key??'public').digest('hex'),cacheKey=provider+'-'+account;
 const cached=memory.get(cacheKey);if(cached&&!force)return {...cached.result,state:cached.result.state==='live'?'cache':cached.result.state};
 if(pending.has(cacheKey))return pending.get(cacheKey);if(force)metadataFlight=undefined;
 const job=(async()=>{const file=path.join(directory,cacheKey+'.json');const disk=await jsonFile(file,null);let previous=cached?.result??disk;
 if(!force&&!cached&&disk?.checkedAt){memory.set(cacheKey,{at:now(),result:disk});return {...disk,state:'cache'};}
 try{const headers={Accept:'application/json'};if(!adapter.public){if(!key)throw Error('模型目录需要服务商凭据');if(provider==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}else if(provider==='google')headers['x-goog-api-key']=key;else headers.Authorization=`Bearer ${key}`;}
 const [body,details]=await Promise.all([readJson(adapter.url,headers),metadata()]);let ids=parseDirectory(provider,body);
 // Follow documented pagination using the same fixed provider origin.
 let page=body;for(let count=0;(page.has_more||page.nextPageToken)&&count<20;count++){const url=new URL(adapter.url);if(provider==='anthropic'&&page.last_id)url.searchParams.set('after_id',page.last_id);else if(provider==='google'&&page.nextPageToken)url.searchParams.set('pageToken',page.nextPageToken);else throw Error('模型目录分页格式无效');page=await readJson(url.href,headers);ids.push(...parseDirectory(provider,page));}if(page.has_more||page.nextPageToken)throw Error('模型目录分页未完成');ids=[...new Set(ids)];if(!ids.length)throw Error('服务商返回空模型目录；保留上一份成功目录');
 const result={state:'live',source:adapter.url,metadataSource:'https://models.dev/api.json',visibility:adapter.public?'public':'authenticated',checkedAt:now(),ids,...runtimeModels(provider,ids,details)};await atomicJson(file,result);memory.set(cacheKey,{at:now(),result});return result;
 }catch(error){const detail=providerFailure(error.message,undefined,[key]).message;const result=previous?{...previous,state:'stale',error:detail}:{state:'failed',source:adapter.url,error:detail,ids:[],models:[],unresolved:[]};memory.set(cacheKey,{at:now(),result});return result;}})();pending.set(cacheKey,job);try{return await job;}finally{pending.delete(cacheKey);}
 }
 return {discover};
}
export function registerDiscoveredModels(registry,provider,result){if(result.models?.length)registry.registerProvider(provider,{baseUrl:discoveryAdapters[provider].baseUrl,apiKey:'PAPERDESK_AUTH_FROM_PRIVATE_STORAGE',models:result.models});}
