import { useEffect, useRef, useState } from "react"
import { envoi } from "@/lib/desktop"
import { researchLibrary, type ResearchPaper } from "@/lib/researchLibrary"
import { extractIdentifiers } from "@/lib/paperMetadata"
import { lookupPaperIdentifier } from "@/lib/metadataLookup"
import type { WebviewTag } from "electron"
const home = "https://arxiv.org"
const bookmarks = [
  { name: "arXiv", url: "https://arxiv.org" },
  { name: "ACM DL", url: "https://dl.acm.org" },
  { name: "OpenReview", url: "https://openreview.net" },
  { name: "DBLP", url: "https://dblp.org" },
  { name: "Semantic Scholar", url: "https://www.semanticscholar.org" },
  { name: "Google Scholar", url: "https://scholar.google.com", external: true },
]
const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
export function PaperBrowsePanel({ root, papers }: { root: string; papers: ResearchPaper[] }) {
  const guest = useRef<WebviewTag | null>(null)
  const [address, setAddress] = useState(home),
    [current, setCurrent] = useState(home),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [canNav, setCanNav] = useState({ back: false, forward: false })
  const identifiers = extractIdentifiers(current)
  useEffect(() => {
    void envoi()
      .bindPaperBrowse(root)
      .catch((error) => setNotice((error as Error).message))
    return envoi().onBrowseImported((event) => {
      if (event.error) setNotice(`下载入库失败：${event.error}`)
      else {
        setNotice(`已下载并加入论文库：${event.title}`)
        window.dispatchEvent(new CustomEvent("envoi:library-updated"))
      }
    })
  }, [root])
  useEffect(() => {
    const view = guest.current
    if (!view) return
    const navigated = () => {
      const url = view.getURL()
      setCurrent(url)
      setAddress(url)
      setFailed("")
      setCanNav({ back: view.canGoBack(), forward: view.canGoForward() })
    }
    view.addEventListener("did-navigate", navigated)
    view.addEventListener("did-navigate-in-page", navigated)
    view.addEventListener("did-start-loading", () => setLoading(true))
    view.addEventListener("did-stop-loading", () => setLoading(false))
    view.addEventListener("did-fail-load", (event) => {
      if (event.errorCode === -3) return // 主动中止（跳转新地址）不算失败
      setLoading(false)
      setFailed(
        event.errorCode === -300 || event.errorDescription?.includes("ERR_BLOCKED_BY_RESPONSE")
          ? "该站点不允许在应用内嵌显示"
          : `页面加载失败：${event.errorDescription || event.errorCode}`,
      )
    })
  }, [])
  const go = (value: string) => {
    const url = /^https?:\/\//i.test(value) ? value : "https://" + value
    guest.current?.loadURL(url).catch(() => {})
  }
  const savePaper = async () => {
    const id = identifiers.doi ?? identifiers.arxiv
    if (!id || saving) return
    setSaving(true)
    setNotice("")
    try {
      const found = await lookupPaperIdentifier(id)
      if (!found) throw Error("未能从页面标识获取文献信息")
      await researchLibrary(root, {
        action: "import",
        papers: [
          {
            id: crypto.randomUUID(),
            title: "",
            author: "",
            year: "",
            venue: "",
            tags: [],
            collection: "",
            status: "待读",
            notes: "",
            created: Date.now(),
            ...found.fields,
            bib: found.bib,
            citationKey: found.citationKey,
          },
        ],
      })
      setNotice(`已保存到论文库：${found.fields.title ?? id}`)
      window.dispatchEvent(new CustomEvent("envoi:library-updated"))
    } catch (error) {
      setNotice(`保存失败：${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }
  const pdfTarget = /\.pdf([?#].*)?$/i.test(current)
    ? current
    : identifiers.arxiv
      ? `https://arxiv.org/pdf/${identifiers.arxiv}`
      : ""
  const fetchPdf = async () => {
    if (!pdfTarget || saving) return
    setSaving(true)
    setNotice("")
    try {
      const file = await researchLibrary<{ name: string; base64: string }>(root, {
        action: "download-pdf",
        url: pdfTarget,
      })
      const id = identifiers.doi ?? identifiers.arxiv
      const found = id ? await lookupPaperIdentifier(id).catch(() => null) : null
      // 已按引用键入库的文献不再重复导入，直接补充 PDF 附件。
      const existing = found?.citationKey
        ? papers.find((paper) => paper.citationKey === found.citationKey)
        : undefined
      if (existing && !existing.attachmentHash) {
        await researchLibrary(root, {
          action: "attach",
          paperId: existing.id,
          base64: file.base64,
          name: file.name,
        })
        setNotice(`已为《${existing.title}》补充 PDF 附件`)
      } else if (existing) {
        setNotice(`论文库已包含该文献及其 PDF：${existing.title}`)
      } else {
        const title =
          found?.fields.title ??
          file.name
            .replace(/\.pdf$/i, "")
            .replace(/[_-]+/g, " ")
            .trim() ??
          "网页下载论文"
        await researchLibrary(root, {
          action: "import",
          papers: [
            {
              id: crypto.randomUUID(),
              title,
              author: "",
              year: "",
              venue: "",
              tags: [],
              collection: "",
              status: "待读",
              notes: "",
              created: Date.now(),
              ...found?.fields,
              bib: found?.bib,
              citationKey: found?.citationKey,
              attachment: { $blob: file.base64, type: "application/pdf" },
              attachmentName: file.name,
            },
          ],
        })
        setNotice(`已下载并加入论文库：${title}`)
      }
      window.dispatchEvent(new CustomEvent("envoi:library-updated"))
    } catch (error) {
      setNotice(`下载失败：${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex h-full flex-col" data-testid="paper-browse">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 bg-card/30 px-3 py-2">
        <button
          className={iconButton}
          disabled={!canNav.back}
          title="后退"
          aria-label="后退"
          onClick={() => guest.current?.goBack()}
        >
          ←
        </button>
        <button
          className={iconButton}
          disabled={!canNav.forward}
          title="前进"
          aria-label="前进"
          onClick={() => guest.current?.goForward()}
        >
          →
        </button>
        <button
          className={iconButton}
          title="刷新"
          aria-label="刷新"
          onClick={() => guest.current?.reload()}
        >
          {loading ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
          ) : (
            "⟳"
          )}
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            go(address)
          }}
        >
          <input
            aria-label="浏览地址"
            className="h-8 w-full rounded-lg border border-border/70 bg-background px-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        {(identifiers.doi || identifiers.arxiv) && (
          <button
            className="ml-1 h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
            disabled={saving}
            title={identifiers.doi ?? identifiers.arxiv}
            onClick={() => void savePaper()}
          >
            {saving ? "正在保存…" : "保存到论文库"}
          </button>
        )}
        {pdfTarget && (
          <button
            className="ml-1 h-8 shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            disabled={saving}
            title={pdfTarget}
            onClick={() => void fetchPdf()}
          >
            {saving ? "处理中…" : "获取 PDF 入库"}
          </button>
        )}
        <a
          className="ml-1 flex h-8 shrink-0 items-center rounded-lg border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          href={current}
          target="_blank"
          rel="noreferrer"
        >
          外部打开 ↗
        </a>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
        {bookmarks.map((bookmark) => (
          <button
            key={bookmark.url}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              current.startsWith(bookmark.url)
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground"
            }`}
            title={bookmark.external ? "该站点可能不允许应用内嵌显示" : undefined}
            onClick={() => go(bookmark.url)}
          >
            {bookmark.name}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          页面中的 PDF 下载会直接进入当前论文库
        </span>
      </div>
      {notice && (
        <p
          role="status"
          className="shrink-0 border-b border-border/60 bg-secondary/30 px-4 py-1.5 text-[11px] text-muted-foreground"
        >
          {notice}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        <webview
          ref={guest}
          src={home}
          partition="persist:paperbrowse"
          webpreferences="contextIsolation=yes, sandbox=yes"
          className="h-full w-full bg-background"
        />
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
            <p className="text-sm text-muted-foreground">{failed}</p>
            <a
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
              href={current}
              target="_blank"
              rel="noreferrer"
            >
              在外部浏览器打开 ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
