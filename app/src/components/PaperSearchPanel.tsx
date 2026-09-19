import { useMemo, useRef, useState } from "react"
import { researchLibrary, type ResearchPaper } from "@/lib/researchLibrary"
import { ipcError } from "@/lib/desktop"
import { notify, notifyLoading } from "@/lib/notifications"
import { synthesizeBib, citationKeyFor } from "@/lib/paperMetadata"
import {
  mergeSearchResults,
  normalizeTitle,
  type PaperSearchResult,
  type SourcePaper,
} from "@/lib/paperSearch.mjs"
const sources = [
  { id: "openalex", name: "OpenAlex" },
  { id: "semanticscholar", name: "Semantic Scholar" },
  { id: "crossref", name: "Crossref" },
  { id: "arxiv", name: "arXiv" },
] as const
type SourceId = (typeof sources)[number]["id"]
type SourceStatus = { state: "pending" | "ok" | "error"; count: number; error: string }
const ghostButton =
  "rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground disabled:opacity-50"
const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id
export function PaperSearchPanel({
  root,
  papers,
  onImported,
  onBrowse,
}: {
  root: string
  papers: ResearchPaper[]
  onImported: () => void
  onBrowse: (url: string) => void
}) {
  const [query, setQuery] = useState(""),
    [enabled, setEnabled] = useState<SourceId[]>(sources.map((s) => s.id)),
    [yearFrom, setYearFrom] = useState(""),
    [yearTo, setYearTo] = useState(""),
    [openAccessOnly, setOpenAccessOnly] = useState(false),
    [searched, setSearched] = useState(false),
    [searchedQuery, setSearchedQuery] = useState(""),
    [batches, setBatches] = useState<Partial<Record<SourceId, SourcePaper[]>>>({}),
    [status, setStatus] = useState<Partial<Record<SourceId, SourceStatus>>>({}),
    [added, setAdded] = useState<string[]>([]),
    [adding, setAdding] = useState<Record<string, "meta" | "pdf" | undefined>>({}),
    [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const run = useRef(0)
  const results = useMemo(
    () =>
      mergeSearchResults(
        sources.map((s) => batches[s.id] ?? []),
        searchedQuery,
      ),
    [batches, searchedQuery],
  )
  const pending = sources.some((s) => status[s.id]?.state === "pending")
  // “已入库”标记：论文库不保存 DOI，用规范化标题+年份与引用键识别。
  const shelved = useMemo(() => {
    const keys = new Set<string>()
    for (const paper of papers) {
      keys.add(normalizeTitle(paper.title) + ":" + paper.year)
      if (paper.citationKey) keys.add("cite:" + paper.citationKey)
    }
    return keys
  }, [papers])
  const inLibrary = (paper: PaperSearchResult) => {
    const key = normalizeTitle(paper.title) + ":" + paper.year
    return shelved.has(key) || added.includes(key)
  }
  const search = async (retry?: SourceId) => {
    const targets = retry ? [retry] : enabled
    const text = retry ? searchedQuery : query.trim()
    if (!text || !targets.length) return
    const ticket = ++run.current
    setSearched(true)
    if (!retry) {
      setSearchedQuery(text)
      setBatches({})
      setStatus({})
    }
    setStatus((value) => ({
      ...value,
      ...Object.fromEntries(
        targets.map((source) => [source, { state: "pending", count: 0, error: "" }]),
      ),
    }))
    await Promise.all(
      targets.map(async (source) => {
        try {
          const response = await researchLibrary(root, {
            action: "paper-search",
            source,
            query: text,
            yearFrom: Number(yearFrom) || undefined,
            yearTo: Number(yearTo) || undefined,
            openAccessOnly,
          })
          if (ticket !== run.current) return
          setBatches((value) => ({ ...value, [source]: response.results }))
          setStatus((value) => ({
            ...value,
            [source]: { state: "ok", count: response.results.length, error: "" },
          }))
        } catch (error) {
          if (ticket !== run.current) return
          setStatus((value) => ({
            ...value,
            [source]: { state: "error", count: 0, error: ipcError(error).message },
          }))
        }
      }),
    )
  }
  const addPaper = async (paper: PaperSearchResult) => {
    const key = normalizeTitle(paper.title) + ":" + paper.year
    if (adding[key]) return
    setAdding((value) => ({ ...value, [key]: paper.pdfUrl ? "pdf" : "meta" }))
    const toastId = `library-add-${key}`
    if (paper.pdfUrl) notifyLoading(`正在下载 PDF：${paper.title}…`, toastId)
    try {
      const record: Record<string, unknown> = {
        id: crypto.randomUUID(),
        title: paper.title,
        author: paper.authors.join(", "),
        year: paper.year,
        venue: [paper.venue, paper.publisher].filter(Boolean).join(" · "),
        tags: paper.versions.includes("预印本") ? ["预印本"] : [],
        collection: "",
        status: "待读",
        notes: "",
        created: Date.now(),
      }
      record.citationKey = citationKeyFor(record as never)
      record.bib = synthesizeBib(record as never, record.citationKey as string)
      let pdfError = ""
      if (paper.pdfUrl) {
        try {
          const file = await researchLibrary(root, {
            action: "download-pdf",
            url: paper.pdfUrl,
          })
          record.attachment = { $blob: file.base64, type: "application/pdf" }
          record.attachmentName = file.name
        } catch (error) {
          pdfError = ipcError(error).message
        }
      }
      await researchLibrary(root, { action: "import", papers: [record] })
      setAdded((value) => [...value, key])
      onImported()
      if (pdfError)
        notify(`PDF 下载失败（${pdfError}），已先保存文献条目：${paper.title}`, "warning", toastId)
      else if (paper.pdfUrl) notify(`已下载并加入论文库：${paper.title}`, "success", toastId)
      else
        notify(
          `已加入论文库：${paper.title}（该来源未提供开放全文 PDF，可稍后补充）`,
          "warning",
          toastId,
        )
    } catch (error) {
      notify(`加入论文库失败：${ipcError(error).message}`, "error", toastId)
    } finally {
      setAdding((value) => ({ ...value, [key]: undefined }))
    }
  }
  return (
    <div className="flex h-full flex-col bg-background" data-testid="paper-search">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/30 px-4 py-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/60">
            ⌕
          </span>
          <input
            aria-label="在线检索关键词"
            className="h-9 w-full rounded-xl border border-border/70 bg-background pl-8 pr-3 text-[13px] outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            placeholder="检索标题、作者、关键词…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="h-9 shrink-0 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
          disabled={pending || !query.trim()}
        >
          {pending && !results.length ? "检索中…" : "搜索"}
        </button>
        <button
          type="button"
          className={ghostButton + " flex h-9 shrink-0 items-center"}
          disabled={!query.trim()}
          title="在内置网页中搜索，结果不作为原生检索来源"
          onClick={() =>
            onBrowse("https://scholar.google.com/scholar?q=" + encodeURIComponent(query.trim()))
          }
        >
          Google Scholar
        </button>
      </form>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-4 py-2">
        {sources.map((source) => (
          <label
            key={source.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              enabled.includes(source.id)
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={enabled.includes(source.id)}
              onChange={(event) =>
                setEnabled((value) =>
                  event.target.checked
                    ? [...value, source.id]
                    : value.filter((item) => item !== source.id),
                )
              }
            />
            <span
              className={`h-1.5 w-1.5 rounded-full ${enabled.includes(source.id) ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
            {source.name}
          </label>
        ))}
        <span className="mx-1 h-4 w-px bg-border/70" />
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          年份
          <input
            aria-label="起始年份"
            className="h-7 w-14 rounded-md border border-border/70 bg-background px-1.5 text-center text-[11px] outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            placeholder="起"
            value={yearFrom}
            onChange={(event) => setYearFrom(event.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          –
          <input
            aria-label="结束年份"
            className="h-7 w-14 rounded-md border border-border/70 bg-background px-1.5 text-center text-[11px] outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            placeholder="止"
            value={yearTo}
            onChange={(event) => setYearTo(event.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </span>
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            openAccessOnly
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
          }`}
          title="只保留确认有开放全文的记录"
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={openAccessOnly}
            onChange={(event) => setOpenAccessOnly(event.target.checked)}
          />
          仅开放全文
        </label>
      </div>
      {searched && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 bg-secondary/20 px-4 py-1.5 text-[11px]">
          {sources
            .filter((source) => status[source.id])
            .map((source) => {
              const state = status[source.id]!
              return (
                <span key={source.id} className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      state.state === "pending"
                        ? "animate-pulse bg-muted-foreground/60"
                        : state.state === "ok"
                          ? "bg-primary"
                          : "bg-destructive"
                    }`}
                  />
                  {source.name}
                  {state.state === "pending" && <span>检索中…</span>}
                  {state.state === "ok" && <span>{state.count} 条</span>}
                  {state.state === "error" && (
                    <>
                      <span className="text-destructive" role="status">
                        {state.error}
                      </span>
                      <button
                        className="rounded px-1 text-primary underline-offset-2 transition-colors hover:underline"
                        onClick={() => void search(source.id)}
                      >
                        重试
                      </button>
                    </>
                  )}
                </span>
              )
            })}
          <span className="ml-auto text-muted-foreground/60">
            部分来源失败不影响其他结果 · 筛选在检索后统一应用
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-4">
          {!searched && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-xl text-primary">
                ⌕
              </span>
              <p className="text-sm font-medium">联合检索各学术索引</p>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                同时查询 OpenAlex、Semantic Scholar、Crossref 与 arXiv， 结果按 DOI／arXiv ID
                去重合并，可逐条加入当前项目论文库。
              </p>
            </div>
          )}
          {searched && !pending && !results.length && (
            <p className="py-16 text-center text-xs text-muted-foreground">
              已完成的来源没有找到匹配文献；如所有来源均失败请检查网络后重试。
            </p>
          )}
          {results.map((paper) => {
            const key = normalizeTitle(paper.title) + ":" + paper.year
            const busy = adding[key]
            const shelvedPaper = inLibrary(paper)
            return (
              <article
                key={key}
                className="group mb-3 rounded-xl border border-border/60 bg-card/50 p-4 transition-all hover:border-border hover:bg-card hover:shadow-sm"
              >
                <header className="flex items-start gap-3">
                  <h3 className="flex-1 text-[13px] font-medium leading-5">{paper.title}</h3>
                  {shelvedPaper && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      已在论文库
                    </span>
                  )}
                </header>
                <p className="mt-1 text-xs text-muted-foreground">
                  {paper.authors.slice(0, 5).join(", ")}
                  {paper.authors.length > 5 ? " 等" : ""}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">{paper.year || "年份未知"}</span>
                  {paper.venue && <span>· {paper.venue}</span>}
                  {paper.publisher && <span>· {paper.publisher}</span>}
                  {paper.versions.map((version) => (
                    <span
                      key={version}
                      className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px]"
                    >
                      {version}
                    </span>
                  ))}
                  {paper.openAccess === true && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      开放获取
                    </span>
                  )}
                  {paper.openAccess === false && <span className="opacity-70">无开放全文</span>}
                  {paper.citations.map((citation) => (
                    <span key={citation.source} className="opacity-80">
                      被引 {citation.count}（{sourceName(citation.source)}）
                    </span>
                  ))}
                </p>
                {!!paper.ranking?.reasons.length && (
                  <p className="mt-1.5 text-[10px] text-primary/80">
                    排序依据：{paper.ranking.reasons.slice(0, 3).join(" · ")}
                  </p>
                )}
                {paper.abstract && (
                  <p
                    className={`mt-2 cursor-pointer whitespace-pre-line text-xs leading-5 text-muted-foreground ${expanded[key] ? "" : "line-clamp-3"}`}
                    onClick={() => setExpanded((value) => ({ ...value, [key]: !value[key] }))}
                    title={expanded[key] ? "点击收起" : "点击展开摘要"}
                  >
                    {paper.abstract}
                  </p>
                )}
                <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
                  <span className="text-[10px] text-muted-foreground/70">
                    来源：{paper.sources.map(sourceName).join(" · ")}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    {paper.url && (
                      <a className={ghostButton} href={paper.url} target="_blank" rel="noreferrer">
                        原文页面 ↗
                      </a>
                    )}
                    <button
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
                      disabled={shelvedPaper || !!busy}
                      title={
                        paper.pdfUrl
                          ? "下载开放全文 PDF 并入库"
                          : "该来源无开放全文，仅保存文献条目"
                      }
                      onClick={() => void addPaper(paper)}
                    >
                      {busy === "pdf"
                        ? "正在获取 PDF…"
                        : busy === "meta"
                          ? "正在加入…"
                          : shelvedPaper
                            ? "已加入"
                            : "加入论文库"}
                    </button>
                  </span>
                </footer>
              </article>
            )
          })}
          {pending && (
            <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
              正在等待其余来源返回，已到达的结果可直接操作…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
