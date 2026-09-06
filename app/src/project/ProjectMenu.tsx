import {restoreProjectSession} from '@/lib/projectSession';
import {bindAgentDirectory} from "@/lib/agentClient";
import {ProjectManagement} from "./ProjectManagement";
import {usePreferences} from "@/settings/context";
import { useEffect, useState } from "react";
import { Folder, FolderOpen, ArrowUp, HardDrive, FilePlus2 } from "lucide-react";
import { createPaper, createTextFile, dirtyFiles, readProject } from "@/lib/projectFiles";
import { authorizedRoots, rememberRoot, ensurePermission, recentProjects, rememberProject, type RecentProject } from "@/lib/recentProjects";
import { localGitRuntime, initializeLocalGit, bindProjectConnection } from "@/lib/localGit";
import {gitPath,rememberGitPath} from "@/lib/gitBinding";
import { paperTemplates } from "@/lib/paperTemplates";
import { useProject } from "./context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function ProjectMenu() {
  const {preferences}=usePreferences();
  const { saveAll,saving,project, setProject, busy, setBusy, message, setMessage } = useProject();
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [connectionPath,setConnectionPath]=useState("");
  const [localPath, setLocalPath] = useState("");
  const [gitStatus, setGitStatus] = useState("检测本地 Git…");
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
  useEffect(() => { if(mode!=="new") return; void localGitRuntime().then(result=>{setGitAvailable(result.available);if(!result.available)setEnableGit(false);setGitStatus(result.available?result.version!:`${result.error} 已自动关闭 Git，可继续创建项目。`);}).catch(error=>{setGitAvailable(false);setGitStatus(error.message);}); }, [mode]);
  useEffect(()=>{const listener=()=>setConnectionOpen(true);const open=()=>setMode('open');window.addEventListener('envoi:open-project',open);window.addEventListener('envoi:connect-project',listener);return()=>{window.removeEventListener('envoi:connect-project',listener);window.removeEventListener('envoi:open-project',open);};},[]);
  useEffect(()=>{const refresh=()=>{void recentProjects().then(setRecent);};window.addEventListener('envoi:recent-updated',refresh);return()=>window.removeEventListener('envoi:recent-updated',refresh);},[]);
  const changed = dirtyFiles(project).length;
  const location = trail[trail.length - 1];
  useEffect(()=>{let active=true;if(location)void gitPath(location).then(path=>{if(active)setLocalPath(path??'');});return()=>{active=false;};},[location]);
  useEffect(() => { void recentProjects().then(setRecent).catch(() => setMessage("最近项目存储不可用；仍可授权打开目录。")); }, [setMessage]);
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
    try { await operation(); } catch (error) { setMessage((error as Error).name === "AbortError" ? "已取消授权，当前项目未改变。" : (error as Error).message); }
    finally { setBusy(false); }
  };
  const browse = async (next: FileSystemDirectoryHandle[]) => {
    const children: FileSystemDirectoryHandle[] = [];
    for await (const child of next[next.length - 1].values()) if (child.kind === "directory") children.push(child);
    setPermissionNeeded(false); setTrail(next); setFolders(children.sort((a,b) => a.name.localeCompare(b.name)));
  };
  const activate = async (directory: FileSystemDirectoryHandle) => {
    const absolutePath=await gitPath(directory);let bindingError='';
    if(absolutePath){try{await bindAgentDirectory(directory,absolutePath);}catch(error){bindingError=` AI 连接未完成：${(error as Error).message}`;}}
    else bindingError=' AI 尚未连接此目录，请在项目连接窗口填写所选目录路径。';
    const next = await restoreProjectSession(await readProject(directory));
    let remembered = true;
    try { await rememberProject(directory); } catch { remembered = false; }
    setProject(next);
    setMessage(remembered ? `已打开 ${next.name}；编辑后请使用“保存全部”。${bindingError}` : `已打开 ${next.name}，但最近项目记录未能保存。`);
    for (const file of project.files) if (file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url);
  };
  const openDialog = (next: "new" | "open" | "file") => { setMode(next); if(next==='new')setEnableGit(preferences.defaultGit); setName(""); setDiscard(false); setMessage(""); };
  return <>
    <ProjectManagement />
    <DropdownMenu><DropdownMenuTrigger aria-label="Envoi 项目菜单" className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-primary">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary font-editor text-[11px] font-bold text-primary-foreground">P</span><span className="text-[12.5px] font-semibold">Envoi</span>
    </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64">
      <DropdownMenuLabel>项目 / 文件 {changed ? `· ${changed} 个未保存` : ""}</DropdownMenuLabel>
      <DropdownMenuItem disabled={busy} onSelect={() => openDialog("new")}>新建项目…</DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => openDialog("open")}>打开项目 / 文件夹…</DropdownMenuItem>
      <DropdownMenuItem disabled={busy || !project.directory} onSelect={() => openDialog("file")}>新建文件…</DropdownMenuItem>
      <DropdownMenuItem disabled={busy || saving || !changed} onSelect={() => void saveAll()}>保存全部</DropdownMenuItem>
      <DropdownMenuItem disabled={busy||saving||project.id==='empty'} onSelect={()=>window.dispatchEvent(new Event('envoi:close-project'))}>关闭当前项目…</DropdownMenuItem>
      <DropdownMenuItem disabled={busy||saving} onSelect={()=>window.dispatchEvent(new Event('envoi:manage-projects'))}>管理项目 / 移除 / 删除…</DropdownMenuItem>
      <DropdownMenuItem disabled={!project.directory} onSelect={()=>setConnectionOpen(true)}>项目本地连接…</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openDialog("open")}>最近项目…（{recent.length}）</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open && !busy) setMode(null); }}>
      <DialogContent className="gap-0 overflow-hidden p-0 max-h-[90vh] overflow-y-auto sm:max-w-[850px]">
        <DialogHeader className="border-b border-border px-6 py-5"><DialogTitle>{mode === "new" ? "新建论文项目" : mode === "file" ? "新建项目文件" : "打开论文项目"}</DialogTitle><DialogDescription>一篇论文，一个项目目录。{mode === "file" ? "新文件写入当前项目，已有内容不会覆盖。" : "仅浏览你已授权的位置；首次访问需要选择本地位置。"}</DialogDescription></DialogHeader>
        <div className="flex min-h-72">
          <aside className="w-44 shrink-0 border-r border-border bg-background/40 p-3">
            <div className="mb-2 px-2 text-xs text-muted-foreground">已授权位置</div>
            {roots.map((entry) => <button key={entry.id} disabled={busy || mode === "file"} className="mb-1 block w-full truncate rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={() => void run(async () => { if (!entry.directory)throw new Error("请重新选择本机目录以恢复浏览器访问权限。"); if (!(await ensurePermission(entry.directory))) throw new Error("目录权限已失效，请重新授权。"); await rememberRoot(entry.directory); await browse([entry.directory]); })}>{entry.name}</button>)}
            {!project.directory && <p className="mb-3 px-2 text-[10px] text-muted-foreground">尚未连接本地项目；打开真实目录后可新建文件和保存。</p>}<div className="mb-3 flex items-center gap-2 px-2 text-xs text-muted-foreground"><HardDrive className="h-3.5 w-3.5" />最近项目</div>
            {!recent.length && <p className="px-2 text-xs text-muted-foreground">尚无已授权项目</p>}
            {recent.map((entry) => <button key={entry.id} disabled={busy || mode === "file"} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary disabled:opacity-40" onClick={() => void run(async () => {
              if (!entry.directory)throw new Error("请重新选择本机目录以恢复浏览器访问权限。"); if (!(await ensurePermission(entry.directory))) throw new Error("未获得目录授权，当前项目不变。");
              await browse([entry.directory]);
            })}><Folder className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{entry.name}</span></button>)}
          </aside>
          <div className="min-w-0 flex-1 space-y-4 p-5">
            {mode !== "file" ? <>
              <div className="flex items-center gap-2"><button disabled={busy || trail.length < 2} aria-label="上一级已授权目录" className="rounded border border-border p-2 disabled:opacity-30" onClick={() => void run(() => browse(trail.slice(0,-1)))}><ArrowUp className="h-4 w-4" /></button><div className="min-w-0 flex-1 truncate rounded border border-border bg-background px-3 py-2 text-xs" title={trail.map((item) => item.name).join(" / ")}>{location ? trail.map((item) => item.name).join(" / ") : "尚未授权本地位置"}</div></div>
              <div className="max-h-44 min-h-28 overflow-auto rounded-lg border border-border bg-background/40 p-2">
                {permissionNeeded ? <button className="p-3 text-xs text-primary" onClick={() => void run(async () => { if (!location || !(await ensurePermission(trail[0]))) throw new Error("未获得目录权限。"); await browse([trail[0]]); })}>目录权限需恢复 · 点击重新授权</button> : !location ? <div className="flex flex-col items-center gap-2 py-5 text-xs text-muted-foreground"><FolderOpen className="h-7 w-7" /><span>选择位置后，这里显示真实子文件夹</span></div> : !folders.length ? <p className="p-3 text-xs text-muted-foreground">此目录没有子文件夹，可直接使用当前位置。</p> : folders.map((folder) => <button key={folder.name} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" disabled={busy} onClick={() => void run(() => browse([...trail, folder]))}><Folder className="h-4 w-4 text-primary" />{folder.name}</button>)}
              </div>
              <button disabled={busy} className="rounded border border-border px-3 py-2 text-xs hover:bg-secondary" onClick={() => void run(async () => {
                if (!("showDirectoryPicker" in window)) throw new Error("此网页环境不支持本地目录授权，请使用 Chrome。未读写任何目录。");
                const root = await window.showDirectoryPicker({ mode: "readwrite" }); await rememberRoot(root); setRoots(await authorizedRoots()); await browse([root]);
              })}>选择本地位置 / 授权目录…</button>
            </> : <div className="rounded border border-border bg-background p-3 text-xs"><div className="mb-2 flex items-center gap-2"><FilePlus2 className="h-4 w-4" />{project.name}</div><div className="max-h-32 overflow-auto text-muted-foreground">{project.files.map((file) => <div key={file.id}>{file.path}</div>)}</div></div>}
            {mode !== "open" && <label className="block space-y-2 text-xs"><span>{mode === "new" ? "项目名称" : "项目内相对路径"}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "new" ? "my-research-paper" : "chapters/method.tex"} className="w-full rounded border border-input bg-background px-3 py-2 outline-none focus:border-primary" /></label>}
            {mode === "new" && <div className="space-y-2">
              <div className="flex gap-2"><input aria-label="搜索论文模板" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索计算机论文模板…" className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2 text-xs" /><select aria-label="模板分类" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-input bg-background text-xs">{["全部","通用","会议","期刊"].map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto">{paperTemplates.filter((item) => (category === "全部" || category === item.category) && `${item.name} ${item.family}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button key={item.id} onClick={() => setTemplate(item.id)} className={`rounded border p-3 text-left text-xs ${template === item.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}><span className="block font-medium">{item.name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{item.category} · {item.version}</span></button>)}</div>
              <p className="text-[10px] text-muted-foreground">当前：{paperTemplates.find((item) => item.id === template)?.name}。模板体系，不代表具体会议年度投稿规则。</p>
              <a className="text-[10px] text-primary" href={paperTemplates.find((item) => item.id === template)?.source} target="_blank" rel="noreferrer">官方来源与要求 ↗</a>
            </div>}
            {mode === "new" && <p className="text-[11px] text-muted-foreground">将在当前位置新建目录，包含 main.tex、chapters、references.bib、assets、data 和 build；编译缓存位于隔离 build 目录。</p>}
            {mode === "new" && <div className="space-y-1 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={enableGit} onChange={event => setEnableGit(event.target.checked && gitAvailable)} />启用 Git 版本管理</label><p className="text-[10px] text-muted-foreground">调用本机 Git 初始化 main；不会自动提交。build 中的成品 PDF 不跟踪，assets 中的输入 PDF 可跟踪。</p><p role="status" className="text-[10px] text-muted-foreground">{gitStatus}</p></div>}
            {mode!=="file"&&<label className="block space-y-1 text-[10px] text-muted-foreground"><span>所选位置的本地路径 · 首次连接本机工具时填写一次</span><input aria-label="所选位置的本地绝对路径" value={localPath} onChange={event=>setLocalPath(event.target.value)} placeholder="已选择位置的本机绝对路径" className="w-full rounded border border-input bg-background px-3 py-2 text-xs" /><span>目录授权会复用；浏览器不提供绝对路径，已连接根目录的子项目自动继承。</span></label>}
            {changed > 0 && mode !== "file" && <div className="rounded border border-amber-500/30 p-3 text-xs text-amber-200"><p>当前项目有 {changed} 个未保存文件。</p><button className="my-2 underline" disabled={busy} onClick={() => void saveAll()}>先保存全部</button><label className="flex items-center gap-2"><input type="checkbox" checked={discard} onChange={(event) => setDiscard(event.target.checked)} />切换时放弃未保存修改</label></div>}
          </div>
        </div>
        {message && <p role="status" className="border-t border-border px-5 py-3 text-xs text-amber-200">{message}</p>}
        <div className="flex justify-end gap-2 border-t border-border bg-background/30 px-5 py-4"><button disabled={busy} onClick={() => setMode(null)} className="rounded border border-border px-4 py-2 text-xs">取消</button><button disabled={busy || (mode === "new" && enableGit && (!gitAvailable || !localPath.startsWith("/"))) || (mode !== "file" && (!location || permissionNeeded)) || (mode !== "open" && !name.trim()) || (!!changed && mode !== "file" && !discard)} className="rounded bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40" onClick={() => void run(async () => {
          if (mode === "file") {
            if (!(await ensurePermission(project.directory!))) throw new Error("未获得写入权限，未创建文件。");
            if (!/\.(tex|bib|md|txt|csv|sty|cls)$/i.test(name.trim())) throw new Error("请使用 .tex、.bib、.md、.txt、.csv、.sty 或 .cls 文本扩展名。");
            await createTextFile(project.directory!, name.trim(), "");
            const fresh = await readProject(project.directory!).catch((error) => { throw new Error(`文件已创建，但目录刷新失败：${error.message}。已有编辑仍保留。`); });
            setProject((current) => ({ ...current, ...fresh, compiled: current.compiled, id: current.id, rootId: current.rootId || fresh.rootId, files: fresh.files.map((file) => { const old = current.files.find((item) => item.id === file.id); if (old && file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url); return old ?? file; }) })); setMode(null); setMessage(`已创建 ${name}。`);
          } else { const directory = mode === "new" ? await createPaper(location, name.trim(), template, enableGit) : location; if(mode === "new" && enableGit) { try { await initializeLocalGit(directory, localPath.replace(/\/$/, "") + "/" + name.trim()); await rememberGitPath(location,localPath); } catch(error) { throw new Error(`项目骨架已创建，但 Git 未完成：${(error as Error).message}。文件保留，请打开该项目检查。`); } } if(localPath)await bindProjectConnection(directory,mode==="new"?localPath.replace(/\/$/, "")+"/"+name.trim():localPath); await activate(directory); if (mode === "new" && enableGit) setMessage("项目已创建，Git 仓库已初始化（main）；尚无提交。"); setMode(null); }
        })}>{busy ? "处理中…" : mode === "new" ? "创建项目" : mode === "file" ? "创建文件" : "打开当前目录"}</button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}><DialogContent><DialogHeader><DialogTitle>项目本地连接</DialogTitle><DialogDescription>目录已获浏览器授权。旧项目首次连接本机工具时需补充绝对路径，之后 Git 等工具统一复用。</DialogDescription></DialogHeader><input aria-label="项目连接绝对路径" value={connectionPath} onChange={event=>setConnectionPath(event.target.value)} placeholder="当前项目目录的本地绝对路径" className="rounded border border-input bg-background px-3 py-2 text-xs" /><button disabled={busy||!connectionPath.startsWith('/')} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40" onClick={()=>void run(async()=>{await bindProjectConnection(project.directory!,connectionPath);setConnectionOpen(false);setMessage('项目本地连接已保存，后续本机工具复用此连接。');})}>保存项目连接</button>{message.includes('身份冲突')&&<button disabled={busy||!connectionPath.startsWith('/')} className="text-left text-xs text-primary" onClick={()=>void run(async()=>{await bindAgentDirectory(project.directory!,connectionPath,true);await rememberGitPath(project.directory!,connectionPath);await activate(project.directory!);setConnectionOpen(false);})}>作为独立副本连接</button>}{message&&<p role="status" className="text-xs text-amber-200">{message}</p>}</DialogContent></Dialog>
    {!mode && message && <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-lg gap-3 rounded border border-border bg-card p-3 text-xs shadow-xl"><span>{message}</span><button aria-label="关闭项目提示" onClick={() => setMessage("")}>×</button></div>}
  </>;
}
