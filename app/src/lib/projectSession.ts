import {fileKind,readProject,type PaperProject} from './projectFiles';
import {recentProjects} from './recentProjects';
function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('paperdesk-session',1);request.onupgradeneeded=()=>request.result.createObjectStore('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
let sessionWrites=Promise.resolve();
export function saveSession(project:PaperProject){const write=sessionWrites.catch(()=>{}).then(()=>writeSession(project));sessionWrites=write;return write;}
async function writeSession(project:PaperProject){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('current','readwrite');tx.objectStore('current').put({...project,files:project.files.map(file=>({...file,url:file.url?.startsWith('blob:')?undefined:file.url}))},'project');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
export function mergeDrafts(fresh:PaperProject,cached:PaperProject):PaperProject {
 const drafts=cached.files.filter(file=>file.text!==undefined&&file.text!==file.saved);
 return {...fresh,rootId:fresh.files.some(file=>file.id===cached.rootId)?cached.rootId:fresh.rootId,diagnostics:cached.diagnostics?.status==='cancelled'&&!cached.diagnostics.items.length?fresh.diagnostics??cached.diagnostics:cached.diagnostics??fresh.diagnostics,compiled:cached.compiled,compileStatus:cached.compileStatus??fresh.compileStatus,compileLog:cached.compileLog??fresh.compileLog,files:[...fresh.files.map(file=>{const draft=drafts.find(d=>d.id===file.id);return draft?{...file,text:draft.text,saved:draft.saved}:file;}),...drafts.filter(d=>!fresh.files.some(f=>f.id===d.id))]};
}
export async function restoreSession():Promise<{project?:PaperProject;recoverable?:PaperProject;warning?:string}> {
 const db=await database();let cached:PaperProject|undefined;try{cached=await new Promise((resolve,reject)=>{const req=db.transaction('current').objectStore('current').get('project');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
 if(!cached){const recent=(await recentProjects())[0];if(!recent)return {};cached={id:'restore',name:recent.name,directory:recent.directory,files:[],directories:[],rootId:''};}
 if(cached.id==='demo'&&!cached.directory){const archive=await database();try{await new Promise<void>((resolve,reject)=>{const tx=archive.transaction('current','readwrite');tx.objectStore('current').put(cached,'legacy-demo');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{archive.close();}return {recoverable:cached,warning:'旧内置会话未自动加载；如需其中草稿，可手动恢复。'};}
 return restoreProjectCache(cached);
}
export async function restoreProjectCache(cached:PaperProject):Promise<{project:PaperProject;warning?:string}> {
 cached={...cached,diagnostics:cached.diagnostics?.status==='running'?{...cached.diagnostics,status:'cancelled'}:cached.diagnostics,compileStatus:cached.compileStatus?.startsWith('正在编译')?'上次编译已中断 · 保留已有 PDF':cached.compileStatus,files:cached.files.map(file=>({...file,kind:fileKind(file.path),url:file.file&&['pdf','image'].includes(file.kind)?URL.createObjectURL(file.file):file.url}))};
 if(!cached.directory)return {project:cached};
 try {
  if(await cached.directory.queryPermission({mode:'readwrite'})!=='granted')return {project:cached,warning:`${cached.name} 的目录权限已失效。当前保留缓存和未保存编辑，请从项目菜单重新授权打开；没有替换当前项目。`};
  return {project:mergeDrafts(await readProject(cached.directory),cached)};
 }catch(error){return {project:cached,warning:`恢复 ${cached.name} 失败：${(error as Error).message}。缓存编辑仍保留，请重新授权或检查目录。`};}
}
