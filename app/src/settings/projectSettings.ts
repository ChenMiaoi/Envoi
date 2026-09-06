import {projectConfiguration,type ProjectConfiguration} from './model';import type {PaperProject} from '@/lib/projectFiles';
export const projectConfigPath='.paperdesk/project.json';
export async function saveProjectConfiguration(project:PaperProject,configuration:ProjectConfiguration,main=project.rootId,ai?:Partial<import('@/lib/agentClient').AiConfig>):Promise<PaperProject>{
 if(!project.directory)throw Error('请先打开真实项目；未连接的草稿不能写入项目设置。');
 if(await project.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('当前项目写入权限不可用，请在项目菜单恢复连接。');
 const root=project.files.find(file=>file.id===main&&file.kind==='latex');if(!root&&ai===undefined)throw Error('主文件必须是当前项目内的 LaTeX 文件。');
 const known=project.files.find(file=>file.path===projectConfigPath),legacy=project.files.find(file=>file.path==='paperdesk.json');
 if([known,legacy].some(file=>file&&file.text!==file.saved))throw Error('项目配置有未保存编辑，请先保存后修改项目设置。');
 let management:FileSystemDirectoryHandle|undefined,handle:FileSystemFileHandle|undefined,raw:string|undefined;
 try{management=await project.directory.getDirectoryHandle('.paperdesk');handle=await management.getFileHandle('project.json');raw=await(await handle.getFile()).text();}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 if(known?raw!==known.saved:raw!==undefined)throw Error('项目配置已被外部修改或新配置已存在，请重新打开项目后设置。');
 let metadata:Record<string,unknown>={};
 if(raw===undefined&&legacy){const legacyRaw=await(await (await project.directory.getFileHandle('paperdesk.json')).getFile()).text();if(legacyRaw!==legacy.saved)throw Error('旧项目配置已被外部修改，请重新打开项目。');const old=JSON.parse(legacyRaw);for(const key of ['name','main','template','dataStatus','buildDirectory'])if(old[key]!==undefined)metadata[key]=old[key];if(old.git&&typeof old.git==='object')metadata.git={requested:old.git.requested,branch:old.git.branch,status:old.git.status};}
 else if(raw!==undefined){try{metadata=JSON.parse(raw);if(!metadata||Array.isArray(metadata)||typeof metadata!=='object')throw Error();}catch{throw Error('项目配置格式无效，未覆盖。');}}
 const ignoreKnown=project.files.find(file=>file.path==='.gitignore');let ignoreHandle:FileSystemFileHandle|undefined,ignoreRaw='';
 try{ignoreHandle=await project.directory.getFileHandle('.gitignore');ignoreRaw=await(await ignoreHandle.getFile()).text();}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
 const ignoreRules='!/.paperdesk/\n/.paperdesk/*\n!/.paperdesk/project.json';const updateIgnore=!ignoreRaw.includes(ignoreRules);
 if(updateIgnore&&ignoreKnown&&(ignoreKnown.text!==ignoreKnown.saved||ignoreKnown.saved!==ignoreRaw))throw Error('.gitignore 有未保存或外部修改，未覆盖；请先处理后保存项目设置。');
 const settings=projectConfiguration(configuration);if(ai!==undefined){metadata.ai=Object.fromEntries(Object.entries(ai).filter(([key,value])=>['model','provider','thinking'].includes(key)&&(value===null||typeof value==='string')||key==='context'&&['none','current'].includes(value as string)||key==='tools'&&['none','read','write'].includes(value as string)));}metadata.settings=settings;if(root)metadata.main=root.path;delete metadata.engine;
 const text=JSON.stringify(metadata,null,2)+'\n';management??=await project.directory.getDirectoryHandle('.paperdesk',{create:true});handle??=await management.getFileHandle('project.json',{create:true});
 const stream=await handle.createWritable();try{await stream.write(text);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
 let ignoreFile=ignoreKnown;
 if(updateIgnore){const ignoreText=ignoreRaw+(ignoreRaw.endsWith('\n')||!ignoreRaw?'':'\n')+'\n# Share project settings; keep machine bindings and caches private\n'+ignoreRules+'\n';ignoreHandle??=await project.directory.getFileHandle('.gitignore',{create:true});const writable=await ignoreHandle.createWritable();try{await writable.write(ignoreText);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw Error('项目配置已写入，但 Git 忽略规则更新失败，请重新打开项目检查：'+(error as Error).message);}ignoreFile={id:'.gitignore',path:'.gitignore',kind:'text',text:ignoreText,saved:ignoreText,handle:ignoreHandle};}
 // Legacy files remain an untouched backup, including unknown fields. New configuration is authoritative.
 const file={id:projectConfigPath,path:projectConfigPath,kind:'text' as const,text,saved:text,handle};
 return {...project,settings,engine:settings.overrides.engine,rootId:root?.id??project.rootId,files:[...project.files.filter(existing=>existing.path!==projectConfigPath&&existing.path!=='.gitignore'),file,...(ignoreFile?[ignoreFile]:[])]};
}
