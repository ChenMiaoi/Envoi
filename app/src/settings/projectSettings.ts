import {projectConfiguration,type ProjectConfiguration} from './model';import type {PaperProject} from '@/lib/projectFiles';
import {managementDirName,legacyDirName,projectConfigPath,legacyProjectConfigPath} from '@/lib/managementDir';
import {translate} from '@/i18n/runtime';
export {projectConfigPath};
export async function saveProjectConfiguration(project:PaperProject,configuration:ProjectConfiguration,main=project.rootId,ai?:Partial<import('@/lib/agentClient').AiConfig>):Promise<PaperProject>{
 if(!project.directory)throw Error(translate('settings.project.openRealFirst'));
 if(await project.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error(translate('settings.project.writePermission'));
 const root=project.files.find(file=>file.id===main&&file.kind==='latex');if(!root&&ai===undefined)throw Error(translate('settings.project.mainMustBeLatex'));
 const known=project.files.find(file=>file.path===projectConfigPath)??project.files.find(file=>file.path===legacyProjectConfigPath),legacy=project.files.find(file=>file.path==='paperdesk.json');
 if([known,legacy].some(file=>file&&file.text!==file.saved))throw Error(translate('settings.project.unsavedEdits'));
 let raw:string|undefined;
 for(const dir of known?[known.path.split('/')[0]]:[managementDirName,legacyDirName]){
  try{raw=await(await(await(await project.directory.getDirectoryHandle(dir)).getFileHandle('project.json')).getFile()).text();break;}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 }
 if(known?raw!==known.saved:raw!==undefined)throw Error(translate('settings.project.externallyModified'));
 let metadata:Record<string,unknown>={};
 if(raw===undefined&&legacy){const legacyRaw=await(await (await project.directory.getFileHandle('paperdesk.json')).getFile()).text();if(legacyRaw!==legacy.saved)throw Error(translate('settings.project.legacyModified'));const old=JSON.parse(legacyRaw);for(const key of ['name','main','template','dataStatus','buildDirectory'])if(old[key]!==undefined)metadata[key]=old[key];if(old.git&&typeof old.git==='object')metadata.git={requested:old.git.requested,branch:old.git.branch,status:old.git.status};}
 else if(raw!==undefined){try{metadata=JSON.parse(raw);if(!metadata||Array.isArray(metadata)||typeof metadata!=='object')throw Error();}catch{throw Error(translate('settings.project.invalidFormat'));}}
 const ignoreKnown=project.files.find(file=>file.path==='.gitignore');let ignoreHandle:FileSystemFileHandle|undefined,ignoreRaw='';
 try{ignoreHandle=await project.directory.getFileHandle('.gitignore');ignoreRaw=await(await ignoreHandle.getFile()).text();}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 const ignoreRules=`!/${managementDirName}/\n/${managementDirName}/*\n!/${projectConfigPath}`;const updateIgnore=!ignoreRaw.includes(ignoreRules);
 if(updateIgnore&&ignoreKnown&&(ignoreKnown.text!==ignoreKnown.saved||ignoreKnown.saved!==ignoreRaw))throw Error(translate('settings.project.gitignoreModified'));
 const settings=projectConfiguration(configuration);if(ai!==undefined){metadata.ai=Object.fromEntries(Object.entries(ai).filter(([key,value])=>['model','provider','thinking'].includes(key)&&(value===null||typeof value==='string')||key==='context'&&['none','current'].includes(value as string)||key==='tools'&&['none','read','write'].includes(value as string)));}metadata.settings=settings;if(root)metadata.main=root.path;delete metadata.engine;
 const text=JSON.stringify(metadata,null,2)+'\n';const management=await project.directory.getDirectoryHandle(managementDirName,{create:true});const handle=await management.getFileHandle('project.json',{create:true});
 const stream=await handle.createWritable();try{await stream.write(text);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
 let ignoreFile=ignoreKnown;
 if(updateIgnore){const ignoreText=ignoreRaw+(ignoreRaw.endsWith('\n')||!ignoreRaw?'':'\n')+'\n# Share project settings; keep machine bindings and caches private\n'+ignoreRules+'\n';ignoreHandle??=await project.directory.getFileHandle('.gitignore',{create:true});const writable=await ignoreHandle.createWritable();try{await writable.write(ignoreText);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw Error(translate('settings.project.gitignoreUpdateFailed',{error:(error as Error).message}));}ignoreFile={id:'.gitignore',path:'.gitignore',kind:'text',text:ignoreText,saved:ignoreText,handle:ignoreHandle};}
 // Legacy files remain an untouched backup, including unknown fields. New configuration is authoritative.
 const file={id:projectConfigPath,path:projectConfigPath,kind:'text' as const,text,saved:text,handle};
 return {...project,settings,engine:settings.overrides.engine,rootId:root?.id??project.rootId,files:[...project.files.filter(existing=>existing.path!==projectConfigPath&&existing.path!=='.gitignore'),file,...(ignoreFile?[ignoreFile]:[])]};
}
