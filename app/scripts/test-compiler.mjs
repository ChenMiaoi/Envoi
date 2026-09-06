import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compileSnapshot,validateSnapshot} from '../server/compiler.mjs';
const snapshot=text=>({engine:'pdflatex',main:'main.tex',files:[{path:'main.tex',base64:Buffer.from(text).toString('base64')}]});
assert.throws(()=>validateSnapshot({...snapshot('x'),main:'../main.tex'}));
assert.throws(()=>validateSnapshot({...snapshot('x'),engine:'bash'}));
const folder=await mkdtemp(path.join(tmpdir(),'paperdesk-security-test-'));
try{
 const sentinel=path.join(folder,'outside.tex');await writeFile(sentinel,'TOPSECRET_TEST_SENTINEL');
 const denied=await compileSnapshot(snapshot(`\\documentclass{article}\\begin{document}\\input{${sentinel}}\\end{document}`));
 assert.equal(denied.ok,false);assert(!denied.log.includes('TOPSECRET_TEST_SENTINEL'));console.log('PASS outside-file read blocked');
 const marker=path.join(folder,'shell-marker');
 const shell=await compileSnapshot(snapshot(`\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}Safe.\\end{document}`));
 assert.equal(shell.ok,true);await assert.rejects(readFile(marker));console.log('PASS shell escape disabled');
 const timeout=await compileSnapshot(snapshot('\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}'),{timeoutMs:500});
 assert.equal(timeout.ok,false);assert.match(timeout.error,/时间/);console.log('PASS timeout terminates TeX');
 const controller=new AbortController();controller.abort(Error('test cancelled'));
 const cancelled=await compileSnapshot(snapshot('x'),{signal:controller.signal});assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancelled/);console.log('PASS cancellation');
 const bad=await compileSnapshot(snapshot('\\documentclass{article}\\begin{document}\\undefinedCommand\\end{document}'));assert.equal(bad.ok,false);assert.match(bad.log,/Undefined control sequence/);console.log('PASS actual syntax error log');
}finally{await rm(folder,{recursive:true,force:true});}
