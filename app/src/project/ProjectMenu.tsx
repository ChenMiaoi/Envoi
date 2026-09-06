import {restoreProjectSession} from '@/lib/projectSession';
import {bindAgentDirectory} from "@/lib/agentClient";
import {ProjectManagement} from "./ProjectManagement";
import {BrandMark} from "@/components/BrandMark";
import {usePreferences} from "@/settings/context";
import { useEffect, useState } from "react";
import { Folder, FolderOpen, ArrowUp, HardDrive, FilePlus2 } from "lucide-react";
import { createPaper, createTextFile, dirtyFiles, readProject } from "@/lib/projectFiles";
import { authorizedRoots, rememberRoot, ensurePermission, recentProjects, rememberProject, type RecentProject } from "@/lib/recentProjects";
import { localGitRuntime, initializeLocalGit, bindProjectConnection } from "@/lib/localGit";
import {gitPath,rememberGitPath} from "@/lib/gitBinding";
import { paperTemplates } from "@/lib/paperTemplates";
import { useProject } from "./context";
import {useT} from "@/i18n/useT";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function ProjectMenu() {
  const {preferences}=usePreferences();
  const {t}=useT();
  const { saveAll,saving,project, setProject, busy, setBusy, message, setMessage } = useProject();
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [connectionPath,setConnectionPath]=useState("");
  const [localPath, setLocalPath] = useState("");
  const [gitStatus, setGitStatus] = useState(t('project.gitProbing'));
  const [gitAvailable, setGitAvailable] = useState(false);
  const [enableGit, setEnableGit] = useState(preferences.defaultGit);
  const [template, setTemplate] = useState("article");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [roots, setRoots] = useState<RecentProject[]>([]);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [mode, setMode] = useState<"new" | "open" | "file" | null>(null);
  const [name, setName] = useState("");
  const [trail, setTrail] = useState<FileSystemDirectoryHandle[]>([]);
  const [folders, setFolders] = useState<FileSystemDirectoryHandle[]>([]);
  const [discard, setDiscard] = useState(false);
  useEffect(() => { if(mode!=="new") return; void localGitRuntime().then(result=>{setGitAvailable(result.available);if(!result.available)setEnableGit(false);setGitStatus(result.available?result.version!:t('project.gitDisabledSuffix',{error:result.error ?? ''}));}).catch(error=>{setGitAvailable(false);setGitStatus(error.message);}); }, [mode, t]);
  useEffect(()=>{const listener=()=>setConnectionOpen(true);const open=()=>setMode('open');window.addEventListener('envoi:open-project',open);window.addEventListener('envoi:connect-project',listener);return()=>{window.removeEventListener('envoi:connect-project',listener);window.removeEventListener('envoi:open-project',open);};},[]);
  useEffect(()=>{const refresh=()=>{void recentProjects().then(setRecent);};window.addEventListener('envoi:recent-updated',refresh);return()=>window.removeEventListener('envoi:recent-updated',refresh);},[]);
  const changed = dirtyFiles(project).length;
  const location = trail[trail.length - 1];
  useEffect(()=>{let active=true;if(location)void gitPath(location).then(path=>{if(active)setLocalPath(path??'');});return()=>{active=false;};},[location]);
  useEffect(() => { void recentProjects().then(setRecent).catch(() => setMessage(t('project.recentStoreUnavailable'))); }, [setMessage, t]);
  useEffect(() => {
    let active = true;
    void authorizedRoots().then(async (items) => {
      if (!active) return; setRoots(items);
      if (!items.length) return;
      const root = items.find(item=>item.directory)?.directory;if(!root)return; setTrail([root]);
      if (await root.queryPermission({ mode: "readwrite" }) !== "granted") { if (active) setPermissionNeeded(true); return; }
      const children: FileSystemDirectoryHandle[] = [];
      for await (const child of root.values()) if (child.kind === "directory") children.push(child);
      if (active) setFolders(children.sort((a,b) => a.name.localeCompare(b.name)));
    }).catch(() => { if (active) setPermissionNeeded(true); });
    return () => { active = false; };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage((error as Error).name === "AbortError" ? t('project.authCancelled') : (error as Error).message); }
    finally { setBusy(false); }
  };
  const browse = async (next: FileSystemDirectoryHandle[]) => {
    const children: FileSystemDirectoryHandle[] = [];
    for await (const child of next[next.length - 1].values()) if (child.kind === "directory") children.push(child);
    setPermissionNeeded(false); setTrail(next); setFolders(children.sort((a,b) => a.name.localeCompare(b.name)));
  };
  const activate = async (directory: FileSystemDirectoryHandle) => {
    const absolutePath=await gitPath(directory);let bindingError='';
    if(absolutePath){try{await bindAgentDirectory(directory,absolutePath);}catch(error){bindingError=t('project.aiBindFailed',{error:(error as Error).message});}}
    else bindingError=t('project.aiNotBound');
    const next = await restoreProjectSession(await readProject(directory));
    let remembered = true;
    try { await rememberProject(directory); } catch { remembered = false; }
    setProject(next);
    setMessage(remembered ? t('project.opened',{name:next.name,bindingError}) : t('project.openedNoRecent',{name:next.name}));
    for (const file of project.files) if (file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url);
  };
  const openDialog = (next: "new" | "open" | "file") => { setMode(next); if(next==='new')setEnableGit(preferences.defaultGit); setName(""); setDiscard(false); setMessage(""); };
  return <>
    <ProjectManagement />
    <DropdownMenu><DropdownMenuTrigger aria-label={t('project.menuAria')} className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-primary">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary text-primary-foreground"><BrandMark className="h-4 w-4" /></span><span className="font-serif text-[14px] font-semibold italic tracking-[0.02em]">Envoi</span>
    </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64">
      <DropdownMenuLabel>{t('project.menuLabel')} {changed ? t('project.unsavedSuffix',{count:changed}) : ""}</DropdownMenuLabel>
      <DropdownMenuItem disabled={busy} onSelect={() => openDialog("new")}>{t('project.newProject')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => openDialog("open")}>{t('project.openProjectFolder')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy || !project.directory} onSelect={() => openDialog("file")}>{t('project.newFile')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy || saving || !changed} onSelect={() => void saveAll()}>{t('project.saveAll')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy||saving||project.id==='empty'} onSelect={()=>window.dispatchEvent(new Event('envoi:close-project'))}>{t('project.closeCurrentEllipsis')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy||saving} onSelect={()=>window.dispatchEvent(new Event('envoi:manage-projects'))}>{t('project.manageMenu')}</DropdownMenuItem>
      <DropdownMenuItem disabled={!project.directory} onSelect={()=>setConnectionOpen(true)}>{t('project.localConnectionMenu')}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openDialog("open")}>{t('project.recentMenu',{count:recent.length})}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open && !busy) setMode(null); }}>
      <DialogContent className="gap-0 overflow-hidden p-0 max-h-[90vh] overflow-y-auto sm:max-w-[850px]">
        <DialogHeader className="border-b border-border px-6 py-5"><DialogTitle>{mode === "new" ? t('project.dialogNewTitle') : mode === "file" ? t('project.dialogFileTitle') : t('project.dialogOpenTitle')}</DialogTitle><DialogDescription>{t('project.dialogIntro')}{mode === "file" ? t('project.dialogFileDesc') : t('project.dialogOpenDesc')}</DialogDescription></DialogHeader>
        <div className="flex min-h-72">
          <aside className="w-44 shrink-0 border-r border-border bg-background/40 p-3">
            <div className="mb-2 px-2 text-xs text-muted-foreground">{t('project.authorizedLocations')}</div>
            {roots.map((entry) => <button key={entry.id} disabled={busy || mode === "file"} className="mb-1 block w-full truncate rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={() => void run(async () => { if (!entry.directory)throw new Error(t('project.errorReselectDirectory')); if (!(await ensurePermission(entry.directory))) throw new Error(t('project.errorPermissionExpired')); await rememberRoot(entry.directory); await browse([entry.directory]); })}>{entry.name}</button>)}
            {!project.directory && <p className="mb-3 px-2 text-[10px] text-muted-foreground">{t('project.notConnectedHint')}</p>}<div className="mb-3 flex items-center gap-2 px-2 text-xs text-muted-foreground"><HardDrive className="h-3.5 w-3.5" />{t('project.recentHeading')}</div>
            {!recent.length && <p className="px-2 text-xs text-muted-foreground">{t('project.noRecent')}</p>}
            {recent.map((entry) => <button key={entry.id} disabled={busy || mode === "file"} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary disabled:opacity-40" onClick={() => void run(async () => {
              if (!entry.directory)throw new Error(t('project.errorReselectDirectory')); if (!(await ensurePermission(entry.directory))) throw new Error(t('project.errorNoDirectoryAuth'));
              await browse([entry.directory]);
            })}><Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{entry.name}</span></button>)}
          </aside>
          <div className="min-w-0 flex-1 space-y-4 p-5">
            {mode !== "file" ? <>
              <div className="flex items-center gap-2"><button disabled={busy || trail.length < 2} aria-label={t('project.parentDirAria')} className="rounded border border-border p-2 disabled:opacity-30" onClick={() => void run(() => browse(trail.slice(0,-1)))}><ArrowUp className="h-4 w-4" /></button><div className="min-w-0 flex-1 truncate rounded border border-border bg-background px-3 py-2 text-xs" title={trail.map((item) => item.name).join(" / ")}>{location ? trail.map((item) => item.name).join(" / ") : t('project.noLocation')}</div></div>
              <div className="max-h-44 min-h-28 overflow-auto rounded-lg border border-border bg-background/40 p-2">
                {permissionNeeded ? <button className="p-3 text-xs text-primary" onClick={() => void run(async () => { if (!location || !(await ensurePermission(trail[0]))) throw new Error(t('project.errorNoPermission')); await browse([trail[0]]); })}>{t('project.permissionRestore')}</button> : !location ? <div className="flex flex-col items-center gap-2 py-5 text-xs text-muted-foreground"><FolderOpen className="h-7 w-7" /><span>{t('project.emptyFolderHint')}</span></div> : !folders.length ? <p className="p-3 text-xs text-muted-foreground">{t('project.noSubfolders')}</p> : folders.map((folder) => <button key={folder.name} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" disabled={busy} onClick={() => void run(() => browse([...trail, folder]))}><Folder className="h-4 w-4 text-primary" />{folder.name}</button>)}
              </div>
              <button disabled={busy} className="rounded border border-border px-3 py-2 text-xs hover:bg-secondary" onClick={() => void run(async () => {
                if (!("showDirectoryPicker" in window)) throw new Error(t('project.errorNoPicker'));
                const root = await window.showDirectoryPicker({ mode: "readwrite" }); await rememberRoot(root); setRoots(await authorizedRoots()); await browse([root]);
              })}>{t('project.chooseLocation')}</button>
            </> : <div className="rounded border border-border bg-background p-3 text-xs"><div className="mb-2 flex items-center gap-2"><FilePlus2 className="h-4 w-4" />{project.name}</div><div className="max-h-32 overflow-auto text-muted-foreground">{project.files.map((file) => <div key={file.id}>{file.path}</div>)}</div></div>}
            {mode !== "open" && <label className="block space-y-2 text-xs"><span>{mode === "new" ? t('project.nameLabel') : t('project.pathLabel')}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "new" ? "my-research-paper" : "chapters/method.tex"} className="w-full rounded border border-input bg-background px-3 py-2 outline-none focus:border-primary" /></label>}
            {mode === "new" && <div className="space-y-2">
              <div className="flex gap-2"><input aria-label={t('project.templateSearchAria')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('project.templateSearchPlaceholder')} className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2 text-xs" /><select aria-label={t('project.templateCategoryAria')} value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-input bg-background text-xs">{["全部","通用","会议","期刊"].map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto">{paperTemplates.filter((item) => (category === "全部" || category === item.category) && `${item.name} ${item.family}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button key={item.id} onClick={() => setTemplate(item.id)} className={`rounded border p-3 text-left text-xs ${template === item.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}><span className="block font-medium">{item.name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{item.category} · {item.version}</span></button>)}</div>
              <p className="text-[10px] text-muted-foreground">{t('project.templateCurrent',{name:paperTemplates.find((item) => item.id === template)?.name ?? ''})}</p>
              <a className="text-[10px] text-primary" href={paperTemplates.find((item) => item.id === template)?.source} target="_blank" rel="noreferrer">{t('project.templateSource')}</a>
            </div>}
            {mode === "new" && <p className="text-[11px] text-muted-foreground">{t('project.newProjectStructure')}</p>}
            {mode === "new" && <div className="space-y-1 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={enableGit} onChange={event => setEnableGit(event.target.checked && gitAvailable)} />{t('project.enableGit')}</label><p className="text-[10px] text-muted-foreground">{t('project.gitNote')}</p><p role="status" className="text-[10px] text-muted-foreground">{gitStatus}</p></div>}
            {mode!=="file"&&<label className="block space-y-1 text-[10px] text-muted-foreground"><span>{t('project.localPathLabel')}</span><input aria-label={t('project.localPathAria')} value={localPath} onChange={event=>setLocalPath(event.target.value)} placeholder={t('project.localPathPlaceholder')} className="w-full rounded border border-input bg-background px-3 py-2 text-xs" /><span>{t('project.localPathNote')}</span></label>}
            {changed > 0 && mode !== "file" && <div className="rounded border border-warning/30 p-3 text-xs text-warning"><p>{t('project.unsavedFilesWarning',{count:changed})}</p><button className="my-2 underline" disabled={busy} onClick={() => void saveAll()}>{t('project.saveAllFirst')}</button><label className="flex items-center gap-2"><input type="checkbox" checked={discard} onChange={(event) => setDiscard(event.target.checked)} />{t('project.discardOnSwitch')}</label></div>}
          </div>
        </div>
        {message && <p role="status" className="border-t border-border px-5 py-3 text-xs text-warning">{message}</p>}
        <div className="flex justify-end gap-2 border-t border-border bg-background/30 px-5 py-4"><button disabled={busy} onClick={() => setMode(null)} className="rounded border border-border px-4 py-2 text-xs">{t('project.cancel')}</button><button disabled={busy || (mode === "new" && enableGit && (!gitAvailable || !localPath.startsWith("/"))) || (mode !== "file" && (!location || permissionNeeded)) || (mode !== "open" && !name.trim()) || (!!changed && mode !== "file" && !discard)} className="rounded bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40" onClick={() => void run(async () => {
          if (mode === "file") {
            if (!(await ensurePermission(project.directory!))) throw new Error(t('project.errorNoWritePermission'));
            if (!/\.(tex|bib|md|txt|csv|sty|cls)$/i.test(name.trim())) throw new Error(t('project.errorFileExtension'));
            await createTextFile(project.directory!, name.trim(), "");
            const fresh = await readProject(project.directory!).catch((error) => { throw new Error(t('project.errorRefreshFailed',{error:error.message})); });
            setProject((current) => ({ ...current, ...fresh, compiled: current.compiled, id: current.id, rootId: current.rootId || fresh.rootId, files: fresh.files.map((file) => { const old = current.files.find((item) => item.id === file.id); if (old && file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url); return old ?? file; }) })); setMode(null); setMessage(t('project.fileCreated',{name}));
          } else { const directory = mode === "new" ? await createPaper(location, name.trim(), template, enableGit) : location; if(mode === "new" && enableGit) { try { await initializeLocalGit(directory, localPath.replace(/\/$/, "") + "/" + name.trim()); await rememberGitPath(location,localPath); } catch(error) { throw new Error(t('project.errorGitIncomplete',{error:(error as Error).message})); } } if(localPath)await bindProjectConnection(directory,mode==="new"?localPath.replace(/\/$/, "")+"/"+name.trim():localPath); await activate(directory); if (mode === "new" && enableGit) setMessage(t('project.gitInitialized')); setMode(null); }
        })}>{busy ? t('project.processing') : mode === "new" ? t('project.createProject') : mode === "file" ? t('project.createFile') : t('project.openCurrentDirectory')}</button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}><DialogContent><DialogHeader><DialogTitle>{t('project.connectionTitle')}</DialogTitle><DialogDescription>{t('project.connectionDesc')}</DialogDescription></DialogHeader><input aria-label={t('project.connectionPathAria')} value={connectionPath} onChange={event=>setConnectionPath(event.target.value)} placeholder={t('project.connectionPathPlaceholder')} className="rounded border border-input bg-background px-3 py-2 text-xs" /><button disabled={busy||!connectionPath.startsWith('/')} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40" onClick={()=>void run(async()=>{await bindProjectConnection(project.directory!,connectionPath);setConnectionOpen(false);setMessage(t('project.connectionSaved'));})}>{t('project.saveConnection')}</button>{message.includes('身份冲突')&&<button disabled={busy||!connectionPath.startsWith('/')} className="text-left text-xs text-primary" onClick={()=>void run(async()=>{await bindAgentDirectory(project.directory!,connectionPath,true);await rememberGitPath(project.directory!,connectionPath);await activate(project.directory!);setConnectionOpen(false);})}>{t('project.connectAsCopy')}</button>}{message&&<p role="status" className="text-xs text-warning">{message}</p>}</DialogContent></Dialog>
    {!mode && message && <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-lg gap-3 rounded border border-border bg-card p-3 text-xs shadow-xl"><span>{message}</span><button aria-label={t('project.dismissAria')} onClick={() => setMessage("")}>×</button></div>}
  </>;
}
