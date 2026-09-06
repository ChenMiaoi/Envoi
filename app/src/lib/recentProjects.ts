export interface RecentProject { id: string; name: string; directory: FileSystemDirectoryHandle; updated: number }
async function database() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("paperdesk-projects", 2);
    request.onupgradeneeded = () => { for (const name of ["recent", "roots"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function recentProjects(): Promise<RecentProject[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction("recent").objectStore("recent").getAll(); request.onsuccess = () => resolve((request.result as RecentProject[]).sort((a,b) => b.updated-a.updated)); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function rememberProject(directory: FileSystemDirectoryHandle) {
  const previous = await recentProjects(); let existing: RecentProject | undefined;
  for (const entry of previous) if (await directory.isSameEntry(entry.directory)) { existing = entry; break; }
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction("recent", "readwrite"); transaction.objectStore("recent").put({ id: existing?.id ?? crypto.randomUUID(), name: directory.name, directory, updated: Date.now() }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); } finally { db.close(); }
}

export async function authorizedRoots(): Promise<RecentProject[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction("roots").objectStore("roots").getAll(); request.onsuccess = () => resolve((request.result as RecentProject[]).sort((a,b) => b.updated-a.updated)); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function rememberRoot(directory: FileSystemDirectoryHandle) {
  const previous = await authorizedRoots(); let existing: RecentProject | undefined;
  for (const entry of previous) if (await directory.isSameEntry(entry.directory)) { existing = entry; break; }
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction("roots", "readwrite"); transaction.objectStore("roots").put({ id: existing?.id ?? crypto.randomUUID(), name: directory.name, directory, updated: Date.now() }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); } finally { db.close(); }
}
export async function ensurePermission(directory: FileSystemDirectoryHandle) {
  if (await directory.queryPermission({ mode: "readwrite" }) === "granted") return true;
  return await directory.requestPermission({ mode: "readwrite" }) === "granted";
}
export async function forgetRecentProject(id:string){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('recent','readwrite');tx.objectStore('recent').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function matchingProjectRecords(directory:FileSystemDirectoryHandle){
 const recent=await recentProjects(),roots=await authorizedRoots();const ids:{store:string;id:string}[]=[];
 for(const [store,entries] of [['recent',recent],['roots',roots]] as const)for(const entry of entries){try{if(await directory.isSameEntry(entry.directory)||await directory.resolve(entry.directory)!==null)ids.push({store,id:entry.id});}catch{/* Keep unrelated inaccessible handles. */}}
 return ids;
}
export async function forgetDeletedRecords(ids:{store:string;id:string}[]){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['recent','roots'],'readwrite');for(const item of ids)tx.objectStore(item.store).delete(item.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
