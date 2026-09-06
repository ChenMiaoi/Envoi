import {detectTool} from './tool-config.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
export function gitRuntime() {
 try {return {available:true,version:execFileSync(detectTool('git')??'git',['--version'],{encoding:'utf8',timeout:5000}).trim()};}
 catch {return {available:false,error:'未检测到可用的本地 Git。'};}
}
async function boundRoot({directory,proof}) {
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof proof!=='string'||!/^\w{64}$/.test(proof))throw Error('Invalid directory binding');
 const root=await realpath(directory).catch(error=>{if(error.code==='ENOENT')throw Error('项目目录位置不存在或已移动，请在项目菜单打开新位置；这不是 Git 授权失效。');throw error;});
 const marker=path.join(root,'.paperdesk','git-proof');
 if(!(await lstat(marker)).isFile()||await realpath(marker)!==marker||await readFile(marker,'utf8')!==proof)throw Error('目录授权证明不匹配，未运行 Git。');
 return {root};
}
export async function initializeBoundGit(input) {
 const {root}=await boundRoot(input);const runtime=gitRuntime();if(!runtime.available)throw Error(runtime.error);
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
export async function readBoundGitStatus(input) {
 const {root}=await boundRoot(input);const runtime=gitRuntime();if(!runtime.available)throw Error(runtime.error);
 const run=args=>execFileSync(detectTool('git')??'git',['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
 try{run(['rev-parse','--show-toplevel']);}catch{return {ok:true,state:'not-initialized',version:runtime.version,files:[]};}
 const prefix=run(['rev-parse','--show-prefix']).trim();
 let branch,detached=false;try{branch=run(['symbolic-ref','--short','HEAD']).trim();}catch{detached=true;branch=run(['rev-parse','--short','HEAD']).trim();}
 const files=parseGitStatus(run(['status','--porcelain=v1','-z','--untracked-files=all','--','.']),prefix).filter(file=>file.path!=='.paperdesk/git-proof');
 return {ok:true,state:'ready',branch,detached,files,version:runtime.version};
}

export async function verifyProjectBinding(input){await boundRoot(input);return {ok:true};}
