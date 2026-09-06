// Read-only documented endpoints; never fall back to billable inference.
function classifyFailure(raw,status){
 const text=String(raw??'');
 if(/model.*(?:not supported|not found|does not exist|not available|unsupported)|unsupported.*model/i.test(text))return {kind:'model',message:'服务商不支持当前模型，请在模型列表中重新选择。'};
 if(/quota|insufficient.*(?:credit|balance)|billing|credit.*(?:exhaust|insufficient)|余额|额度/i.test(text)||status===402)return {kind:'quota',message:'服务商账户额度不足或计费受限，请检查账户。'};
 if(status===429||/rate.limit|too many requests/i.test(text))return {kind:'rate_limit',message:'服务商请求频率受限，请稍后重试。'};
 if(status===401||/invalid.*(?:api.?key|token)|authentication|unauthorized|incorrect.*key/i.test(text))return {kind:'authentication',message:'服务商拒绝认证，请检查 API Key 或重新登录。'};
 if(status===403||/permission|forbidden/i.test(text))return {kind:'permission',message:'服务商拒绝访问，请检查账户权限或地区限制。'};
 if(/timeout|timed out|abort/i.test(text))return {kind:'timeout',message:'服务商连接超时，请重试。'};
 if(/fetch failed|network|ENOTFOUND|ECONN|socket|TLS|certificate/i.test(text))return {kind:'network',message:'无法连接服务商，请检查网络或代理后重试。'};
 return {kind:'provider',message:status?`服务商请求失败（HTTP ${status}），请稍后重试。`:'服务商未完成请求，请重试或检查账户。'};
}
export function safeProviderDetail(raw,secrets=[]){
 let value=String(raw??'');
 for(const secret of secrets)if(secret)value=value.split(secret).join('[redacted]');
 return value.replace(/Bearer\s+[^\s"',}]+/gi,'Bearer [redacted]').replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|x-api-key)["']?)\s*[:=]\s*)["']?[^\s,"'}]+["']?/gi,'$1[redacted]').replace(/\bsk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/\/(?:Users|home)\/[^\s"']+/g,'[private path]').slice(0,16000);
}
export function providerFailure(raw,status,secrets=[]){
 const summary=classifyFailure(raw,status),detail=safeProviderDetail(raw,secrets).trim();
 return {...summary,summary:summary.message,message:detail?(status&&!new RegExp('\\b'+status+'\\b').test(detail)?`${status} ${detail}`:detail):summary.message};
}
const probes={
 openai:{url:'https://api.openai.com/v1/models',authenticated:true},
 anthropic:{url:'https://api.anthropic.com/v1/models?limit=1',authenticated:true,kind:'anthropic'},
 google:{url:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',authenticated:true,kind:'google'},
 opencode:{url:'https://opencode.ai/zen/v1/models',authenticated:false},
 'opencode-go':{url:'https://opencode.ai/zen/v1/models',authenticated:false},
};
export async function validateProviderCredential(provider,key,{fetcher=fetch}={}){
 const probe=probes[provider];
 if(!probe)return {state:'saved',message:'已保存',checkedAt:Date.now(),method:'no-read-only-auth-endpoint'};
 const headers={Accept:'application/json'};
 // Public catalog checks prove reachability, never credential validity.
 if(probe.authenticated){if(probe.kind==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}else if(probe.kind==='google')headers['x-goog-api-key']=key;else headers.Authorization=`Bearer ${key}`;}
 try{const response=await fetcher(probe.url,{headers,redirect:'error',signal:AbortSignal.timeout(12000)});const text=await response.text();if(!response.ok)return {state:'failed',...providerFailure(text,response.status,[key]),checkedAt:Date.now()};let body;try{body=JSON.parse(text);}catch{return {state:'failed',kind:'response',message:'服务商返回了无法识别的响应，请检查连接。',checkedAt:Date.now()};}if(!Array.isArray(body.data)&&!Array.isArray(body.models))return {state:'failed',kind:'response',message:'服务商未返回有效模型列表，请重试。',checkedAt:Date.now()};return {state:probe.authenticated?'verified':'reachable',message:probe.authenticated?'连接成功':'已保存，服务可访问',checkedAt:Date.now(),method:probe.authenticated?'authenticated-model-list':'public-model-list'};}catch(error){return {state:'failed',...providerFailure(error.message,undefined,[key]),checkedAt:Date.now()};}
}
