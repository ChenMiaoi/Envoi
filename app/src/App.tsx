import {matchShortcut,shortcuts,commandBinding,bindingText,shortcutLabel} from "@/navigation/shortcuts";
import {PreferencesProvider} from "@/settings/PreferencesProvider";
import {useSettings} from "@/settings/useSettings";
import {paperLibrary,libraryAttachment,type LibraryPaper} from "@/lib/paperLibrary";
import type {ProjectFile} from "@/lib/projectFiles";
import { ProjectProvider } from "@/project/ProjectProvider";
import { ProjectMenu } from "@/project/ProjectMenu";
import { useProject } from "@/project/context";
import { projectTree } from "@/lib/projectFiles";
import { useCallback, useEffect, useMemo, useState } from "react";
import {ProblemsPanel,type ProblemTarget} from "@/project/ProblemsPanel";
import { GitStatusPanel } from "@/project/GitStatusPanel";
import { Search, BookMarked, FileText, FileCode2, FileType2, BookOpenText, PenLine, LibraryBig, History } from "lucide-react";
import { ActivityBar } from "@/components/ActivityBar";
import {viewNames,viewPaths,resolvePage,type ViewId} from "@/navigation/routes";
import {Link,Navigate,useLocation,useNavigate} from "react-router";
import { ReaderView, type OpenFile } from "@/views/ReaderView";
import { WriterView } from "@/views/WriterView";
import { LibraryView } from "@/views/LibraryView";
import { GitHistoryView } from "@/views/GitHistoryView";
import { SettingsView } from "@/views/SettingsView";
import { type FileNode } from "@/data/workspace";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const kindIcon: Record<string, typeof FileText> = {
  pdf: BookMarked,
  markdown: FileText,
  latex: FileCode2,
  bib: FileType2,
};

function flatten(nodes: FileNode[], prefix = ""): { node: FileNode; path: string }[] {
  return nodes.flatMap((n) =>
    n.kind === "folder"
      ? flatten(n.children ?? [], `${prefix}${n.name}/`)
      : [{ node: n, path: `${prefix}${n.name}` }],
  );
}

export default function App() { return <PreferencesProvider><ProjectProvider><ProjectSession /></ProjectProvider></PreferencesProvider>; }
function ProjectSession() { const { project } = useProject(); return <ProjectApp key={project.id} />; }
function ProjectApp() {
  const {effective}=useSettings();
  const { project } = useProject();
  const fileTree = useMemo(() => projectTree(project.files, project.directories), [project.files, project.directories]);
  const [problemTarget,setProblemTarget]=useState<ProblemTarget|undefined>();
  const location=useLocation(),navigate=useNavigate();
  const page=resolvePage(location.pathname),view=page.view;
  const setView=useCallback((next:ViewId)=>{if(location.pathname!==viewPaths[next])void navigate(viewPaths[next]);},[location.pathname,navigate]);
  // The workspace stays mounted across URLs so editor buffers and in-flight tools survive.
  const [visited,setVisited]=useState<Set<ViewId>>(()=>new Set(view?[view]:[]));
  if(view&&!visited.has(view))setVisited(new Set([...visited,view]));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [libraryFiles,setLibraryFiles]=useState<ProjectFile[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [writerFile,setWriterFile]=useState<{id:string;request:number}|undefined>();
  const openTex=(id:string)=>{setWriterFile(previous=>({id,request:(previous?.request??0)+1}));setView("writer");};
  const [activeId, setActiveId] = useState<string | null>(null);

  const allFiles = useMemo(() => flatten(fileTree), [fileTree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(e.isComposing||(e.target as HTMLElement)?.closest?.('[data-shortcut-recorder]'))return;
      const shortcut=matchShortcut(e,effective.shortcuts);if(!shortcut){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&!e.shiftKey&&!e.altKey)e.preventDefault();return;}e.preventDefault();e.stopPropagation();if(e.repeat)return;
      if(shortcut.id==='commands')setPaletteOpen(v=>!v);
      else if(shortcut.id==='reader'||shortcut.id==='writer')setView(shortcut.id);
      else if(shortcut.id==='compile'){setView('writer');setTimeout(()=>window.dispatchEvent(new Event(shortcut.event)),0);}
      else window.dispatchEvent(new Event(shortcut.event));
    };
    window.addEventListener("keydown", onKey,true);
    return () => window.removeEventListener("keydown", onKey,true);
  }, [setView,effective.shortcuts]);

  const openLibraryPaper=(paper:LibraryPaper)=>{if(paper.status==='待读')void paperLibrary.put([{...paper,status:'在读'}]).then(()=>window.dispatchEvent(new Event('paperdesk:library-updated')));const file=libraryAttachment(paper),id=`library:${paper.id}`;setLibraryFiles(current=>[...current.filter(item=>item.id!==id),{id,path:paper.attachmentName??file.name,kind:'pdf',file}]);setOpenFiles(current=>current.some(item=>item.id===id)?current:[...current,{id,name:paper.title||file.name,kind:'pdf'}]);setActiveId(id);setView('reader');};
  const openFromPalette = (f: { node: FileNode; path: string }) => {
    setPaletteOpen(false);
    if(f.node.kind==='latex'){openTex(f.node.id);return;}
    setView("reader");
    if (!openFiles.find((o) => o.id === f.node.id))
      setOpenFiles([...openFiles, { id: f.node.id, name: f.node.name, kind: f.node.kind }]);
    setActiveId(f.node.id);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {page.redirect&&<Navigate to={page.redirect} replace />}
      {/* 标题栏 */}
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-card">
        <div className="flex w-48 items-center gap-2 pl-3.5">
          <ProjectMenu />
          
        </div>
        <div className="flex flex-1 justify-center">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-6.5 w-72 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50"
            style={{ height: 26 }}
          >
            <Search className="h-3 w-3" />
            <span className="flex-1 text-left">搜索文件、命令…</span>
            <kbd className="rounded border border-border bg-secondary px-1 font-editor text-[10px]">{shortcutLabel(bindingText(commandBinding('commands',effective.shortcuts)),/Mac/.test(navigator.platform))}</kbd>
          </button>
        </div>
        <div className="flex w-48 items-center justify-end gap-2 pr-3.5 text-[11px] text-muted-foreground">
          <span className="font-editor">{project.name}</span>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        <ActivityBar view={view} />
        <div className="min-w-0 flex-1">
          {visited.has("reader") && <section hidden={view!=="reader"} className="h-full" aria-label="阅读页面">
            <ReaderView libraryFiles={libraryFiles} onTex={openTex}
              openFiles={openFiles}
              activeId={activeId}
              onOpenFiles={setOpenFiles}
              onActive={setActiveId}
            />
          </section>}
          {visited.has("writer") && <section hidden={view!=="writer"} className="h-full" aria-label="写作页面"><WriterView requestedFile={writerFile} problemTarget={problemTarget} /></section>}
          {visited.has("library") && <section hidden={view!=="library"} className="h-full" aria-label="论文库页面"><LibraryView onOpen={openLibraryPaper} /></section>}
          {visited.has("history") && <section hidden={view!=="history"} className="h-full" aria-label="版本历史页面"><GitHistoryView /></section>}
          {visited.has("settings") && <section hidden={view!=="settings"} className="h-full" aria-label="设置页面"><SettingsView /></section>}
          {!view&&!page.redirect&&<div className="flex h-full flex-col items-center justify-center gap-3"><h1 className="text-lg font-medium">页面不存在</h1><p className="text-sm text-muted-foreground">当前地址没有对应页面，项目和编辑仍保留。</p><Link to="/writer" className="text-sm text-primary">返回写作页面</Link></div>}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex h-6.5 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground" style={{ height: 26 }}>
        <div className="flex items-center gap-3">
          <GitStatusPanel />
          <ProblemsPanel onNavigate={target=>{setProblemTarget(target);setView("writer");}} />
          <span>工作区：{view?viewNames[view]:"页面导航"}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            AI · 未接入
          </span>
          <span className="font-editor">{effective.engine==='xelatex'?'XeLaTeX':'pdfLaTeX'}</span>
          <span className="font-editor">UTF-8</span>
        </div>
      </div>

      {/* ⌘K 命令面板 */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="输入文件名或命令…" />
        <CommandList>
          <CommandEmpty>没有匹配的结果</CommandEmpty>
          <CommandGroup heading="切换视图">
            <CommandItem onSelect={() => { setView("reader"); setPaletteOpen(false); }}>
              <BookOpenText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> 阅读配置
            </CommandItem>
            <CommandItem onSelect={() => { setView("writer"); setPaletteOpen(false); }}>
              <PenLine className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> 写作配置
            </CommandItem>
            <CommandItem onSelect={() => { setView("library"); setPaletteOpen(false); }}>
              <LibraryBig className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> 论文库
            </CommandItem>
            <CommandItem onSelect={() => { setView("history"); setPaletteOpen(false); }}>
              <History className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> 版本历史
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="项目操作">{shortcuts.filter(item=>'event' in item).map(item=><CommandItem key={item.id} onSelect={()=>{setPaletteOpen(false);if(item.id==='compile')setView('writer');if('event' in item)setTimeout(()=>window.dispatchEvent(new Event(item.event)),0);}}><span>{item.label}</span><kbd className="ml-auto text-[10px] text-muted-foreground">{shortcutLabel(bindingText(commandBinding(item.id,effective.shortcuts)),/Mac/.test(navigator.platform))}</kbd></CommandItem>)}</CommandGroup>
          <CommandGroup heading="打开文件">
            {allFiles.map((f) => {
              const Icon = kindIcon[f.node.kind] ?? FileText;
              return (
                <CommandItem key={f.node.id} value={f.path} onSelect={() => openFromPalette(f)}>
                  <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span>{f.path}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
