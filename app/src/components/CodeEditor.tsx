import { PythonEnvironment } from "./PythonEnvironment"
import { useLayoutEffect, useRef, useState } from "react"
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
import { LanguageDescription, syntaxHighlighting, bracketMatching } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import {
  autocompletion,
  acceptCompletion,
  completionKeymap,
  snippet,
  nextSnippetField,
  prevSnippetField,
  clearSnippet,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint"
import { toast } from "sonner"
import { envoi } from "@/lib/desktop"
import {
  clearLspDiagnostics,
  clearToolDiagnostics,
  publishLspDiagnostics,
  publishLspStatus,
  publishToolDiagnostics,
} from "@/lib/lspStatus"
import { codeHighlight } from "@/lib/codeHighlight"
import { editorChrome } from "@/lib/editorTheme"
import { fontCss } from "@/settings/fonts"
import { usePreferences } from "@/settings/context"
import { lspLanguageForPath } from "@/lib/lspLanguage"
import { editorFonts, pluginEnabled, themes } from "@/settings/model"
import { pluginForLanguage } from "@/settings/pluginCatalog"
import { useT } from "@/i18n/useT"
import { completionChanges, type LspPosition, type LspRange } from "@/lib/lspCompletion"

type LspDiagnostic = { range: LspRange; message: string; severity?: number; source?: string }
type LspCompletion = {
  label: string
  filterText?: string
  kind?: number
  detail?: string
  documentation?: string | { value: string }
  insertText?: string
  insertTextFormat?: number
  textEdit?:
    { range: LspRange; newText: string } | { insert: LspRange; replace: LspRange; newText: string }
  additionalTextEdits?: { range: LspRange; newText: string }[]
}

const lspDownloads: Record<string, { name: string; url: string }> = {
  c: { name: "clangd", url: "https://clangd.llvm.org/installation" },
  cpp: { name: "clangd", url: "https://clangd.llvm.org/installation" },
  python: { name: "Pyright", url: "https://github.com/microsoft/pyright#command-line" },
  rust: { name: "rust-analyzer", url: "https://rust-analyzer.github.io/book/vs_code.html" },
}
const promptedLsp = new Set<string>()
const linters: Record<string, string> = {
  c: "clangTidy",
  cpp: "clangTidy",
  python: "ruffLint",
  rust: "clippy",
}

// LSP CompletionItemKind → CodeMirror 补全类型(决定图标徽章)。
const completionTypes: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "function",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "constant",
  12: "constant",
  13: "enum",
  14: "keyword",
  15: "text",
  16: "constant",
  17: "text",
  18: "text",
  19: "text",
  20: "constant",
  21: "constant",
  22: "type",
  23: "text",
  24: "keyword",
  25: "type",
}

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

function drainLint(
  queued: { current: (() => Promise<void>) | null },
  running: { current: boolean },
) {
  if (running.current) return
  running.current = true
  void (async () => {
    while (queued.current) {
      const job = queued.current
      queued.current = null
      await job()
    }
  })().finally(() => {
    running.current = false
    if (queued.current) drainLint(queued, running)
  })
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
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const settings = useRef(new Compartment())
  const callbacks = useRef({ onChange, onNavigate })
  const external = useRef(false)
  const ready = useRef(false)
  const server = useRef("LSP")
  const lspIssues = useRef<Diagnostic[]>([])
  const toolIssues = useRef<Diagnostic[]>([])
  const queuedLint = useRef<(() => Promise<void>) | null>(null)
  const lintRunning = useRef(false)
  const { preferences, update } = usePreferences()
  const { t } = useT()
  const lspLanguage = lspLanguageForPath(path)
  const pluginId = pluginForLanguage(lspLanguage)
  const enabled = pluginEnabled(preferences, root, pluginId ?? "")
  callbacks.current = { onChange, onNavigate }

  function showIssues(editor: EditorView) {
    const unique = new Map<string, Diagnostic>()
    for (const issue of [...lspIssues.current, ...toolIssues.current])
      unique.set(`${issue.from}:${issue.to}:${issue.message}`, issue)
    editor.dispatch(setDiagnostics(editor.state, [...unique.values()]))
  }

  useLayoutEffect(() => {
    if (!host.current) return
    let alive = true
    let terminated = false
    const token = crypto.randomUUID()
    const query = (method: string, at: number, text: string) =>
      root && ready.current
        ? envoi()
            .lspQuery(root, path, method, at, text)
            .catch(() => null)
        : Promise.resolve(null)
    const goToDefinition = (editor: EditorView, at: number) => {
      if (!ready.current) return false
      void query("textDocument/definition", at, editor.state.doc.toString()).then((result) => {
        const location = Array.isArray(result) ? result[0] : null
        if (location?.path && location?.position)
          callbacks.current.onNavigate(location.path, location.position)
      })
      return true
    }
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
          type: item.kind === undefined ? undefined : completionTypes[item.kind],
          detail: item.detail,
          info: documentation(item.documentation),
          apply: (editor, _completion, from, to) => {
            const changes = completionChanges(editor.state.doc, item, from, to)
            if (!changes.length) return
            const [primary, ...extras] = changes
            if (item.insertTextFormat !== 2) {
              editor.dispatch({ changes })
              return
            }
            // snippet 补全(clangd 函数占位符等):先插入附加编辑(import 等),
            // 映射主编辑位置后按模板展开,Tab 在占位符间跳转。
            const mapping = editor.state.changes(extras)
            editor.dispatch({ changes: extras })
            // LSP 允许 $0/$1 简写且可省略 $0(默认模板末尾);
            // CodeMirror 只解析 ${…} 形式,先规范化再补终结位。
            const normalized = primary.insert.replace(/(?<![\\{])\$(\d+)/g, "${$1}")
            const template = /\$\{0[:}]/.test(normalized) ? normalized : `${normalized}\${0}`
            snippet(template)(
              editor,
              _completion,
              mapping.mapPos(primary.from, 1),
              mapping.mapPos(primary.to, -1),
            )
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
          keymap.of([
            // snippet 占位符跳转优先于补全接受与缩进。
            { key: "Tab", run: nextSnippetField },
            { key: "Shift-Tab", run: prevSnippetField },
            { key: "Escape", run: clearSnippet },
            {
              key: "F12",
              run: (editor) => goToDefinition(editor, editor.state.selection.main.head),
            },
            // Tab 优先接受补全;弹窗未打开时落到 indentWithTab。
            { key: "Tab", run: acceptCompletion },
            indentWithTab,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          autocompletion({ override: [complete] }),
          lintGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(codeHighlight, { fallback: true }),
          bracketMatching(),
          editorChrome,
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
                dom.className = "cm-hover-doc"
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
              return goToDefinition(editor, at)
            },
          }),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              lspIssues.current = lspIssues.current.map((issue) => ({
                ...issue,
                from: update.changes.mapPos(issue.from),
                to: update.changes.mapPos(issue.to),
              }))
              toolIssues.current = []
              clearToolDiagnostics(path)
              if (!external.current) callbacks.current.onChange(update.state.doc.toString())
              queueMicrotask(() => {
                if (view.current === update.view) showIssues(update.view)
              })
            }
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
          lspIssues.current = diagnostics
          showIssues(editor)
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
    const offStatus = root
      ? envoi().onLspStatus?.((event) => {
          if (!alive || event.root !== root || event.path !== path || event.token !== token) return
          terminated = true
          ready.current = false
          lspIssues.current = []
          clearLspDiagnostics(path)
          showIssues(editor)
          setFailed(true)
          publishLspStatus({ state: "unavailable", reason: "failed", pluginId, root })
        })
      : undefined
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
          if (terminated) return
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
            if (download && !/^(ssh|wsl):\/\//.test(root) && !promptedLsp.has(promptKey)) {
              promptedLsp.add(promptKey)
              toast.info(t("extensions.installPrompt", { name: download.name }), {
                duration: 12000,
                action: {
                  label: t("extensions.installAction"),
                  onClick: () => {
                    const notification = toast.loading(
                      t("extensions.installing", { name: download.name }),
                    )
                    void Promise.resolve()
                      .then(() => {
                        const bridge = envoi()
                        if (typeof bridge.installLsp !== "function")
                          throw Error(t("extensions.restartToInstall"))
                        return bridge.installLsp(lspLanguage)
                      })
                      .then((installed) => {
                        toast.success(t("extensions.installed", { name: download.name }), {
                          id: notification,
                        })
                        const lspServers = { ...preferences.lspServers }
                        if (installed.id === "clangd") {
                          lspServers.c = installed.id
                          lspServers.cpp = installed.id
                        } else lspServers[lspLanguage] = installed.id
                        update({
                          lspServers,
                          lspPaths: { ...preferences.lspPaths, [installed.id]: "" },
                        })
                      })
                      .catch((error) => {
                        promptedLsp.delete(promptKey)
                        toast.error(t("extensions.installFailed", { name: download.name }), {
                          id: notification,
                          description: error instanceof Error ? error.message : String(error),
                          action: {
                            label: t("extensions.downloadPage"),
                            onClick: () =>
                              window.open(download.url, "_blank", "noopener,noreferrer"),
                          },
                        })
                      })
                  },
                },
              })
            }
          }
          if (result.available && editor.state.doc.toString() !== source)
            void envoi().lspChange(root, path, editor.state.doc.toString())
        })
        .catch(() => {
          if (alive) {
            setFailed(true)
            publishLspStatus({ state: "unavailable", reason: "failed", pluginId, root })
          }
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
      clearToolDiagnostics(path)
      queuedLint.current = null
      off()
      offStatus?.()
      editor.destroy()
      view.current = null
      if (root) void envoi().lspClose(root, path, token)
    }
    // An editor instance lives for one file; ReaderView keys it by file ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])
  useLayoutEffect(() => {
    if (!/^(ssh|wsl):\/\//.test(root ?? "") || typeof envoi().onRemoteEvent !== "function") return
    return envoi().onRemoteEvent((event) => {
      if (event.type !== "state" || event.value.root !== root) return
      if (event.value.state === "connected") {
        setFailed(false)
        setAttempt((value) => value + 1)
      } else {
        ready.current = false
        setFailed(true)
        clearLspDiagnostics(path)
      }
    })
  }, [root, path])
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
    const editor = view.current
    const id = linters[lspLanguage ?? ""]
    toolIssues.current = []
    clearToolDiagnostics(path)
    if (editor) showIssues(editor)
    if (!editor || !root || !enabled || !id || readOnly) return
    let cancelled = false
    const timer = setTimeout(
      () => {
        queuedLint.current = async () => {
          try {
            const result = await envoi().languageTool(
              root,
              path,
              source,
              "lint",
              preferences.toolPaths[id],
            )
            if (cancelled || view.current !== editor || editor.state.doc.toString() !== source)
              return
            const issues = result.diagnostics ?? []
            toolIssues.current = issues.flatMap((issue): Diagnostic[] => {
              const from = offset(editor, { line: issue.line - 1, character: issue.column - 1 })
              return from === null
                ? []
                : [
                    {
                      from,
                      to: Math.min(from + 1, editor.state.doc.length),
                      message: issue.message,
                      severity: issue.severity === "error" ? "error" : "warning",
                      source: issue.source,
                    },
                  ]
            })
            showIssues(editor)
            publishToolDiagnostics(
              path,
              result.tool,
              issues.map((issue) => ({
                severity: issue.severity === "error" ? "error" : "warning",
                message: issue.message,
                line: issue.line,
                column: issue.column,
              })),
            )
          } catch {
            if (!cancelled) clearToolDiagnostics(path)
          }
        }
        drainLint(queuedLint, lintRunning)
      },
      id === "ruffLint" ? 350 : id === "clippy" ? 1_200 : 600,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [root, path, source, enabled, readOnly, lspLanguage, preferences.toolPaths])
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: settings.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme(
          {
            "&": {
              fontFamily: fontCss(preferences.fontFamily, editorFonts),
              fontSize: `${preferences.fontSize}px`,
            },
            ".cm-scroller": { overflow: "auto", lineHeight: String(preferences.lineHeight) },
            ".cm-content": { tabSize: String(preferences.tabSize) },
          },
          { dark: themes[preferences.theme].mode === "dark" },
        ),
      ]),
    })
  }, [readOnly, preferences, attempt])
  return (
    <div className="flex h-full min-h-0 flex-col">
      {root && lspLanguage === "python" && !readOnly && (
        <PythonEnvironment root={root} onCreated={() => setAttempt((value) => value + 1)} />
      )}
      {failed && enabled && (
        <button
          data-testid="lsp-retry"
          className="shrink-0 border-b px-3 py-1 text-left text-xs"
          onClick={() => {
            setFailed(false)
            setAttempt((value) => value + 1)
          }}
        >
          {t("extensions.retry")}
        </button>
      )}
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  )
}

const editorLanguage = new Compartment()
