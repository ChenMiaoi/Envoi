import {detectTool} from './tool-config.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
export function gitRuntime() {
 try {return {available:true,version:execFileSync(detectTool('git')??'git',['--version'],{encoding:'utf8',timeout:5000}).trim()};}
 catch {return {available:false,error:'未检测到可用的本地 Git。'};}
}
function gitRun(root){return args=>execFileSync(detectTool('git')??'git',['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});}
function gitReady(){const runtime=gitRuntime();if(!runtime.available)throw Error(runtime.error);return runtime;}
async function boundRoot({directory,proof,proofKind}) {
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof proof!=='string'||!/^\w{64}$/.test(proof))throw Error('Invalid directory binding');
 const root=await realpath(directory).catch(error=>{if(error.code==='ENOENT')throw Error('项目目录位置不存在或已移动，请在项目菜单打开新位置；这不是 Git 授权失效。');throw error;});
 const marker=path.join(root,'.envoi',proofKind==='unique'?'git-proof-'+proof:'git-proof');
 if(!(await lstat(marker)).isFile()||await realpath(marker)!==marker||await readFile(marker,'utf8')!==proof)throw Error('目录授权证明不匹配，未运行 Git。');
 return {root};
}
export async function gitInitAt(root) {
 const runtime=gitReady();
 // Never reinitialize an existing repository or silently nest inside one.
 let existing;
 try {existing=execFileSync(detectTool('git')??'git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();}catch{}
 if(existing)throw Error(`此位置已属于 Git 仓库 ${existing}，未更改已有历史；请选择独立位置或取消启用 Git。`);
 if(await lstat(path.join(root,'.git')).then(()=>true,()=>false))throw Error('已有 .git，未覆盖。');
 execFileSync(detectTool('git')??'git',['init','-b','main'],{cwd:root,encoding:'utf8',timeout:10000});
 const branch=execFileSync(detectTool('git')??'git',['symbolic-ref','--short','HEAD'],{cwd:root,encoding:'utf8',timeout:5000}).trim();
 if(branch!=='main')throw Error('Git 分支验证失败。');
 return {ok:true,branch,version:runtime.version};
}
export async function initializeBoundGit(input){return gitInitAt((await boundRoot(input)).root);}

export function parseGitStatus(output,prefix='') {
 const records=output.split('\0'),files=[];
 for(let i=0;i<records.length;i++){
  const record=records[i];if(!record)continue;const index=record[0],worktree=record[1],rawPath=record.slice(3);
  const originalPath=index==='R'||index==='C'||worktree==='R'||worktree==='C'?records[++i]:undefined;
  if(!rawPath.startsWith(prefix))continue;
  files.push({path:rawPath.slice(prefix.length),originalPath:originalPath?.startsWith(prefix)?originalPath.slice(prefix.length):undefined,index,worktree,untracked:index==='?'&&worktree==='?',conflict:index==='U'||worktree==='U'||['AA','DD'].includes(index+worktree)});
 }
 return files;
}
export async function gitStatusAt(root) {
 const runtime=gitReady(),run=gitRun(root);
 try{run(['rev-parse','--show-toplevel']);}catch{return {ok:true,state:'not-initialized',version:runtime.version,files:[]};}
 const prefix=run(['rev-parse','--show-prefix']).trim();
 let branch,detached=false;try{branch=run(['symbolic-ref','--short','HEAD']).trim();}catch{detached=true;branch=run(['rev-parse','--short','HEAD']).trim();}
 const files=parseGitStatus(run(['status','--porcelain=v1','-z','--untracked-files=all','--','.']),prefix).filter(file=>!/^\.(?:envoi|paperdesk)\/(?:git|agent)-proof(?:-|$)/.test(file.path));
 return {ok:true,state:'ready',branch,detached,files,version:runtime.version};
}
export async function readBoundGitStatus(input){return gitStatusAt((await boundRoot(input)).root);}
export function parseRefs(decorations){const refs=[];let head=false;for(const part of decorations.split(', ').filter(Boolean)){if(part==='HEAD'){head=true;continue;}if(part.startsWith('HEAD -> ')){head=true;refs.push({name:part.slice(8),kind:'branch'});continue;}if(part.startsWith('tag: ')){refs.push({name:part.slice(5),kind:'tag'});continue;}refs.push({name:part,kind:part.includes('/')?'remote':'branch'});}return {refs,head};}
const LOG_FORMAT='%x1e%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s';
export function parseLog(output){return output.split('\x1e').slice(1).map(record=>{const [hash,parents,decorations,author,date,subject]=record.replace(/\n$/,'').split('\x1f');return {hash,parents:parents?parents.split(' '):[],...parseRefs(decorations),author,date,subject};});}
export async function gitLogAt(root,extra) {
 gitReady();const run=gitRun(root);
 let toplevel;try{toplevel=run(['rev-parse','--show-toplevel']).trim();}catch{return {ok:true,state:'not-initialized',commits:[],truncated:false};}
 // Git silently climbs to an enclosing repository; the graph must reflect the opened project's own .git only.
 if(await realpath(toplevel).catch(()=>toplevel)!==root)return {ok:true,state:'nested',enclosing:toplevel,commits:[],truncated:false};
 let branch,detached=false;try{branch=run(['symbolic-ref','--short','HEAD']).trim();}catch{detached=true;branch=run(['rev-parse','--short','HEAD']).trim();}
 try{run(['rev-parse','--verify','HEAD']);}catch{return {ok:true,state:'ready',branch,detached,commits:[],truncated:false};}
 const commits=parseLog(run(['log','--all','--topo-order','--max-count=501',`--pretty=tformat:${LOG_FORMAT}`]));
 const truncated=commits.length>500;if(truncated)commits.length=500;
 return {ok:true,state:'ready',branch,detached,commits,truncated};
}
export async function readBoundGitLog(input){return gitLogAt((await boundRoot(input)).root);}
export async function gitShowAt(root,extra) {
 gitReady();const run=gitRun(root);
 const toplevel=await realpath(run(['rev-parse','--show-toplevel']).trim()).catch(()=>null);if(toplevel!==root)throw Error('此目录属于上级 Git 仓库，未读取提交。');
 const commit=extra&&extra.commit;if(typeof commit!=='string'||!/^[0-9a-f]{6,64}$/i.test(commit))throw Error('Invalid commit');
 const [meta]=parseLog(run(['show','-s',`--pretty=tformat:${LOG_FORMAT}`,commit,'--']));
 const body=run(['show','-s','--format=%B',commit,'--']).replace(/\n$/,'');
 const parents=run(['rev-list','--parents','-n','1',commit]).trim().split(' ').slice(1);
 // Merges are described against their first parent; root commits need --root to list their tree.
 const output=parents.length>1?run(['diff','-z','--no-renames','--numstat',parents[0],commit]):run(['diff-tree','-r','-z','--no-renames','--no-commit-id','--numstat','--root',commit]);
 const files=output.split('\0').filter(Boolean).map(line=>{const [added,deleted,...rest]=line.split('\t');const stat=value=>value==='-'?null:Number(value);return {path:rest.join('\t'),added:stat(added),deleted:stat(deleted)};});
 return {ok:true,commit:{...meta,body},files};
}
export async function readBoundGitShow(input){return gitShowAt((await boundRoot(input)).root,input);}

export async function verifyProjectBinding(input){await boundRoot(input);return {ok:true};}
