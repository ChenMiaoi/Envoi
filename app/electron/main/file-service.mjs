import {mkdir,open,readFile,rename,rm,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function projectPath(root,relative){
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:\u0000-\u001f]/u.test(part)))throw Error('无效项目文件路径');
 return path.join(root,...relative.split('/'));
}
const queues=new Map();
export function withProjectFiles(root,operation){
 const previous=queues.get(root)??Promise.resolve();
 const current=previous.catch(()=>{}).then(operation);queues.set(root,current);
 return current.finally(()=>{if(queues.get(root)===current)queues.delete(root);});
}
async function destination(root,relative){
 const target=projectPath(root,relative);
 // Replacing the resolved file preserves a user-created symlink.
 try{return await realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;return target;}
}
async function contents(target){try{return await readFile(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function equal(a,b){return a===null?b===null:b!==null&&a.equals(b);}
async function prepare(target,bytes){
 await mkdir(path.dirname(target),{recursive:true});
 const mode=await stat(target).then(value=>value.mode&0o777,()=>0o644);
 const temporary=path.join(path.dirname(target),`.envoi-write-${randomUUID()}.tmp`);
 let file;
 try{file=await open(temporary,'wx',mode);await file.writeFile(bytes);await file.sync();await file.close();return temporary;}
 catch(error){await file?.close().catch(()=>{});await rm(temporary,{force:true});throw error;}
}
export async function atomicProjectWrite(root,relative,content){
 return withProjectFiles(root,async()=>{
  const target=await destination(root,relative);
  const bytes=typeof content.text==='string'?Buffer.from(content.text):typeof content.base64==='string'?Buffer.from(content.base64,'base64'):null;
  if(bytes===null)throw Error('缺少文件内容');
  const temporary=await prepare(target,bytes);
  try{await rename(temporary,target);}finally{await rm(temporary,{force:true});}
 });
}
export async function saveProjectFiles(root,changes){
 return withProjectFiles(root,async()=>{
  const saved=[],prepared=[];
  try{
   if(!Array.isArray(changes))throw Error('无效保存请求');
   const seen=new Set();
   for(const change of changes){
    if(typeof change.text!=='string'||!(typeof change.expectedText==='string'||change.expectedText===null))throw Error('缺少文件保存基线');
    const target=await destination(root,change.path);
    if(seen.has(target))throw Error('同一文件不能重复保存');seen.add(target);
    const expected=change.expectedText===null?null:Buffer.from(change.expectedText);
    if(!equal(await contents(target),expected))throw Error(`${change.path} 已被外部修改，草稿已保留。`);
    prepared.push({path:change.path,target,expected,text:change.text});
   }
   // Stage all files before committing any; partial commits are explicitly returned.
   for(const item of prepared)item.temporary=await prepare(item.target,Buffer.from(item.text));
   for(const item of prepared){
    if(!equal(await contents(item.target),item.expected))throw Error(`${item.path} 在保存期间被外部修改，草稿已保留。`);
    await rename(item.temporary,item.target);saved.push(item.path);
   }
   return {saved};
  }catch(error){return {saved,error:error.message};}
  finally{await Promise.all(prepared.filter(item=>item.temporary).map(item=>rm(item.temporary,{force:true})));}
 });
}
