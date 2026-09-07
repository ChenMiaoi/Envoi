import {execFileSync} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const demo=await realpath(path.join(repository,'examples/demo'));
const env={...process.env};
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])delete env[key];
const git=(cwd,args)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const metadata=path.join(demo,'.git');
if(await lstat(metadata).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})){
 const top=await realpath(git(demo,['rev-parse','--show-toplevel']).trim());
 if(top!==demo)throw Error('Existing demo Git metadata does not point to the demo; nothing changed.');
 console.log('Demo already has its own Git repository; existing history and changes preserved.');
}else{
 // Seed only versioned example files, never local credentials, caches or build output.
 const files=git(repository,['ls-files','-z','--','examples/demo/']).split('\0').filter(Boolean).map(file=>file.slice('examples/demo/'.length));
 const present=[];
 for(const file of files){if(await lstat(path.join(demo,file)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))present.push(file);}
 if(!present.includes('main.tex'))throw Error('Tracked demo manuscript not found; nothing changed.');
 git(demo,['init','-b','main']);
 git(demo,['add','--',...present]);
 // This is a local development fixture baseline, not reconstructed paper history.
 // Supply an explicit fixture author per command without changing user Git identity.
 git(demo,['-c','user.name=Envoi Demo','-c','user.email=demo@envoi.invalid','-c','commit.gpgSign=false','-c','core.hooksPath=/dev/null','commit','-m','demo: initialize local development baseline']);
 console.log('Created independent demo Git repository with one local baseline commit.');
}
console.log(git(demo,['rev-parse','--show-toplevel']).trim());
