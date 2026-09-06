import {useEffect,useState,useMemo} from 'react';
import {verifyPreview} from '@/lib/pdfSync';
import { CompileControls } from './CompileControls';
import { projectSignature } from '@/lib/compileClient';
import { paperPdf } from '@/lib/paperPdf';
import { TexCompilePreview } from '@/components/TexCompilePreview';
import { useProject } from './context';
export function ProjectPdfPreview({target}:{target?:{title:string;id:number}}) {
 const {project}=useProject();const active=useMemo(()=>paperPdf(project),[project]);
 const [verification,setVerification]=useState<{project:typeof project;ok:boolean}|null>(null);
 useEffect(()=>{let live=true;if(active)void verifyPreview(project,active).then(ok=>{if(live)setVerification({project,ok});});return()=>{live=false;};},[project,active]);
 const syncReady=!active?false:verification?.project===project?verification.ok:null;
 return <div className="flex h-full min-h-0 flex-col">
  <CompileControls hasPdf={!!active} />
  {active?.id==='compiled'&&project.compiled&&project.compiled.signature!==projectSignature(project)&&<p className="shrink-0 bg-card px-3 py-1 text-[10px] text-amber-300">正文已有更新，显示上次成功编译结果。</p>}
  <div className="min-h-0 flex-1"><TexCompilePreview paperOnly target={target} syncReady={syncReady} key={`${project.rootId}:${active?.id??'empty'}:${active?.file?.lastModified??0}:${active?.url??''}`} initialSource={{name:active?.path??'',file:active?.file,url:active?.url}} /></div>
 </div>;
}
