import {useSettings} from "@/settings/useSettings";
import {parseDiagnostics,safeDiagnosticText} from '@/lib/diagnostics';
import { useEffect, useRef, useState } from 'react';
import { compileProject, projectSignature } from '@/lib/compileClient';
import { previewManifest } from '@/lib/pdfSync';
import { persistBuild,persistDiagnostics } from '@/lib/projectFiles';
import { useProject } from './context';
export function CompileControls({hasPdf = false}:{hasPdf?:boolean}) {
 const {project,setProject,busy,setBusy} = useProject();
 const {effective,configuration,save}=useSettings();const engine=effective.engine;
 const [running,setRunning] = useState(false);
 const [open,setOpen] = useState(false);
 const request = useRef<AbortController | null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 const run = async()=>{
  if(running||busy)return;
  const controller=new AbortController();request.current=controller;setRunning(true);setBusy(true);
  const signature=projectSignature(project),id=project.id;
  setProject(current=>({...current,compileStatus:'正在编译…',compileLog:'正在将当前编辑内容作为临时快照编译，不自动保存源文件。'}));
  try {
   const result=await compileProject(project,engine,controller.signal);
   const diagnostics={items:parseDiagnostics(result.ok?result.log:`${result.error}\n${result.log}`,project.files,!result.ok),signature,rootId:project.rootId,status:result.ok?'success' as const:'failed' as const,log:result.ok?result.log:`${result.error}\n${result.log}`,engine,timestamp:Date.now()};
   let diagnosticSaveWarning="";
   if(project.directory)await persistDiagnostics(project.directory,diagnostics).catch(()=>{diagnosticSaveWarning=" · 诊断仅保留浏览器缓存（磁盘写入失败）";});
   let successStatus='编译成功 · 仅浏览器缓存，未写入论文目录';
   if(result.ok && project.directory){try{await persistBuild(project.directory,result.file,result.log,JSON.stringify(await previewManifest(project,result.file)),result.synctex);successStatus='编译成功 · 已保存当前项目 build/main.pdf';}catch(error){successStatus=`编译成功 · 产物未完整保存：${(error as Error).message}`;}}
   setProject(current=>current.id!==id?current:result.ok?{...current,diagnostics,compiled:{file:result.file,signature,synctex:result.synctex},compileStatus:successStatus+diagnosticSaveWarning,compileLog:result.log}:{...current,diagnostics,compileStatus:'编译失败 · 预览未更新'+diagnosticSaveWarning,compileLog:`${result.error}\n${result.log}`});
  }catch(error){setProject(current=>current.id!==id?current:{...current,diagnostics:controller.signal.aborted&&current.diagnostics?current.diagnostics:{items:controller.signal.aborted?[]:parseDiagnostics((error as Error).message,project.files,true),signature,rootId:project.rootId,status:controller.signal.aborted?'cancelled':'failed',log:(error as Error).message},compileStatus:controller.signal.aborted?'编译已取消':'编译失败 · 预览未更新',compileLog:(error as Error).message});}
  finally{setBusy(false);setRunning(false);request.current=null;}
 };
 useEffect(()=>{const compile=()=>{void run();};window.addEventListener('envoi:compile',compile);return()=>window.removeEventListener('envoi:compile',compile);});
 return <div className="shrink-0 border-b border-border bg-card text-[11px]">
  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
   <button className="text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={()=>setOpen(!open)}>{project.compileStatus ?? (hasPdf ? '已有论文 PDF · 编译日志' : '等待首次编译')} {open?'▴':'▾'}</button>
   <div className="flex gap-2"><select aria-label="LaTeX 编译器" className="bg-card" value={engine} disabled={running||!project.rootId} onChange={event=>{const engine=event.target.value as 'pdflatex'|'xelatex';if(project.directory)void save({...configuration.overrides,engine});else setProject(current=>({...current,engine,settings:{version:1,overrides:{...configuration.overrides,engine}}}));}}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option></select>
    {running?<button onClick={()=>request.current?.abort()} className="rounded border border-border px-2 py-1">取消编译</button>:<button disabled={busy||!project.rootId} className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40" onClick={()=>void run()}>编译当前正文</button>}
   </div>
  </div>
  {open&&<pre className="scrollbar-thin max-h-36 overflow-auto whitespace-pre-wrap break-all border-t border-border p-3 text-[10px] text-muted-foreground">{project.compileLog ? safeDiagnosticText(project.compileLog) : '主文件在项目设置 → 编译中选择，默认 main.tex。编译使用当前编辑快照；产物写入当前论文 build，源文件需从项目菜单另行保存。'}</pre>}
 </div>;
}
