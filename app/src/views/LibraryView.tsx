import { Notification } from "@/components/Notification"
import { PaperBrowsePanel } from "@/components/PaperBrowsePanel"
import { PaperSearchPanel } from "@/components/PaperSearchPanel"
import {
  ResizablePanelGroup as Group,
  ResizableHandle as Handle,
  ResizablePanel as Panel,
} from "@/components/ui/resizable"
import { PaperWorkspace } from "@/features/library/PaperWorkspace"
import { field, notice } from "@/features/library/ui"
import { useT } from "@/i18n/useT"
import { envoi } from "@/lib/desktop"
import { encodeNative } from "@/lib/localData"
import { enrichPaper, lookupPaperIdentifier } from "@/lib/metadataLookup"
import { importLibraryFiles, paperLibrary } from "@/lib/paperLibrary"
import { researchLibrary, type LibraryIndex } from "@/lib/researchLibrary"
import { matchBinding, resolveBindings } from "@/navigation/shortcuts"
import { useProject } from "@/project/context"
import { useSettings } from "@/settings/useSettings"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
export function LibraryView() {
  const { t } = useT()
  const root = useProject((state) => state.project.rootPath)
  const location = useLocation()
  const [index, setIndex] = useState<LibraryIndex>(),
    [selected, setSelected] = useState(""),
    [visited, setVisited] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  const [exportNotice, setExportNotice] = useState("")
  const [sourceOpen, setSourceOpen] = useState(false)
  const [mode, setMode] = useState<"library" | "search" | "browse">("library")
  const [browseVisited, setBrowseVisited] = useState(false)
  const [browseTarget, setBrowseTarget] = useState<{ url: string; request: number }>()
  const [sourceUrl, setSourceUrl] = useState("")
  const input = useRef<HTMLInputElement>(null),
    selectionClock = useRef(Date.now())
  const load = useCallback(async () => {
    if (!root) return
    const next = await researchLibrary(root, { action: "list" })
    setIndex(next)
    setSelected((current) =>
      next.papers.some((p) => p.id === current)
        ? current
        : next.papers.some((p) => p.id === next.selected)
          ? next.selected!
          : next.papers[0]?.id || "",
    )
  }, [root])
  useEffect(() => {
    if (location.pathname !== "/library") return
    let timer: ReturnType<typeof setTimeout>
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        await load()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        running = false
      }
    }
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    }
    void refresh()
    const off = envoi().onFilesChanged((event) => {
      if (event.paths.some((p) => p === "papers" || p.startsWith("papers/"))) changed()
    })
    const poll = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 3000)
    window.addEventListener("envoi:library-updated", changed)
    window.addEventListener("focus", changed)
    return () => {
      off()
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener("envoi:library-updated", changed)
      window.removeEventListener("focus", changed)
    }
  }, [load, location.pathname])
  useEffect(() => {
    if (selected) setVisited((ids) => (ids.includes(selected) ? ids : [...ids, selected]))
  }, [selected])
  const { effective } = useSettings()
  const selectPaper = useCallback(
    (id: string) => {
      if (!root || !id) return
      setSelected(id)
      void researchLibrary(root, {
        action: "select",
        paperId: id,
        selectedAt: (selectionClock.current = Math.max(Date.now(), selectionClock.current + 1)),
      }).catch(notice)
    },
    [root],
  )
  // 复用可配置的标签切换键(默认 Mod+Alt+←/→)在论文间循环,仅论文库视图激活时响应。
  useEffect(() => {
    if (location.pathname !== "/library") return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const command = matchBinding(e, resolveBindings(effective.bindings))
      if (!command || (command.id !== "tab-prev" && command.id !== "tab-next")) return
      const papers = index?.papers
      if (!papers?.length) return
      e.preventDefault()
      e.stopPropagation()
      const current = papers.findIndex((p) => p.id === selected),
        step = command.id === "tab-next" ? 1 : -1,
        next = papers[(current + step + papers.length) % papers.length]
      selectPaper(next.id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, selected, effective.bindings, location.pathname, selectPaper])
  const importPapers = async (legacy = false, files: File[] = []) => {
    if (!root) return
    setBusy(true)
    try {
      if (files.length === 1 && files[0].name.endsWith(".json")) {
        const archive = JSON.parse(await files[0].text())
        if (archive.version !== 1 || !Array.isArray(archive.papers))
          throw Error(t("research.invalidExport"))
        await researchLibrary(root, { action: "import", papers: archive.papers, restore: true })
        await load()
        return
      }
      const papers = legacy ? await paperLibrary.list() : await importLibraryFiles(files)
      if (!legacy)
        for (const paper of papers) {
          if (paper.attachment) {
            const found = await enrichPaper({
              attachment: paper.attachment,
              title: paper.title,
            }).catch(() => null)
            if (found)
              Object.assign(paper, found.fields, { bib: found.bib, citationKey: found.citationKey })
          }
        }
      await researchLibrary(root, { action: "import", papers: await encodeNative(papers) })
      await load()
      setError("")
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  if (!root)
    return (
      <div className="h-full p-1.5">
        <div className="workspace-pane flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("library.openProjectFirst")}
        </div>
      </div>
    )
  const groups = [
    ...new Set(index?.papers.map((p) => p.collection || t("research.uncategorized")) ?? []),
  ]
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-1.5" data-testid="research-library">
      <header className="workspace-pane flex h-11 shrink-0 items-center gap-3 px-4 text-xs">
        <nav
          aria-label={t("research.views")}
          className="flex rounded-lg border border-border/70 bg-secondary/50 p-0.5"
        >
          {(
            [
              ["library", t("research.library")],
              ["search", t("research.search")],
              ["browse", t("research.browse")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              data-testid={`library-mode-${id}`}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                mode === id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setMode(id)
                if (id === "browse") setBrowseVisited(true)
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="mr-auto text-muted-foreground">
          {t("library.paperCount", { n: index?.papers.length ?? 0 })}
        </span>
        <button
          className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={() => setSourceOpen((value) => !value)}
        >
          URL / DOI
        </button>
        <button
          className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {t("library.addPaper")}
        </button>
        <button
          className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={() => void importPapers(true)}
        >
          {t("research.legacyImport")}
        </button>
        <button
          className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          disabled={busy}
          title={t("research.exportHint")}
          onClick={async () => {
            setBusy(true)
            setExportNotice("")
            try {
              const result = await researchLibrary(root, {
                action: "export-file",
              })
              if (result.saved) setExportNotice(t("research.exported", { path: result.path ?? "" }))
            } catch (error) {
              notice(error)
            } finally {
              setBusy(false)
            }
          }}
        >
          {t("research.exportAll")}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.bib,.json"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ""
            void importPapers(false, files)
          }}
        />
      </header>
      {index?.root !== root && (
        <p
          className="workspace-pane shrink-0 px-4 py-2 text-xs text-muted-foreground"
          title={index?.papersDirectory}
        >
          {t("research.sharedPapers")}
        </p>
      )}
      {!!index?.warnings?.length && (
        <p
          role="status"
          className="workspace-pane shrink-0 px-4 py-2 text-xs text-muted-foreground"
        >
          {index.warnings.join("；")}
        </p>
      )}
      {sourceOpen && (
        <form
          className="workspace-pane flex shrink-0 flex-wrap gap-2 px-4 py-2 text-xs"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy || !sourceUrl.trim()) return
            setBusy(true)
            setError("")
            try {
              const source = sourceUrl.trim()
              if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(source)) {
                const found = await lookupPaperIdentifier(source)
                if (!found) throw Error(t("research.metadataMissing"))
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
                await load()
              } else {
                const url = source.replace(/^(https:\/\/(?:www\.)?arxiv\.org)\/abs\//, "$1/pdf/")
                const file = await researchLibrary(root, {
                  action: "download-pdf",
                  url,
                })
                const imported = await importPapers(false, [
                  new File(
                    [Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))],
                    file.name,
                    { type: "application/pdf" },
                  ),
                ])
                if (imported === false) return
              }
              setSourceOpen(false)
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <input
            aria-label={t("research.urlAria")}
            placeholder={t("research.urlHint")}
            className="min-w-64 flex-1 rounded border bg-background px-2 py-1"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <button disabled={busy || !sourceUrl.trim()} type="submit">
            {busy ? t("research.importing") : t("research.importLink")}
          </button>
        </form>
      )}
      {exportNotice && <Notification message={exportNotice} kind="success" />}
      {error && <Notification message={error} kind={"error"} />}
      <div className="min-h-0 flex-1">
        <div className="h-full" hidden={mode === "browse"}>
          {mode === "search" ? (
            <div className="workspace-pane h-full">
              <PaperSearchPanel
                root={root}
                papers={index?.papers ?? []}
                onImported={() => void load()}
                onBrowse={(url) => {
                  setBrowseTarget((current) => ({ url, request: (current?.request ?? 0) + 1 }))
                  setBrowseVisited(true)
                  setMode("browse")
                }}
              />
            </div>
          ) : (
            <Group orientation="horizontal">
              <Panel defaultSize="18%" minSize="14%" maxSize="30%" className="workspace-pane">
                <nav className="flex h-full flex-col bg-card">
                  <div className="flex h-9 shrink-0 items-center border-b border-border px-2">
                    <input
                      aria-label={t("research.searchAria")}
                      className={field + " h-7 w-full"}
                      placeholder={t("research.searchPlaceholder")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 overflow-auto p-2">
                    {groups.map((group) => (
                      <details open key={group} className="mb-3">
                        <summary className="cursor-pointer py-2 text-xs font-medium">
                          {group}
                        </summary>
                        {index?.papers
                          .filter(
                            (p) =>
                              (p.collection || t("research.uncategorized")) === group &&
                              [p.title, p.author, ...p.tags]
                                .join(" ")
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                          )
                          .map((p) => (
                            <button
                              key={p.id}
                              className={`mb-1 w-full rounded p-2 text-left text-xs leading-5 ${selected === p.id ? "bg-accent text-primary" : "hover:bg-secondary"}`}
                              onClick={() => selectPaper(p.id)}
                            >
                              {p.title}
                              <span className="mt-1 block text-[10px] text-muted-foreground">
                                {p.year || t("research.yearPending")} ·{" "}
                                {p.attachmentPath ?? t("library.noAttachmentShort")}
                              </span>
                            </button>
                          ))}
                      </details>
                    ))}
                    {!index?.papers.length && (
                      <p className="py-6 text-xs leading-6 text-muted-foreground">
                        {t("library.startImport")}
                      </p>
                    )}
                  </div>
                </nav>
              </Panel>
              <Handle className="workspace-pane-divider" />
              <Panel minSize="50%">
                {visited.map((id) => {
                  const paper = index?.papers.find((p) => p.id === id)
                  return paper ? (
                    <section key={id} hidden={selected !== id} className="h-full">
                      <PaperWorkspace
                        root={root}
                        paper={paper}
                        active={selected === id}
                        onChanged={() => void load()}
                      />
                    </section>
                  ) : null
                })}
                {!selected && (
                  <div className="workspace-pane flex h-full flex-col items-center justify-center gap-2 px-10 text-center text-sm text-muted-foreground">
                    {index?.papers.length ? (
                      <p>{t("research.select")}</p>
                    ) : (
                      <>
                        <p className="text-base text-foreground">{t("research.empty")}</p>
                        <p className="text-xs leading-6">{t("research.emptyHint")}</p>
                      </>
                    )}
                  </div>
                )}
              </Panel>
            </Group>
          )}
        </div>
        {browseVisited && (
          <div className="workspace-pane h-full" hidden={mode !== "browse"}>
            <PaperBrowsePanel
              key={browseTarget?.request ?? 0}
              root={root}
              papers={index?.papers ?? []}
              initialUrl={browseTarget?.url}
            />
          </div>
        )}
      </div>
    </div>
  )
}
