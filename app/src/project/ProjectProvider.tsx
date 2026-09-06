import {createProjectSaver} from "@/lib/projectSaver";
import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import {assertCanClose} from "@/lib/projectManagement";
import {initialProject,emptyProject} from '@/lib/initialProject';
import { dirtyFiles, type PaperProject } from '@/lib/projectFiles';
import {restoreSession,saveSession} from '@/lib/projectSession';
import { ProjectContext } from './context';
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<PaperProject>(()=>initialProject(import.meta.hot?.data.project));
  const latest=useRef(project);
  const setProject=useCallback<React.Dispatch<React.SetStateAction<PaperProject>>>((action)=>{const next=typeof action==='function'?action(latest.current):action;latest.current=next;setProjectState(next);},[]);
  const [saving,setSaving]=useState(false);
  const [recoverable,setRecoverable]=useState<PaperProject|undefined>();
  const [restored,setRestored] = useState(!!import.meta.hot?.data.project&&import.meta.hot.data.project.id!=='demo');
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(()=>{const listener=(event:Event)=>setMessage((event as CustomEvent<string>).detail);window.addEventListener('envoi:storage-warning',listener);return()=>window.removeEventListener('envoi:storage-warning',listener);},[]);
  // createProjectSaver stores this getter; it reads the ref only when a save is requested.
  const saveAll=useMemo(()=>createProjectSaver({getProject:()=>latest.current,setProject,message:setMessage,saving:setSaving}),[setProject]);
  const closeProject=useCallback(async(discard=false)=>{const current=latest.current;assertCanClose(current,busy,saving,discard);setBusy(true);try{const empty=emptyProject();await saveSession(empty);if(latest.current!==current){await saveSession(latest.current);throw Error('项目在关闭过程中发生变化，未关闭。');}if(import.meta.hot)import.meta.hot.data.project=empty;setProject(empty);setMessage('项目已关闭；磁盘文件与最近记录保留。');}finally{setBusy(false);}},[busy,saving,setProject]);
  useEffect(()=>{const save=()=>{void saveAll();};window.addEventListener('envoi:save',save);return()=>window.removeEventListener('envoi:save',save);},[saveAll]);
  useEffect(() => {
    if(restored)return;
    let active=true;
    void restoreSession().then(result=>{if(!active)return;if(result.project)setProject(result.project);if(result.recoverable)setRecoverable(result.recoverable);if(result.warning)setMessage(result.warning);setRestored(true);}).catch(error=>{if(active){setMessage(`项目恢复存储不可用：${error.message}`);setRestored(true);}});
    return ()=>{active=false;};
  },[restored,setProject]);
  useEffect(()=>{
    if(!restored)return;
    if(import.meta.hot)import.meta.hot.data.project=project;
    if(project.id==='empty')return;
    void saveSession(project).catch(()=>setMessage('恢复数据保存失败；草稿保留在当前窗口与可用备份中，请保存源文件后重试。'));
  },[project,restored]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyFiles(project).length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [project]);
  if(!restored)return <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">正在恢复上次项目…</div>;
  return <ProjectContext.Provider value={{ closeProject,saveAll,saving,message, setMessage, project, setProject, busy, setBusy, edit: (id, text) => setProject((current) => ({ ...current, files: current.files.map((file) => file.id === id ? { ...file, text } : file) })) }}>{recoverable&&<div className="fixed bottom-9 right-3 z-50 flex max-w-lg items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-lg"><span>发现另一个保留的恢复版本，未自动覆盖当前项目。</span><button disabled={busy||saving||dirtyFiles(project).length>0} title="当前项目有未保存编辑时，请先保存" className="text-primary disabled:opacity-40" onClick={()=>{setProject({...recoverable,id:'recovered:'+recoverable.id,name:'已恢复的未连接草稿'});setRecoverable(undefined);}}>手动恢复旧会话</button></div>}{children}</ProjectContext.Provider>;
}
