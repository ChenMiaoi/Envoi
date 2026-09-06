import {useCallback,useEffect,useRef,useState} from 'react';
import {translate} from '@/i18n/runtime';
import {useT} from '@/i18n/useT';
import {GitBranch,RefreshCw} from 'lucide-react';
import {useProject} from './context';
import {gitPath,rememberGitPath} from '@/lib/gitBinding';
import {localGitRuntime,localGitStatus,type GitStatus} from '@/lib/localGit';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export function GitStatusPanel(){
 const {t}=useT();
 const {project}=useProject();const [open,setOpen]=useState(false),[status,setStatus]=useState<GitStatus|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const identity=useRef(project.id);identity.current=project.id;
 const refresh=useCallback(async()=>{
  const id=project.id;setBusy(true);setStatus(null);
  try{
   if(!project.directory){setMessage(translate('git.snapshotUnbound'));return;}
   const runtime=await localGitRuntime();if(identity.current!==id)return;if(!runtime.available){setMessage(runtime.error!);return;}
   const bound=await gitPath(project.directory);if(identity.current!==id)return;if(!bound){setMessage(translate('git.toolNotConnected'));return;}
   const result=await localGitStatus(project.directory,bound);if(identity.current!==id)return;
   await rememberGitPath(project.directory,bound);
   setStatus(result);setMessage(result.state==='not-initialized'?translate('git.notInitializedHint'):translate('git.diskOnly'));
  }catch(error){if(identity.current===id)setMessage((error as Error).message);}finally{if(identity.current===id)setBusy(false);}
 },[project.id,project.directory]);
 const savedRevision=project.files.map(file=>file.saved??'').join('\u0000');
 useEffect(()=>{void refresh();},[refresh,savedRevision]);
 useEffect(()=>{const listener=()=>void refresh();window.addEventListener('envoi:connection-updated',listener);return()=>window.removeEventListener('envoi:connection-updated',listener);},[refresh]);
 useEffect(()=>{const listener=()=>{setOpen(true);void refresh();};window.addEventListener('envoi:show-git',listener);return()=>window.removeEventListener('envoi:show-git',listener);},[refresh]);
 const branch=status?.state==='not-initialized'?t('git.notInitialized'):status?.state==='ready'?(status.detached?t('git.detachedBranch',{branch:status.branch ?? ''}):status.branch):busy?t('git.detecting'):t('git.notConnected');
 const shown=message||t('git.statusUnread');
 return <><button className="flex items-center gap-1 text-primary hover:text-primary/80" title={shown} onClick={()=>setOpen(true)}><GitBranch className="h-3 w-3" />{branch}</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{t('command.git')}{status?.branch?` · ${status.branch}`:''}</DialogTitle><DialogDescription>{t('git.readonlyDesc',{name:project.name})}</DialogDescription></DialogHeader>
 <div className="flex items-center justify-between gap-3"><p role="status" className="text-xs text-muted-foreground">{shown}</p><button disabled={busy} aria-label={t('git.refreshAria')} onClick={()=>void refresh()} className="rounded border border-border p-2"><RefreshCw className={`h-3.5 w-3.5 ${busy?'animate-spin':''}`} /></button></div>
 {!status&&project.directory&&<button className="text-left text-xs text-primary" onClick={()=>{setOpen(false);window.dispatchEvent(new Event('envoi:connect-project'));}}>{t('git.completeConnection')}</button>}
 {status?.state==='ready'&&<div className="max-h-80 overflow-auto rounded border border-border">{!status.files.length?<p className="p-5 text-center text-xs text-muted-foreground">{t('git.clean')}</p>:status.files.map((file,index)=><div key={`${file.path}:${index}`} className="flex items-start gap-3 border-b border-border/50 px-3 py-2 text-xs last:border-0"><span className="min-w-16 shrink-0 text-muted-foreground">{file.conflict?t('git.conflict'):file.untracked?t('git.untracked'):`${file.index!==' '?t('git.staged'):''}${file.worktree!==' '?t('git.worktreeModified'):''}`}</span><span className="min-w-0 break-all">{file.originalPath?`${file.originalPath} → `:''}{file.path}</span><code className="ml-auto whitespace-pre text-[10px] text-muted-foreground">{file.index}{file.worktree}</code></div>)}</div>}
 </DialogContent></Dialog></>;
}
