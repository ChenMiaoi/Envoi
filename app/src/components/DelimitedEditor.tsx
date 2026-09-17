import { fontCss } from "@/settings/fonts"
import { useLayoutEffect, useMemo, useRef } from "react"
import { parseDelimited, editDelimitedCell } from "@/lib/delimited"
import { usePreferences } from "@/settings/context"
import { textFonts, editorFonts } from "@/settings/model"
import { useT } from "@/i18n/useT"
const isNumeric = (value: string) =>
  /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(value)

export function DelimitedEditor({
  source,
  delimiter,
  onChange,
  readOnly,
}: {
  source: string
  delimiter: string
  onChange: (source: string) => void
  readOnly: boolean
}) {
  const { t } = useT()
  const tableRef = useRef<HTMLTableElement>(null)
  const { preferences } = usePreferences()
  const parsed = useMemo(() => {
    try {
      return { rows: parseDelimited(source, delimiter), error: "" }
    } catch (error) {
      return { rows: [], error: (error as Error).message }
    }
  }, [source, delimiter])
  const hasHeader =
    parsed.rows.length > 1 &&
    parsed.rows[0].every((cell) => cell.value.trim() && !isNumeric(cell.value)) &&
    parsed.rows.slice(1).some((row) => row.some((cell) => isNumeric(cell.value)))
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const measure = () => {
      const sample = table.querySelector(".data-table-cell")
      if (!sample) return
      const computed = getComputedStyle(sample),
        span = document.createElement("span")
      Object.assign(span.style, {
        position: "fixed",
        visibility: "hidden",
        whiteSpace: "pre",
        font: computed.font,
        fontWeight: hasHeader ? "600" : computed.fontWeight,
        letterSpacing: computed.letterSpacing,
        tabSize: computed.tabSize,
      })
      document.body.append(span)
      const widths: number[] = []
      for (const row of parsed.rows)
        row.forEach((cell, column) => {
          for (const line of cell.value.split(/\r\n|\r|\n/)) {
            span.textContent = line
            widths[column] = Math.max(
              widths[column] ?? 48,
              Math.ceil(span.getBoundingClientRect().width) + 32,
            )
          }
        })
      span.remove()
      table.querySelectorAll("col").forEach((col, index) => {
        col.style.width = `${index === 0 ? 48 : (widths[index - 1] ?? 48)}px`
      })
      table.style.width = `${48 + widths.reduce((sum, width) => sum + width, 0)}px`
    }
    measure()
    let active = true
    void document.fonts.ready.then(() => {
      if (active) measure()
    })
    return () => {
      active = false
    }
  }, [parsed.rows, hasHeader, readOnly, preferences.previewFontSize, preferences.previewFontFamily])
  if (parsed.error)
    return (
      <div className="flex h-full flex-col">
        <p role="alert" className="p-4 text-sm text-warning">
          {t("editor.tableError", { error: parsed.error })}
        </p>
        <textarea
          data-content-typography="editor"
          style={{
            fontFamily: fontCss(preferences.fontFamily, editorFonts),
            fontSize: preferences.fontSize,
            lineHeight: preferences.lineHeight,
            tabSize: preferences.tabSize,
          }}
          aria-label={t("editor.tableFixAria")}
          value={source}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-0 flex-1 bg-transparent p-4 font-editor"
        />
      </div>
    )
  if (!parsed.rows.length)
    return (
      <textarea
        data-content-typography="editor"
        style={{
          fontFamily: fontCss(preferences.fontFamily, editorFonts),
          fontSize: preferences.fontSize,
          lineHeight: preferences.lineHeight,
          tabSize: preferences.tabSize,
        }}
        aria-label={t("editor.emptyTableAria")}
        value={source}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full bg-transparent p-4"
        placeholder={t("editor.csvPlaceholder")}
      />
    )
  return (
    <div
      data-content-typography="preview"
      className="h-full min-w-0 overflow-hidden p-4"
      style={{
        fontFamily: fontCss(preferences.previewFontFamily, textFonts),
        fontSize: preferences.previewFontSize,
        lineHeight: preferences.previewLineHeight,
      }}
    >
      <div className="data-table-frame envoi-scrollbar">
        <table ref={tableRef} className="data-table table-fixed">
          <colgroup>
            {Array.from(
              { length: 1 + parsed.rows.reduce((count, row) => Math.max(count, row.length), 0) },
              (_, i) => (
                <col key={i} />
              ),
            )}
          </colgroup>
          <tbody>
            {parsed.rows.map((row, r) => (
              <tr key={r} data-header={hasHeader && r === 0 ? true : undefined}>
                <th scope="row" className="px-2 text-[.8em] font-normal">
                  {r + 1}
                </th>
                {row.map((cell, c) => {
                  const numeric = isNumeric(cell.value)
                  const Cell = hasHeader && r === 0 ? "th" : "td"
                  return (
                    <Cell
                      key={c}
                      scope={hasHeader && r === 0 ? "col" : undefined}
                      className="align-top"
                    >
                      {readOnly ? (
                        <div className={`data-table-cell${numeric ? " text-right" : ""}`}>
                          {cell.value || "\u00a0"}
                        </div>
                      ) : (
                        <textarea
                          aria-label={t("editor.cellAria", { r: r + 1, c: c + 1 })}
                          wrap="off"
                          rows={Math.max(1, cell.value.split(/\r\n|\r|\n/).length)}
                          value={cell.value}
                          onChange={(event) =>
                            onChange(editDelimitedCell(source, cell, event.target.value, delimiter))
                          }
                          className={`data-table-cell${numeric ? " text-right" : ""}`}
                        />
                      )}
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
