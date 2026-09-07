import {translate} from '@/i18n/runtime';
import {nativeGet,nativePut,nativeMigrate,encodeNative,decodeNative} from "./localData";
import {fileKind,readProject,type PaperProject} from './projectFiles';
import {bindProject} from './agentClient';
import {recentProjects} from './recentProjects';
function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('paperdesk-session',1);request.onupgradeneeded=()=>request.result.createObjectStore('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
const revisions=new Map<string,number>();
type PendingSession = {project: PaperProject; waiters: {resolve(): void; reject(error: unknown): void}[]};
const sessionQueue: PendingSession[] = [];
let draining = false;
// Coalesce queued edits of the same project while preserving project-switch order.
export function saveSession(project: PaperProject): Promise<void> {
 const promise = new Promise<void>((resolve, reject) => {
  const tail = sessionQueue.at(-1);
  if (tail?.project.id === project.id) {tail.project = project; tail.waiters.push({resolve, reject});}
  else sessionQueue.push({project, waiters: [{resolve, reject}]});
 });
 if (!draining) {
  draining = true;
  queueMicrotask(() => {void (async () => {
   try {while (sessionQueue.length) {const entry = sessionQueue.shift()!;try {await writeSession(entry.project);entry.waiters.forEach(waiter => waiter.resolve());} catch (error) {entry.waiters.forEach(waiter => waiter.reject(error));}}}
   finally {draining = false;}
  })();});
 }
 return promise;
}
async function writeSession(project:PaperProject){
 let nativeError:unknown;
 if(typeof window!=='undefined'&&typeof fetch==='function'){
  try{const encoded=await encodeNative(project);for(const key of [...(project.id!=='empty'?[project.id.replace(/[^a-zA-Z0-9_-]/g,'_')]:[]),'current']){if(!revisions.has(key))revisions.set(key,(await nativeGet('session',key))?.revision??0);try{const result=await nativePut('session',encoded,key,{expectedRevision:revisions.get(key)});revisions.set(key,result.revision);}catch(error){await nativePut('session',encoded,key,{migrate:true}).catch(()=>{});throw error;}}}catch(error){nativeError=error;window.dispatchEvent(new CustomEvent('envoi:storage-warning',{detail:translate('project.sessionNotWritten')+(error as Error).message}));}
 }

 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('current','readwrite');tx.objectStore('current').put({...project,files:project.files.map(file=>({...file,url:file.url?.startsWith('blob:')?undefined:file.url}))},'project');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 if(nativeError)throw nativeError;
}
export function mergeDrafts(fresh:PaperProject,cached:PaperProject):PaperProject {
 const drafts=cached.files.filter(file=>file.text!==undefined&&file.text!==file.saved);
 return {...fresh,rootId:fresh.files.some(file=>file.id===cached.rootId)?cached.rootId:fresh.rootId,diagnostics:cached.diagnostics?.status==='cancelled'&&!cached.diagnostics.items.length?fresh.diagnostics??cached.diagnostics:cached.diagnostics??fresh.diagnostics,compiled:cached.compiled,compileStatus:cached.compileStatus??fresh.compileStatus,compileLog:cached.compileLog??fresh.compileLog,files:[...fresh.files.map(file=>{const draft=drafts.find(d=>d.id===file.id);return draft?{...file,text:draft.text,saved:draft.saved}:file;}),...drafts.filter(d=>!fresh.files.some(f=>f.id===d.id))]};
}
export async function restoreSession():Promise<{project?:PaperProject;recoverable?:PaperProject;warning?:string}> {
 const db=await database();let cached:PaperProject|undefined;try{cached=await new Promise((resolve,reject)=>{const req=db.transaction('current').objectStore('current').get('project');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
 let recoverable:PaperProject|undefined;
 if(typeof window!=='undefined'&&typeof fetch==='function'){try{const native=await nativeGet<unknown>('session','current');if(native){revisions.set('current',native.revision);const restored=decodeNative(native.value) as PaperProject;if(cached){const legacy=await encodeNative(cached);if(JSON.stringify(legacy)!==JSON.stringify(native.value)){await nativeMigrate('session',legacy,'current');if(cached.files.some(file=>file.text!==undefined&&file.text!==file.saved))recoverable=cached;}}if(!cached||cached.id!==restored.id)cached=restored;else cached={...restored,rootPath:cached.rootPath};}else if(cached){const result=await nativePut('session',await encodeNative(cached),'current',{migrate:true});revisions.set('current',result.revision);}}catch{/* Retain browser recovery data when the local service is unavailable. */}}

 if(!cached){const recent=(await recentProjects())[0];if(!recent)return {};cached={id:'restore',name:recent.name,rootPath:recent.path,files:[],directories:[],rootId:''};}
 if(cached.id==='demo'&&!cached.rootPath){const archive=await database();try{await new Promise<void>((resolve,reject)=>{const tx=archive.transaction('current','readwrite');tx.objectStore('current').put(cached,'legacy-demo');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{archive.close();}return {recoverable:cached,warning:translate('project.legacySessionWarning')};}
 const result=await restoreProjectCache(cached);return {...result,...(recoverable?{recoverable,warning:translate('project.restoreConflict')}:{})};
}
export async function restoreProjectCache(cached:PaperProject):Promise<{project:PaperProject;warning?:string}> {
 cached={...cached,diagnostics:cached.diagnostics?.status==='running'?{...cached.diagnostics,status:'cancelled'}:cached.diagnostics,compileStatus:cached.compileStatus?.startsWith(translate('compile.compiling'))?translate('compile.interrupted'):cached.compileStatus,files:cached.files.map(file=>({...file,kind:fileKind(file.path),url:file.url?.startsWith('blob:')?undefined:file.url}))};
 if(!cached.rootPath)return {project:cached};
 try {
  const binding=await bindProject(cached.rootPath);
  return {project:mergeDrafts(await readProject(binding.project.path),cached)};
 }catch(error){return {project:{...cached,rootPath:undefined},warning:translate('project.restoreFailed',{name:cached.name,message:(error as Error).message})};}
}

export async function restoreProjectSession(fresh:PaperProject):Promise<PaperProject>{
 if(typeof window==='undefined')return fresh;
 try{const key=fresh.id.replace(/[^a-zA-Z0-9_-]/g,'_'),record=await nativeGet<unknown>('session',key);revisions.set(key,record?.revision??0);if(record){const cached=decodeNative(record.value) as PaperProject;if(cached.id===fresh.id)return mergeDrafts(fresh,cached);}}catch(error){window.dispatchEvent(new CustomEvent('envoi:storage-warning',{detail:translate('project.sessionUnavailable')+(error as Error).message}));}
 return fresh;
}
