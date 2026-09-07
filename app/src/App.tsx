import {WelcomePage} from '@/project/WelcomePage';
import {ProjectIdentity} from '@/project/ProjectIdentity';
import {useAgent} from '@/agent/context';
import {AgentProvider} from "@/agent/AgentProvider";
import {commands,matchBinding,commandChordLabel,resolveBindings,type Command} from "@/navigation/shortcuts";
import {PreferencesProvider} from "@/settings/PreferencesProvider";
import {type MessageKey} from "@/i18n/runtime";
import {useT} from "@/i18n/useT";
import {I18nProvider} from "@/i18n";
import {useSettings} from "@/settings/useSettings";
import {paperLibrary,libraryAttachment,type LibraryPaper} from "@/lib/paperLibrary";
import type {ProjectFile} from "@/lib/projectFiles";
import { ProjectProvider } from "@/project/ProjectProvider";
import { ProjectMenu } from "@/project/ProjectMenu";
import { useProject } from "@/project/context";
import { projectTree } from "@/lib/projectFiles";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {ProblemsPanel,type ProblemTarget} from "@/project/ProblemsPanel";
import { GitStatusPanel } from "@/project/GitStatusPanel";
import { Search, BookMarked, FileText, FileCode2, FileType2, BookOpenText, PenLine, LibraryBig, History, Settings } from "lucide-react";
import { ActivityBar } from "@/components/ActivityBar";
import {viewPaths,resolvePage,type ViewId} from "@/navigation/routes";
import {Link,Navigate,useLocation,useNavigate} from "react-router";
import type { OpenFile } from "@/views/ReaderView";
import { type FileNode } from "@/data/workspace";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const ReaderView=lazy(()=>import("@/views/ReaderView").then(module=>({default:module.ReaderView})));
const WriterView=lazy(()=>import("@/views/WriterView").then(module=>({default:module.WriterView})));
const LibraryView=lazy(()=>import("@/views/LibraryView").then(module=>({default:module.LibraryView})));
const GitHistoryView=lazy(()=>import("@/views/GitHistoryView").then(module=>({default:module.GitHistoryView})));
const SettingsView=lazy(()=>import("@/views/SettingsView").then(module=>({default:module.SettingsView})));

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

export default function App() { return <PreferencesProvider><I18nProvider><ProjectProvider><AgentProvider><ProjectSession /></AgentProvider></ProjectProvider></I18nProvider></PreferencesProvider>; }
function ProjectSession() {
 const {project}=useProject(),navigate=useNavigate(),previous=useRef<string|undefined>(undefined);
 useEffect(()=>{if(previous.current===project.id)return;previous.current=project.id;if(project.id==='empty')void navigate('/writer',{replace:true});},[project.id,navigate]);
 return <ProjectApp key={project.id}/>;
}
function ProjectApp() {
  const agent=useAgent();
  const {t}=useT();
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
  const emptyWorkspace=project.id==='empty'&&view!=='library'&&view!=='settings'&&!libraryFiles.length;
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [writerFile,setWriterFile]=useState<{id:string;request:number}|undefined>();
  const openTex=(id:string)=>{setWriterFile(previous=>({id,request:(previous?.request??0)+1}));setView("writer");};
  const [activeId, setActiveId] = useState<string | null>(null);

  const allFiles = useMemo(() => flatten(fileTree), [fileTree]);

  const mac=/Mac/.test(navigator.platform);
  const runCommand=useCallback((command:Command)=>{
    if(command.id==='palette'){setPaletteOpen(v=>!v);return;}
    if(command.view){setView(command.view);return;}
    if(command.id==='compile'){setView('writer');setTimeout(()=>window.dispatchEvent(new Event('envoi:compile')),0);return;}
    if(command.event)window.dispatchEvent(new CustomEvent(command.event,{detail:command.detail}));
  },[setView]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(e.isComposing||(e.target as HTMLElement)?.closest?.('[data-shortcut-recorder]'))return;
      const command=matchBinding(e,resolveBindings(effective.bindings));
      if(!command||(command.scope!=='global'&&command.scope!==view)){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&!e.shiftKey&&!e.altKey)e.preventDefault();return;}
      e.preventDefault();e.stopPropagation();if(e.repeat)return;
      runCommand(command);
    };
    window.addEventListener("keydown", onKey,true);
    return () => window.removeEventListener("keydown", onKey,true);
  }, [runCommand,effective.bindings,view]);

  const openLibraryPaper=(paper:LibraryPaper)=>{if(paper.status==='待读')void paperLibrary.put([{...paper,status:'在读'}]).then(()=>window.dispatchEvent(new Event('envoi:library-updated')));const file=libraryAttachment(paper),id=`library:${paper.id}`;setLibraryFiles(current=>[...current.filter(item=>item.id!==id),{id,path:paper.attachmentName??file.name,kind:'pdf',file}]);setOpenFiles(current=>current.some(item=>item.id===id)?current:[...current,{id,name:paper.title||file.name,kind:'pdf'}]);setActiveId(id);setView('reader');};
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
      {mac&&emptyWorkspace&&<div aria-hidden="true" className="window-drag fixed inset-x-0 top-0 z-40 h-10"/>}
      {/* The macOS traffic lights share the content area; keep controls clear of them. */}
      <div className={emptyWorkspace ? "hidden" : `flex h-10 shrink-0 items-center border-b border-border bg-card ${mac ? "window-drag pl-[80px]" : ""}`}>
        <div className="flex min-w-0 max-w-[55%] items-center gap-2 pl-3.5">
          <div className="shrink-0"><ProjectMenu /></div><ProjectIdentity />
          
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-6.5 w-72 max-w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50"
            style={{ height: 26 }}
          >
            <Search className="h-3 w-3" />
            <span className="min-w-0 flex-1 truncate text-left">{t('app.searchPlaceholder')}</span>
            <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1 font-editor text-[10px] sm:inline">{commandChordLabel('palette',resolveBindings(effective.bindings),mac)}</kbd>
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        {!emptyWorkspace&&<ActivityBar view={view} />}
        <div className="min-w-0 flex-1">
          <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('project.processing')}</div>}>
          {emptyWorkspace&&<WelcomePage/>}
          {!emptyWorkspace&&visited.has("reader") && <section hidden={view!=="reader"} className="h-full" aria-label={t('app.aria.reader')}>
            <ReaderView libraryFiles={libraryFiles} onTex={openTex}
              openFiles={openFiles}
              activeId={activeId}
              onOpenFiles={setOpenFiles}
              onActive={setActiveId}
            />
          </section>}
          {project.id!=='empty'&&visited.has("writer") && <section hidden={view!=="writer"} className="h-full" aria-label={t('app.aria.writer')}><WriterView requestedFile={writerFile} problemTarget={problemTarget} /></section>}
          {visited.has("library") && <section hidden={view!=="library"} className="h-full" aria-label={t('app.aria.library')}><LibraryView onOpen={openLibraryPaper} /></section>}
          {project.id!=='empty'&&visited.has("history") && <section hidden={view!=="history"} className="h-full" aria-label={t('app.aria.history')}><GitHistoryView /></section>}
          {visited.has("settings") && <section hidden={view!=="settings"} className="h-full" aria-label={t('app.aria.settings')}><SettingsView /></section>}
          {!view&&!page.redirect&&<div className="flex h-full flex-col items-center justify-center gap-3"><h1 className="text-lg font-medium">{t('app.notFound.title')}</h1><p className="text-sm text-muted-foreground">{t('app.notFound.body')}</p><Link to="/writer" className="text-sm text-primary">{t('app.notFound.back')}</Link></div>}
          </Suspense>
        </div>
      </div>

      {/* 状态栏 */}
      {!emptyWorkspace&&<div className="flex h-6.5 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground" style={{ height: 26 }}>
        <div className="flex items-center gap-3">
          {project.id!=='empty'&&<GitStatusPanel />}
          {project.id!=='empty'&&<ProblemsPanel onNavigate={target=>{setProblemTarget(target);setView("writer");}} />}
          <span>{t('app.statusbar.workspace')}：{view?t(`view.${view}`):t('app.statusbar.pageNavigation')}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            {agent.status?.runtime?t('app.statusbar.runtime'):t('app.statusbar.disconnected')}
          </span>
          <span className="font-editor">{effective.engine==='xelatex'?'XeLaTeX':'pdfLaTeX'}</span>
          <span className="font-editor">UTF-8</span>
        </div>
      </div>}

      {/* ⌘K 命令面板 */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder={t('app.palettePlaceholder')} />
        <CommandList>
          <CommandEmpty>{t('app.paletteEmpty')}</CommandEmpty>
          <CommandGroup heading={t('app.paletteViews')}>
            <CommandItem onSelect={() => { setView("reader"); setPaletteOpen(false); }}>
              <BookOpenText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t('view.reader')}
            </CommandItem>
            <CommandItem onSelect={() => { setView("writer"); setPaletteOpen(false); }}>
              <PenLine className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t('view.writer')}
            </CommandItem>
            <CommandItem onSelect={() => { setView("library"); setPaletteOpen(false); }}>
              <LibraryBig className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t('view.library')}
            </CommandItem>
            <CommandItem onSelect={() => { setView("history"); setPaletteOpen(false); }}>
              <History className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t('view.history')}
            </CommandItem>
            <CommandItem onSelect={() => { setView("settings"); setPaletteOpen(false); }}>
              <Settings className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t('view.settings')}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('app.paletteActions')}>{commands.filter(item=>item.event&&item.scope==='global').map(item=><CommandItem key={item.id} onSelect={()=>{setPaletteOpen(false);setTimeout(()=>runCommand(item),0);}}><span>{t(`command.${item.id}` as MessageKey)}</span><kbd className="ml-auto text-[10px] text-muted-foreground">{commandChordLabel(item.id,resolveBindings(effective.bindings),mac)}</kbd></CommandItem>)}</CommandGroup>
          <CommandGroup heading={t('app.paletteFiles')}>
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
