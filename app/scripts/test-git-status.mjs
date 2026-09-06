import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {initializeBoundGit,readBoundGitStatus,parseGitStatus} from '../server/git.mjs';
assert.deepEqual(parseGitStatus('R  renamed file.tex\0old file.tex\0?? new.tex\0').map(f=>[f.path,f.originalPath,f.untracked]),[['renamed file.tex','old file.tex',false],['new.tex',undefined,true]]);
const root=await mkdtemp(path.join(tmpdir(),'envoi-git-status-')),proof='b'.repeat(64),input={directory:root,proof};
try{
 await mkdir(path.join(root,'.envoi'));await writeFile(path.join(root,'.envoi/git-proof'),proof);
 assert.equal((await readBoundGitStatus(input)).state,'not-initialized');await initializeBoundGit(input);
 assert.equal((await readBoundGitStatus(input)).files.length,0);
 await writeFile(path.join(root,'a.tex'),'one');let result=await readBoundGitStatus(input);assert(result.files.some(f=>f.path==='a.tex'&&f.untracked));
 // Fixture staging is confined to this temporary test repository, never the demo.
 execFileSync('/usr/bin/git',['add','a.tex'],{cwd:root});await writeFile(path.join(root,'a.tex'),'two');const before=await readFile(path.join(root,'.git/index'));
 result=await readBoundGitStatus(input);assert.equal(result.branch,'main');assert(result.files.some(f=>f.index==='A'&&f.worktree==='M'));
 assert.deepEqual(await readFile(path.join(root,'.git/index')),before);assert.equal(execFileSync('/usr/bin/git',['remote'],{cwd:root,encoding:'utf8'}),'');
 console.log('PASS native Git status: uninitialized/clean/untracked/staged+modified; index unchanged, no remote');
}finally{await rm(root,{recursive:true,force:true});}
