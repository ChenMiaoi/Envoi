import type { PaperProject } from './projectFiles';
export function projectSignature(project: PaperProject) {
 return JSON.stringify([project.rootId, project.files.filter(file=>!file.path.split('/').some(part=>part.startsWith('.')||['build','output'].includes(part))&&/\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(file.path)).sort((a,b)=>a.path.localeCompare(b.path)).map(file => [file.path, file.text ?? file.file?.lastModified ?? file.url ?? 0])]);
}
function encode(bytes: Uint8Array) {
 let binary = ''; for (let index=0;index<bytes.length;index+=32768) binary += String.fromCharCode(...bytes.subarray(index,index+32768));
 return btoa(binary);
}
export async function compileProject(project: PaperProject, engine: string, signal: AbortSignal) {
 const runtimeResponse = await fetch('/api/paperdesk/compiler', { signal });
 if (!runtimeResponse.ok || !runtimeResponse.headers.get('content-type')?.includes('application/json')) throw new Error('本地编译服务不可用，请通过项目开发服务启动。');
 const runtime = await runtimeResponse.json(); if (!runtime.available) throw new Error(runtime.error);
 const main = project.files.find(file => file.id === project.rootId)?.path;
 if (!main) throw new Error('请选择论文主文件。');
 const files = [];
 for (const file of project.files) {
  if (/^(build|output)\//.test(file.path)) continue;
  if (/^(build|output)\//.test(file.path)) continue;
  if (/^(build|output)\//.test(file.path)) continue;
  if (/^(build|output)\//.test(file.path)) continue;
  if (!/\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(file.path)) continue;
  if (signal.aborted) throw new DOMException('已取消','AbortError');
  const bytes = file.text !== undefined ? new TextEncoder().encode(file.text) : file.file ? new Uint8Array(await file.file.arrayBuffer()) : file.url ? new Uint8Array(await (await fetch(file.url,{signal})).arrayBuffer()) : file.url ? new Uint8Array(await (await fetch(file.url,{signal})).arrayBuffer()) : file.url ? new Uint8Array(await (await fetch(file.url,{signal})).arrayBuffer()) : file.url ? new Uint8Array(await (await fetch(file.url,{signal})).arrayBuffer()) : null;
  if (bytes) files.push({ path:file.path,base64:encode(bytes) });
 }
 const response = await fetch('/api/paperdesk/compile', { method:'POST',signal,headers:{'Content-Type':'application/json','X-PaperDesk-Token':runtime.token},body:JSON.stringify({main,engine,files}) });
 const result = await response.json();
 if (!response.ok || !result.ok) return { ok:false as const,error:result.error ?? '编译失败',log:result.log ?? '' };
 return { ok:true as const,file:new File([Uint8Array.from(atob(result.pdf),(character)=>character.charCodeAt(0))], 'compiled.pdf', {type:'application/pdf'}),synctex:typeof result.synctex==='string'?Uint8Array.from(atob(result.synctex),(character)=>character.charCodeAt(0)):undefined,log:result.log as string };
}
