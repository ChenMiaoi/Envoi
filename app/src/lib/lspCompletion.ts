import type { Text } from "@codemirror/state"

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspTextEdit = { range: LspRange; newText: string }
export type LspCompletionEdit = {
  label: string
  insertText?: string
  textEdit?: LspTextEdit | { insert: LspRange; replace: LspRange; newText: string }
  additionalTextEdits?: LspTextEdit[]
}
type Change = { from: number; to: number; insert: string }

export function lspOffset(doc: Text, point: LspPosition): number | null {
  if (
    !point ||
    !Number.isInteger(point.line) ||
    point.line < 0 ||
    point.line >= doc.lines ||
    !Number.isInteger(point.character) ||
    point.character < 0
  )
    return null
  const line = doc.line(point.line + 1)
  return Math.min(line.to, line.from + Math.max(0, point.character))
}

function editChange(doc: Text, edit: LspTextEdit): Change | null {
  const from = lspOffset(doc, edit.range?.start)
  const to = lspOffset(doc, edit.range?.end)
  return from === null || to === null || from > to || typeof edit.newText !== "string"
    ? null
    : { from, to, insert: edit.newText }
}

export function completionChanges(
  doc: Text,
  item: LspCompletionEdit,
  from: number,
  to: number,
): Change[] {
  const edit = item.textEdit
  const range = edit && ("range" in edit ? edit.range : edit.replace)
  const primary =
    range && edit
      ? editChange(doc, { range, newText: edit.newText })
      : { from, to, insert: item.insertText ?? item.label }
  if (!primary) return []
  const changes = [primary]
  for (const extra of item.additionalTextEdits ?? []) {
    const change = editChange(doc, extra)
    if (change && !changes.some((prior) => change.from < prior.to && prior.from < change.to))
      changes.push(change)
  }
  return changes.sort((a, b) => a.from - b.from)
}
