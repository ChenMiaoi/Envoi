import {projectSignature} from '../src/lib/compileClient';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOutline,outlineTitle,type OutlineNode} from '../src/lib/paperOutline';
import {paperPdf} from '../src/lib/paperPdf';
import {mergeDrafts,restoreProjectCache} from '../src/lib/projectSession';
import {matchBookmark} from '../src/lib/pdfSync';
import type {PaperProject} from '../src/lib/projectFiles';
const source=(id:string,text:string)=>({id,path:id,text});
const flatten=(nodes:OutlineNode[]):OutlineNode[]=>nodes.flatMap(node=>[node,...flatten(node.children)]);
test('outline expands input in position, nests titles, links offsets and handles appendix',()=>{
 const main=source('main.tex',String.raw`\begin{abstract}Text\end{abstract}\section{Before \textbf{the {nested} title}}\input{chapters/a}\section[Short]{After}\bibliography{references}\appendix\input{chapters/b}`);
 const child=source('chapters/a.tex',String.raw`\subsection{Detail}\section*{Acknowledgments}\subsection{More}`);
 const appendix=source('chapters/b.tex',String.raw`\section{Audit}\subsection{Reproduce}`);
 const list=flatten(buildOutline([main,child,appendix],main.id).nodes);
 assert.deepEqual(list.map(n=>[n.number,n.title]),[['','Abstract'],['1','Before the nested title'],['1.1','Detail'],['','Acknowledgments'],['1.2','More'],['2','After'],['','References'],['A','Audit'],['A.1','Reproduce']]);
 const detail=list[2];assert.equal(detail.location.fileId,child.id);assert.equal(child.text.slice(detail.location.start,detail.location.end),String.raw`\subsection{Detail}`);
});
test('outline excludes comments, literals and command definitions; repeated includes and cycles are bounded',()=>{
 const a=source('main.tex',String.raw`% \section{Hidden}
\newcommand{\heading}{\section{Macro definition}}
\begin{verbatim}\section{Literal}\end{verbatim}\input{x}\input{x}\input{missing}`);
 const result=buildOutline([a,source('x.tex',String.raw`\section{Repeated}\input{main}`)],a.id);
 assert.deepEqual(result.nodes.map(n=>n.number),['1','2']);assert.notEqual(result.nodes[0].id,result.nodes[1].id);assert.equal(result.warnings.length,2);
 assert.equal(outlineTitle(String.raw`\LaTeX{} \emph{IO-aware {attention}} \& $\alpha$`),'LaTeX IO-aware attention & α');
});
test('book numbering and depth follow common static counters',()=>{
 const file=source('main.tex',String.raw`\documentclass{book}\chapter{One}\section{Two}\subsection{Three}\subsubsection{Unnumbered}\appendix\chapter{Extra}`);
 assert.deepEqual(flatten(buildOutline([file],file.id).nodes).map(n=>n.number),['1','1.1','1.1.1','','A']);
});
test('paper preview never chooses an asset PDF and follows root changes',()=>{
 const project:PaperProject={id:'p',name:'p',rootId:'main.tex',directories:[],files:[{id:'main.tex',path:'main.tex',kind:'latex'},{id:'plot',path:'assets/plot.pdf',kind:'pdf',url:'/plot.pdf'}]};
 assert.equal(paperPdf(project),undefined);project.files.push({id:'pdf',path:'build/main.pdf',kind:'pdf',url:'/main.pdf'});assert.equal(paperPdf(project)?.id,'pdf');
 project.files.push({id:'other.tex',path:'other.tex',kind:'latex'});project.rootId='other.tex';assert.equal(paperPdf(project),undefined);
});
test('restore preserves dirty draft and original external-conflict baseline',()=>{
 const fresh:PaperProject={id:'p',name:'p',rootId:'main.tex',directories:[],files:[{id:'main.tex',path:'main.tex',kind:'latex',text:'external',saved:'external'}]};
 const cached={...fresh,files:[{...fresh.files[0],text:'unsaved draft',saved:'original'}]};
 const result=mergeDrafts(fresh,cached);assert.equal(result.files[0].text,'unsaved draft');assert.equal(result.files[0].saved,'original');assert.equal(fresh.files[0].text,'external');
});
test('PDF navigation requires unique actual bookmark, never estimates page numbers',()=>{
 const items=[{title:'1 Introduction',items:[{title:'1.1 Motivation',items:[]}]}];
 assert.equal(matchBookmark(items,'1.1 Motivation')?.title,'1.1 Motivation');
 assert.equal(matchBookmark(items,'7 Unknown'),undefined);
 assert.equal(matchBookmark([...items,...items],'1 Introduction'),undefined);
});

test('missing desktop directory keeps cached drafts without switching to demo',async()=>{
 const cached:PaperProject={id:'real',name:'paper',rootId:'main.tex',directories:[],files:[{id:'main.tex',path:'main.tex',kind:'latex',text:'draft',saved:'disk'}],rootPath:'/missing-desktop-directory'};
 const result=await restoreProjectCache(cached);assert.equal(result.project.id,'real');assert.equal(result.project.files[0].text,'draft');assert.match(result.warning!,/恢复/);
});

test('build metadata changes do not mark source stale, source edits do',()=>{
 const p:PaperProject={id:'p',name:'p',rootId:'main.tex',directories:[],files:[{id:'main.tex',path:'main.tex',kind:'latex',text:'source'},{id:'build/preview.json',path:'build/preview.json',kind:'markdown',text:'old'}]};
 const signature=projectSignature(p);p.files[1].text='new output';assert.equal(projectSignature(p),signature);p.files[0].text='edited';assert.notEqual(projectSignature(p),signature);
});
