import { useCallback, useEffect, useId, useRef, useState } from "react";
import {matchBookmark} from "@/lib/pdfSync";
import { ChevronDown, FileUp } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
const base = import.meta.env.BASE_URL;

function PdfPage({ page, width, onError, highlight, separator }: { separator?:boolean;highlight?:number; page: PDFPageProxy; width: number; onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const original = page.getViewport({ scale: 1 });
  const height = width * original.height / original.width;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    let active = true;
    const scale = width / original.width;
    // Limit bitmap memory while keeping CSS sizing faithful to the PDF page.
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (width * height)));
    const viewport = page.getViewport({ scale: scale * density });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvas, viewport });
    task.promise.then(() => { if (active) setError(""); }).catch((reason: Error) => {
      if (active && reason.name !== "RenderingCancelledException") {
        const message = `第 ${page.pageNumber} 页渲染失败：${reason.message}`;
        setError(message); onError(message);
      }
    });
    return () => { active = false; task.cancel(); };
  }, [page, width, height, original.width, onError]);
  return <figure data-pdf-page={page.pageNumber} className="m-0 shrink-0" aria-label={`第 ${page.pageNumber} 页`}>
    <div className="relative bg-white" style={{ width, height }}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`PDF 第 ${page.pageNumber} 页`} />
      {separator&&<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-slate-300/50" />}
      {highlight!==undefined&&<div className="pointer-events-none absolute left-0 right-0 h-6 border-t-2 border-amber-400/60 bg-amber-300/15" style={{top:highlight*width/original.width}} />}
      {error && <p role="alert" className="absolute inset-3 text-sm text-red-600">{error}</p>}
    </div>
  </figure>;
}

export function TexCompilePreview({ initialSource, paperOnly = false, target, syncReady }: { target?:{title:string;id:number};syncReady?:boolean|null;paperOnly?: boolean; initialSource?: { file?: File; name: string; url?: string } }) {
  const [source, setSource] = useState<{ file?: File; name: string; url?: string }>(initialSource ?? { name: "" });
  const documentRef=useRef<PDFDocumentProxy|null>(null);
  const [syncNotice,setSyncNotice]=useState("");
  const [highlight,setHighlight]=useState<{page:number;y:number}|null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [status, setStatus] = useState("正在加载 PDF…");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logId = useId();
  const onRenderError = useCallback((message: string) => {
    setStatus("页面渲染失败");
    setLogs((previous) => previous.includes(message) ? previous : [...previous, message]);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    let document: PDFDocumentProxy | undefined;
    async function load() {
      containerRef.current?.parentElement?.scrollTo({ top: 0 });
      setPages([]); setError(""); setStatus("正在加载 PDF…");
      setLogs([`正在读取 ${source.name}`, "此面板读取 PDF 文件；项目编译结果由上方编译操作更新。"]);
      if (!source.file&&!source.url) { setStatus("未选择 PDF"); setLogs(["项目尚无可预览的 PDF；可打开本地文件。"]); return; }
      try {
        const data = source.file ? new Uint8Array(await source.file.arrayBuffer()) : undefined;
        if (!active) return;
        task = getDocument({ ...(data ? { data } : { url: source.url }),
          cMapUrl: `${base}pdfjs/cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${base}pdfjs/standard_fonts/`, wasmUrl: `${base}pdfjs/wasm/` });
        document = await task.promise;documentRef.current=document;
        const loaded: PDFPageProxy[] = [];
        for (let number = 1; number <= document.numPages; number++) {
          loaded.push(await document.getPage(number));
          if (!active) return;
        }
        setPages(loaded); setStatus(`已加载 · ${document.numPages} 页`);
        setLogs((previous) => [...previous, `PDF 解析成功，共 ${document!.numPages} 页。`, "页面按 PDF 原始尺寸及旋转方向等比渲染。"]);
      } catch (reason) {
        if (!active) return;
        const failure = reason as Error;
        const message = failure.name === "PasswordException" ? "此 PDF 需要密码，请选择未加密的文件。" : `无法加载 PDF：${failure.message}`;
        setError(message); setStatus("加载失败"); setLogs((previous) => [...previous, message]);
      }
    }
    void load();
    return () => { active = false;documentRef.current=null; void task?.destroy(); };
  }, [source]);

  useEffect(()=>{
    if(!target)return;
    let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    if(syncReady!==true)return;
    const pdf=documentRef.current;if(!pdf||!pages.length)return;
    void (async()=>{
      const bookmark=matchBookmark(await pdf.getOutline()??[],target.title);
      if(!bookmark?.dest){if(active)setSyncNotice('已定位源码；当前 PDF 没有唯一对应的章节书签。');return;}
      const destination=typeof bookmark.dest==='string'?await pdf.getDestination(bookmark.dest):bookmark.dest;
      if(!destination||destination[1]?.name!=='XYZ'){if(active)setSyncNotice('已定位源码；此 PDF 书签位置格式暂不支持。');return;}
      const index=typeof destination[0]==='number'?destination[0]:await pdf.getPageIndex(destination[0]);
      const page=pages[index],viewport=page.getViewport({scale:1});
      const [,y]=viewport.convertToViewportPoint(destination[2]??0,destination[3]??viewport.viewBox[3]);
      const figure=containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${index+1}"]`),scroller=containerRef.current?.parentElement;
      if(!active||!figure||!scroller)return;
      scroller.scrollTo({top:scroller.scrollTop+figure.getBoundingClientRect().top-scroller.getBoundingClientRect().top+y*width/viewport.width-20,behavior:'smooth'});
      setHighlight({page:index+1,y});setSyncNotice('');timer=setTimeout(()=>setHighlight(null),1800);
    })().catch(()=>{if(active)setSyncNotice('已定位源码；无法读取 PDF 章节位置。');});
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[target,syncReady,pages,width]);

  const navigationNotice=target&&syncReady!==true?(syncReady===null?'正在校验论文与正文…':'已定位源码；PDF 未经同步校验或正文已有改动，请重新编译。'):syncNotice;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-editor">
    {!paperOnly && <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1 text-[11.5px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-40 truncate" title={source.name}>{source.name}</span>
        <button type="button" aria-expanded={logOpen} aria-controls={logId} onClick={() => setLogOpen((open) => !open)} className="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-secondary">
          {status}<ChevronDown className={`h-3 w-3 ${logOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-primary-foreground"><FileUp className="h-3 w-3" />打开 PDF</button>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="选择本地 PDF" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) setSource({ file, name: file.name });
        event.target.value = "";
      }} />
    </div>}
    {paperOnly&&navigationNotice&&<p role="status" className="shrink-0 px-3 py-1 text-[10px] text-muted-foreground">{navigationNotice}</p>}
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
      <div data-content-typography="pdf" ref={containerRef} className="flex w-full flex-col">
      {error && <p role="alert" className="p-3 text-sm text-red-400">{error}</p>}
        {!error && !pages.length && <p className="p-3 text-sm text-muted-foreground">{source.name ? "正在加载 PDF…" : paperOnly ? "尚无当前论文的编译输出。点击上方编译正文以生成 PDF。" : "项目中暂无 PDF，请打开文件或将编译产物放入项目目录后重新打开项目。"}</p>}
        {pages.map((page,index) => <PdfPage separator={index>0} key={page.pageNumber} page={page} width={width} onError={onRenderError} highlight={highlight?.page===page.pageNumber?highlight.y:undefined} />)}
      </div>
    </div>
    <div id={logId} hidden={!logOpen} className="shrink-0 border-t border-border bg-card p-3">
      <div className="mb-1 text-[11px] text-muted-foreground">PDF 加载日志</div>
      <div className="scrollbar-thin max-h-20 overflow-auto text-[11px] leading-relaxed text-muted-foreground">{logs.map((log, index) => <div key={index}>{log}</div>)}</div>
    </div>
  </div>;
}
