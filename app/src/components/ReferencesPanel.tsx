import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Notification } from "@/components/Notification"
import { useT } from "@/i18n/useT"
import { useMemo, useRef, useState } from "react"
import { useProject } from "@/project/context"
import { bibliographyNames, parseBibliography } from "@/lib/bibliography"
import { normalizePath, type collectPaper, type SourceLocation } from "@/lib/paperSources"
import type { LatexEditorHandle } from "./LatexEditor"

export function ReferencesPanel({
  paper,
  editor,
  onLocate,
}: {
  paper: ReturnType<typeof collectPaper>
  editor: React.RefObject<LatexEditorHandle | null>
  onLocate: (location: SourceLocation) => void
}) {
  const { t } = useT()
  const { project, edit, busy } = useProject()
  const [editing, setEditing] = useState<string | null>(null)
  const bibliographyFiles = project.files.filter(
    (file) => file.kind === "bib" && file.text !== undefined,
  )
  const edited = bibliographyFiles.find((file) => file.id === editing)
  let editError = ""
  if (edited) {
    try {
      parseBibliography(edited.text ?? "")
    } catch (error) {
      editError = (error as Error).message
    }
  }
  const [local, setLocal] = useState<{ name: string; text: string } | null>(null)
  const [readError, setReadError] = useState("")
  const [detail, setDetail] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const nextLocation = useRef<Record<string, number>>({})
  const result = useMemo(() => {
    try {
      if (readError) throw new Error(readError)
      if (local)
        return {
          entries: parseBibliography(local.text),
          label: t("refs.localFileLabel", { name: local.name }),
          error: "",
        }
      const available = project.files.filter((file) => file.kind === "bib")
      const declarations = paper.files.flatMap((file) =>
        bibliographyNames(file.text).map((name) => ({ name, from: file.path })),
      )
      if (!declarations.length) throw new Error(t("refs.noBibDeclared"))
      const resolved = declarations.map(({ name, from }) => {
        const candidates = [
          normalizePath(from.replace(/[^/]+$/, "") + name),
          normalizePath((paper.files[0]?.path.replace(/[^/]+$/, "") ?? "") + name),
          normalizePath(name),
        ]
        const match = candidates
          .map((path) => available.find((file) => file.path === path))
          .find(Boolean)
        if (!match || match.text === undefined)
          throw new Error(t("refs.bibUnreadable", { from, name }))
        return match
      })
      const unique = [...new Map(resolved.map((file) => [file.id, file])).values()]
      return {
        entries: parseBibliography(unique.map((file) => file.text).join("\n")),
        label: t("refs.projectFilesLabel", { files: unique.map((file) => file.path).join("、") }),
        error: "",
      }
    } catch (error) {
      return {
        entries: [],
        label: local?.name || t("refs.projectBib"),
        error: (error as Error).message,
      }
    }
  }, [paper, local, readError, project.files, t])
  const citations = paper.citations
  const unknown = [...new Set(citations.map((citation) => citation.key))].filter(
    (key) => !result.entries.some((entry) => entry.key === key),
  )
  const locate = (key: string) => {
    const positions = citations.filter((citation) => citation.key === key)
    const index = (nextLocation.current[key] ?? 0) % positions.length
    if (!positions.length) return
    nextLocation.current[key] = index + 1
    onLocate(positions[index])
    setNotice(
      t("refs.citationLocation", {
        key,
        file: positions[index].path,
        index: index + 1,
        total: positions.length,
      }),
    )
  }
  return (
    <div className="space-y-2 text-[11px]">
      <Dialog
        open={!!edited}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("refs.editProjectBib")}</DialogTitle>
            <DialogDescription>{t("refs.editHint")}</DialogDescription>
          </DialogHeader>
          <select
            aria-label={t("refs.projectBib")}
            value={editing ?? ""}
            onChange={(event) => setEditing(event.target.value)}
          >
            {bibliographyFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.path}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t("refs.sourceEditor")}
            readOnly={busy}
            value={edited?.text ?? ""}
            onChange={(event) => {
              if (edited) edit(edited.id, event.target.value)
            }}
            className="h-80 w-full resize-y rounded border bg-background p-3 font-mono text-xs"
          />
          {editError && (
            <p role="alert" className="text-xs text-danger">
              {editError}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <div className="flex flex-wrap gap-2">
        {!!bibliographyFiles.length && (
          <button
            className="rounded border border-border px-2 py-1 hover:bg-secondary"
            onClick={() => setEditing(bibliographyFiles[0].id)}
          >
            {t("refs.editProjectBib")}
          </button>
        )}
        <button
          className="rounded border border-border px-2 py-1 hover:bg-secondary"
          onClick={() => fileRef.current?.click()}
        >
          {t("refs.openBib")}
        </button>
        {local && (
          <button
            className="text-muted-foreground"
            onClick={() => {
              request.current++
              setLocal(null)
              setReadError("")
            }}
          >
            {t("refs.useProjectBib")}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".bib,text/plain"
          aria-label={t("refs.selectLocalBib")}
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (!file) return
            const id = ++request.current
            try {
              const text = await file.text()
              if (id === request.current) {
                setLocal({ name: file.name, text })
                setReadError("")
                setDetail(null)
              }
            } catch (error) {
              if (id === request.current)
                setReadError(t("refs.readFailed", { message: (error as Error).message }))
            }
          }}
        />
      </div>
      <p className="break-words text-muted-foreground">{result.label}</p>
      <p className="text-muted-foreground">{t("refs.scopeHint")}</p>
      {local && (
        <p role="status" className="text-warning">
          {t("refs.localPreviewOnly")}
        </p>
      )}
      {!!paper.missing.length && (
        <p role="alert" className="text-warning">
          {t("refs.statsIncomplete", { list: paper.missing.join("；") })}
        </p>
      )}
      {result.error && (
        <p role="alert" className="break-words text-danger">
          {t("refs.parseFailed", { error: result.error })}
        </p>
      )}
      {!result.error && !result.entries.length && <p>{t("refs.noEntries")}</p>}
      <Notification message={notice} kind={"info"} />
      {[true, false].map((used) => {
        const entries = result.entries.filter(
          (entry) => citations.some((citation) => citation.key === entry.key) === used,
        )
        return (
          <section key={String(used)} className="space-y-1.5">
            <h3 className="pt-2 font-medium text-muted-foreground">
              {used ? t("refs.cited") : t("refs.uncited")} · {entries.length}
            </h3>
            {entries.map((entry) => {
              const count = citations.filter((citation) => citation.key === entry.key).length
              return (
                <div
                  key={entry.key}
                  className="rounded-lg border border-border bg-background p-2.5"
                >
                  <button
                    className="w-full text-left"
                    onClick={() => setDetail(detail === entry.key ? null : entry.key)}
                    aria-expanded={detail === entry.key}
                  >
                    <div className="text-[11.5px] text-foreground">{entry.title}</div>
                    <div className="mt-1 break-words text-muted-foreground">
                      {entry.author} {entry.year || t("refs.missingYear")}
                    </div>
                    <div className="mt-1 break-all font-editor text-primary">{entry.key}</div>
                  </button>
                  {detail === entry.key && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      <p>{entry.venue}</p>
                      <pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                        {entry.raw}
                      </pre>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="rounded bg-primary px-2 py-1 text-primary-foreground"
                      onClick={() => {
                        editor.current?.insert(`\\cite{${entry.key}}`)
                        setNotice(t("refs.inserted", { key: entry.key }))
                      }}
                    >
                      {t("refs.insertCitation")}
                    </button>
                    {!!count && (
                      <button
                        className="rounded border border-border px-2 py-1 hover:bg-secondary"
                        onClick={() => locate(entry.key)}
                      >
                        {t("refs.locateCitations", { count })}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
      {!!unknown.length && (
        <section className="space-y-1 border-t border-border pt-2 text-warning">
          <h3>{t("refs.unresolvedHeading")}</h3>
          {unknown.map((key) => (
            <button key={key} onClick={() => locate(key)} className="block break-all text-left">
              {t("refs.locateKey", { key })}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
