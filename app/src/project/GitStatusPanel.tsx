import {useCallback,useEffect,useRef,useState} from 'react';
import {GitBranch,RefreshCw} from 'lucide-react';
import {useProject} from './context';
import {gitPath,rememberGitPath} from '@/lib/gitBinding';
import {localGitRuntime,localGitStatus,type GitStatus} from '@/lib/localGit';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export function GitStatusPanel(){
 const {project}=useProject();const [open,setOpen]=useState(false),[status,setStatus]=useState<GitStatus|null>(null),[message,setMessage]=useState('Git 状态未读取'),[busy,setBusy]=useState(false);
 const identity=useRef(project.id);identity.current=project.id;
 const refresh=useCallback(async()=>{
  const id=project.id;setBusy(true);setStatus(null);
  try{
   if(!project.directory){setMessage('内置快照未绑定真实目录；请打开本地项目。');return;}
   const runtime=await localGitRuntime();if(identity.current!==id)return;if(!runtime.available){setMessage(runtime.error!);return;}
   const bound=await gitPath(project.directory);if(identity.current!==id)return;if(!bound){setMessage('已授权目录；本地工具路径尚未连接，可在项目菜单完善一次项目连接。');return;}
   const result=await localGitStatus(project.directory,bound);if(identity.current!==id)return;
   await rememberGitPath(project.directory,bound);
   setStatus(result);setMessage(result.state==='not-initialized'?'此项目尚未初始化 Git 仓库。':'状态来自本地磁盘；编辑器未保存内容不计入 Git 状态。');
  }catch(error){if(identity.current===id)setMessage((error as Error).message);}finally{if(identity.current===id)setBusy(false);}
 },[project.id,project.directory]);
 const savedRevision=project.files.map(file=>file.saved??'').join('\u0000');
 useEffect(()=>{void refresh();},[refresh,savedRevision]);
 useEffect(()=>{const listener=()=>void refresh();window.addEventListener('envoi:connection-updated',listener);return()=>window.removeEventListener('envoi:connection-updated',listener);},[refresh]);
 useEffect(()=>{const listener=()=>{setOpen(true);void refresh();};window.addEventListener('envoi:show-git',listener);return()=>window.removeEventListener('envoi:show-git',listener);},[refresh]);
 const branch=status?.state==='not-initialized'?'Git 未初始化':status?.state==='ready'?(status.detached?'分离 HEAD · ':'')+status.branch:busy?'Git 检测中':'Git 未连接';
 return <><button className="flex items-center gap-1 text-primary hover:text-primary/80" title={message} onClick={()=>setOpen(true)}><GitBranch className="h-3 w-3" />{branch}</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Git 状态{status?.branch?` · ${status.branch}`:''}</DialogTitle><DialogDescription>{project.name} · 只读状态，不提交或暂存文件</DialogDescription></DialogHeader>
 <div className="flex items-center justify-between gap-3"><p role="status" className="text-xs text-muted-foreground">{message}</p><button disabled={busy} aria-label="刷新 Git 状态" onClick={()=>void refresh()} className="rounded border border-border p-2"><RefreshCw className={`h-3.5 w-3.5 ${busy?'animate-spin':''}`} /></button></div>
 {!status&&project.directory&&<button className="text-left text-xs text-primary" onClick={()=>{setOpen(false);window.dispatchEvent(new Event('envoi:connect-project'));}}>在项目菜单完善本地连接…</button>}
 {status?.state==='ready'&&<div className="max-h-80 overflow-auto rounded border border-border">{!status.files.length?<p className="p-5 text-center text-xs text-muted-foreground">工作区干净，没有待提交的磁盘更改。</p>:status.files.map((file,index)=><div key={`${file.path}:${index}`} className="flex items-start gap-3 border-b border-border/50 px-3 py-2 text-xs last:border-0"><span className="min-w-16 shrink-0 text-muted-foreground">{file.conflict?'冲突':file.untracked?'未跟踪':`${file.index!==' '?'已暂存 ':''}${file.worktree!==' '?'工作区修改':''}`}</span><span className="min-w-0 break-all">{file.originalPath?`${file.originalPath} → `:''}{file.path}</span><code className="ml-auto whitespace-pre text-[10px] text-muted-foreground">{file.index}{file.worktree}</code></div>)}</div>}
 </DialogContent></Dialog></>;
}
