// Renderer tests use the same path-based contract as the Electron preload.
import type {EnvoiBridge} from '../src/lib/desktop';
interface TestFile {kind: 'file'; getFile(): Promise<File>; createWritable(): Promise<{write(value:string):Promise<void>;close():Promise<void>}>}
interface TestDirectory {name: string; kind: 'directory'; getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<TestDirectory>;getFileHandle(name:string,options?:{create?:boolean}):Promise<TestFile>;entries():AsyncIterable<[string,TestDirectory|TestFile]>}
const roots = new Map<string, TestDirectory>();
const stores = new Map<string, {revision:number;value:unknown}>();
export function mountDirectory(handle: TestDirectory, root = `/fixtures/${crypto.randomUUID()}/${handle.name}`): string { roots.set(root,handle); return root; }
async function directory(root:string, rel='',create=false):Promise<TestDirectory> {
 let handle=roots.get(root);
 if(!handle){const parent=[...roots.keys()].filter(key=>root.startsWith(key+'/')).sort((a,b)=>b.length-a.length)[0];if(parent)return directory(parent,root.slice(parent.length+1)+(rel?'/'+rel:''),create);throw Error('目录不可用');}
 for(const part of rel.split('/').filter(Boolean))handle=await handle.getDirectoryHandle(part,{create});
 return handle;
}
const bridge = {
 canonicalDirectory:async(root:string)=>root,
 trustDirectory:async(root:string)=>root,
 fsChildren:async(root:string)=>{const children:{name:string;kind:'directory'|'file'}[]=[];for await(const [name,entry] of (await directory(root)).entries())children.push({name,kind:entry.kind});return children;},
 fsList:async(root:string)=>{const files:{path:string;kind:string;text:string}[]=[],directories:string[]=[];const walk=async(handle:TestDirectory,prefix='')=>{for await(const [name,child] of handle.entries()){if(['.envoi','.paperdesk','.git','node_modules'].includes(name))continue;const rel=prefix+name;if(child.kind==='directory'){directories.push(rel);await walk(child,rel+'/');}else files.push({path:rel,kind:'text',text:await (await child.getFile()).text()});}};await walk(await directory(root));return {files,directories};},
 fsRead:async(root:string,rel:string)=>{const parts=rel.split('/'),name=parts.pop();const handle=await directory(root,parts.join('/'));const file=await (await handle.getFileHandle(name)).getFile();return {text:await file.text()};},
 fsWrite:async(root:string,rel:string,content:{text?:string;base64?:string})=>{const parts=rel.split('/'),name=parts.pop();const handle=await directory(root,parts.join('/'),true);const writable=await (await handle.getFileHandle(name,{create:true})).createWritable();await writable.write(content.text??atob(content.base64!));await writable.close();},
 fsSave:async(root:string,changes:{path:string;text:string;expectedText:string|null}[])=>{const saved:string[]=[];try{for(const file of changes){const disk=await bridge.fsRead(root,file.path).catch(()=>null);if((disk?.text??null)!==file.expectedText)throw Error(file.path+' 已被外部修改');}for(const file of changes){await bridge.fsWrite(root,file.path,{text:file.text});saved.push(file.path);}return {saved};}catch(error){return {saved,error:(error as Error).message};}},
 fsWriteFiles:async(root:string,files:{path:string;text?:string;base64?:string}[])=>{for(const file of files)await bridge.fsWrite(root,file.path,file);},
 fsMkdir:async(root:string,rel:string)=>{await directory(root,rel,true);},
 assetUrl:async(root:string,rel:string)=>`envoi://fixture/${encodeURIComponent(root)}/${rel}`,
 dataGet:async(store:string,key='default')=>stores.get(store+':'+key)??null,
 dataPut:async(store:string,value:unknown,key='default',opts:{migrate?:boolean;expectedRevision?:number}={})=>{const id=store+':'+key,current=stores.get(id);if(opts.migrate&&current)return current;if(opts.expectedRevision!==undefined&&opts.expectedRevision!==(current?.revision??0))throw Error('数据冲突');const result={value,revision:(current?.revision??0)+1};stores.set(id,result);return result;},
} as unknown as EnvoiBridge;
export function installDesktopFixture(){Object.defineProperty(globalThis,'window',{configurable:true,value:{envoi:{...bridge},dispatchEvent:()=>true}});}
export function unmountDirectory(root:string){roots.delete(root);}
