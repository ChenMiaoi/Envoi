import {PdfRenderScheduler} from '@/lib/pdfRenderScheduler';
import {useT} from "@/i18n/useT";
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

function PdfPage({ scheduler, page, width, dpr, linkService, onError, highlight, separator, onClickPoint }: { scheduler:PdfRenderScheduler;separator?: boolean; highlight?: number; page: PDFPageProxy; width: number; dpr: number; linkService: PDFLinkService | null; onClickPoint?: (page: number, x: number, y: number) => void; onError: (message: string) => void }) {
  const {t}=useT();
  const figureRef=useRef<HTMLElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    const figure=figureRef.current;if(!figure)return;
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{root:figure.parentElement?.parentElement,rootMargin:'300px 0px'});
    observer.observe(figure);return()=>observer.disconnect();
  },[]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const original = page.getViewport({ scale: 1 });
  const height = width * original.height / original.width;
  const scale = width / original.width;
  useEffect(() => {
    const canvas = canvasRef.current, text = textRef.current, annotationElement=annotationRef.current;
    if (!canvas || !text || !width || !visible) return;
    let active=true;
    const cancel=scheduler.enqueue(async signal=>{
      let task:ReturnType<PDFPageProxy['render']>|undefined,textLayer:TextLayer|undefined;
      const abort=()=>{task?.cancel();textLayer?.cancel();};signal.addEventListener('abort',abort,{once:true});
      try{
        await scheduler.wait(signal);if(!active||signal.aborted)return;
        const density=Math.min(dpr,2,Math.sqrt(4_000_000/(width*height)));
        const bitmapViewport=page.getViewport({scale:scale*density});
        canvas.width=Math.ceil(bitmapViewport.width);canvas.height=Math.ceil(bitmapViewport.height);text.innerHTML='';
        task=page.render({canvas,viewport:bitmapViewport});
        task.onContinue=(resume:()=>void)=>{void scheduler.wait(signal).then(()=>{if(active&&!signal.aborted)resume();}).catch(()=>{});};
        await task.promise;await scheduler.wait(signal);if(!active||signal.aborted)return;
        textLayer=new TextLayer({textContentSource:page.streamTextContent(),container:text,viewport:page.getViewport({scale})});
        await textLayer.render();await scheduler.wait(signal);if(!active||signal.aborted)return;
        const annotation=annotationRef.current;
        if(annotation){
          const viewport=page.getViewport({scale}).clone({dontFlip:true});
          const annotations=await page.getAnnotations({intent:'display'});
          if(active&&!signal.aborted){annotation.innerHTML='';const layer=new AnnotationLayer({div:annotation,page,viewport,linkService,accessibilityManager:undefined,annotationCanvasMap:undefined,annotationEditorUIManager:undefined,structTreeLayer:undefined,commentManager:undefined,annotationStorage:undefined});await layer.render({viewport,div:annotation,page,linkService:linkService as PDFLinkService,annotations,renderForms:false});}
        }
        if(active)setError('');
      }catch(reason){const failure=reason as Error;if(active&&!signal.aborted&&failure.name!=='RenderingCancelledException'){const message=t('compile.renderPageFailed',{page:page.pageNumber,message:failure.message});setError(message);onError(message);}}
      finally{signal.removeEventListener('abort',abort);}
    });
    return()=>{active=false;cancel();canvas.width=0;canvas.height=0;text.innerHTML='';if(annotationElement)annotationElement.innerHTML='';};
  },[page,width,height,scale,dpr,onError,t,visible,linkService,scheduler]);
  return <figure ref={figureRef} data-pdf-page={page.pageNumber} className="m-0 shrink-0" aria-label={t('compile.page',{page:page.pageNumber})}>
    <div className="relative bg-white" style={{ width, height, "--scale-factor": scale, "--user-unit": 1, "--total-scale-factor": "calc(var(--scale-factor) * var(--user-unit))", "--scale-round-x": "1px", "--scale-round-y": "1px" } as React.CSSProperties} onClick={onClickPoint ? (event) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if ((event.target as HTMLElement).closest("a,button,input,textarea")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      onClickPoint(page.pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
    } : undefined}>
      <canvas ref={canvasRef} width={0} height={0} className="block h-full w-full" aria-label={t('compile.pdfPage',{page:page.pageNumber})} />
      {separator&&<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-slate-300/50" />}
      {highlight!==undefined&&<div className="pointer-events-none absolute left-0 right-0 h-6 border-t-2 border-amber-400/60 bg-amber-300/15" style={{top:highlight*width/original.width}} />}
      <div ref={textRef} className="textLayer" />
      <div ref={annotationRef} className="annotationLayer" />
      {error && <p role="alert" className="absolute inset-3 text-sm text-red-600">{error}</p>}
    </div>
  </figure>;
}

export function TexCompilePreview({ initialSource, paperOnly = false, target, syncReady, syncData, sourcePaths, syncPoint, onLocateSource, reading, onReadingChange, jump }: { jump?:{page:number;id:number};reading?:{page:number;fraction:number};onReadingChange?:(position:{page:number;fraction:number})=>void;target?:{title:string;id:number};syncReady?:boolean|null;paperOnly?: boolean; initialSource?: { file?: File; name: string; url?: string }; syncData?: Uint8Array | null; sourcePaths?: string[]; syncPoint?: { path: string; line: number; id: number }; onLocateSource?: (path: string, line: number) => void }) {
  const [source, setSource] = useState<{ file?: File; name: string; url?: string }>(initialSource ?? { name: "" });
  const documentRef=useRef<PDFDocumentProxy|null>(null);
  const [syncNotice,setSyncNotice]=useState("");
  const {t}=useT();
  const [highlight,setHighlight]=useState<{page:number;y:number}|null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [status, setStatus] = useState(() => t('compile.loadingPdf'));
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const dpr = useDevicePixelRatio();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scheduler]=useState(()=>new PdfRenderScheduler());
  useEffect(()=>{
    const scroller=containerRef.current?.parentElement;if(!scroller)return;
    const pause=()=>scheduler.pause();
    scroller.addEventListener('wheel',pause,{passive:true});scroller.addEventListener('scroll',pause,{passive:true});
    return()=>{scroller.removeEventListener('wheel',pause);scroller.removeEventListener('scroll',pause);scheduler.dispose();};
  },[scheduler]);
  useEffect(()=>{if(jump&&pages.length)scrollToPagePosition(containerRef.current,jump.page,0);},[jump,pages]);
  const initialReading=useRef(reading),restoredReading=useRef(false),readingCallback=useRef(onReadingChange);
  useEffect(()=>{readingCallback.current=onReadingChange;},[onReadingChange]);
  useEffect(()=>{
    const container=containerRef.current,scroller=container?.parentElement;
    if(!container||!scroller||!pages.length||!width)return;
    if(!restoredReading.current){const position=initialReading.current;if(position){const figure=container.querySelector<HTMLElement>(`[data-pdf-page="${position.page}"]`);if(figure)scroller.scrollTo({top:scroller.scrollTop+figure.getBoundingClientRect().top-scroller.getBoundingClientRect().top+position.fraction*figure.clientHeight,behavior:'instant'});}restoredReading.current=true;}
    let timer:ReturnType<typeof setTimeout>;let lastPosition:{page:number;fraction:number}|undefined;
    const save=()=>{if(!scroller.clientHeight){if(lastPosition)readingCallback.current?.(lastPosition);return;}const top=scroller.getBoundingClientRect().top;const figures=Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page]'));const figure=figures.find(el=>el.getBoundingClientRect().bottom>top+5);if(figure){lastPosition={page:Number(figure.dataset.pdfPage),fraction:Math.max(0,(top-figure.getBoundingClientRect().top)/figure.clientHeight)};readingCallback.current?.(lastPosition);}};
    const scroll=()=>{clearTimeout(timer);timer=setTimeout(save,250);};scroller.addEventListener('scroll',scroll);
    return()=>{clearTimeout(timer);save();scroller.removeEventListener('scroll',scroll);};
  },[pages,width]);

  const logId = useId();
  const pagesRef = useRef<PDFPageProxy[]>([]);
  const [linkService, setLinkService] = useState<PDFLinkService | null>(null);
  const [syncDb, setSyncDb] = useState<SyncTexDB | null>(null);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { setLinkService(createLinkService(documentRef, pagesRef, containerRef)); }, []);
  const onRenderError = useCallback((message: string) => {
    setStatus(t('compile.renderFailed'));
    setLogs((previous) => previous.includes(message) ? previous : [...previous, message]);
  }, [t]);

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
      if (!hit) { setSyncNotice(t('compile.noSyncPosition')); return; }
      const viewport = pages[hit.page - 1]?.getViewport({ scale: 1 });
      if (!viewport) return;
      scrollToPagePosition(containerRef.current, hit.page, hit.y / viewport.height);
      setHighlight({ page: hit.page, y: hit.y }); setSyncNotice("");
      timer = setTimeout(() => setHighlight(null), 1800);
    });
    return () => { active = false; if (timer) clearTimeout(timer); };
  },[syncPoint, syncDb, pages, width, pathOfInput, t]);


  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // Resize the layout immediately, but rasterize only when dragging settles.
    let timer:ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {clearTimeout(timer);timer=setTimeout(()=>setWidth(Math.round(entry.contentRect.width)),150);});
    observer.observe(element);
    return () => {clearTimeout(timer);observer.disconnect();};
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    let document: PDFDocumentProxy | undefined;
    async function load() {
      containerRef.current?.parentElement?.scrollTo({ top: 0 });
      setPages([]); setError(""); setStatus(t('compile.loadingPdf'));
      setLogs([t('compile.readingFile',{name:source.name}), t('compile.panelHint')]);
      if (!source.file&&!source.url) { setStatus(t('compile.noPdfSelected')); setLogs([t('compile.noPreviewablePdf')]); return; }
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
        setPages(loaded); setStatus(t('compile.loadedPages',{count:document.numPages}));
        setLogs((previous) => [...previous, t('compile.parseSuccess',{count:document!.numPages}), t('compile.renderScaleHint')]);
      } catch (reason) {
        if (!active) return;
        const failure = reason as Error;
        const message = failure.name === "PasswordException" ? t('compile.passwordPdf') : t('compile.loadFailed',{message:failure.message});
        setError(message); setStatus(t('compile.loadError')); setLogs((previous) => [...previous, message]);
      }
    }
    void load();
    return () => { active = false;documentRef.current=null; void task?.destroy(); };
  }, [source, t]);

  useEffect(()=>{
    if(!target)return;
    let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    if(syncReady!==true)return;
    const pdf=documentRef.current;if(!pdf||!pages.length)return;
    void (async()=>{
      const bookmark=matchBookmark(await pdf.getOutline()??[],target.title);
      if(!bookmark?.dest){if(active)setSyncNotice(t('compile.noBookmark'));return;}
      const destination=typeof bookmark.dest==='string'?await pdf.getDestination(bookmark.dest):bookmark.dest;
      if(!destination||destination[1]?.name!=='XYZ'){if(active)setSyncNotice(t('compile.bookmarkFormatUnsupported'));return;}
      const index=typeof destination[0]==='number'?destination[0]:await pdf.getPageIndex(destination[0]);
      const page=pages[index],viewport=page.getViewport({scale:1});
      const [,y]=viewport.convertToViewportPoint(destination[2]??0,destination[3]??viewport.viewBox[3]);
      const figure=containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${index+1}"]`),scroller=containerRef.current?.parentElement;
      if(!active||!figure||!scroller)return;
      scroller.scrollTo({top:scroller.scrollTop+figure.getBoundingClientRect().top-scroller.getBoundingClientRect().top+y*width/viewport.width-20,behavior:'smooth'});
      setHighlight({page:index+1,y});setSyncNotice('');timer=setTimeout(()=>setHighlight(null),1800);
    })().catch(()=>{if(active)setSyncNotice(t('compile.bookmarkReadFailed'));});
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[target,syncReady,pages,width,t]);

  const navigationNotice=target&&syncReady!==true?(syncReady===null?t('compile.verifying'):t('compile.notSynced')):syncNotice;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-editor">
    {!paperOnly && <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1 text-[11.5px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-40 truncate" title={source.name}>{source.name}</span>
        <button type="button" aria-expanded={logOpen} aria-controls={logId} onClick={() => setLogOpen((open) => !open)} className="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-secondary">
          {status}<ChevronDown className={`h-3 w-3 ${logOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-primary-foreground"><FileUp className="h-3 w-3" />{t('compile.openPdf')}</button>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label={t('compile.selectLocalPdf')} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) setSource({ file, name: file.name });
        event.target.value = "";
      }} />
    </div>}
    {onReadingChange&&<div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground"><span>跳转到</span><input aria-label="论文页码" type="number" min={1} max={pages.length||1} defaultValue={reading?.page??1} className="w-16 rounded border bg-background px-2 py-1" onChange={event=>{const page=Number(event.target.value);if(page>=1&&page<=pages.length)scrollToPagePosition(containerRef.current,page,0);}}/><span>/ {pages.length} 页</span></div>}
    {paperOnly&&navigationNotice&&<p role="status" className="shrink-0 px-3 py-1 text-[10px] text-muted-foreground">{navigationNotice}</p>}
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
      <div data-content-typography="pdf" ref={containerRef} className="flex w-full flex-col">
      {error && <p role="alert" className="p-3 text-sm text-danger">{error}</p>}
        {!error && !pages.length && <p className="p-3 text-sm text-muted-foreground">{source.name ? t('compile.loadingPdf') : paperOnly ? t('compile.noOutput') : t('compile.noProjectPdf')}</p>}
        {pages.map((page,index) => <PdfPage scheduler={scheduler} separator={index>0} key={page.pageNumber} page={page} width={width} dpr={dpr} linkService={linkService} onError={onRenderError} onClickPoint={syncDb&&onLocateSource?clickPoint:undefined} highlight={highlight?.page===page.pageNumber?highlight.y:undefined} />)}
      </div>
    </div>
    <div id={logId} hidden={!logOpen} className="shrink-0 border-t border-border bg-card p-3">
      <div className="mb-1 text-[11px] text-muted-foreground">{t('compile.loadLog')}</div>
      <div className="scrollbar-thin max-h-20 overflow-auto text-[11px] leading-relaxed text-muted-foreground">{logs.map((log, index) => <div key={index}>{log}</div>)}</div>
    </div>
  </div>;
}
