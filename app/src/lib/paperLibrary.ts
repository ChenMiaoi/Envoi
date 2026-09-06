import {parseBibliography} from './bibliography';
export interface LibraryPaper {id:string;title:string;author:string;year:string;venue:string;tags:string[];collection:string;status:'待读'|'在读'|'已读';notes:string;created:number;attachment?:Blob;attachmentName?:string;contentHash?:string;bib?:string;citationKey?:string}
export function createLibraryStore(name='paperdesk-library-v1'){
 const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('papers',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 return {
  async list():Promise<LibraryPaper[]>{const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('papers').objectStore('papers').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}},
  async put(papers:LibraryPaper[]){const db=await database();try{await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('papers','readwrite');for(const paper of papers)transaction.objectStore('papers').put(paper);transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error??Error('论文库写入失败'));transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}},
  async remove(id:string){const db=await database();try{await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('papers','readwrite');transaction.objectStore('papers').delete(id);transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}}
 };
}
export const paperLibrary=createLibraryStore();
export type LibrarySort='created'|'title'|'year';
export function filterLibrary(papers:LibraryPaper[],query:string,collection:string,status:string,year='',sort:LibrarySort='created'){
 const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const sorted=(a:LibraryPaper,b:LibraryPaper)=>sort==='title'?a.title.localeCompare(b.title):sort==='year'?b.year.localeCompare(a.year):b.created-a.created;
 return papers.filter(paper=>(!collection||paper.collection===collection)&&(!status||paper.status===status)&&(!year||paper.year===year)&&terms.every(term=>[paper.title,paper.author,paper.year,paper.venue,...paper.tags,paper.citationKey??''].join(' ').toLocaleLowerCase().includes(term))).sort(sorted);
}
export async function fingerprintPdf(file:Blob){const digest=await crypto.subtle.digest('SHA-256',await file.slice(0,65536).arrayBuffer());return `${file.size}:${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`;}
export function dedupeImported(existing:LibraryPaper[],imported:LibraryPaper[]){const keys=new Set(existing.map(p=>p.citationKey).filter(Boolean)),hashes=new Set(existing.map(p=>p.contentHash).filter(Boolean));const added=imported.filter(paper=>!(paper.citationKey&&keys.has(paper.citationKey))&&!(paper.contentHash&&hashes.has(paper.contentHash)));return {added,skipped:imported.length-added.length};}
export async function validateLibraryPdf(file:Blob){if(file.size>100_000_000)throw Error('单个 PDF 超过 100 MB，未导入。');if(!(await file.slice(0,1024).text()).includes('%PDF-'))throw Error('文件不是可识别的 PDF，未导入。');}
export async function importLibraryFiles(files:File[]):Promise<LibraryPaper[]>{
 const records:LibraryPaper[]=[];for(const file of files){
  const base={author:'',year:'',venue:'',tags:[],collection:'',status:'待读' as const,notes:'',created:Date.now()};
  if(/\.pdf$/i.test(file.name)){await validateLibraryPdf(file);records.push({...base,id:crypto.randomUUID(),title:file.name.replace(/\.pdf$/i,''),attachment:file,attachmentName:file.name,contentHash:await fingerprintPdf(file)});}
  else if(/\.bib$/i.test(file.name)){if(file.size>5_000_000)throw Error('Bib 文件超过 5 MB，未导入。');for(const entry of parseBibliography(await file.text()))records.push({...base,id:crypto.randomUUID(),title:entry.title==='（无标题）'?'':entry.title,author:entry.author==='（无作者）'?'':entry.author,year:entry.year,venue:entry.venue,bib:entry.raw,citationKey:entry.key});}
  else throw Error(`暂不支持导入 ${file.name}，请选择 PDF 或 Bib 文件。`);
 }return records;
}
export function libraryAttachment(paper:LibraryPaper){if(!paper.attachment)throw Error('此条目尚未关联 PDF，请先添加附件。');return new File([paper.attachment],paper.attachmentName??`${paper.title||'paper'}.pdf`,{type:'application/pdf'});}
