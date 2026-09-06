import {translate} from '@/i18n/runtime';
import {dirtyFiles,saveProject,type PaperProject} from './projectFiles';
export function createProjectSaver({getProject,setProject,message,saving}:{getProject:()=>PaperProject;setProject:(update:(project:PaperProject)=>PaperProject)=>void;message:(text:string)=>void;saving:(value:boolean)=>void}){
 let running=false;
 return async()=>{
  if(running)return;const snapshot=getProject();running=true;saving(true);message(translate('project.savingAll'));
  try{
   if(!snapshot.directory)throw Error(translate('project.notConnected'));
   if(await snapshot.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error(translate('project.writePermissionUnavailable'));
   for await(const entry of snapshot.directory.entries()){void entry;break;}
   await saveProject(snapshot,(id,saved)=>setProject(current=>current.id!==snapshot.id?current:{...current,files:current.files.map(file=>file.id===id?{...file,saved}:file)}));
   message(dirtyFiles(getProject()).length?translate('project.savedWithDirty'):translate('project.savedAll'));
  }catch(error){message((error as Error).name==='NotFoundError'?translate('project.movedNotSaved'):translate('project.saveFailed',{message:(error as Error).message}));}
  finally{running=false;saving(false);}
 };
}
