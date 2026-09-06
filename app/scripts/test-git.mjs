import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gitRuntime,initializeBoundGit} from '../server/git.mjs';
assert(gitRuntime().available);
const root=await mkdtemp(path.join(tmpdir(),'paperdesk-git-'));
const proof='a'.repeat(64);
try{
 await mkdir(path.join(root,'.paperdesk'));await writeFile(path.join(root,'.paperdesk/git-proof'),proof);
 await assert.rejects(initializeBoundGit({directory:root,proof:'b'.repeat(64)}),/证明/);
 const result=await initializeBoundGit({directory:root,proof});assert.equal(result.branch,'main');
 assert.equal(execFileSync('/usr/bin/git',['symbolic-ref','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'main');
 assert.equal(execFileSync('/usr/bin/git',['remote'],{cwd:root,encoding:'utf8'}),'');
 assert.throws(()=>execFileSync('/usr/bin/git',['rev-parse','--verify','HEAD'],{cwd:root,stdio:'pipe'}));
 await assert.rejects(initializeBoundGit({directory:root,proof}),/已属于/);
 console.log('PASS bound native Git init, main, no commits/remotes, wrong proof rejected, existing history preserved');
}finally{await rm(root,{recursive:true,force:true});}
