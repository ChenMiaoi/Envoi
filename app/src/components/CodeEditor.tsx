import { useLayoutEffect, useRef } from "react"
import { EditorState, Compartment } from "@codemirror/state"
import {
  EditorView,
  keymap,
  hoverTooltip,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint"
import { toast } from "sonner"
import { envoi } from "@/lib/desktop"
import { clearLspDiagnostics, publishLspDiagnostics, publishLspStatus } from "@/lib/lspStatus"
import { codeHighlight } from "@/lib/codeHighlight"
import { fontCss } from "@/settings/fonts"
import { usePreferences } from "@/settings/context"
import { lspLanguageForPath } from "@/lib/lspLanguage"
import { editorFonts, pluginEnabled } from "@/settings/model"
import { pluginForLanguage } from "@/settings/pluginCatalog"
import { useT } from "@/i18n/useT"

type LspPosition = { line: number; character: number }
type LspRange = { start: LspPosition; end: LspPosition }
type LspDiagnostic = { range: LspRange; message: string; severity?: number; source?: string }
type LspCompletion = {
  label: string
  filterText?: string
  kind?: number
  detail?: string
  documentation?: string | { value: string }
  insertText?: string
  textEdit?: { range: LspRange; newText: string }
}

const lspDownloads: Record<string, { name: string; url: string }> = {
  c: { name: "clangd", url: "https://clangd.llvm.org/installation" },
  cpp: { name: "clangd", url: "https://clangd.llvm.org/installation" },
  python: { name: "Pyright", url: "https://github.com/microsoft/pyright#command-line" },
  rust: { name: "rust-analyzer", url: "https://rust-analyzer.github.io/book/vs_code.html" },
}
const promptedLsp = new Set<string>()

function offset(view: EditorView, point: LspPosition) {
  if (!point || point.line < 0 || point.line >= view.state.doc.lines) return null
  const line = view.state.doc.line(point.line + 1)
  return Math.min(line.to, line.from + Math.max(0, point.character))
}
function documentation(value: string | { value: string } | undefined) {
  return typeof value === "string" ? value : (value?.value ?? "")
}
function textContent(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(textContent).join("\n")
  if (value && typeof value === "object" && "value" in value) return String(value.value)
  return ""
}

export function CodeEditor({
  root,
  path,
  source,
  readOnly,
  onChange,
  onNavigate,
  ariaLabel,
  jumpTo,
}: {
  root?: string
  path: string
  source: string
  readOnly: boolean
  onChange: (text: string) => void
  onNavigate: (path: string, position: LspPosition) => void
  ariaLabel: string
  jumpTo?: { path: string; position: LspPosition; id: string }
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const settings = useRef(new Compartment())
  const callbacks = useRef({ onChange, onNavigate })
  const external = useRef(false)
  const ready = useRef(false)
  const server = useRef("LSP")
  const { preferences } = usePreferences()
  const { t } = useT()
  const lspLanguage = lspLanguageForPath(path)
  const pluginId = pluginForLanguage(lspLanguage)
  const enabled = pluginEnabled(preferences, root, pluginId ?? "")
  callbacks.current = { onChange, onNavigate }

  useLayoutEffect(() => {
    if (!host.current) return
    let alive = true
    const token = crypto.randomUUID()
    const query = (method: string, at: number, text: string) =>
      root && ready.current
        ? envoi()
            .lspQuery(root, path, method, at, text)
            .catch(() => null)
        : Promise.resolve(null)
    const complete = async (context: CompletionContext) => {
      const word = context.matchBefore(/[\w]*/)
      if (
        !context.explicit &&
        !word?.text &&
        !/[.:>]$/.test(context.state.doc.sliceString(Math.max(0, context.pos - 2), context.pos))
      )
        return null
      const result = await query(
        "textDocument/completion",
        context.pos,
        context.state.doc.toString(),
      )
      if (!result || context.aborted) return null
      const received = Array.isArray(result) ? result : (result as { items?: unknown }).items
      const items = Array.isArray(received) ? (received as LspCompletion[]) : []
      const options: Completion[] = items
        .slice(0, 200)
        .filter((item) => typeof item.label === "string")
        .map((item) => ({
          label: item.label,
          filterText: item.filterText,
          detail: item.detail,
          info: documentation(item.documentation),
          apply: (editor, _completion, from, to) => {
            const edit = item.textEdit
            const start = edit?.range ? offset(editor, edit.range.start) : null
            const end = edit?.range ? offset(editor, edit.range.end) : null
            editor.dispatch({
              changes: {
                from: start ?? from,
                to: end ?? to,
                insert: edit?.newText ?? item.insertText ?? item.label,
              },
            })
          },
        }))
      return options.length ? { from: word?.from ?? context.pos, options } : null
    }
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [complete] }),
          lintGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(codeHighlight, { fallback: true }),
          hoverTooltip(async (editor, pos) => {
            const result = (await query(
              "textDocument/hover",
              pos,
              editor.state.doc.toString(),
            )) as { contents?: unknown; range?: LspRange } | null
            const content = textContent(result?.contents)
            if (!content) return null
            return {
              pos:
                offset(
                  editor,
                  result?.range?.start ?? {
                    line: editor.state.doc.lineAt(pos).number - 1,
                    character: pos - editor.state.doc.lineAt(pos).from,
                  },
                ) ?? pos,
              end: result?.range ? (offset(editor, result.range.end) ?? pos) : pos,
              create: () => {
                const dom = document.createElement("pre")
                dom.className = "max-w-md whitespace-pre-wrap p-2 text-xs"
                dom.textContent = content
                return { dom }
              },
            }
          }),
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if ((!event.ctrlKey && !event.metaKey) || !ready.current) return false
              const at = editor.posAtCoords({ x: event.clientX, y: event.clientY })
              if (at === null) return false
              event.preventDefault()
              void query("textDocument/definition", at, editor.state.doc.toString()).then(
                (result) => {
                  const location = Array.isArray(result) ? result[0] : null
                  if (location?.path && location?.position)
                    callbacks.current.onNavigate(location.path, location.position)
                },
              )
              return true
            },
          }),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !external.current)
              callbacks.current.onChange(update.state.doc.toString())
          }),
          settings.current.of([]),
          editorLanguage.of([]),
        ],
      }),
    })
    view.current = editor
    const off = root
      ? envoi().onLspDiagnostics((event) => {
          if (!alive || event.root !== root || event.path !== path) return
          const diagnostics = (
            Array.isArray(event.diagnostics) ? (event.diagnostics as LspDiagnostic[]) : []
          ).flatMap((item): Diagnostic[] => {
            const from = offset(editor, item.range?.start),
              to = offset(editor, item.range?.end)
            return from === null || to === null
              ? []
              : [
                  {
                    from,
                    to: Math.max(from, to),
                    message: item.message,
                    severity:
                      item.severity === 1
                        ? "error"
                        : item.severity === 2
                          ? "warning"
                          : item.severity === 4
                            ? "hint"
                            : "info",
                    source: item.source,
                  },
                ]
          })
          editor.dispatch(setDiagnostics(editor.state, diagnostics))
          publishLspDiagnostics(
            path,
            server.current,
            (Array.isArray(event.diagnostics) ? (event.diagnostics as LspDiagnostic[]) : [])
              .filter((item) => item.severity === 1 || item.severity === 2)
              .map((item) => ({
                severity: item.severity === 1 ? ("error" as const) : ("warning" as const),
                message: item.message,
                line: (item.range?.start.line ?? 0) + 1,
                column: (item.range?.start.character ?? 0) + 1,
              })),
          )
        })
      : () => {}
    if (root && enabled) {
      publishLspStatus({ state: "starting", pluginId, root })
      void envoi()
        .lspOpen(
          root,
          path,
          source,
          token,
          preferences.lspServers[lspLanguageForPath(path) ?? ""],
          preferences.lspPaths[preferences.lspServers[lspLanguageForPath(path) ?? ""]],
        )
        .then((result) => {
          if (!alive) {
            void envoi().lspClose(root, path, token)
            return
          }
          server.current = result.server ?? "LSP"
          ready.current = result.available
          publishLspStatus(
            result.available
              ? { state: "ready", server: result.server ?? "LSP", pluginId, root }
              : result.error === "No language server for this file"
                ? null
                : { state: "unavailable", reason: "missing", pluginId, root },
          )
          if (
            !result.available &&
            result.error === `No ${lspLanguage} language server found` &&
            root &&
            lspLanguage
          ) {
            const download = lspDownloads[lspLanguage]
            const promptKey = `${root}\0${pluginId ?? lspLanguage}`
            if (download && !promptedLsp.has(promptKey)) {
              promptedLsp.add(promptKey)
              toast.info(t("extensions.installPrompt", { name: download.name }), {
                duration: 12000,
                action: {
                  label: t("extensions.downloadPage"),
                  onClick: () => window.open(download.url, "_blank", "noopener,noreferrer"),
                },
              })
            }
          }
          if (result.available && editor.state.doc.toString() !== source)
            void envoi().lspChange(root, path, editor.state.doc.toString())
        })
        .catch(() => {
          if (alive) publishLspStatus({ state: "unavailable", reason: "failed", pluginId, root })
        })
    }
    const language = LanguageDescription.matchFilename(languages, path)
    if (language)
      void language
        .load()
        .then((support) => {
          if (alive) editor.dispatch({ effects: editorLanguage.reconfigure(support) })
        })
        .catch(() => {})
    return () => {
      alive = false
      ready.current = false
      publishLspStatus(null)
      clearLspDiagnostics(path)
      off()
      editor.destroy()
      view.current = null
      if (root) void envoi().lspClose(root, path, token)
    }
    // An editor instance lives for one file; ReaderView keys it by file ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    const editor = view.current
    if (!editor || !jumpTo || jumpTo.path !== path) return
    const at = offset(editor, jumpTo.position)
    if (at !== null) {
      editor.dispatch({ selection: { anchor: at }, scrollIntoView: true })
      editor.focus()
    }
  }, [jumpTo, path])
  useLayoutEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== source) {
      external.current = true
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } })
      external.current = false
    }
    if (root && ready.current)
      void envoi()
        .lspChange(root, path, source)
        .catch(() => {})
  }, [root, path, source])
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: settings.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          "&": {
            height: "100%",
            fontFamily: fontCss(preferences.fontFamily, editorFonts),
            fontSize: `${preferences.fontSize}px`,
            color: "hsl(var(--foreground))",
          },
          ".cm-scroller": { overflow: "auto", lineHeight: String(preferences.lineHeight) },
          ".cm-content": { padding: "16px", tabSize: String(preferences.tabSize) },
          "&.cm-focused": { outline: "none" },
          ".cm-cursor": { borderLeftColor: "hsl(var(--primary))" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            background: "hsl(var(--primary) / .2)",
          },
          ".cm-gutters": {
            background: "transparent",
            color: "hsl(var(--muted-foreground) / .55)",
            border: "none",
          },
          ".cm-activeLine": { background: "hsl(var(--foreground) / .045)" },
          ".cm-activeLineGutter": {
            background: "transparent",
            color: "hsl(var(--foreground))",
          },
        }),
      ]),
    })
  }, [readOnly, preferences])
  return <div ref={host} className="h-full" />
}

const editorLanguage = new Compartment()
