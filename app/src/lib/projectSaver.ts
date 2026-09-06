import {dirtyFiles,saveProject,type PaperProject} from './projectFiles';
export function createProjectSaver({getProject,setProject,message,saving}:{getProject:()=>PaperProject;setProject:(update:(project:PaperProject)=>PaperProject)=>void;message:(text:string)=>void;saving:(value:boolean)=>void}){
 let running=false;
 return async()=>{
  if(running)return;const snapshot=getProject();running=true;saving(true);message('正在保存全部修改…');
  try{
   if(!snapshot.directory)throw Error('尚未连接本地项目；草稿保留，未写入磁盘。');
   if(await snapshot.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('目录写入权限不可用；草稿保留，请从项目菜单恢复连接。');
   for await(const entry of snapshot.directory.entries()){void entry;break;}
   await saveProject(snapshot,(id,saved)=>setProject(current=>current.id!==snapshot.id?current:{...current,files:current.files.map(file=>file.id===id?{...file,saved}:file)}));
   message(dirtyFiles(getProject()).length?'本次保存已完成；保存期间的新修改仍未保存。':'所有修改已保存到当前项目目录。');
  }catch(error){message((error as Error).name==='NotFoundError'?'项目目录已移动或不存在；草稿保留，未保存，请打开新位置。':`保存失败：${(error as Error).message}`);}
  finally{running=false;saving(false);}
 };
}
