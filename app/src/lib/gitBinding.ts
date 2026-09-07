import {nativePathWithin} from './nativePath';
import {nativeGet,nativePut} from './localData';
// 绑定存储：projectId → 项目根绝对路径，由 agentClient.bindProject 在绑定成功后记录。
export async function rememberGitPath(projectId:string,path:string){
 const current=await nativeGet<Record<string,string>>('bindings');
 await nativePut('bindings',{...current?.value,[projectId]:path},'default',{expectedRevision:current?current.revision:0});
}
// 删除流程：找出根路径等于 rootPath 或位于其下的所有绑定项目。
export async function matchingGitBindings(rootPath:string){
 const root=rootPath.replace(/\/$/,''),bindings=await nativeGet<Record<string,string>>('bindings');
 return Object.entries(bindings?.value??{}).filter(([,path])=>nativePathWithin(path,root)).map(([id])=>id);
}
export async function forgetGitBindings(projectIds:string[]){
 const current=await nativeGet<Record<string,string>>('bindings');
 if(!current)return;
 await nativePut('bindings',Object.fromEntries(Object.entries(current.value).filter(([id])=>!projectIds.includes(id))),'default',{expectedRevision:current.revision});
}
