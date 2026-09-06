import {tokenizeLatex} from "@/lib/latexHighlight";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {usePreferences} from "@/settings/context";
import {textFonts,editorFonts} from "@/settings/model";
import { cn } from "@/lib/utils";

/* ---------- Markdown 预览 ---------- */
export function MarkdownViewer({ source }: { source: string }) {
  const {preferences}=usePreferences();
  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div data-content-typography="preview" style={{fontFamily:textFonts[preferences.previewFontFamily].css,fontSize:preferences.previewFontSize}} className="markdown-body mx-auto max-w-[720px] px-10 py-8">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{source}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ---------- LaTeX 语法高亮 ---------- */
export function HighlightedLatex({ source }: { source: string }) {
  const toks = tokenizeLatex(source);
  return (
    <>
      {toks.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
      {"\n"}
    </>
  );
}

/* ---------- LaTeX 只读预览（阅读视图用：默认预览 = 高亮源码 + 行号） ---------- */
export function LatexViewer({ source }: { source: string }) {
  const {preferences}=usePreferences();
  const style={fontFamily:editorFonts[preferences.fontFamily].css,fontSize:preferences.fontSize,lineHeight:preferences.lineHeight,tabSize:preferences.tabSize};
  const lines = source.split("\n").length;
  return (
    <div data-content-typography="editor" className="scrollbar-thin flex h-full overflow-auto bg-editor">
      <div className="flex min-h-full w-full">
        <div style={style} className="sticky left-0 select-none border-r border-border/60 bg-editor py-4 pl-4 pr-3 text-right font-editor text-[12.5px] leading-[1.75] text-muted-foreground/40">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre style={style} className="flex-1 whitespace-pre-wrap break-all py-4 pl-4 pr-6 font-editor text-[12.5px] leading-[1.75] text-foreground/85">
          <HighlightedLatex source={source} />
        </pre>
      </div>
    </div>
  );
}

/* ---------- BibTeX 预览：解析为文献卡片 ---------- */
export function BibViewer({ source }: { source: string }) {
  const {preferences}=usePreferences();
  const entries = source
    .split(/@(?=\w+\s*\{)/)
    .filter((s) => s.trim())
    .map((s) => {
      const type = s.match(/^(\w+)\s*\{\s*([^,]+)/);
      const field = (k: string) => {
        const mm = s.match(new RegExp(k + "\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*[,\\n}]"));
        return mm ? mm[1].replace(/\s+/g, " ").replace(/[{}]/g, "").trim() : "";
      };
      return { key: type?.[2] ?? "", type: type?.[1] ?? "", title: field("title"), author: field("author"), venue: field("booktitle") || field("journal"), year: field("year") };
    });
  return (
    <div data-content-typography="preview" style={{fontFamily:textFonts[preferences.previewFontFamily].css,fontSize:preferences.previewFontSize}} className="bib-preview scrollbar-thin h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[640px] space-y-3">
        <div className="mb-4 text-[11px] uppercase tracking-widest text-muted-foreground">
          {entries.length} 条参考文献
        </div>
        {entries.map((e) => (
          <div key={e.key} className="rounded-lg border border-border bg-card p-3.5">
            <div className="text-[13px] font-medium leading-snug text-foreground">{e.title}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">{e.author.replace(/\s+and\s+/g, " · ")}</div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-primary">{e.venue}</span>
              <span className="text-muted-foreground">{e.year}</span>
              <span className="font-editor text-muted-foreground/50">@{e.type}{"{"}{e.key}{"}"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ViewerBadge({kind}: {kind:string}) {
  const map: Record<string, { label: string; cls: string }> = {
    csv: {label:"CSV 表格",cls:"text-primary"}, tsv:{label:"TSV 表格",cls:"text-primary"},text:{label:"文本 / 源码",cls:"text-muted-foreground"},binary:{label:"未支持的文件",cls:"text-muted-foreground"},
    markdown: { label: "Markdown 预览", cls: "text-[hsl(var(--hue-blue))]" },
    latex: { label: "LaTeX 源码", cls: "text-[hsl(var(--hue-green))]" },
    pdf: { label: "PDF 预览", cls: "text-[hsl(var(--hue-red))]" },
    bib: { label: "文献视图", cls: "text-[hsl(var(--hue-orange))]" },
    image: { label: "图片", cls: "text-[hsl(var(--hue-violet))]" },
  };
  const m = map[kind] ?? { label: kind, cls: "text-muted-foreground" };
  return <span className={cn("text-[11px]", m.cls)}>{m.label}</span>;
}
