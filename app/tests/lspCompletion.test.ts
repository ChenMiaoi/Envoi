import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorState } from "@codemirror/state"
import { completionChanges } from "../src/lib/lspCompletion"

test("LSP completion applies its replacement and import edit in one transaction", () => {
  const state = EditorState.create({ doc: "value = Lis\n" })
  const changes = completionChanges(
    state.doc,
    {
      label: "List",
      textEdit: {
        range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } },
        newText: "List",
      },
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: "from typing import List\n",
        },
      ],
    },
    8,
    11,
  )
  assert.equal(
    state.update({ changes }).state.doc.toString(),
    "from typing import List\nvalue = List\n",
  )
})

test("LSP completion skips overlapping secondary edits", () => {
  const state = EditorState.create({ doc: "old" })
  const changes = completionChanges(
    state.doc,
    {
      label: "new",
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          newText: "conflict",
        },
      ],
    },
    0,
    3,
  )
  assert.equal(state.update({ changes }).state.doc.toString(), "new")
})
