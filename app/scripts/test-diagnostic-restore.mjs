import {build} from 'esbuild';import {readdir,readFile,stat} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
await build({entryPoints:['src/lib/projectFiles.ts','src/lib/projectSession.ts'],bundle:true,platform:'node',format:'esm',outdir:'tmp/restore-check'});
const {readProject}=await import('../tmp/restore-check/projectFiles.js');const {mergeDrafts}=await import('../tmp/restore-check/projectSession.js');
function directory(root){return {name:path.basename(root),queryPermission:async()=>'granted',async *entries(){for(const entry of await readdir(root,{withFileTypes:true})){const target=path.join(root,entry.name);yield [entry.name,entry.isDirectory()?{...directory(target),kind:'directory'}:{kind:'file',getFile:async()=>new File([await readFile(target)],entry.name,{lastModified:(await stat(target)).mtimeMs})}];}}};}
const project=await readProject(directory(path.resolve('../examples/demo')));assert(project.diagnostics.items.length>=6);
const imageWarnings=project.diagnostics.items.filter(item=>item.message.includes('image without description'));assert.equal(imageWarnings.length,6);assert(imageWarnings.every(item=>item.path?.startsWith('chapters/')&&item.line));
assert.notEqual(project.diagnostics.signature,'legacy-unverified');
const restored=mergeDrafts(project,{...project,diagnostics:{...project.diagnostics,status:'cancelled',items:[]}});assert.equal(restored.diagnostics.items.length,project.diagnostics.items.length);
console.log('PASS actual disk legacy log restored',project.diagnostics.items.length,'diagnostics; all 6 image warnings point to chapters; empty cancelled cache cannot erase them');
