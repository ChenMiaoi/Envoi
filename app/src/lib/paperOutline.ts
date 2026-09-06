import {maskLatex} from './citations';
import {normalizePath,type SourceFile,type SourceLocation} from './paperSources';
export interface OutlineNode {id:string;title:string;number:string;level:number;kind:'heading'|'abstract'|'references';location:SourceLocation;children:OutlineNode[]}
function group(text:string,start:number,open='{',close='}') {
 while(/\s/.test(text[start]??'')&&start<text.length)start++;
 if(text[start]!==open)return null;
 let depth=1,index=start+1;
 for(;index<text.length;index++){if(text[index]==='\\'){index++;continue;}if(text[index]===open)depth++;if(text[index]===close&&!--depth)return {value:text.slice(start+1,index),start,end:index+1};}
 return null;
}
export function outlineTitle(value:string):string {
 return value.replace(/(?<!\\)%[^\n]*/g,'').replace(/\\(?:texorpdfstring|href)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,'$2')
 .replace(/\\(?:label|cite\w*|ref|footnote)\s*\{[^{}]*\}/g,'')
 .replace(/\\(LaTeX|TeX|BibTeX)\b/g,'$1').replace(/\\(?:textbackslash)\b/g,'')
 .replace(/\\([%&#_$])/g,'$1').replace(/\\(?:alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|tau|phi|omega)\b/g,m=>({alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',sigma:'σ',tau:'τ',phi:'φ',omega:'ω'}[m.slice(1)]!))
 .replace(/\\[a-zA-Z]+\*?/g,'').replace(/\\['"`^~=.]\s*/g,'').replace(/[{}$]/g,'').replace(/~/g,' ').replace(/\\+/g,' ').replace(/\s+/g,' ').trim();
}
export function buildOutline(files:SourceFile[],rootId:string) {
 const root=files.find(file=>file.id===rootId), nodes:OutlineNode[]=[],stack:OutlineNode[]=[],warnings:string[]=[];
 const counts=[0,0,0,0];let appendix=false,serial=0,ended=false;
 const chapterMode=!!root&&/\\documentclass(?:\[[^\]]*\])?\s*\{(?:book|report|memoir|scrbook|scrreprt)\}/.test(maskLatex(root.text));
 let depthLimit=chapterMode?2:3;
 const sectionIndex:Record<string,number>={chapter:0,section:1,subsection:2,subsubsection:3};
 const alphabet=(n:number):string=>n>26?alphabet(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
 function add(file:SourceFile,start:number,end:number,title:string,kind:OutlineNode['kind'],index=1,star=false) {
  let number='';const level=kind==='heading'?index-(chapterMode?0:1):-1;
  if(kind==='heading'&&!star&&index<=depthLimit){counts[index]++;for(let i=index+1;i<4;i++)counts[i]=0;
   const from=chapterMode?0:1;number=counts.slice(from,index+1).map((n,i)=>appendix&&i===0?alphabet(n):String(n)).join('.');}
  const node:OutlineNode={id:`${file.id}:${start}:${serial++}`,title:title||'Untitled section',number,level,kind,location:{fileId:file.id,path:file.path,start,end},children:[]};
  if(kind!=='heading'){nodes.push(node);stack.length=0;return;}
  while(stack.length&&stack[stack.length-1].level>=level)stack.pop();
  if(stack.length)stack[stack.length-1].children.push(node);else nodes.push(node);stack.push(node);
 }
 function visit(file:SourceFile,ancestors:Set<string>) {
  if(ancestors.has(file.id)){warnings.push(`循环引用：${file.path}`);return;}
  const branch=new Set(ancestors).add(file.id),text=maskLatex(file.text);
  const commands=/\\(chapter|section|subsection|subsubsection|input|include|appendix|begin|end|bibliography|printbibliography|setcounter|newcommand|renewcommand|providecommand|DeclareRobustCommand)\b(\*)?/g;
  for(let match=commands.exec(text);match&&!ended;match=commands.exec(text)) {
   const command=match[1],start=match.index;let cursor=commands.lastIndex;
   if(command==='appendix'){appendix=true;counts.fill(0);stack.length=0;continue;}
   if(/^(newcommand|renewcommand|providecommand|DeclareRobustCommand)$/.test(command)){
    const name=group(text,cursor);if(name)cursor=name.end;else {const macro=/^\s*\\[a-zA-Z]+/.exec(text.slice(cursor));if(macro)cursor+=macro[0].length;}
    let opt=group(text,cursor,'[',']');while(opt){cursor=opt.end;opt=group(text,cursor,'[',']');}const body=group(text,cursor);if(body)commands.lastIndex=body.end;continue;
   }
   const optional=group(text,cursor,'[',']');if(optional)cursor=optional.end;
   const arg=group(text,cursor);if(arg)commands.lastIndex=arg.end;
   if(command==='end'&&arg?.value==='document'){ended=true;break;}
   if(command==='setcounter'&&arg){const value=group(text,arg.end);if(value){commands.lastIndex=value.end;const n=Number(value.value);if(Number.isInteger(n)){if(arg.value==='secnumdepth')depthLimit=n;else if(arg.value in sectionIndex)counts[sectionIndex[arg.value]]=n;}}continue;}
   if(command==='input'||command==='include') {
    const bare=!arg?/^\s*([^\s{}%]+)/.exec(text.slice(cursor)):null;const name=(arg?.value??bare?.[1]??'').trim();if(!name||/[\\#]/.test(name)){warnings.push(`未解析动态引用：${file.path}`);continue;}
    const target=name.replace(/\.tex$/,'')+'.tex';const candidates=[normalizePath((root?.path.replace(/[^/]+$/,'')??'')+target),normalizePath(file.path.replace(/[^/]+$/,'')+target)];
    const child=candidates.map(path=>files.find(f=>f.path===path)).find(Boolean);if(child)visit(child,branch);else warnings.push(`缺失文件：${name}`);continue;
   }
   if(command in sectionIndex && arg){const raw=file.text.slice(arg.start+1,arg.end-1);add(file,start,arg.end,outlineTitle(raw),'heading',sectionIndex[command],!!match[2]);}
   if(command==='begin'&&arg?.value==='abstract')add(file,start,arg.end,'Abstract','abstract');
   if(command==='bibliography'||command==='printbibliography'||command==='begin'&&arg?.value==='thebibliography')add(file,start,arg?.end??cursor,'References','references');
  }
 }
 if(root)visit(root,new Set());
 return {nodes,warnings:[...new Set(warnings)]};
}
