import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from "react"
import { replaceSelection } from "@/lib/citations"
import { tokenizeLatex } from "@/lib/latexHighlight"
import { useT } from "@/i18n/useT"

export interface LatexEditorHandle {
  insert: (text: string) => void
  locate: (start: number, end: number) => void
}

/** Native soft-wrapping textarea with an identically sized syntax mirror. */
export function LatexEditor({
  ref,
  value,
  onChange,
  fontSize = 12.5,
  highlight,
  fontFamily,
  lineHeight = 1.75,
  tabSize = 4,
  onDoubleClickLine,
}: {
  ref?: Ref<LatexEditorHandle>
  value: string
  onChange: (v: string) => void
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  tabSize?: number
  highlight?: { start: number; severity: "error" | "warning" }
  onDoubleClickLine?: (line: number) => void
}) {
  const { t } = useT()
  const gutterRef = useRef<HTMLDivElement>(null),
    preRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null),
    textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null),
    pendingCursor = useRef<number | null>(null)
  const lines = useMemo(
    () => value.split("\n").map((text) => ({ text, tokens: tokenizeLatex(text) })),
    [value],
  )
  const typography = { fontSize, lineHeight, fontFamily, tabSize }
  const sync = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (preRef.current) preRef.current.scrollTop = textarea.scrollTop
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop
  }, [])
  const reveal = useCallback(
    (start: number, end: number) => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(start, end)
      const mirror = document.createElement("div"),
        style = getComputedStyle(textarea)
      Object.assign(mirror.style, {
        position: "fixed",
        top: "0",
        left: "0",
        visibility: "hidden",
        width: `${textarea.clientWidth}px`,
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "normal",
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        tabSize: style.tabSize,
        padding: style.padding,
        border: "0",
      })
      mirror.append(document.createTextNode(textarea.value.slice(0, start)))
      const marker = document.createElement("span")
      marker.textContent = textarea.value.slice(start, start + 1) || "\u200b"
      mirror.append(marker, document.createTextNode(textarea.value.slice(start + 1)))
      document.body.append(mirror)
      textarea.scrollTop = Math.max(
        0,
        marker.getBoundingClientRect().top -
          mirror.getBoundingClientRect().top -
          textarea.clientHeight / 3,
      )
      mirror.remove()
      sync()
    },
    [sync],
  )
  useImperativeHandle(ref, () => ({
    insert(text) {
      const textarea = textareaRef.current
      const result = replaceSelection(
        value,
        textarea?.selectionStart ?? value.length,
        textarea?.selectionEnd ?? value.length,
        text,
      )
      pendingCursor.current = result.cursor
      onChange(result.value)
    },
    locate: reveal,
  }))
  useLayoutEffect(() => {
    const textarea = textareaRef.current,
      content = contentRef.current,
      gutter = gutterRef.current
    if (!textarea || !content || !gutter) return
    const measure = () => {
      // clientWidth excludes the native scrollbar, so both layers break at the same pixel.
      content.style.width = `${textarea.clientWidth}px`
      const sourceLines = content.querySelectorAll<HTMLElement>("[data-source-line]")
      sourceLines.forEach((line, index) => {
        const number = gutter.children[index] as HTMLElement
        number.style.height = `${line.getBoundingClientRect().height}px`
      })
      const selected = highlight ? value.slice(0, highlight.start).split("\n").length - 1 : -1
      const target = sourceLines[selected],
        band = highlightRef.current
      if (band && target) {
        band.style.top = `${target.offsetTop}px`
        band.style.height = `${target.getBoundingClientRect().height}px`
      }
      sync()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(textarea)
    observer.observe(content)
    let active = true
    void document.fonts.ready.then(() => {
      if (active) measure()
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [value, fontSize, fontFamily, lineHeight, tabSize, highlight, sync])
  useLayoutEffect(() => {
    if (pendingCursor.current !== null) {
      reveal(pendingCursor.current, pendingCursor.current)
      pendingCursor.current = null
    }
  }, [value, reveal])
  return (
    <div data-content-typography="editor" className="flex h-full min-w-0 bg-editor">
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none shrink-0 overflow-hidden border-r border-border/60 py-3 pl-3 pr-2.5 text-right font-editor text-muted-foreground/40"
        style={typography}
      >
        {lines.map((_, index) => (
          <div key={index} style={{ width: `${String(lines.length).length}ch` }}>
            {index + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={preRef}
          aria-hidden
          className="scrollbar-none pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div
            ref={contentRef}
            className="relative min-h-full px-3.5 py-3 font-editor text-foreground/85"
            style={{
              ...typography,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "normal",
            }}
          >
            {highlight && (
              <div
                ref={highlightRef}
                className={`pointer-events-none absolute left-0 right-0 border-l-2 ${highlight.severity === "error" ? "border-danger bg-danger/15" : "border-warning bg-warning/15"}`}
              />
            )}
            {lines.map((line, index) => (
              <div data-source-line={index + 1} key={index}>
                {line.text
                  ? line.tokens.map((token, i) => (
                      <span key={i} className={token.cls}>
                        {token.text}
                      </span>
                    ))
                  : "\u200b"}
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          aria-label={t("editor.latexBodyAria")}
          value={value}
          wrap="soft"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onDoubleClick={
            onDoubleClickLine
              ? (event) =>
                  onDoubleClickLine(
                    value.slice(0, event.currentTarget.selectionStart).split("\n").length,
                  )
              : undefined
          }
          className="scrollbar-thin absolute inset-0 h-full w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent px-3.5 py-3 font-editor text-transparent caret-primary outline-none selection:bg-primary/25 selection:text-transparent"
          style={{
            ...typography,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "normal",
          }}
        />
      </div>
    </div>
  )
}
