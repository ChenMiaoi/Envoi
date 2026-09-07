import {nativePathWithin} from './nativePath';
import {nativeGet,nativePut} from './localData';
// Serialize local read-modify-write operations so simultaneous project restores
// cannot use the same revision and overwrite independent bindings.
let writes:Promise<unknown>=Promise.resolve();
function updateBindings(change:(current:Record<string,string>)=>Record<string,string>){
 const write=writes.catch(()=>{}).then(async()=>{
  const current=await nativeGet<Record<string,string>>('bindings');
  const next=change(current?.value??{});
  if(JSON.stringify(next)===JSON.stringify(current?.value??{}))return;
  await nativePut('bindings',next,'default',{expectedRevision:current?.revision??0});
 });
 writes=write;return write;
}
export function rememberGitPath(projectId:string,path:string){return updateBindings(current=>({...current,[projectId]:path}));}
// 删除流程：找出根路径等于 rootPath 或位于其下的所有绑定项目。
export async function matchingGitBindings(rootPath:string){
 const root=rootPath.replace(/\/$/,''),bindings=await nativeGet<Record<string,string>>('bindings');
 return Object.entries(bindings?.value??{}).filter(([,path])=>nativePathWithin(path,root)).map(([id])=>id);
}
export function forgetGitBindings(projectIds:string[]){return updateBindings(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!projectIds.includes(id))));}
