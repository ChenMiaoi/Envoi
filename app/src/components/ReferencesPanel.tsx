import { useMemo, useRef, useState } from "react";
import { useProject } from "@/project/context";
import { bibliographyNames, parseBibliography } from "@/lib/bibliography";
import { normalizePath, type collectPaper, type SourceLocation } from "@/lib/paperSources";
import type { LatexEditorHandle } from "./LatexEditor";

export function ReferencesPanel({ paper, editor, onLocate }: { paper: ReturnType<typeof collectPaper>; editor: React.RefObject<LatexEditorHandle | null>; onLocate: (location: SourceLocation) => void }) {
  const { project } = useProject();
  const [local, setLocal] = useState<{ name: string; text: string } | null>(null);
  const [readError, setReadError] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const nextLocation = useRef<Record<string, number>>({});
  const result = useMemo(() => {
    try {
      if (readError) throw new Error(readError);
      if (local) return { entries: parseBibliography(local.text), label: `本地文件：${local.name}（本次会话）`, error: "" };
      const available = project.files.filter((file) => file.kind === "bib");
      const declarations = paper.files.flatMap((file) => bibliographyNames(file.text).map((name) => ({ name, from: file.path })));
      if (!declarations.length) throw new Error("正文未声明 Bib 文件，请打开 .bib 文件。");
      const resolved = declarations.map(({ name, from }) => {
        const candidates = [normalizePath(from.replace(/[^/]+$/, "") + name), normalizePath((paper.files[0]?.path.replace(/[^/]+$/, "") ?? "") + name), normalizePath(name)];
        const match = candidates.map((path) => available.find((file) => file.path === path)).find(Boolean);
        if (!match || match.text === undefined) throw new Error(`无法读取 ${from} 关联的 ${name}，请打开 .bib 文件。`);
        return match;
      });
      const unique = [...new Map(resolved.map((file) => [file.id, file])).values()];
      return { entries: parseBibliography(unique.map((file) => file.text).join("\n")), label: `项目文件：${unique.map((file) => file.path).join("、")}`, error: "" };
    } catch (error) { return { entries: [], label: local?.name || "项目 Bib", error: (error as Error).message }; }
  }, [paper, local, readError, project.files]);
  const citations = paper.citations;
  const unknown = [...new Set(citations.map((citation) => citation.key))].filter((key) => !result.entries.some((entry) => entry.key === key));
  const locate = (key: string) => {
    const positions = citations.filter((citation) => citation.key === key);
    const index = (nextLocation.current[key] ?? 0) % positions.length;
    if (!positions.length) return;
    nextLocation.current[key] = index + 1;
    onLocate(positions[index]);
    setNotice(`${key}：${positions[index].path}，第 ${index + 1}/${positions.length} 处引用`);
  };
  return <div className="space-y-2 text-[11px]">
    <div className="flex flex-wrap gap-2">
      <button className="rounded border border-border px-2 py-1 hover:bg-secondary" onClick={() => fileRef.current?.click()}>打开 .bib</button>
      {local && <button className="text-muted-foreground" onClick={() => { request.current++; setLocal(null); setReadError(""); }}>使用项目 Bib</button>}
      <input ref={fileRef} type="file" accept=".bib,text/plain" aria-label="选择本地 Bib 文件" className="hidden" onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        const id = ++request.current;
        try { const text = await file.text(); if (id === request.current) { setLocal({ name: file.name, text }); setReadError(""); setDetail(null); } }
        catch (error) { if (id === request.current) setReadError(`读取失败：${(error as Error).message}`); }
      }} />
    </div>
    <p className="break-words text-muted-foreground">{result.label}</p>
    <p className="text-muted-foreground">统计 main.tex 及可达章节；插入到当前文件光标/选区。</p>
    {!!paper.missing.length && <p role="alert" className="text-amber-300">统计不完整，缺失章节：{paper.missing.join("；")}</p>}
    {result.error && <p role="alert" className="break-words text-red-400">Bib 无法解析：{result.error}</p>}
    {!result.error && !result.entries.length && <p>此 Bib 没有可用条目。</p>}
    <p role="status" className="break-words text-primary">{notice}</p>
    {[true, false].map((used) => {
      const entries = result.entries.filter((entry) => citations.some((citation) => citation.key === entry.key) === used);
      return <section key={String(used)} className="space-y-1.5">
        <h3 className="pt-2 font-medium text-muted-foreground">{used ? "已引用" : "未引用"} · {entries.length}</h3>
        {entries.map((entry) => {
          const count = citations.filter((citation) => citation.key === entry.key).length;
          return <div key={entry.key} className="rounded-lg border border-border bg-background p-2.5">
            <button className="w-full text-left" onClick={() => setDetail(detail === entry.key ? null : entry.key)} aria-expanded={detail === entry.key}>
              <div className="text-[11.5px] text-foreground">{entry.title}</div>
              <div className="mt-1 break-words text-muted-foreground">{entry.author} {entry.year}</div>
              <div className="mt-1 break-all font-editor text-primary">{entry.key}</div>
            </button>
            {detail === entry.key && <div className="mt-2 space-y-1 border-t border-border pt-2"><p>{entry.venue}</p><pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{entry.raw}</pre></div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => { editor.current?.insert(`\\cite{${entry.key}}`); setNotice(`已插入 ${entry.key}`); }}>插入引用</button>
              {!!count && <button className="rounded border border-border px-2 py-1 hover:bg-secondary" onClick={() => locate(entry.key)}>定位引用（{count} 处）</button>}
            </div>
          </div>;
        })}
      </section>;
    })}
    {!!unknown.length && <section className="space-y-1 border-t border-border pt-2 text-amber-300"><h3>正文中未解析的引用</h3>{unknown.map((key) => <button key={key} onClick={() => locate(key)} className="block break-all text-left">{key} · 定位</button>)}</section>}
  </div>;
}
