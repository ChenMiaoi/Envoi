import {useState} from 'react';
import {CircleAlert,TriangleAlert} from 'lucide-react';
import {useProject} from './context';
import {projectSignature} from '@/lib/compileClient';
import {diagnosticLocation,safeDiagnosticText,parseDiagnostics} from '@/lib/diagnostics';
import type {SourceLocation} from '@/lib/paperSources';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export type ProblemTarget=SourceLocation&{severity:'error'|'warning';id:number};
export function ProblemsPanel({onNavigate}:{onNavigate:(target:ProblemTarget)=>void}){
 const {project}=useProject();const [open,setOpen]=useState(false),[logOpen,setLogOpen]=useState(false);
 const diagnostics=project.diagnostics?.rootId===project.rootId?project.diagnostics:undefined;
 const compiledItems=(diagnostics?parseDiagnostics(diagnostics.log,project.files,diagnostics.status==='failed'):[]).map(item=>({...item,source:'compile' as const}));
 const lint=project.lint;const lintCurrent=lint&&project.files.find(file=>file.id===lint.fileId)?.text===lint.text;
 const lintItems=lintCurrent?lint.items.filter(item=>!compiledItems.some(other=>other.path===item.path&&other.line===item.line&&other.message===item.message)):[];
 const items=[...compiledItems,...lintItems],errors=items.filter(i=>i.severity==='error').length,warnings=items.length-errors;
 const stale=diagnostics&&diagnostics.signature!==projectSignature(project);
 const label=project.compileStatus?.startsWith('正在编译')?'正在编译 · 显示上次诊断':project.compileStatus?.includes('已取消')||project.compileStatus?.includes('已中断')?'编译已取消或中断 · 保留上次结果':!diagnostics?'尚未编译此论文':diagnostics.status==='running'?'正在编译 · 显示上次诊断':diagnostics.status==='cancelled'?'编译已取消':diagnostics.status==='failed'?'上次编译失败':'上次编译完成';
 const groups=new Map<string,typeof items>();for(const item of items){const key=item.path??'全局 / 编译工具';groups.set(key,[...(groups.get(key)??[]),item]);}
 return <><button className="flex items-center gap-1 hover:text-foreground" aria-label="打开编译问题列表" title={label} onClick={()=>setOpen(true)}><CircleAlert className={`h-3 w-3 ${errors?'text-red-400':''}`} />{diagnostics||lint?errors:'—'}<TriangleAlert className={`ml-1 h-3 w-3 ${warnings?'text-amber-300':''}`} />{diagnostics||lint?warnings:'—'}</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>论文编译问题</DialogTitle><DialogDescription>{label}{stale?' · 正文已更新，诊断已过期':''}。编译结果覆盖主论文；ChkTeX 只检查当前编辑文件。</DialogDescription></DialogHeader>
 {diagnostics?.timestamp&&<p className="text-[10px] text-muted-foreground">{diagnostics.engine} · {new Date(diagnostics.timestamp).toLocaleString()} · 已保留上次编译记录</p>}
 {lint&&<p className="text-xs text-muted-foreground">实时检查 · {lint.status==='disabled'?'已在设置中关闭':lint.status==='checking'?'ChkTeX 检查中':lint.status==='unavailable'?lint.message:lintCurrent?'ChkTeX 已检查当前文件':'等待编辑停顿后更新'}</p>}
 <div className="max-h-[55vh] overflow-auto">{!items.length?<p className="p-5 text-center text-xs text-muted-foreground">{!diagnostics?'编译当前论文后，这里显示真实错误和警告。':diagnostics.status==='cancelled'?'编译已取消，没有本次完整诊断。':'没有已解析的错误或警告。'}</p>:[...groups].map(([path,entries])=><section key={path} className="mb-3"><h3 className="mb-1 break-all text-xs font-medium text-muted-foreground">{path}</h3>{entries.map(item=><button key={item.id} className="flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={()=>{const location=(!stale||item.source==='lint')?diagnosticLocation(item,project.files):undefined;if(location){setOpen(false);onNavigate({...location,id:Date.now()});}else setLogOpen(true);}}>{item.severity==='error'?<CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />:<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />}<span className="min-w-0 break-words"><span className="mr-1 text-[10px] text-muted-foreground">{item.source==='lint'?'ChkTeX':'编译'}</span>{item.message}<span className="mt-1 block text-[10px] text-muted-foreground">{item.line?`第 ${item.line} 行`:'无可靠源码位置 · 查看日志'}{stale&&item.source!=='lint'?' · 过期诊断仅查看日志':''}</span></span></button>)}</section>)}</div>
 {diagnostics&&<button onClick={()=>setLogOpen(!logOpen)} className="text-left text-xs text-primary">{logOpen?'收起':'查看'}本次日志</button>}
 {logOpen&&diagnostics&&<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-[10px] text-muted-foreground">{safeDiagnosticText(diagnostics.log)}</pre>}
 </DialogContent></Dialog></>;
}
