import {bindAgentDirectory} from './agentClient';
import {rememberGitPath} from './gitBinding';
export async function localGitRuntime() {
 const response=await fetch('/api/paperdesk/git');
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('本地 Git 服务未连接；无法检测安装状态。请启动本地服务或取消启用 Git。');
 return response.json() as Promise<{available:boolean;version?:string;error?:string;token:string}>;
}
// Every bridge call proves directory ownership by writing a one-time token the server re-reads from disk.
async function gitBridge<T>(directory:FileSystemDirectoryHandle,path:string,endpoint:string,failure:string,extra:Record<string,unknown>={}):Promise<T> {
 const runtime=await localGitRuntime();if(!runtime.available)throw Error(runtime.error);
 const proof=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('目录权限已失效，请在项目菜单恢复授权。');
 const state=await directory.getDirectoryHandle('.paperdesk',{create:true}).catch(error=>{if(error.name==='NotFoundError')throw Error('项目目录已移动或不存在，请在项目菜单打开新位置；这不是 Git 授权失效。');throw error;});
 const handle=await state.getFileHandle('git-proof-'+proof,{create:true});const stream=await handle.createWritable();await stream.write(proof);await stream.close();
 try{const response=await fetch(`/api/paperdesk/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-PaperDesk-Token':runtime.token},body:JSON.stringify({directory:path,proof,proofKind:'unique',...extra})});if(!response.headers.get('content-type')?.includes('application/json'))throw Error('本地 Git 桥接不可用。');const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error??failure);return result as T;}finally{await state.removeEntry('git-proof-'+proof).catch(()=>{});}
}
export async function initializeLocalGit(directory:FileSystemDirectoryHandle, absolutePath:string) {
 await gitBridge(directory,absolutePath,'git-init','Git 初始化失败');
 await rememberGitPath(directory,absolutePath);
 const state=await directory.getDirectoryHandle('.paperdesk');
 let metadata:FileSystemFileHandle;try{metadata=await state.getFileHandle('project.json');}catch(error){if((error as Error).name!=='NotFoundError')throw error;metadata=await directory.getFileHandle('paperdesk.json');}const json=JSON.parse(await (await metadata.getFile()).text());json.git.status='initialized';const writable=await metadata.createWritable();await writable.write(JSON.stringify(json,null,2)+'\n');await writable.close();
}
export interface GitStatus {state:'ready'|'not-initialized';branch?:string;detached?:boolean;version:string;files:{path:string;originalPath?:string;index:string;worktree:string;untracked:boolean;conflict:boolean}[]}
export function localGitStatus(directory:FileSystemDirectoryHandle,path:string):Promise<GitStatus> {
 return gitBridge(directory,path,'git-status','Git 状态读取失败');
}
export interface GitRef {name:string;kind:'branch'|'tag'|'remote'}
export interface GitCommit {hash:string;parents:string[];refs:GitRef[];head:boolean;author:string;date:string;subject:string}
export interface GitLog {state:'ready'|'not-initialized'|'nested';branch?:string;detached?:boolean;enclosing?:string;commits:GitCommit[];truncated:boolean}
export function localGitLog(directory:FileSystemDirectoryHandle,path:string):Promise<GitLog> {
 return gitBridge(directory,path,'git-log','Git 历史读取失败');
}
export interface GitShow {commit:GitCommit&{body:string};files:{path:string;added:number|null;deleted:number|null}[]}
export function localGitShow(directory:FileSystemDirectoryHandle,path:string,commit:string):Promise<GitShow> {
 return gitBridge(directory,path,'git-show','提交详情读取失败',{commit});
}
export async function bindProjectConnection(directory:FileSystemDirectoryHandle,path:string) {
 await bindAgentDirectory(directory,path);
 await rememberGitPath(directory,path);
 window.dispatchEvent(new Event('paperdesk:connection-updated'));
}
