import {useSettings} from "@/settings/useSettings";
import {useEffect} from 'react';
import {useProject} from './context';
export function useEditorLint(fileId:string|undefined,path:string|undefined,text:string){
 const {effective}=useSettings();const enabled=effective.lintEnabled;const rules=JSON.stringify(effective.disabledRules);
 const {project,setProject}=useProject();const projectId=project.id;
 useEffect(()=>{
  if(!fileId||!path?.endsWith('.tex'))return;
  const controller=new AbortController();let active=true;
  const timer=setTimeout(()=>void(async()=>{
   if(!enabled){if(active)setProject(current=>current.id===projectId?{...current,lint:{fileId,text,status:'disabled',items:[]}}:current);return;}
   setProject(current=>current.id===projectId?{...current,lint:{fileId,text,status:'checking',items:[]}}:current);
   try{const runtimeResponse=await fetch('/api/paperdesk/compiler',{signal:controller.signal});if(!runtimeResponse.headers.get('content-type')?.includes('application/json'))throw Error('本地检查服务未连接');const runtime=await runtimeResponse.json();
    const response=await fetch('/api/paperdesk/lint',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-PaperDesk-Token':runtime.token},body:JSON.stringify({path,text,disabledRules:JSON.parse(rules)})});const result=await response.json();if(!response.ok||!result.available)throw Error(result.error??'实时检查不可用');
    if(active)setProject(current=>current.id===projectId?{...current,lint:{fileId,text,status:'ready',items:result.items.map((item:object)=>({...item,source:'lint'}))}}:current);
   }catch(error){if(active&&!controller.signal.aborted)setProject(current=>current.id===projectId?{...current,lint:{fileId,text,status:'unavailable',items:[],message:(error as Error).message}}:current);}
  })(),700);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[fileId,path,text,projectId,setProject,enabled,rules]);
}
