import {useState} from 'react';
import {ChevronRight,ChevronsDownUp,ChevronsUpDown} from 'lucide-react';
import type {OutlineNode} from '@/lib/paperOutline';
import type {SourceLocation} from '@/lib/paperSources';
export function PaperOutline({nodes,warnings,onLocate}:{nodes:OutlineNode[];warnings:string[];onLocate:(location:SourceLocation,title:string)=>void}) {
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 const [selected,setSelected]=useState('');
 function all(items:OutlineNode[]):string[]{return items.flatMap(node=>[node.id,...all(node.children)]);}
 function render(items:OutlineNode[],depth=0){return items.map(node=>{
  const open=expanded.has(node.id),active=selected===node.id;
  return <li key={node.id}>
   <div className={`group flex items-start rounded-md transition-colors ${active?'bg-primary/10 text-primary':'text-foreground/80 hover:bg-secondary/70'}`}>
    {node.children.length?<button aria-label={`${open?'折叠':'展开'} ${node.number} ${node.title}`} aria-expanded={open} className="mt-1.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-primary" onClick={()=>setExpanded(current=>{const next=new Set(current);if(open)next.delete(node.id);else next.add(node.id);return next;})}><ChevronRight className={`h-3 w-3 transition-transform ${open?'rotate-90':''}`} /></button>:<span className="w-4 shrink-0" />}
    <button title={`${node.number ? node.number+' ' : ''}${node.title}\n${node.location.path}`} aria-current={active?'location':undefined} onClick={()=>{setSelected(node.id);onLocate(node.location,`${node.number ? node.number+' ' : ''}${node.title}`);}} className={`min-w-0 flex-1 py-2 pr-1.5 text-left text-[11.5px] leading-[1.45] ${depth===0?'font-medium':''}`}>
     {node.number&&<span className="mr-1.5 font-editor text-[10px] text-muted-foreground">{node.number}</span>}<span className="break-words">{node.title}</span>
    </button>
   </div>
   {open&&node.children.length>0&&<ul className="ml-2 border-l border-border/70 pl-1.5">{render(node.children,depth+1)}</ul>}
  </li>;
 });}
 return <nav aria-label="论文自动目录">
  <div className="mb-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground"><span title="依据常见 LaTeX 静态结构识别，不执行宏或条件分支。">论文目录 · 自动</span><div className="flex gap-1"><button title="展开全部" aria-label="展开全部章节" className="rounded p-1 hover:bg-secondary" onClick={()=>setExpanded(new Set(all(nodes)))}><ChevronsUpDown className="h-3 w-3" /></button><button title="折叠全部" aria-label="折叠全部章节" className="rounded p-1 hover:bg-secondary" onClick={()=>setExpanded(new Set())}><ChevronsDownUp className="h-3 w-3" /></button></div></div>
  {nodes.length?<ul className="space-y-0.5">{render(nodes)}</ul>:<p className="px-2 py-4 text-xs text-muted-foreground">正文中尚未识别到章节。</p>}
  {!!warnings.length&&<details className="mt-3 px-2 text-[10px] text-amber-300"><summary>有 {warnings.length} 个结构提示</summary>{warnings.map(w=><p key={w} className="mt-1 break-words">{w}</p>)}</details>}
 </nav>;
}
