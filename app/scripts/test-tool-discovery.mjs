import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {detectTool,executableName,environmentInfo} from '../server/tool-config.mjs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

test('tool discovery handles spaces, executable suffix, override priority and directories',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'envoi tool discovery '));
 const saved={...process.env};
 try{
  const bin=path.join(root,'bin with spaces'),override=path.join(root,'override');
  await mkdir(bin);await mkdir(override);
  const name=executableName('envoi-test-tool');
  await writeFile(path.join(bin,name),'fixture',{mode:0o755});
  process.env.PATH=process.platform==='win32'?`"${bin}"`:bin;
  delete process.env.ENVOI_TEX_BIN;delete process.env.PAPERDESK_TEX_BIN;
  assert.equal(detectTool('envoi-test-tool'),path.join(bin,name));
  await mkdir(path.join(bin,executableName('not-a-tool')));
  assert.equal(detectTool('not-a-tool'),undefined);
  await writeFile(path.join(override,name),'fixture',{mode:0o755});
  process.env.ENVOI_TEX_BIN=override;
  assert.equal(detectTool('envoi-test-tool'),path.join(override,name));
  assert.equal(environmentInfo().arch,process.arch);
 }finally{process.env=saved;await rm(root,{recursive:true,force:true});}
});

test('SyncTeX accepts Windows drive paths and CRLF page records',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'envoi-synctex-'));
 try{
  const outfile=path.join(root,'sync.mjs');
  await build({entryPoints:['src/lib/syncTex.ts'],outfile,bundle:true,platform:'node',format:'esm'});
  const {parseSyncTex,matchSyncTexPath}=await import(pathToFileURL(outfile).href);
  const db=parseSyncTex('Input:1:C:\\paper\\main.tex\r\n{1\r\nh1,2:65536,65536\r\n');
  assert.equal(db.records[0].page,1);
  assert.equal(matchSyncTexPath(['main.tex'],db.inputs[1]),'main.tex');
 }finally{await rm(root,{recursive:true,force:true});}
});
