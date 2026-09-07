import {editorFonts} from "@/settings/model";
import {useSettings} from "@/settings/useSettings";
import {useEditorLint} from "@/project/useEditorLint";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ResizablePanelGroup as PanelGroup, ResizablePanel as Panel, ResizableHandle as PanelResizeHandle } from "@/components/ui/resizable";
import { ListTree, BookMarked, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/project/context";
import { ProjectPdfPreview } from "@/project/ProjectPdfPreview";
import { buildOutline } from "@/lib/paperOutline";
import { PaperOutline } from "@/components/PaperOutline";
import { collectPaper, type SourceLocation } from "@/lib/paperSources";
import { AssetsPanel } from "@/components/AssetsPanel";
import { ReferencesPanel } from "@/components/ReferencesPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { LatexEditor, type LatexEditorHandle } from "@/components/LatexEditor";
import {useT} from "@/i18n/useT";
import {useLocation} from 'react-router';


const sideTabs = [
  { id: "outline", labelKey: "writer.tabOutline", icon: ListTree },
  { id: "refs", labelKey: "writer.tabRefs", icon: BookMarked },
  { id: "assets", labelKey: "writer.tabAssets", icon: Package },
] as const;
type SideTab = (typeof sideTabs)[number]["id"];

export function WriterView({problemTarget,requestedFile}:{requestedFile?:{id:string;request:number};problemTarget?:import("@/project/ProblemsPanel").ProblemTarget}) {
  const location=useLocation();
  const {effective}=useSettings();
  const [pdfTarget,setPdfTarget] = useState<{title:string;id:number}|undefined>();
  const {t}=useT();
  const [syncPoint,setSyncPoint] = useState<{path:string;line:number;id:number}|undefined>();
  const [tab, setTab] = useState<SideTab>("outline");
  const editor = useRef<LatexEditorHandle>(null);
  const { project, edit, busy } = useProject();
  const sources = useMemo(() => project.files.filter((file) => file.kind === "latex" && file.text !== undefined).map((file) => ({ id: file.id, path: file.path, text: file.text! })), [project.files]);
  const [activeId, setActiveId] = useState(requestedFile?.id??problemTarget?.fileId??project.rootId);
  const [lastRequested,setLastRequested]=useState(requestedFile);
  if(requestedFile&&requestedFile!==lastRequested){setLastRequested(requestedFile);setActiveId(requestedFile.id);}
  const pendingLocation = useRef<SourceLocation | null>(null);
  const editable=project.files.filter(file=>file.text!==undefined);
  const active = editable.find((file) => file.id === activeId) ?? sources[0];
  const source = active?.text ?? "";
  useEffect(()=>{
    const save=(event:Event)=>{if(event.cancelable&&location.pathname==='/writer'&&/\.tex$/i.test(active?.path??'')){event.preventDefault();window.dispatchEvent(new Event('envoi:save-compile'));}};
    window.addEventListener('envoi:save',save,true);return()=>window.removeEventListener('envoi:save',save,true);
  },[location.pathname,active?.path]);

  useEditorLint(active?.id,active?.path,source);
  const setSource = (text: string) => { if (active && !busy) edit(active.id, text); };
  const paper = useMemo(() => collectPaper(sources, project.rootId), [sources, project.rootId]);
  const locate = (location: SourceLocation) => {
    if (location.fileId === activeId) editor.current?.locate(location.start, location.end);
    else { pendingLocation.current = location; setActiveId(location.fileId); }
  };
  // PDF 点击 → 定位源码行（路径已在预览侧匹配回项目相对路径）。
  const locateSource = (path:string,line:number) => {
    const file=editable.find(f=>f.path===path);if(!file?.text)return;
    const lines=file.text.split('\n');
    const start=lines.slice(0,line-1).reduce((n,text)=>n+text.length+1,0);
    locate({fileId:file.id,path,start,end:start+(lines[line-1]?.length??0)});
  };
  useLayoutEffect(() => {
    if (pendingLocation.current) { const location = pendingLocation.current; pendingLocation.current = null; editor.current?.locate(location.start, location.end); }
  }, [activeId]);

  const [lastProblem,setLastProblem]=useState(problemTarget);
  if(problemTarget&&problemTarget!==lastProblem){setLastProblem(problemTarget);setActiveId(problemTarget.fileId);}
  useLayoutEffect(()=>{if(problemTarget?.fileId===activeId)editor.current?.locate(problemTarget.start,problemTarget.end);},[problemTarget,activeId]);
  const outline = useMemo(() => buildOutline(sources, project.rootId), [sources, project.rootId]);
  useEffect(() => {
    const onPanel = (event: Event) => {
      const panel = (event as CustomEvent<string>).detail;
      if (panel === "outline" || panel === "refs" || panel === "assets") setTab(panel);
    };
    window.addEventListener("envoi:panel", onPanel);
    return () => window.removeEventListener("envoi:panel", onPanel);
  }, []);
  return (
    <PanelGroup orientation="horizontal" className="h-full">
      {/* 左：资源 / 大纲 */}
      <Panel defaultSize="16%" minSize="12%" maxSize="28%" className="bg-card">
        <div className="flex h-full flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
            {sideTabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  tab === item.id ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="h-3 w-3" />
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            {tab === "outline" && <PaperOutline nodes={outline.nodes} warnings={outline.warnings} onLocate={(location,title)=>{locate(location);setPdfTarget(current=>({title,id:(current?.id??0)+1}));}} />}
            <div hidden={tab !== "refs"}><ReferencesPanel paper={paper} editor={editor} onLocate={locate} /></div>
            <div hidden={tab !== "assets"}><AssetsPanel paper={paper} onLocate={locate} /></div>
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />

      {/* 中：编辑器 + 底部 AI 聊天 */}
      <Panel defaultSize="42%" minSize="28%">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <div className="flex h-full flex-col">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card px-3">
                <div className="flex items-center gap-2 text-[12px]">
                  <select aria-label={t('writer.currentFileAria')} className="max-w-48 bg-card text-foreground/90" value={activeId} onChange={(event) => setActiveId(event.target.value)}>{editable.map((file) => <option key={file.id} value={file.id}>{file.path}</option>)}</select>
                </div>
                <span className="font-editor text-[11px] text-muted-foreground">{project.files.some((file) => file.text !== file.saved) ? t('writer.unsavedHint') : t('writer.savedHint')}</span>
              </div>
              <div className="min-h-0 flex-1">
                {active ? <LatexEditor fontSize={effective.fontSize} fontFamily={editorFonts[effective.fontFamily].css} lineHeight={effective.lineHeight} tabSize={effective.tabSize} highlight={problemTarget?.fileId===activeId?{start:problemTarget.start,severity:problemTarget.severity}:undefined} onDoubleClickLine={(line)=>setSyncPoint(current=>({path:active.path,line,id:(current?.id??0)+1}))} ref={editor} value={source} onChange={setSource} /> : <p className="p-4 text-sm text-muted-foreground">{t('writer.noLatex')}</p>}
              </div>
            </div>
          </div>
          <div className="shrink-0 bg-editor">
            <ChatPanel compact inputOnly context={active?{label:active.path,text:source}:undefined} />
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />

      {/* 右：编译预览 */}
      <Panel defaultSize="42%" minSize="18%" maxSize="45%">
        <ProjectPdfPreview target={pdfTarget} syncPoint={syncPoint} onLocateSource={locateSource} />
      </Panel>
    </PanelGroup>
  );
}
