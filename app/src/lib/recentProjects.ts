import {nativeMigrate,nativePut,nativeGet,encodeNative} from "./localData";
import {gitPath} from './gitBinding';
import {projectConfigFile} from './managementDir';
export interface RecentProject { id: string; name: string; projectId?: string; directory?: FileSystemDirectoryHandle; path?: string; updated: number }
async function database() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("paperdesk-projects", 2);
    request.onupgradeneeded = () => { for (const name of ["recent", "roots"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function cachedRecentProjects(): Promise<RecentProject[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction("recent").objectStore("recent").getAll(); request.onsuccess = () => resolve((request.result as RecentProject[]).sort((a,b) => b.updated-a.updated)); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function rememberProject(directory: FileSystemDirectoryHandle) {
  const previous = await recentProjects(); let existing: RecentProject | undefined;
  for (const entry of previous) if (entry.directory && await directory.isSameEntry(entry.directory)) { existing = entry; break; }
  let identity:string|undefined;try{identity=JSON.parse((await projectConfigFile(directory))?.text??'{}').projectId;}catch{/* Authorized roots need not be projects. */}
  existing??=previous.find(entry=>identity&&entry.projectId===identity);
  const id=existing?.id??identity??crypto.randomUUID(),path=await gitPath(directory);
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction("recent", "readwrite"); transaction.objectStore("recent").put({ id, name: directory.name, projectId:identity, directory, path, updated: Date.now() }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); } finally { db.close(); }
await syncRegistry('recent',[],[id]);
}

async function cachedAuthorizedRoots(): Promise<RecentProject[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction("roots").objectStore("roots").getAll(); request.onsuccess = () => resolve((request.result as RecentProject[]).sort((a,b) => b.updated-a.updated)); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function rememberRoot(directory: FileSystemDirectoryHandle) {
  const previous = await authorizedRoots(); let existing: RecentProject | undefined;
  for (const entry of previous) if (entry.directory && await directory.isSameEntry(entry.directory)) { existing = entry; break; }
  let identity:string|undefined;try{identity=JSON.parse((await projectConfigFile(directory))?.text??'{}').projectId;}catch{/* Authorized roots need not be projects. */}
  existing??=previous.find(entry=>identity&&entry.projectId===identity);
  const id=existing?.id??identity??crypto.randomUUID(),path=await gitPath(directory);
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction("roots", "readwrite"); transaction.objectStore("roots").put({ id, name: directory.name, projectId:identity, directory, path, updated: Date.now() }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); } finally { db.close(); }
await syncRegistry('roots',[],[id]);
}
export async function ensurePermission(directory: FileSystemDirectoryHandle) {
  if (await directory.queryPermission({ mode: "readwrite" }) === "granted") return true;
  return await directory.requestPermission({ mode: "readwrite" }) === "granted";
}
export async function forgetRecentProject(id:string){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('recent','readwrite');tx.objectStore('recent').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
await syncRegistry('recent',[id]);
}
export async function matchingProjectRecords(directory:FileSystemDirectoryHandle){
 const recent=await recentProjects(),roots=await authorizedRoots();const ids:{store:string;id:string}[]=[];
 for(const [store,entries] of [['recent',recent],['roots',roots]] as const)for(const entry of entries){try{if(entry.directory&&(await directory.isSameEntry(entry.directory)||await directory.resolve(entry.directory)!==null))ids.push({store,id:entry.id});}catch{/* Keep unrelated inaccessible handles. */}}
 return ids;
}
export async function forgetDeletedRecords(ids:{store:string;id:string}[]){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['recent','roots'],'readwrite');for(const item of ids)tx.objectStore(item.store).delete(item.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
await syncRegistry('recent',ids.filter(item=>item.store==='recent').map(item=>item.id));await syncRegistry('roots',ids.filter(item=>item.store==='roots').map(item=>item.id));
}

async function records(store:'recent'|'roots'):Promise<RecentProject[]> {
 const cached=await (store==='recent'?cachedRecentProjects():cachedAuthorizedRoots());
 if(typeof window==='undefined')return cached;
 try{const native=await nativeMigrate(store,await encodeNative(cached));return (native.value as RecentProject[]).map(entry=>({...entry,directory:cached.find(item=>item.id===entry.id)?.directory})).sort((a,b)=>b.updated-a.updated);}catch(error){window.dispatchEvent(new CustomEvent('envoi:storage-warning',{detail:'本机项目列表未连接，浏览器记录仍保留：'+(error as Error).message}));return cached;}
}
export const recentProjects=()=>records('recent');
export const authorizedRoots=()=>records('roots');
async function syncRegistry(store:'recent'|'roots',remove:string[]=[],changed:string[]=[]) {
 if(typeof window==='undefined')return;
 const cached=await (store==='recent'?cachedRecentProjects():cachedAuthorizedRoots());
 const current=await nativeGet<RecentProject[]>(store);
 const merged=new Map((current?.value??[]).map(entry=>[entry.id,entry]));for(const entry of cached.filter(entry=>changed.includes(entry.id)))merged.set(entry.id,{...merged.get(entry.id),...entry});for(const id of remove)merged.delete(id);
 await nativePut(store,await encodeNative([...merged.values()]),'default',{expectedRevision:current?.revision??0});
}
