import { ChatPanel } from "@/components/ChatPanel"
import { isRemoteWorkspace } from "@/lib/workspaceLocation"
import { MarkdownEditor } from "@/components/MarkdownEditor"
import { TexCompilePreview } from "@/components/TexCompilePreview"
import {
  ResizablePanelGroup as Group,
  ResizableHandle as Handle,
  ResizablePanel as Panel,
} from "@/components/ui/resizable"
import { useT } from "@/i18n/useT"
import { bibliographyNames } from "@/lib/bibliography"
import { encodeNative } from "@/lib/localData"
import { notify } from "@/lib/notifications"
import { bibtexKey, citationKeyFor, synthesizeBib } from "@/lib/paperMetadata"
import { createPaperClient, type PaperDetail, type ResearchPaper } from "@/lib/researchLibrary"
import { useProject } from "@/project/context"
import { useEffect, useMemo, useRef, useState } from "react"
import { field, headerGhost, headerPrimary, notice } from "./ui"
import { usePaperAttachment } from "./usePaperAttachment"
import { usePaperChat } from "./usePaperChat"
import { usePaperNote } from "./usePaperNote"
export function PaperWorkspace({
  root,
  paper,
  active,
  onChanged,
}: {
  root: string
  paper: ResearchPaper
  active: boolean
  onChanged: () => void
}) {
  const { t } = useT()
  const { project, edit: editProject } = useProject()
  const [detail, setDetail] = useState<PaperDetail>()
  const [error, setError] = useState("")
  const [history, setHistory] = useState<{ revision: number; text: string; actor: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [selection, setSelection] = useState("")
  const [jump, setJump] = useState<{ page: number; id: number }>()
  const selectionPage = useRef(1)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const reader = useRef<HTMLDivElement>(null)
  const call = useMemo(() => createPaperClient(root, paper.id), [root, paper.id])
  const note = usePaperNote(call, active, detail, setError)
  const {
    text,
    saving,
    conflict,
    initialize,
    flush,
    edit,
    beginMerge,
    saveMerged,
    useLatest,
    isSaved,
    isBlocked,
    currentText,
  } = note
  const attachment = usePaperAttachment(call, paper, !!detail, setError)
  const { file, setFile, setPdfText, readingPosition } = attachment
  const { chat, setChat, busy, send, newChat, selectChat, listChats, stop } = usePaperChat({
    call,
    root,
    paper,
    note,
    attachment,
    selection,
    setError,
  })
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const d = await call("get")
        if (!live) return
        setDetail(d)
        readingPosition.current = d.state.reading
        initialize(d.note)
        setChat(d.state.chat)
      } catch (e) {
        if (live) setError((e as Error).message)
      }
    })()
    return () => {
      live = false
    }
  }, [call, initialize, readingPosition, setChat])
  const cite = () => {
    try {
      const main = project.files.find((f) => f.id === project.rootId),
        names = bibliographyNames(main?.text ?? "")
      const target =
        project.files.find((f) => names.includes(f.path)) ??
        project.files.find((f) => f.kind === "bib")
      if (!target) throw Error(t("library.noBibFile"))
      const bib = paper.bib ?? synthesizeBib(paper, paper.citationKey || citationKeyFor(paper))
      const key = bibtexKey(bib) ?? paper.citationKey
      if (key && target.text?.includes("{" + key + ",")) {
        notify(t("library.citeKeyExists", { key, path: target.path }), "warning")
        return
      }
      editProject(target.id, (target.text ?? "") + "\n" + bib + "\n")
      notify(t("library.citeWritten", { key: key ?? "", path: target.path }), "success")
    } catch (error) {
      notify((error as Error).message, "error")
    }
  }
  if (!detail)
    return <div className="workspace-pane h-full p-6 text-sm">{error || t("research.opening")}</div>
  return (
    <Group orientation="horizontal">
      <Panel defaultSize="65%" minSize="25%" className="workspace-pane">
        <div
          ref={reader}
          className="flex h-full flex-col"
          onMouseUp={() => {
            const selected = window.getSelection()
            if (selected?.anchorNode && reader.current?.contains(selected.anchorNode)) {
              setSelection(selected.toString().slice(0, 10000))
              selectionPage.current = Number(
                selected.anchorNode.parentElement
                  ?.closest("[data-pdf-page]")
                  ?.getAttribute("data-pdf-page") ?? 1,
              )
            }
          }}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium leading-4" title={paper.title}>
                {paper.title}
              </div>
              <div className="mt-1 truncate text-[11px] leading-3.5 text-muted-foreground">
                {[paper.author, paper.venue, paper.year, paper.citationKey]
                  .filter(Boolean)
                  .join(" · ") || t("research.metadataPending")}
              </div>
            </div>
            <button className={headerPrimary} title={t("library.citeToProject")} onClick={cite}>
              {t("research.cite")}
            </button>
            <button
              className={headerGhost}
              disabled={busy}
              title={t("research.trashHint")}
              onClick={async () => {
                try {
                  await flush()
                  if (isBlocked()) return
                  await call("remove")
                  notify(t("research.removed", { title: paper.title }), "info")
                  onChanged()
                } catch (e) {
                  notice(e)
                }
              }}
            >
              {t("library.remove")}
            </button>
            <button
              className={headerGhost}
              disabled={busy}
              onClick={() => attachmentInput.current?.click()}
            >
              {file ? t("research.replace") : t("research.attach")}
            </button>
            <input
              ref={attachmentInput}
              type="file"
              accept=".pdf"
              hidden
              onChange={(e) => {
                const next = e.target.files?.[0]
                e.target.value = ""
                if (!next) return
                void (async () => {
                  try {
                    const encoded = (await encodeNative(next)) as { $blob: string }
                    await call("attach", { base64: encoded.$blob, name: next.name })
                    readingPosition.current = undefined
                    setFile(next)
                    setDetail(await call("get"))
                    setPdfText("")
                    onChanged()
                    notify(t("research.attachmentUpdated", { name: next.name }), "success")
                  } catch (error) {
                    setError((error as Error).message)
                  }
                })()
              }}
            />
            {selection && (
              <button
                className={headerGhost}
                onClick={() => {
                  const page = selectionPage.current
                  edit(
                    currentText() +
                      `\n\n> ${selection}\n\n[${t("research.sourcePage", { page })}](envoi-paper:${paper.id}/${paper.attachmentHash}/${page})\n`,
                  )
                  notify(t("research.excerptSaved", { page }), "success")
                }}
              >
                {t("research.excerpt")}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {file && active ? (
              <TexCompilePreview
                key={file.name + file.size + file.lastModified}
                paperOnly
                jump={jump}
                initialSource={{ file, name: file.name }}
                reading={readingPosition.current}
                onReadingChange={(position) => {
                  readingPosition.current = position
                  void call("state", { key: "reading", value: position }).catch(notice)
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted-foreground">
                <p>{paper.attachmentHash ? t("research.loadingPdf") : t("research.missingPdf")}</p>
              </div>
            )}
          </div>
        </div>
      </Panel>
      <Handle className="workspace-pane-divider" />
      <Panel defaultSize="35%" minSize="280px" className="workspace-pane">
        <aside
          data-testid="paper-notes-panel"
          className="flex h-full min-h-0 flex-col bg-background"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
              <h2 className="text-sm font-medium">{t("research.readingNotes")}</h2>
              <span className="text-[10px] text-muted-foreground/70" aria-live="polite">
                {saving
                  ? t("research.saving")
                  : isSaved
                    ? t("research.saved")
                    : t("research.unsaved")}
              </span>
              <button
                className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => {
                  setShowHistory((v) => !v)
                  void call("history").then(setHistory).catch(notice)
                }}
              >
                {t("research.history")}
              </button>
            </header>
            {detail.drafts?.map((d) => (
              <div key={d.id} className="border-b p-2 text-xs">
                {t("library.pendingMerge")}
                <button
                  onClick={() => {
                    beginMerge(d.text)
                  }}
                >
                  {t("research.merge")}
                </button>
                <button
                  onClick={() => {
                    void call("dismiss-draft", { draftId: d.id }).then(() =>
                      setDetail((value) =>
                        value
                          ? { ...value, drafts: value.drafts?.filter((item) => item.id !== d.id) }
                          : value,
                      ),
                    )
                  }}
                >
                  {t("research.dismissDraft")}
                </button>
              </div>
            ))}
            <div className="shrink-0 px-5 pb-3">
              <details className="relative inline-block text-xs">
                <summary className="cursor-pointer list-none rounded-full border border-border/60 bg-secondary/40 px-2.5 py-1 text-muted-foreground hover:bg-secondary">
                  {paper.collection || t("research.addPurpose")}{" "}
                  <span className="ml-1 opacity-50">⌄</span>
                </summary>
                <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-border bg-popover p-3 shadow-lg">
                  <label className="mb-2 block text-xs text-muted-foreground">
                    {t("research.purpose")}
                  </label>
                  <input
                    aria-label={t("research.purpose")}
                    className={field + " w-full"}
                    defaultValue={paper.collection}
                    placeholder={t("research.purposeHint")}
                    onBlur={(e) => {
                      void call("metadata", { patch: { collection: e.target.value } })
                        .then(onChanged)
                        .catch(notice)
                    }}
                  />
                </div>
              </details>
            </div>
            {showHistory && (
              <div className="max-h-36 overflow-auto border-b p-2">
                {history.map((h) => (
                  <button
                    key={h.revision}
                    className="block text-xs"
                    onClick={() => {
                      edit(h.text)
                      setShowHistory(false)
                    }}
                  >
                    {t("research.restoreRevision", { revision: h.revision, actor: h.actor })}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              <MarkdownEditor
                source={text}
                onChange={edit}
                readOnly={false}
                path={`.envoi/library/notes/${paper.id}.md`}
                files={project.files}
                ariaLabel={t("research.notesAria")}
                onSource={(url) => {
                  const expected = `envoi-paper:${paper.id}/${paper.attachmentHash}/`
                  if (url.startsWith(expected)) {
                    const page = Number(url.slice(expected.length))
                    if (Number.isInteger(page) && page > 0) setJump({ page, id: Date.now() })
                  }
                }}
              />
            </div>{" "}
            {conflict && (
              <div role="alert" className="border-t p-3 text-xs">
                <p>{t("research.noteConflict")}</p>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{conflict.text}</pre>
                <button className={field} onClick={saveMerged}>
                  {t("library.saveMerged")}
                </button>
                <button className={field} onClick={useLatest}>
                  {t("research.useLatest")}
                </button>
              </div>
            )}
          </div>
          {!isRemoteWorkspace(root) && (
            <div className="shrink-0 pb-1 pt-3">
              <div className="flex items-center gap-2 px-5 pb-2 text-[11px] text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-primary/60" />
                <span>{t("research.assistant")}</span>
                <span className="ml-auto text-[10px] opacity-70">
                  {t("research.assistantContext")}
                </span>
              </div>
              <ChatPanel
                compact
                inputOnly
                historySource={{
                  scope: root + paper.id,
                  record: chat ?? null,
                  busy,
                  newSession: newChat,
                  select: selectChat,
                  list: listChats,
                }}
                placeholder={t("research.assistantPlaceholder")}
                conversation={{
                  record: chat ?? null,
                  busy,
                  error,
                  send,
                  stop,
                }}
              />
            </div>
          )}
        </aside>
      </Panel>
    </Group>
  )
}
