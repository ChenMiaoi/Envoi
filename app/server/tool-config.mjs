import {readFileSync,realpathSync,accessSync,constants} from 'node:fs';import {mkdir,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {homedir} from 'node:os';import path from 'node:path';
const configPath=path.join(homedir(),'.config/envoi/tools.json'),legacyConfigPath=path.join(homedir(),'.config/paperdesk/tools.json');
function config(){for(const file of [configPath,legacyConfigPath])try{return JSON.parse(readFileSync(file,'utf8'));}catch{/* try legacy location */}return {};}
export function detectTool(name){return [...(process.env.PATH??'').split(path.delimiter),'/opt/homebrew/bin','/Library/TeX/texbin','/usr/local/bin','/usr/bin'].filter(prefix=>path.isAbsolute(prefix)).map(prefix=>path.join(prefix,name)).find(candidate=>{try{accessSync(candidate,constants.X_OK);return true;}catch{return false;}});}
export function chktexPath(){return config().chktexPath??detectTool('chktex');}
export function validateChktexPath(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\u0000-\u001f]/u.test(value))throw Error('请输入 ChkTeX 可执行文件的绝对路径，不支持命令或参数。');
 const resolved=realpathSync(value);if(path.basename(resolved)!=='chktex')throw Error('所选程序不是 chktex 可执行文件。');accessSync(resolved,constants.X_OK);
 const version=execFileSync(resolved,['-W'],{encoding:'utf8',timeout:3000,maxBuffer:20000});if(!/ChkTeX v\d/.test(version))throw Error('程序未通过 ChkTeX 版本校验。');return resolved;
}
export function toolInfo(){
 const configured=config().chktexPath;let chktex={available:false,path:chktexPath()??'',configured:!!configured,error:'未找到 ChkTeX'};
 try{const executable=validateChktexPath(chktex.path);chktex={...chktex,available:true,path:executable,error:''};}catch(error){chktex.error=error.message;}
 const texlab=detectTool('texlab');return {chktex,texlab:{available:!!texlab,path:texlab??'',integrationAvailable:false},configurationScope:'local-user'};
}
export async function configureTools(input){
 if(!input||!Object.hasOwn(input,'chktexPath')||Object.keys(input).some(key=>key!=='chktexPath'))throw Error('Unsupported tool configuration');
 const selected=input.chktexPath===null?null:validateChktexPath(input.chktexPath);
 await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,JSON.stringify({chktexPath:selected},null,2)+'\n',{mode:0o600});return toolInfo();
}
