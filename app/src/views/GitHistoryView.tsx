import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {GitBranch,History,RefreshCw,Tag} from 'lucide-react';
import {useProject} from '@/project/context';
import {gitPath} from '@/lib/gitBinding';
import {localGitLog,localGitShow,type GitCommit,type GitLog,type GitShow} from '@/lib/localGit';
import {layoutGraph} from '@/lib/gitGraph';
import {cn} from '@/lib/utils';

/** 车道颜色随主题的 hue 槽位解析；SVG 表现属性支持 var() 引用。 */
const LANE_COLORS=['yellow','blue','green','red','violet','orange','cyan','pink'].map(name=>`hsl(var(--hue-${name}))`);
const ROW_H=30,LANE_W=16,PAD=8;
const cx=(lane:number)=>PAD+lane*LANE_W+LANE_W/2,cy=(row:number)=>row*ROW_H+ROW_H/2;

function RefBadge({commit}:{commit:GitCommit}){
 return <>{commit.head&&<span className="rounded-full border border-primary/50 px-1.5 text-[10px] leading-4 text-primary">HEAD</span>}
 {commit.refs.map(ref=><span key={`${ref.kind}:${ref.name}`} className={cn('flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-4',ref.kind==='branch'?'border-primary/40 text-primary':ref.kind==='tag'?'border-warning/40 text-warning':'border-border text-muted-foreground')}>
  {ref.kind==='tag'?<Tag className="h-2.5 w-2.5"/>:<GitBranch className="h-2.5 w-2.5"/>}{ref.name}
 </span>)}</>;
}

export function GitGraph({commits,selected,onSelect}:{commits:GitCommit[];selected:string|null;onSelect:(hash:string)=>void}){
 const {rows,edges,laneCount}=useMemo(()=>layoutGraph(commits),[commits]);
 const graphWidth=laneCount*LANE_W+PAD*2;
 return <div className="relative" style={{minHeight:rows.length*ROW_H}}>
  <svg aria-hidden className="absolute left-0 top-0" width={graphWidth} height={(rows.length+1)*ROW_H}>
   {edges.map((edge,index)=><path key={index} d={`M ${cx(edge.fromLane)} ${cy(edge.fromRow)} C ${cx(edge.fromLane)} ${(cy(edge.fromRow)+cy(edge.toRow))/2}, ${cx(edge.toLane)} ${(cy(edge.fromRow)+cy(edge.toRow))/2}, ${cx(edge.toLane)} ${cy(edge.toRow)}`} stroke={LANE_COLORS[edge.color%LANE_COLORS.length]} strokeWidth={1.6} fill="none"/>)}
   {rows.map(({commit,lane},row)=><circle key={commit.hash} cx={cx(lane)} cy={cy(row)} r={4} fill={commit.head?LANE_COLORS[lane%LANE_COLORS.length]:'hsl(var(--background))'} stroke={LANE_COLORS[lane%LANE_COLORS.length]} strokeWidth={2}/>)}
  </svg>
  {rows.map(({commit})=><button key={commit.hash} onClick={()=>onSelect(commit.hash)} className={cn('relative flex w-full items-center gap-2 px-2 text-left text-xs transition-colors hover:bg-secondary/60',selected===commit.hash&&'bg-accent/60')} style={{height:ROW_H,paddingLeft:graphWidth+8}}>
   <RefBadge commit={commit}/>
   <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
   <span className="shrink-0 text-muted-foreground">{commit.author} · {commit.date.slice(0,10)}</span>
   <span className="w-16 shrink-0 text-right font-editor text-muted-foreground">{commit.hash.slice(0,7)}</span>
  </button>)}
 </div>;
}

function CommitDetail({show,error,busy}:{show?:GitShow;error:string;busy:boolean}){
 if(busy)return <p className="p-4 text-xs text-muted-foreground">读取提交详情…</p>;
 if(error)return <p role="alert" className="p-4 text-xs text-warning">{error}</p>;
 if(!show)return null;
 const rest=show.commit.body.split('\n').slice(1).join('\n').trim();
 return <div className="p-4 text-xs">
  <p className="font-editor text-muted-foreground">{show.commit.hash}</p>
  <h2 className="mt-1 text-sm font-medium">{show.commit.subject}</h2>
  {rest&&<p className="mt-2 whitespace-pre-wrap text-muted-foreground">{rest}</p>}
  <p className="mt-2 text-muted-foreground">{show.commit.author} · {show.commit.date.replace('T',' ').slice(0,16)}</p>
  {show.commit.parents.length>1&&<p className="mt-2 text-muted-foreground">合并提交；改动相对第一父提交。</p>}
  <h3 className="mt-4 border-t border-border pt-3 font-medium">改动文件（{show.files.length}）</h3>
  {show.files.length===0?<p className="mt-2 text-muted-foreground">没有文件改动。</p>:
  <ul className="mt-2 space-y-1.5">{show.files.map(file=><li key={file.path} className="flex items-baseline gap-2">
   <span className="shrink-0 font-editor text-[10px]">{file.added===null?<span className="text-muted-foreground">二进制</span>:<><span className="text-success">+{file.added}</span> <span className="text-danger">−{file.deleted}</span></>}</span>
   <span className="min-w-0 truncate" title={file.path}>{file.path}</span>
  </li>)}</ul>}
 </div>;
}

export function GitHistoryView(){
 const {project}=useProject();
 const [log,setLog]=useState<GitLog|null>(null),[message,setMessage]=useState('Git 历史未读取'),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<string|null>(null);
 const [details,setDetails]=useState<Record<string,GitShow>>({});
 const [detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState('');
 const identity=useRef(project.id);identity.current=project.id;
 const refresh=useCallback(async()=>{
  const id=project.id;setBusy(true);setLog(null);setSelected(null);setDetails({});
  try{
   if(!project.directory){setMessage('内置快照未绑定真实目录；请打开本地项目查看版本历史。');return;}
   const bound=await gitPath(project.directory);if(identity.current!==id)return;if(!bound){setMessage('已授权目录；本地工具路径尚未连接，可在项目菜单完善一次项目连接。');return;}
   const result=await localGitLog(project.directory,bound);if(identity.current!==id)return;
   setLog(result);setMessage(result.state==='nested'?`此目录属于上级 Git 仓库 ${result.enclosing}，没有自己的版本历史；为项目单独初始化 Git 后可在此查看。`:result.state==='not-initialized'?'此项目尚未初始化 Git 仓库；新建项目时可启用版本管理。':result.commits.length?'':'仓库还没有提交。');
  }catch(error){if(identity.current===id)setMessage((error as Error).message);}finally{if(identity.current===id)setBusy(false);}
 },[project.id,project.directory]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{const listener=()=>void refresh();window.addEventListener('envoi:connection-updated',listener);return()=>window.removeEventListener('envoi:connection-updated',listener);},[refresh]);
 const select=useCallback(async(hash:string)=>{
  setSelected(hash);if(details[hash])return;
  const id=project.id,directory=project.directory;if(!directory)return;
  setDetailBusy(true);setDetailError('');
  try{const bound=await gitPath(directory);if(!bound)throw Error('本地连接已失效。');const show=await localGitShow(directory,bound,hash);if(identity.current!==id)return;setDetails(current=>({...current,[hash]:show}));}
  catch(error){if(identity.current===id)setDetailError((error as Error).message);}finally{if(identity.current===id)setDetailBusy(false);}
 },[project.id,project.directory,details]);
 return <div className="flex h-full flex-col bg-background">
  <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-4">
   <div className="flex items-center gap-2">
    <History className="h-4 w-4 text-muted-foreground"/><h1 className="text-sm font-medium">版本历史</h1>
    {log?.branch&&<span className="flex items-center gap-1 rounded-full border border-border px-2 text-[11px] leading-5 text-muted-foreground"><GitBranch className="h-3 w-3"/>{log.detached?'分离 HEAD · ':''}{log.branch}</span>}
    {log?.truncated&&<span className="text-[11px] text-muted-foreground">仅显示最近 500 条提交</span>}
   </div>
   <button disabled={busy} aria-label="刷新 Git 历史" onClick={()=>void refresh()} className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground"><RefreshCw className={`h-3.5 w-3.5 ${busy?'animate-spin':''}`}/></button>
  </header>
  {!log&&<div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"><p role="status" className="text-sm text-muted-foreground">{busy?'正在读取本地 Git 历史…':message}</p></div>}
  {log&&<div className="flex min-h-0 flex-1">
   <div className="min-w-0 flex-1 overflow-auto py-1">
    {message&&<p role="status" className="p-6 text-center text-sm text-muted-foreground">{message}</p>}
    {!message&&<GitGraph commits={log.commits} selected={selected} onSelect={hash=>void select(hash)}/>}
   </div>
   {selected&&<aside className="w-80 shrink-0 overflow-auto border-l border-border bg-card"><CommitDetail show={details[selected]} error={detailError} busy={detailBusy&&!details[selected]}/></aside>}
  </div>}
 </div>;
}
