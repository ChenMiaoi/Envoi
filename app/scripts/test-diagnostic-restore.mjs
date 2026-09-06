import {build} from 'esbuild';import {readdir,readFile,stat} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
await build({entryPoints:['src/lib/projectFiles.ts','src/lib/projectSession.ts'],bundle:true,platform:'node',format:'esm',outdir:'tmp/restore-check'});
const {readProject}=await import('../tmp/restore-check/projectFiles.js');const {mergeDrafts}=await import('../tmp/restore-check/projectSession.js');
function fileHandle(root,name){return {kind:'file',getFile:async()=>new File([await readFile(path.join(root,name))],name,{lastModified:(await stat(path.join(root,name))).mtimeMs})};}
function directory(root){return {
 name:path.basename(root),
 queryPermission:async()=>'granted',
 async getDirectoryHandle(name){const target=path.join(root,name);if(await stat(target).then(info=>info.isDirectory(),()=>false))return {...directory(target),kind:'directory'};throw new DOMException('Missing','NotFoundError');},
 async getFileHandle(name){if(!await stat(path.join(root,name)).then(info=>info.isFile(),()=>false))throw new DOMException('Missing','NotFoundError');return fileHandle(root,name);},
 async *entries(){for(const entry of await readdir(root,{withFileTypes:true}))yield [entry.name,entry.isDirectory()?{...directory(path.join(root,entry.name)),kind:'directory'}:fileHandle(root,entry.name)];}
};}
const project=await readProject(directory(path.resolve('../examples/demo')));assert(project.diagnostics.items.length>=6);
const imageWarnings=project.diagnostics.items.filter(item=>item.message.includes('image without description'));assert.equal(imageWarnings.length,6);assert(imageWarnings.every(item=>item.path?.startsWith('chapters/')&&item.line));
assert.notEqual(project.diagnostics.signature,'legacy-unverified');
const restored=mergeDrafts(project,{...project,diagnostics:{...project.diagnostics,status:'cancelled',items:[]}});assert.equal(restored.diagnostics.items.length,project.diagnostics.items.length);
console.log('PASS actual disk legacy log restored',project.diagnostics.items.length,'diagnostics; all 6 image warnings point to chapters; empty cancelled cache cannot erase them');
