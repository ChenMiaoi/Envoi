import {createProjectSaver} from "@/lib/projectSaver";
import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import {assertCanClose} from "@/lib/projectManagement";
import {initialProject,emptyProject} from '@/lib/initialProject';
import { dirtyFiles, type PaperProject } from '@/lib/projectFiles';
import {restoreSession,saveSession} from '@/lib/projectSession';
import { ProjectContext } from './context';
import {useT} from "@/i18n/useT";
export function ProjectProvider({ children }: { children: ReactNode }) {
  const {t}=useT();
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
  const closeProject=useCallback(async(discard=false)=>{const current=latest.current;assertCanClose(current,busy,saving,discard);setBusy(true);try{const empty=emptyProject();await saveSession(empty);if(latest.current!==current){await saveSession(latest.current);throw Error(t('project.errorCloseChanged'));}if(import.meta.hot)import.meta.hot.data.project=empty;setProject(empty);setMessage(t('project.closed'));}finally{setBusy(false);}},[busy,saving,setProject,t]);
  useEffect(()=>{const save=()=>{void saveAll();};window.addEventListener('envoi:save',save);return()=>window.removeEventListener('envoi:save',save);},[saveAll]);
  useEffect(() => {
    if(restored)return;
    let active=true;
    void restoreSession().then(result=>{if(!active)return;if(result.project)setProject(result.project);if(result.recoverable)setRecoverable(result.recoverable);if(result.warning)setMessage(result.warning);setRestored(true);}).catch(error=>{if(active){setMessage(t('project.restoreUnavailable',{error:error.message}));setRestored(true);}});
    return ()=>{active=false;};
  },[restored,setProject,t]);
  useEffect(()=>{
    if(!restored)return;
    if(import.meta.hot)import.meta.hot.data.project=project;
    if(project.id==='empty')return;
    void saveSession(project).catch(()=>setMessage(t('project.recoverySaveFailed')));
  },[project,restored,t]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyFiles(project).length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [project]);
  if(!restored)return <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">{t('project.restoring')}</div>;
  return <ProjectContext.Provider value={{ closeProject,saveAll,saving,message, setMessage, project, setProject, busy, setBusy, edit: (id, text) => setProject((current) => ({ ...current, files: current.files.map((file) => file.id === id ? { ...file, text } : file) })) }}>{recoverable&&<div className="fixed bottom-9 right-3 z-50 flex max-w-lg items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-lg"><span>{t('project.recoverableFound')}</span><button disabled={busy||saving||dirtyFiles(project).length>0} title={t('project.recoverableTitle')} className="text-primary disabled:opacity-40" onClick={()=>{setProject({...recoverable,id:'recovered:'+recoverable.id,name:t('project.recoveredDraftName')});setRecoverable(undefined);}}>{t('project.recoverOldSession')}</button></div>}{children}</ProjectContext.Provider>;
}
