import {translate} from '@/i18n/runtime';
import {projectConfiguration,type ProjectConfiguration} from "../settings/model";
import {parseDiagnostics} from "./diagnostics";
import {projectSignature} from "./compileClient";
import {verifyPreview} from "./pdfSync";
import type {CompileDiagnostics, Diagnostic} from "./diagnostics";
import { managementDirName, legacyDirName, projectConfigPath, legacyProjectConfigPath, projectConfigFile } from "./managementDir";
import { templateFiles } from "./paperTemplates";
import type { FileKind, FileNode } from "@/data/workspace";
export interface ProjectFile { id: string; path: string; kind: FileKind; text?: string; saved?: string; file?: File; handle?: FileSystemFileHandle; url?: string }
export interface PaperProject { settings?:ProjectConfiguration; lint?: {fileId:string;text:string;status:"checking"|"ready"|"unavailable"|"disabled";message?:string;items:Diagnostic[]}; diagnostics?: CompileDiagnostics; engine?: "pdflatex" | "xelatex"; compiled?: { file: File; signature: string; synctex?: Uint8Array<ArrayBuffer> }; compileStatus?: string; compileLog?: string; id: string; name: string; files: ProjectFile[]; directories: string[]; rootId: string; directory?: FileSystemDirectoryHandle }
export function fileKind(path: string): FileKind {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension === "tex" ? "latex" : extension === "bib" ? "bib" : extension === "pdf" ? "pdf" : ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "ico"].includes(extension ?? "") ? "image" : extension==='csv'?'csv':extension==='tsv'?'tsv':['md','markdown'].includes(extension??'')?'markdown':isTextPath(path)?'text':'binary';
}
export function isTextPath(path:string){return /\.(tex|bib|md|markdown|txt|csv|tsv|json|sty|cls|bst|log|yaml|yml|toml|ini|cfg|py|r|js|ts|jsx|tsx|css|html|xml|sh|sql|c|h|cpp|rs|go|jl)$/i.test(path)||/(^|\/)(README|LICENSE|Makefile|Dockerfile|\.gitignore)$/i.test(path);}
export function safePath(path: string) {
  const parts = path.trim().split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || (/[\\:]/.test(part) || [...part].some((character) => character.charCodeAt(0) < 32)))) throw new Error(translate('project.invalidPath'));
  return parts;
}
export function isWritingPath(path: string) {
  return !path.split('/').some(part => part.startsWith('.') || ['build', 'output', 'node_modules', '__pycache__'].includes(part)) && !/\.(aux|log|bbl|blg|bcf|fls|fdb_latexmk|toc|out|lof|lot|nav|snm|xdv|dvi|pyc)$|\.synctex\.gz$|\.run\.xml$/i.test(path) && !['paperdesk.json', 'TEMPLATE.md'].includes(path);
}
export function projectTree(files: ProjectFile[], directories: string[] = []): FileNode[] {
  const roots: FileNode[] = [];
  function folder(parts: string[]) {
    let nodes = roots, path = "";
    for (const part of parts) {
      path += (path ? "/" : "") + part;
      let node = nodes.find((item) => item.id === path);
      if (!node) { node = { id: path, name: part, kind: "folder", children: [] }; nodes.push(node); }
      nodes = node.children!;
    }
    return nodes;
  }
  for (const path of directories.filter(isWritingPath)) folder(path.split("/"));
  for (const file of files.filter(file => isWritingPath(file.path))) { const parts = file.path.split("/"); const name = parts.pop()!; folder(parts).push({ id: file.id, name, kind: file.kind }); }
  return roots;
}
export function dirtyFiles(project: PaperProject) { return project.files.filter((file) => file.text !== undefined && file.text !== file.saved); }
export async function readProject(directory: FileSystemDirectoryHandle): Promise<PaperProject> {
  const files: ProjectFile[] = [], directories: string[] = [];
  async function walk(handle: FileSystemDirectoryHandle, prefix = "") {
    for await (const [name, child] of handle.entries()) {
      if ([".git", managementDirName, legacyDirName, "node_modules", ".DS_Store"].includes(name)) continue;
      const path = prefix + name;
      if (child.kind === "directory") { directories.push(path); await walk(child, path + "/"); }
      else {
        const file = await child.getFile(), kind = fileKind(path);
        const isText = isTextPath(path);
        if (isText && file.size > 5_000_000) throw new Error(translate('project.textTooLarge',{path}));
        const bytes=isText?await file.arrayBuffer():undefined;
        let text:string|undefined;try{if(bytes){text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);if(text.includes("\0"))text=undefined;}}catch{/* Non-UTF-8 or binary content stays read-only. */}
        files.push({ id: path, path, kind, text, saved: text, file, handle: child });
      }
    }
  }
  await walk(directory);
  try{const config=await projectConfigFile(directory);if(config)files.push({id:config.path,path:config.path,kind:'text',text:config.text,saved:config.text,handle:config.handle});}catch(error){if((error as Error).name!=='NotFoundError')throw error;}
  files.sort((a, b) => a.path.localeCompare(b.path));
  let metadata: {projectId?:string;settings?:ProjectConfiguration;main?: string; engine?: "pdflatex" | "xelatex"} = {};
  try { metadata = JSON.parse((files.find(file=>file.path===projectConfigPath)??files.find(file=>file.path===legacyProjectConfigPath)??files.find(file => file.path === 'paperdesk.json'))?.text ?? '{}');if(!metadata||Array.isArray(metadata)||typeof metadata!=='object')throw Error(); } catch { throw Error(translate('project.configInvalid')); }
  let diagnostics:CompileDiagnostics|undefined;try{const record=JSON.parse(files.find(file=>file.path==='build/diagnostics.json')?.text??'null');if(record&&Array.isArray(record.items)&&typeof record.signature==='string'&&['success','failed','cancelled'].includes(record.status))diagnostics=record;}catch{/* Optional last-build diagnostics. */}
  const root = files.find(file => file.path === metadata.main) ?? files.find((file) => /(^|\/)main\.tex$/i.test(file.path)) ?? files.find((file) => file.kind === "latex");
  const project:PaperProject = { settings:projectConfiguration(metadata.settings,metadata.engine),diagnostics,compileLog:diagnostics?.log,compileStatus:diagnostics?translate('compile.restoredRecord',{status:translate(diagnostics.status==='success'?'compile.statusSuccess':diagnostics.status==='failed'?'compile.statusFailed':'compile.statusCancelled')}):undefined,engine: ["pdflatex", "xelatex"].includes(metadata.engine ?? "") ? metadata.engine : undefined, id: metadata.projectId??crypto.randomUUID(), name: directory.name, directory, files: files.map((file) => ({ ...file, url: file.file && ["pdf", "image"].includes(file.kind) ? URL.createObjectURL(file.file) : undefined })), directories, rootId: root?.id ?? "" };
  if(!diagnostics){
    const log=files.find(file=>file.path==='build/compile.log'),pdf=project.files.find(file=>file.path==='build/main.pdf');
    if(log?.text&&pdf){const verified=await verifyPreview(project,pdf);diagnostics={items:parseDiagnostics(log.text,files),signature:verified?projectSignature(project):'legacy-unverified',rootId:project.rootId,status:'success',log:log.text,engine:project.engine,timestamp:log.file?.lastModified};project.diagnostics=diagnostics;project.compileLog=log.text;project.compileStatus=translate('compile.restoredDisk');}
  }
  return project;
}
export async function createTextFile(directory: FileSystemDirectoryHandle, path: string, text: string) {
  const parts = safePath(path); const name = parts.pop()!;
  let parent = directory;
  for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true });
  try { await parent.getFileHandle(name); throw new Error(translate('project.fileExists',{path})); }
  catch (error) { if ((error as Error).name !== "NotFoundError") throw error; }
  const handle = await parent.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try { await stream.write(text); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
}
export async function createPaper(parent: FileSystemDirectoryHandle, name: string, template = "article", enableGit = true) {
  if (safePath(name).length !== 1) throw new Error(translate('project.nameNoPath'));
  try { await parent.getDirectoryHandle(name); throw new Error(translate('project.directoryExists',{name})); }
  catch (error) { if ((error as Error).name !== "NotFoundError") throw error; }
  const directory = await parent.getDirectoryHandle(name, { create: true });
  try {
    for (const [path, text] of Object.entries(templateFiles(template, enableGit))) await createTextFile(directory, path, text);
    await directory.getDirectoryHandle("assets", { create: true });
    await directory.getDirectoryHandle("build", { create: true });

  } catch (error) { throw new Error(translate('project.initIncomplete',{message:(error as Error).message})); }
  return directory;
}
export async function saveProject(project: PaperProject, onSaved: (id: string, text: string) => void) {
  const changes = dirtyFiles(project);
  for (const file of changes) {
    if (!file.handle) throw new Error(translate('project.noHandle'));
    if (new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await(await file.handle.getFile()).arrayBuffer()) !== file.saved) throw new Error(translate('project.externallyModified',{path:file.path}));
  }
  for (const file of changes) {
    const stream = await file.handle!.createWritable();
    try { await stream.write(file.text!); await stream.close(); onSaved(file.id, file.text!); }
    catch (error) { await stream.abort().catch(() => {}); throw new Error(translate('project.saveFileFailed',{path:file.path,message:(error as Error).message})); }
  }
}
export async function persistBuild(directory:FileSystemDirectoryHandle, pdf:File, log:string, manifest?:string, synctex?:Uint8Array<ArrayBuffer>) {
 if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw new Error(translate('project.writePermissionLostPdf'));
 const build=await directory.getDirectoryHandle('build',{create:true});
 for(const [name,data] of [['main.pdf',pdf],['compile.log',log],...(manifest ? [['preview.json',manifest] as const] : []),...(synctex ? [['main.synctex.gz',synctex] as const] : [])] as const){
  const handle=await build.getFileHandle(name,{create:true});const stream=await handle.createWritable();
  try{await stream.write(data);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
 }
}

export async function persistDiagnostics(directory:FileSystemDirectoryHandle,diagnostics:CompileDiagnostics){
 if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw new Error(translate('project.writePermissionLostLog'));
 const build=await directory.getDirectoryHandle('build',{create:true});
 for(const [name,data] of [['diagnostics.json',JSON.stringify(diagnostics,null,2)],['compile.log',diagnostics.log??'']] as const){
  const file=await build.getFileHandle(name,{create:true});const stream=await file.createWritable();
  try{await stream.write(data);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
 }
}
