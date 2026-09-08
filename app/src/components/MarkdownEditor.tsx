import { fontCss } from "@/settings/fonts"
import { useLayoutEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { EditorState, StateField, Compartment, type Range } from "@codemirror/state"
import { EditorView, Decoration, WidgetType, keymap, type DecorationSet } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { syntaxTree, syntaxHighlighting, HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"
import { GFM } from "@lezer/markdown"
import { languages } from "@codemirror/language-data"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { usePreferences } from "@/settings/context"
import { editorFonts, textFonts } from "@/settings/model"
import { resolveProjectLink, markdownDocument, editMarkdownChanges } from "@/lib/markdownEditing"
import type { ProjectFile } from "@/lib/projectFiles"
import { rehypeCallouts } from "@/lib/rehypeCallouts"
import { translate } from "@/i18n/runtime"
/* 代码块内嵌语法着色：token 颜色与阅读预览一致（主题色相槽） */
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "hsl(var(--hue-violet))" },
  { tag: [tags.string, tags.special(tags.string)], color: "hsl(var(--hue-green))" },
  { tag: [tags.number, tags.bool, tags.atom], color: "hsl(var(--hue-orange))" },
  { tag: tags.comment, color: "hsl(var(--hue-sage))", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "hsl(var(--hue-blue))",
  },
  {
    tag: [tags.typeName, tags.className, tags.standard(tags.variableName)],
    color: "hsl(var(--hue-cyan))",
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.variableName],
    color: "hsl(var(--hue-yellow))",
  },
  { tag: [tags.labelName, tags.namespace], color: "hsl(var(--hue-pink))" },
  { tag: [tags.operator, tags.punctuation], color: "hsl(var(--muted-foreground))" },
  { tag: tags.meta, color: "hsl(var(--muted-foreground))" },
])

class PreviewWidget extends WidgetType {
  private root?: Root
  readonly source: string
  readonly from: number
  readonly file?: ProjectFile
  readonly block: boolean
  constructor(source: string, from: number, file?: ProjectFile, block = false) {
    super()
    this.source = source
    this.from = from
    this.file = file
    this.block = block
  }
  eq(other: PreviewWidget) {
    return (
      other.source === this.source &&
      other.from === this.from &&
      other.file?.url === this.file?.url &&
      other.block === this.block
    )
  }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.block ? "div" : "span")
    dom.className = "markdown-body cm-markdown-widget"
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })
    if (this.file?.url) {
      const image = document.createElement("img")
      image.src = this.file.url
      image.alt = this.file.path
      image.style.maxWidth = "100%"
      dom.append(image)
    } else {
      this.root = createRoot(dom)
      this.root.render(
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeCallouts]}
          skipHtml
          components={{
            img: ({ alt }) => <span>{alt}</span>,
            p: ({ children }) => <span>{children}</span>,
          }}
        >
          {this.source}
        </ReactMarkdown>,
      )
    }
    return dom
  }
  destroy() {
    const root = this.root
    queueMicrotask(() => root?.unmount())
  }
  ignoreEvent() {
    return false
  }
}
export function MarkdownEditor({
  source,
  onChange,
  readOnly,
  path,
  files,
  onOpen,
  ariaLabel,
  onSource,
}: {
  ariaLabel?: string
  onSource?: (url: string) => void
  source: string
  onChange: (text: string) => void
  readOnly: boolean
  path: string
  files: ProjectFile[]
  onOpen?: (file: ProjectFile) => void
}) {
  const raw = useRef(source),
    sourceLink = useRef(onSource)
  useLayoutEffect(() => {
    sourceLink.current = onSource
  }, [onSource])
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    change = useRef(onChange),
    external = useRef(false),
    settings = useRef(new Compartment())
  const { preferences } = usePreferences()
  useLayoutEffect(() => {
    change.current = onChange
  }, [onChange])
  useLayoutEffect(() => {
    if (!host.current) return
    const decorate = (state: EditorState) => {
      const ranges: Range<Decoration>[] = []
      const active = (from: number, to: number) =>
        state.selection.ranges.some((range) => range.from <= to && range.to >= from)
      const activeLine = (position: number) => {
        const line = state.doc.lineAt(position)
        return active(line.from, line.to)
      }
      const lines = new Set<number>()
      for (const selection of state.selection.ranges) {
        for (
          let n = state.doc.lineAt(selection.from).number;
          n <= state.doc.lineAt(selection.to).number;
          n++
        )
          lines.add(state.doc.line(n).from)
      }
      for (const from of lines) ranges.push(Decoration.line({ class: "cm-md-editing" }).range(from))
      syntaxTree(state).iterate({
        enter(node) {
          const name = node.name,
            text = state.doc.sliceString(node.from, node.to)
          if (name === "FencedCode" || name === "CodeBlock") {
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            for (let line = first; line <= last; line++) {
              const classes = ["cm-md-codeblock"]
              if (line === first) classes.push("cm-md-codeblock-first")
              if (line === last) classes.push("cm-md-codeblock-last")
              ranges.push(
                Decoration.line({ class: classes.join(" ") }).range(state.doc.line(line).from),
              )
            }
            return false
          }
          if (name === "Table" && !active(node.from, node.to)) {
            ranges.push(
              Decoration.replace({
                widget: new PreviewWidget(text, node.from, undefined, true),
                block: true,
              }).range(node.from, node.to),
            )
            return false
          }
          if (name === "Image" && !activeLine(node.from)) {
            const destination = /\]\(([^\s)]+)(?:\s+[^)]*)?\)$/.exec(text)?.[1]
            const target = destination && resolveProjectLink(path, destination)
            const file = files.find((file) => file.path === target && file.kind === "image")
            if (file?.url) {
              ranges.push(
                Decoration.replace({ widget: new PreviewWidget(text, node.from, file) }).range(
                  node.from,
                  node.to,
                ),
              )
              return false
            }
          }
          if (name === "Blockquote") {
            for (
              let n = state.doc.lineAt(node.from).number;
              n <= state.doc.lineAt(node.to).number;
              n++
            )
              ranges.push(Decoration.line({ class: "cm-md-quote" }).range(state.doc.line(n).from))
          }
          if (/^ATXHeading[1-6]$/.test(name))
            ranges.push(
              Decoration.mark({ class: `cm-md-heading cm-md-h${name.at(-1)}` }).range(
                node.from,
                node.to,
              ),
            )
          if (
            name === "StrongEmphasis" ||
            name === "Emphasis" ||
            name === "Strikethrough" ||
            name === "InlineCode"
          )
            ranges.push(
              Decoration.mark({
                class: {
                  StrongEmphasis: "cm-md-strong",
                  Emphasis: "cm-md-em",
                  Strikethrough: "cm-md-strike",
                  InlineCode: "cm-md-code",
                }[name],
              }).range(node.from, node.to),
            )
          if (
            ["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark"].includes(name) &&
            !activeLine(node.from)
          )
            ranges.push(Decoration.replace({}).range(node.from, node.to))
          if (name === "Link" && !activeLine(node.from)) {
            ranges.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to))
            const suffix = text.indexOf("](")
            if (suffix >= 0) {
              ranges.push(Decoration.replace({}).range(node.from, node.from + 1))
              ranges.push(Decoration.replace({}).range(node.from + suffix, node.to))
            }
          }
        },
      })
      for (const match of state.doc.toString().matchAll(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g)) {
        const from = match.index,
          to = from + match[0].length
        if (active(from, to)) continue
        let node = syntaxTree(state).resolveInner(from, 1),
          code = false
        while (node.parent) {
          if (/Code|Table/.test(node.name)) code = true
          node = node.parent
        }
        if (!code)
          ranges.push(
            Decoration.replace({
              widget: new PreviewWidget(match[0], from, undefined, match[0].includes("\n")),
              block: match[0].includes("\n"),
            }).range(from, to),
          )
      }
      return Decoration.set(ranges, true)
    }
    const preview = StateField.define<DecorationSet>({
      create: decorate,
      update: (value, transaction) =>
        transaction.docChanged || transaction.selection ? decorate(transaction.state) : value,
      provide: (field) => EditorView.decorations.from(field),
    })
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: markdownDocument(source),
        extensions: [
          markdown({ extensions: GFM, codeLanguages: languages }),
          syntaxHighlighting(codeHighlight),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if (!event.ctrlKey && !event.metaKey) return false
              const position = editor.posAtCoords({ x: event.clientX, y: event.clientY })
              if (position === null) return false
              let node = syntaxTree(editor.state).resolveInner(position, 1)
              while (node.parent && node.name !== "Link") node = node.parent
              if (node.name !== "Link") return false
              const url = node.getChild("URL")
              if (!url) return false
              const destination = editor.state.doc.sliceString(url.from, url.to),
                target = resolveProjectLink(path, destination),
                file = files.find((file) => file.path === target)
              if (destination.startsWith("envoi-paper:") && sourceLink.current)
                sourceLink.current(destination)
              else if (file) onOpen?.(file)
              else if (/^https?:\/\//i.test(destination))
                window.open(destination, "_blank", "noopener,noreferrer")
              else return false
              event.preventDefault()
              return true
            },
          }),
          preview,
          settings.current.of([]),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel ?? translate("editor.markdownLiveAria"),
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !external.current) {
              const changes: { from: number; to: number; insert: string }[] = []
              update.changes.iterChanges((from, to, _a, _b, insert) =>
                changes.push({ from, to, insert: insert.toString() }),
              )
              raw.current = editMarkdownChanges(raw.current, changes)
              change.current(raw.current)
            }
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // This component is keyed by file ID. Keeping one EditorView preserves selection and undo across edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    raw.current = source
    const editor = view.current
    if (editor && editor.state.doc.toString() !== markdownDocument(source)) {
      external.current = true
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: markdownDocument(source) },
      })
      external.current = false
    }
  }, [source])
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: settings.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme(
          {
            "&": {
              height: "100%",
              fontFamily: fontCss(preferences.previewFontFamily, textFonts),
              fontSize: `${preferences.previewFontSize}px`,
              color: "hsl(var(--foreground))",
            },
            ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.85", overflow: "auto" },
            ".cm-content": { padding: "24px 32px", caretColor: "hsl(var(--primary))" },
            ".cm-line": { overflowWrap: "anywhere" },
            "&.cm-focused": { outline: "none" },
            ".cm-cursor": { borderLeftColor: "hsl(var(--primary))" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              background: "hsl(var(--primary) / .2)",
            },
            ".cm-md-editing": {
              fontFamily: fontCss(preferences.fontFamily, editorFonts),
              fontSize: `${preferences.fontSize}px`,
              lineHeight: String(preferences.lineHeight),
            },
            ".cm-md-heading": { fontWeight: "700", color: "var(--prose-heading)" },
            ".cm-md-h1": { fontSize: "1.65em", color: "var(--prose-h12)" },
            ".cm-md-h2": { fontSize: "1.32em", color: "var(--prose-h12)" },
            ".cm-md-h3": { fontSize: "1.1em" },
            ".cm-md-strong": { fontWeight: "700", color: "var(--prose-strong)" },
            ".cm-md-em": { fontStyle: "italic" },
            ".cm-md-strike": { textDecoration: "line-through" },
            ".cm-md-code": {
              fontFamily: fontCss(preferences.fontFamily, editorFonts),
              background: "var(--prose-code-bg)",
              color: "var(--prose-code)",
              borderRadius: "4px",
              padding: "0 .2em",
            },
            ".cm-line.cm-md-codeblock": {
              fontFamily: fontCss(preferences.fontFamily, editorFonts),
              fontSize: `${preferences.fontSize}px`,
              lineHeight: "1.65",
              background: "var(--prose-code-bg)",
              color: "hsl(var(--foreground))",
              borderLeft: "1px solid hsl(var(--border))",
              borderRight: "1px solid hsl(var(--border))",
              padding: "0 16px",
              whiteSpace: "pre-wrap",
              overflowWrap: "normal",
              wordBreak: "normal",
              tabSize: String(preferences.tabSize),
            },
            ".cm-line.cm-md-codeblock-first": {
              borderTop: "1px solid hsl(var(--border))",
              borderRadius: "8px 8px 0 0",
              paddingTop: "10px",
            },
            ".cm-line.cm-md-codeblock-last": {
              borderBottom: "1px solid hsl(var(--border))",
              borderRadius: "0 0 8px 8px",
              paddingBottom: "10px",
            },
            ".cm-md-link": { color: "var(--prose-link)", textDecoration: "underline" },
            ".cm-md-quote": {
              borderLeft: "3px solid var(--prose-quote-border)",
              background: "var(--prose-quote-bg)",
              paddingLeft: "0.85em",
              borderRadius: "0 6px 6px 0",
            },
            ".cm-markdown-widget": { fontSize: "inherit", fontFamily: "inherit" },
            ".cm-markdown-widget table": { fontSize: "inherit" },
          },
          { dark: true },
        ),
      ]),
    })
  }, [preferences, readOnly])
  return <div data-content-typography="preview" ref={host} className="h-full min-w-0" />
}
