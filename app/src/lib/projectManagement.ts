import {translate} from '@/i18n/runtime';
import {dirtyFiles,safePath,type PaperProject} from './projectFiles';
export function assertCanClose(project:PaperProject,busy:boolean,saving:boolean,discard:boolean){
 if(busy||saving)throw Error(translate('project.closeBusy'));
 if(dirtyFiles(project).length&&!discard)throw Error(translate('project.closeUnsaved'));
}
export interface DeletionTarget {parent:FileSystemDirectoryHandle;directory:FileSystemDirectoryHandle;name:string;label:string}
export async function verifyDeletionTarget(parent:FileSystemDirectoryHandle,directory:FileSystemDirectoryHandle):Promise<DeletionTarget>{
 const name=directory.name;if(!name||name==='.'||name==='..'||/[\\/]/.test(name))throw Error(translate('project.deleteInvalidName'));
 if(await parent.isSameEntry(directory))throw Error(translate('project.deleteIsParent'));
 if(await parent.queryPermission({mode:'readwrite'})!=='granted'||await directory.queryPermission({mode:'readwrite'})!=='granted')throw Error(translate('project.deleteNoPermission'));
 const relative=await parent.resolve(directory);if(!relative||relative.length!==1||relative[0]!==name)throw Error(translate('project.deleteNotParent'));
 const child=await parent.getDirectoryHandle(name);if(!await child.isSameEntry(directory))throw Error(translate('project.deleteMoved'));
 // This interface deletes paper directories, never the application/code repository root.
 try{await child.getFileHandle('package.json');throw Error(translate('project.deletePackageJson'));}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 let paper=false;for await(const [entry,handle] of child.entries()){if(handle.kind==='file'&&/\.tex$/i.test(entry)){paper=true;break;}}
 if(!paper){for(const configuration of [['.envoi','project.json'],['.paperdesk','project.json'],['paperdesk.json']]){try{let folder=child;for(const component of configuration.slice(0,-1))folder=await folder.getDirectoryHandle(component);const metadata=JSON.parse(await(await(await folder.getFileHandle(configuration.at(-1)!)).getFile()).text());if(typeof metadata.main!=='string'||!/\.tex$/i.test(metadata.main))continue;const components=safePath(metadata.main);folder=child;for(const component of components.slice(0,-1))folder=await folder.getDirectoryHandle(component);await folder.getFileHandle(components.at(-1)!);paper=true;break;}catch{/* An invalid/missing project marker never authorizes deletion. */}}}
 if(!paper)throw Error(translate('project.deleteNoMainTex'));
 if(typeof parent.removeEntry!=='function')throw Error(translate('project.deleteUnsupported'));
 return {parent,directory,name,label:`${parent.name} / ${name}`};
}
export async function deleteVerifiedProject(plan:DeletionTarget,typedName:string){
 if(typedName!==plan.name)throw Error(translate('project.deleteConfirmName'));
 await verifyDeletionTarget(plan.parent,plan.directory);
 try{await plan.parent.removeEntry(plan.name,{recursive:true});}catch(error){throw Error(translate('project.deleteIncomplete',{message:(error as Error).message}));}
 try{await plan.parent.getDirectoryHandle(plan.name);}catch(error){if((error as Error).name==='NotFoundError')return;throw error;}
 throw Error(translate('project.deleteStillExists'));
}
