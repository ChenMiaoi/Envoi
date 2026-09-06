import { useCallback, useEffect, useId, useRef, useState } from "react";
import {matchBookmark} from "@/lib/pdfSync";
import {forwardLookup,gunzipSyncTex,inverseLookup,matchSyncTexPath,parseSyncTex,type SyncTexDB} from "@/lib/syncTex";
import { ChevronDown, FileUp } from "lucide-react";
import { AnnotationLayer, getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import type { PDFLinkService } from "pdfjs-dist/types/web/pdf_link_service.js";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;
const base = import.meta.env.BASE_URL;

function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    const query = matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    onChange();
    return () => { query.removeEventListener("change", onChange); window.removeEventListener("resize", onChange); };
  }, [dpr]);
  return dpr;
}

function scrollToPagePosition(container: HTMLElement | null, pageNumber: number, fraction: number) {
  const figure = container?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
  const scroller = container?.parentElement;
  if (!figure || !scroller) return;
  scroller.scrollTo({
    top: scroller.scrollTop + figure.getBoundingClientRect().top - scroller.getBoundingClientRect().top + fraction * figure.clientHeight - 20,
    behavior: "smooth",
  });
}

/** Minimal PDFLinkService：外部链接新窗口打开，内部目标跳转到本组件的滚动位置。 */
function createLinkService(documentRef: React.RefObject<PDFDocumentProxy | null>, pagesRef: React.RefObject<PDFPageProxy[]>, containerRef: React.RefObject<HTMLDivElement | null>) {
  const goToPage = (pageNumber: number) => {
    const total = pagesRef.current.length;
    if (total) scrollToPagePosition(containerRef.current, Math.min(Math.max(1, pageNumber), total), 0);
  };
  const service = {
    externalLinkEnabled: true,
    eventBus: null,
    addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow?: boolean) {
      if (!url || /^\s*javascript:/i.test(url)) { link.removeAttribute("href"); return; }
      link.href = url;
      link.target = newWindow ? "" : "_blank";
      link.rel = "noopener noreferrer nofollow";
    },
    getAnchorUrl: (hash: string) => hash || "#",
    getDestinationHash(dest: unknown) {
      if (Array.isArray(dest) && typeof dest[0] === "number") return `#page=${dest[0] + 1}`;
      return "#";
    },
    async goToDestination(dest: string | unknown[]) {
      const doc = documentRef.current;
      if (!doc) return;
      const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return;
      const index = typeof explicit[0] === "number" ? explicit[0] : await doc.getPageIndex(explicit[0] as never);
      const page = pagesRef.current[index];
      if (!page) return;
      const viewport = page.getViewport({ scale: 1 });
      const mode = (explicit[1] as { name?: string } | undefined)?.name;
      let fraction = 0;
      if (mode === "XYZ" && typeof explicit[3] === "number") {
        const [, y] = viewport.convertToViewportPoint((explicit[2] as number) ?? 0, explicit[3] as number);
        fraction = y / viewport.height;
      } else if ((mode === "FitH" || mode === "FitBH") && typeof explicit[2] === "number") {
        const [, y] = viewport.convertToViewportPoint(0, explicit[2] as number);
        fraction = y / viewport.height;
      }
      scrollToPagePosition(containerRef.current, index + 1, fraction);
    },
    goToPage,
    executeNamedAction(action: string) {
      const container = containerRef.current, scroller = container?.parentElement;
      if (!container || !scroller) return;
      const figures = [...container.querySelectorAll<HTMLElement>("[data-pdf-page]")];
      let current = 1;
      const top = scroller.getBoundingClientRect().top;
      for (const figure of figures) if (figure.getBoundingClientRect().top <= top + 40) current = Number(figure.dataset.pdfPage);
      if (action === "NextPage") goToPage(current + 1);
      else if (action === "PrevPage") goToPage(current - 1);
      else if (action === "FirstPage") goToPage(1);
      else if (action === "LastPage") goToPage(figures.length);
    },
    executeSetOCGState() { /* 可选内容组切换暂不支持 */ },
    getAttachmentContent: async () => null,
  };
  return service as unknown as PDFLinkService;
}

function PdfPage({ page, width, dpr, linkService, onError, highlight, separator, onClickPoint }: { separator?: boolean; highlight?: number; page: PDFPageProxy; width: number; dpr: number; linkService: PDFLinkService | null; onClickPoint?: (page: number, x: number, y: number) => void; onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const original = page.getViewport({ scale: 1 });
  const height = width * original.height / original.width;
  const scale = width / original.width;
  useEffect(() => {
    const canvas = canvasRef.current, text = textRef.current;
    if (!canvas || !text || !width) return;
    let active = true;
    // 位图密度跟随 DPR；32M 像素内存预算避免极端宽度下画布过大。
    const density = Math.min(dpr, Math.sqrt(32_000_000 / (width * height)));
    const bitmapViewport = page.getViewport({ scale: scale * density });
    canvas.width = Math.ceil(bitmapViewport.width);
    canvas.height = Math.ceil(bitmapViewport.height);
    text.innerHTML = "";
    const task = page.render({ canvas, viewport: bitmapViewport });
    const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: page.getViewport({ scale }) });
    Promise.all([task.promise, textLayer.render()]).then(() => { if (active) setError(""); }).catch((reason: Error) => {
      if (active && reason.name !== "RenderingCancelledException") {
        const message = `第 ${page.pageNumber} 页渲染失败：${reason.message}`;
        setError(message); onError(message);
      }
    });
    return () => { active = false; task.cancel(); textLayer.cancel(); };
  }, [page, width, height, scale, dpr, onError]);
  useEffect(() => {
    const annotation = annotationRef.current;
    if (!annotation || !width) return;
    let active = true;
    annotation.innerHTML = "";
    const viewport = page.getViewport({ scale }).clone({ dontFlip: true });
    const layer = new AnnotationLayer({ div: annotation, page, viewport, linkService, accessibilityManager: undefined, annotationCanvasMap: undefined, annotationEditorUIManager: undefined, structTreeLayer: undefined, commentManager: undefined, annotationStorage: undefined });
    page.getAnnotations({ intent: "display" }).then((list) => active ? layer.render({ viewport, div: annotation, page, linkService: linkService as PDFLinkService, annotations: list, renderForms: false }) : undefined).catch(() => { /* 注释层失败不影响正文渲染 */ });
    return () => { active = false; };
  }, [page, width, scale, linkService]);
  return <figure data-pdf-page={page.pageNumber} className="m-0 shrink-0" aria-label={`第 ${page.pageNumber} 页`}>
    <div className="relative bg-white" style={{ width, height, "--scale-factor": scale, "--user-unit": 1, "--total-scale-factor": "calc(var(--scale-factor) * var(--user-unit))", "--scale-round-x": "1px", "--scale-round-y": "1px" } as React.CSSProperties} onClick={onClickPoint ? (event) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if ((event.target as HTMLElement).closest("a,button,input,textarea")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      onClickPoint(page.pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
    } : undefined}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`PDF 第 ${page.pageNumber} 页`} />
      {separator&&<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-slate-300/50" />}
      {highlight!==undefined&&<div className="pointer-events-none absolute left-0 right-0 h-6 border-t-2 border-amber-400/60 bg-amber-300/15" style={{top:highlight*width/original.width}} />}
      <div ref={textRef} className="textLayer" />
      <div ref={annotationRef} className="annotationLayer" />
      {error && <p role="alert" className="absolute inset-3 text-sm text-red-600">{error}</p>}
    </div>
  </figure>;
}

export function TexCompilePreview({ initialSource, paperOnly = false, target, syncReady, syncData, sourcePaths, syncPoint, onLocateSource }: { target?:{title:string;id:number};syncReady?:boolean|null;paperOnly?: boolean; initialSource?: { file?: File; name: string; url?: string }; syncData?: Uint8Array | null; sourcePaths?: string[]; syncPoint?: { path: string; line: number; id: number }; onLocateSource?: (path: string, line: number) => void }) {
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
  const dpr = useDevicePixelRatio();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logId = useId();
  const pagesRef = useRef<PDFPageProxy[]>([]);
  const [linkService, setLinkService] = useState<PDFLinkService | null>(null);
  const [syncDb, setSyncDb] = useState<SyncTexDB | null>(null);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { setLinkService(createLinkService(documentRef, pagesRef, containerRef)); }, []);
  const onRenderError = useCallback((message: string) => {
    setStatus("页面渲染失败");
    setLogs((previous) => previous.includes(message) ? previous : [...previous, message]);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let db: SyncTexDB | null = null;
      try { if (syncData) db = parseSyncTex(await gunzipSyncTex(syncData)); } catch { /* 映射损坏时退化为仅渲染。 */ }
      if (active) setSyncDb(db);
    })();
    return () => { active = false; };
  }, [syncData]);
  const pathOfInput = useCallback((input: number) => syncDb && sourcePaths ? matchSyncTexPath(sourcePaths, syncDb.inputs[input]) : undefined, [syncDb, sourcePaths]);
  const clickPoint = useCallback((page: number, x: number, y: number) => {
    if (!syncDb || !onLocateSource) return;
    const hit = inverseLookup(syncDb, pathOfInput, page, x, y);
    if (hit) onLocateSource(hit.path, hit.line);
  }, [syncDb, pathOfInput, onLocateSource]);
  // 正向：编辑器双击 → 滚动到对应 PDF 位置并短暂高亮。
  useEffect(() => {
    if (!syncPoint || !syncDb || !pages.length) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.resolve().then(() => {
      if (!active) return;
      const hit = forwardLookup(syncDb, pathOfInput, syncPoint.path, syncPoint.line);
      if (!hit) { setSyncNotice("该行没有对应的 PDF 位置；可能不参与输出，或正文改动后尚未重新编译。"); return; }
      const viewport = pages[hit.page - 1]?.getViewport({ scale: 1 });
      if (!viewport) return;
      scrollToPagePosition(containerRef.current, hit.page, hit.y / viewport.height);
      setHighlight({ page: hit.page, y: hit.y }); setSyncNotice("");
      timer = setTimeout(() => setHighlight(null), 1800);
    });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [syncPoint, syncDb, pages, width, pathOfInput]);


  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
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
      {error && <p role="alert" className="p-3 text-sm text-danger">{error}</p>}
        {!error && !pages.length && <p className="p-3 text-sm text-muted-foreground">{source.name ? "正在加载 PDF…" : paperOnly ? "尚无当前论文的编译输出。点击上方编译正文以生成 PDF。" : "项目中暂无 PDF，请打开文件或将编译产物放入项目目录后重新打开项目。"}</p>}
        {pages.map((page,index) => <PdfPage separator={index>0} key={page.pageNumber} page={page} width={width} dpr={dpr} linkService={linkService} onError={onRenderError} onClickPoint={syncDb&&onLocateSource?clickPoint:undefined} highlight={highlight?.page===page.pageNumber?highlight.y:undefined} />)}
      </div>
    </div>
    <div id={logId} hidden={!logOpen} className="shrink-0 border-t border-border bg-card p-3">
      <div className="mb-1 text-[11px] text-muted-foreground">PDF 加载日志</div>
      <div className="scrollbar-thin max-h-20 overflow-auto text-[11px] leading-relaxed text-muted-foreground">{logs.map((log, index) => <div key={index}>{log}</div>)}</div>
    </div>
  </div>;
}
