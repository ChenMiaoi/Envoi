import {dirtyFiles,safePath,type PaperProject} from './projectFiles';
export function assertCanClose(project:PaperProject,busy:boolean,saving:boolean,discard:boolean){
 if(busy||saving)throw Error('请等待保存、编译或项目操作结束后再关闭。');
 if(dirtyFiles(project).length&&!discard)throw Error('当前项目有未保存修改，请先保存或明确放弃修改。');
}
export interface DeletionTarget {parent:FileSystemDirectoryHandle;directory:FileSystemDirectoryHandle;name:string;label:string}
export async function verifyDeletionTarget(parent:FileSystemDirectoryHandle,directory:FileSystemDirectoryHandle):Promise<DeletionTarget>{
 const name=directory.name;if(!name||name==='.'||name==='..'||/[\\/]/.test(name))throw Error('目录名称无效，拒绝删除。');
 if(await parent.isSameEntry(directory))throw Error('不能删除所选父目录本身，请选择项目的直接父目录。');
 if(await parent.queryPermission({mode:'readwrite'})!=='granted'||await directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('父目录或项目写入权限不可用，未删除。');
 const relative=await parent.resolve(directory);if(!relative||relative.length!==1||relative[0]!==name)throw Error('所选位置不是该项目的直接父目录，未删除。');
 const child=await parent.getDirectoryHandle(name);if(!await child.isSameEntry(directory))throw Error('项目目录已移动或被替换，未删除。');
 // This interface deletes paper directories, never the application/code repository root.
 try{await child.getFileHandle('package.json');throw Error('此目录包含 package.json；为保护应用或代码仓库，请使用系统文件管理器处理。');}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 let paper=false;for await(const [entry,handle] of child.entries()){if(handle.kind==='file'&&/\.tex$/i.test(entry)){paper=true;break;}}
 if(!paper){for(const configuration of [['.envoi','project.json'],['.paperdesk','project.json'],['paperdesk.json']]){try{let folder=child;for(const component of configuration.slice(0,-1))folder=await folder.getDirectoryHandle(component);const metadata=JSON.parse(await(await(await folder.getFileHandle(configuration.at(-1)!)).getFile()).text());if(typeof metadata.main!=='string'||!/\.tex$/i.test(metadata.main))continue;const components=safePath(metadata.main);folder=child;for(const component of components.slice(0,-1))folder=await folder.getDirectoryHandle(component);await folder.getFileHandle(components.at(-1)!);paper=true;break;}catch{/* An invalid/missing project marker never authorizes deletion. */}}}
 if(!paper)throw Error('未找到可验证的论文主文件；不在应用中删除此目录，请使用系统文件管理器。');
 if(typeof parent.removeEntry!=='function')throw Error('此浏览器没有可靠的目录删除能力，请使用系统文件管理器。');
 return {parent,directory,name,label:`${parent.name} / ${name}`};
}
export async function deleteVerifiedProject(plan:DeletionTarget,typedName:string){
 if(typedName!==plan.name)throw Error('请输入完整项目目录名称确认永久删除。');
 await verifyDeletionTarget(plan.parent,plan.directory);
 try{await plan.parent.removeEntry(plan.name,{recursive:true});}catch(error){throw Error(`删除未完成：${(error as Error).message}。可能已有部分文件被移除；当前草稿仍保留，请检查目录。`);}
 try{await plan.parent.getDirectoryHandle(plan.name);}catch(error){if((error as Error).name==='NotFoundError')return;throw error;}
 throw Error('目录仍然存在或已被重新创建，未标记删除成功。');
}
