import {usePreferences} from "@/settings/context";
import {editorFonts} from "@/settings/model";
import { useEffect, useMemo, useState } from "react";
import { ResizablePanelGroup as PanelGroup, ResizablePanel as Panel, ResizableHandle as PanelResizeHandle } from "@/components/ui/resizable";
import { X, BookMarked, FileText, FileCode2, FileType2, Image as ImageIcon, FolderTree, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { type FileNode } from "@/data/workspace";
import { useProject } from "@/project/context";
import { projectTree } from "@/lib/projectFiles";
import { TexCompilePreview } from "@/components/TexCompilePreview";
import { FileTree } from "@/components/FileTree";
import { ChatPanel } from "@/components/ChatPanel";
import {fileKind} from "@/lib/projectFiles";
import {DelimitedEditor} from "@/components/DelimitedEditor";
import {MarkdownEditor} from "@/components/MarkdownEditor";
import { LatexViewer, BibViewer, ViewerBadge } from "@/components/viewers";
import { extractPdfText } from "@/lib/metadataLookup";

const tabIcon: Record<string, typeof FileText> = {
  pdf: BookMarked,
  markdown: FileText,
  latex: FileCode2,
  bib: FileType2,
  image: ImageIcon,
};

export interface OpenFile {
  id: string;
  name: string;
  kind: string;
}

export function ReaderView({
  openFiles,
  activeId,
  onOpenFiles,
  onActive,onTex,libraryFiles,
}: {
  openFiles: OpenFile[];
  activeId: string | null;
  onOpenFiles: (f: OpenFile[]) => void;
  libraryFiles:import("@/lib/projectFiles").ProjectFile[];
  onActive: (id: string) => void;onTex:(id:string)=>void;
}) {
  const {preferences}=usePreferences();
  const { project, edit, busy } = useProject();
  const fileTree = useMemo(() => projectTree(project.files, project.directories), [project.files, project.directories]);
  const fileContents = Object.fromEntries(project.files.map((file) => [file.id, file.text]));
  const activeData = [...project.files,...libraryFiles].find((file) => file.id === activeId);
  const kind=activeData?fileKind(activeData.path):undefined;
  const [showChat, setShowChat] = useState(true);
  const [showTree, setShowTree] = useState(true);
  const active = openFiles.find((f) => f.id === activeId);
  const [pdfContext, setPdfContext] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    const file = kind === 'pdf' ? activeData?.file : undefined;
    if (!file || !activeId) return;
    let live = true;
    extractPdfText(file, 2).then(text => { if (live) setPdfContext({ id: activeId, text: text.slice(0, 4000) }); }).catch(() => {});
    return () => { live = false; };
  }, [activeId, kind, activeData?.file]);

  const openNode = (n: FileNode) => {
    if(n.kind==='latex'){onTex(n.id);return;}
    if (!openFiles.find((f) => f.id === n.id)) onOpenFiles([...openFiles, { id: n.id, name: n.name, kind: n.kind }]);
    onActive(n.id);
  };

  const close = (id: string) => {
    const rest = openFiles.filter((f) => f.id !== id);
    onOpenFiles(rest);
    if (activeId === id && rest.length) onActive(rest[rest.length - 1].id);
  };

  useEffect(() => {
    const onTab = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      const index = openFiles.findIndex((f) => f.id === activeId);
      if (action === 'close') {
        if (!activeId) return;
        const rest = openFiles.filter((f) => f.id !== activeId);
        onOpenFiles(rest);
        if (rest.length) onActive(rest[rest.length - 1].id);
      } else if ((action === 'prev' || action === 'next') && openFiles.length > 1) {
        const next = openFiles[((index < 0 ? 0 : index) + (action === 'next' ? 1 : openFiles.length - 1)) % openFiles.length];
        if (next) onActive(next.id);
      }
    };
    const onPanel = (event: Event) => {
      const panel = (event as CustomEvent<string>).detail;
      if (panel === 'tree') setShowTree((v) => !v);
      else if (panel === 'chat') setShowChat((v) => !v);
    };
    window.addEventListener('paperdesk:tab', onTab);
    window.addEventListener('paperdesk:panel', onPanel);
    return () => { window.removeEventListener('paperdesk:tab', onTab); window.removeEventListener('paperdesk:panel', onPanel); };
  }, [openFiles, activeId, onOpenFiles, onActive]);


  return (
    <PanelGroup orientation="horizontal" className="h-full">
      {/* 左：目录树 */}
      {showTree && (
          <Panel defaultSize="17%" minSize="12%" maxSize="30%" className="bg-card">
            <div className="flex h-full flex-col">
              <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span>资源管理器</span>
              </div>
              <div className="min-h-0 flex-1">
                <FileTree rootName={project.id==='empty'?undefined:project.name} nodes={fileTree} activeId={activeId} onOpen={openNode} />
              </div>
            </div>
          </Panel>
      )}
      {showTree && <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />}

      {/* 中：编辑/预览区 */}
      <Panel minSize="30%">
        <div className="flex h-full flex-col bg-background">
          {/* 标签栏 */}
          <div className="scrollbar-none flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card">
            {openFiles.map((f) => {
              const Icon = tabIcon[f.kind] ?? FileText;
              const isActive = f.id === activeId;
              return (
                <div
                  key={f.id}
                  onClick={() => f.kind==='latex'?onTex(f.id):onActive(f.id)}
                  className={cn(
                    "group flex cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-[12px]",
                    isActive ? "bg-background text-foreground shadow-[inset_0_2px_0_0_hsl(var(--primary))]" : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span className="whitespace-nowrap">{f.name}{project.files.find(file=>file.id===f.id)?.text!==project.files.find(file=>file.id===f.id)?.saved?" · 未保存":""}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); close(f.id); }}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            <div className="flex-1" />
            <div className="flex items-center gap-1 px-2">
              <button
                title={showTree ? "隐藏目录树" : "显示目录树"}
                onClick={() => setShowTree(!showTree)}
                className={cn("rounded-md p-1.5 transition-colors", showTree ? "text-primary" : "text-muted-foreground hover:bg-secondary")}
              >
                <FolderTree className="h-3.5 w-3.5" />
              </button>
              <button
                title={showChat ? "隐藏 AI 面板" : "显示 AI 面板"}
                onClick={() => setShowChat(!showChat)}
                className={cn("rounded-md p-1.5 transition-colors", showChat ? "text-primary" : "text-muted-foreground hover:bg-secondary")}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* 内容：打开后默认进入对应预览模式 */}
          <div className="min-h-0 flex-1">
            {!active ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <div className="text-[13px]">从左侧目录树打开一个文件</div>
                <div className="text-[11px] text-muted-foreground/60">PDF · Markdown · 表格按类型打开；LaTeX 文件进入写作页</div>
              </div>
            ) : activeData?.text === undefined && kind!=='image'&&kind!=='pdf' ? (
              <p className="p-4 text-sm text-muted-foreground">此文件不是可编辑的 UTF-8 文本，暂无预览；原文件保持不变。</p>
            ) : kind === "markdown" ? (
              <MarkdownEditor key={active.id} source={fileContents[active.id] ?? ""} readOnly={busy} onChange={text=>edit(active.id,text)} path={activeData?.path??active.name} files={project.files} onOpen={file=>openNode({id:file.id,name:file.path,kind:file.kind})} />
            ) : (kind === "csv" || kind === "tsv") && activeData?.text !== undefined ? (
              <DelimitedEditor key={active.id} source={activeData.text} delimiter={kind==='tsv'?'\t':','} onChange={text=>edit(active.id,text)} readOnly={busy} />
            ) : kind === "text" && activeData?.text !== undefined ? (
              <textarea aria-label="文本源码编辑器" readOnly={busy} value={activeData.text} onChange={e=>edit(active.id,e.target.value)} data-content-typography="editor" className="h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-4 outline-none" style={{fontFamily:editorFonts[preferences.fontFamily].css,fontSize:preferences.fontSize,lineHeight:preferences.lineHeight,tabSize:preferences.tabSize}} />
            ) : kind === "latex" ? (
              <LatexViewer source={fileContents[active.id] ?? ""} />
            ) : kind === "bib" ? (
              <BibViewer source={fileContents[active.id] ?? ""} />
            ) : kind === "pdf" ? (
              activeData?.file || activeData?.url ? <TexCompilePreview key={`${active.id}:${activeData?.file?.lastModified??activeData?.url}`} initialSource={{ name: activeData.path, file: activeData.file, url: activeData.url }} /> : <p className="p-4 text-xs text-muted-foreground">此文件没有可访问的 PDF 内容。</p>
            ) : (
              kind==='image'&&activeData?.url ? <img className="max-h-full max-w-full object-contain" src={activeData.url} alt={active.name} /> : <p className="p-4 text-xs text-muted-foreground">此格式暂无预览，或内容不是可编辑的 UTF-8 文本。原文件保持不变。</p>
            )}
          </div>

          {/* 底部信息条 */}
          {active && (
            <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
              <span><ViewerBadge kind={kind??active.kind} /></span>
              <span className="font-editor">
                {kind === "pdf" ? "PDF 原始分页" : `${(fileContents[active.id] ?? "").split("\n").length} 行 · UTF-8`}
              </span>
            </div>
          )}
        </div>
      </Panel>

      {/* 右：AI 聊天 */}
      {showChat && <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />}
      {showChat && (
          <Panel defaultSize="23%" minSize="16%" maxSize="40%">
            <ChatPanel context={active?{label:activeData?.path??active.name,text:activeData?.text!==undefined?activeData.text:(kind==='pdf'&&pdfContext?.id===active.id?pdfContext.text:'')}:undefined} />
          </Panel>
      )}
    </PanelGroup>
  );
}
