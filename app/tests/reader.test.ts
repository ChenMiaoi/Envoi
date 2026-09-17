import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDelimited, editDelimitedCell } from "../src/lib/delimited"
import {
  markdownDocument,
  editMarkdownChanges,
  resolveProjectLink,
} from "../src/lib/markdownEditing"
import { fileKind } from "../src/lib/projectFiles"
import {
  matchBinding,
  resolveBindings,
  normalizeBindings,
  validateChord,
  migrateLegacyBindings,
} from "../src/navigation/shortcuts"
import { resolvePage } from "../src/navigation/routes"
test("CSV/TSV preserve quotes, empty rows/cells, BOM, CRLF and exact numeric strings on one-cell edit", () => {
  const source =
    '\ufeffname,value,note\r\n"a,b",90071992547409931234,"line1\r\nline2 ""quote"""\r\n\r\nx,,\r\n'
  const rows = parseDelimited(source)
  assert.equal(rows.length, 4)
  assert.equal(rows[1][0].value, "a,b")
  assert.equal(rows[1][1].value, "90071992547409931234")
  assert.equal(rows[1][2].value, 'line1\r\nline2 "quote"')
  assert.deepEqual(
    rows[3].map((c) => c.value),
    ["x", "", ""],
  )
  const next = editDelimitedCell(source, rows[1][0], "changed, name")
  assert.equal(next, source.replace('"a,b"', '"changed, name"'))
  assert.equal(editDelimitedCell(source, rows[1][2], rows[1][2].value), source)
  for (const original of ["", ",", "\n", "a,", '""\r\n', 'a\tb\n"x\ty"\t\n']) {
    const delimiter = original.includes("\t") ? "\t" : ","
    for (const row of parseDelimited(original, delimiter))
      for (const cell of row)
        assert.equal(editDelimitedCell(original, cell, cell.value, delimiter), original)
  }
  assert.throws(() => parseDelimited('"unterminated'))
  assert.throws(() => parseDelimited('a"b,c'))
  assert.throws(() => parseDelimited('"ok"extra,c'))
})
test("continuous Markdown transactions preserve untouched syntax and mixed line endings", () => {
  const source = "# Head\r\n\r\nA **bold** [ref][id].\n\n[id]: https://example.org\r\n"
  const document = markdownDocument(source),
    from = document.indexOf("bold")
  const next = editMarkdownChanges(source, [{ from, to: from + 4, insert: "new" }])
  assert.equal(next, source.replace("bold", "new"))
  assert.equal(
    editMarkdownChanges(source, [{ from: document.length, to: document.length, insert: "\nend" }]),
    source + "\r\nend",
  )
  assert.equal(resolveProjectLink("notes/a.md", "../assets/plot.png"), "assets/plot.png")
  assert.equal(resolveProjectLink("a.md", "../../secret"), null)
  assert.equal(resolveProjectLink("a.md", "javascript:alert(1)"), null)
})
test("file routing recognizes only tex as writer source and keeps binary files distinct", () => {
  assert.equal(fileKind("chapters/a.tex"), "latex")
  assert.equal(fileKind("a.txt"), "text")
  assert.equal(fileKind("a.csv"), "csv")
  assert.equal(fileKind("a.tsv"), "tsv")
  assert.equal(fileKind("a.md"), "markdown")
  assert.equal(fileKind("a.docx"), "binary")
  assert.equal(fileKind("a.avif"), "image")
})
test("shortcut matching recognizes Ctrl and Cmd chords and scoped reader commands", () => {
  const bindings = resolveBindings([])
  const key = {
    key: "s",
    code: "KeyS",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  }
  assert.equal(matchBinding(key, bindings)?.id, "save")
  assert.equal(matchBinding({ ...key, ctrlKey: false, metaKey: true }, bindings)?.id, "save")
  assert.equal(matchBinding({ ...key, shiftKey: true }, bindings), undefined)
  assert.equal(
    matchBinding({ ...key, key: "r", code: "KeyR", altKey: true }, bindings)?.id,
    "reader-read-only",
  )
  assert.equal(
    matchBinding(
      { key: "!", code: "Digit1", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
      bindings,
    )?.id,
    "view-reader",
  )
  assert.equal(
    matchBinding(
      {
        key: "ArrowLeft",
        code: "ArrowLeft",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      },
      bindings,
    )?.id,
    "tab-prev",
  )
})
test("binding strings normalize to canonical form and reject conflicts, reserved and bare keys", () => {
  assert.deepEqual(
    normalizeBindings([
      "MOD + S = save",
      "mod+alt+w = tab close",
      "mod+alt+w = tab prev",
      "nonsense",
      "mod+q = git",
    ]),
    ["mod+s = save", "mod+alt+w = tab close"],
  )
  const taken = ["mod+alt+w = tab close"]
  assert.match(validateChord({ mod: true, shift: false, alt: false, key: "w" }, taken), /保留/)
  assert.match(validateChord({ mod: true, shift: false, alt: false, key: "f5" }, taken), /保留/)
  assert.match(validateChord({ mod: false, shift: false, alt: false, key: "w" }, taken), /修饰键/)
  assert.match(validateChord({ mod: true, shift: false, alt: true, key: "w" }, taken), /冲突/)
  assert.equal(
    validateChord({ mod: true, shift: false, alt: true, key: "w" }, taken, "tab-close"),
    "",
  )
  assert.equal(resolvePage("/settings/global/shortcuts").view, "settings")
  assert.deepEqual(resolvePage("/settings/project/shortcuts"), {})
})
test("legacy per-command shortcut overrides migrate onto the default binding table", () => {
  const migrated = migrateLegacyBindings({
    save: { key: "k", shift: false, alt: false },
    compile: { key: "Enter", shift: true, alt: false },
  })
  assert(migrated)
  assert(migrated.includes("mod+k = save"))
  assert(migrated.includes("mod+shift+enter = compile"))
  assert(migrated.includes("mod+alt+o = project open"))
  assert.equal(migrateLegacyBindings(undefined), undefined)
  assert.equal(migrateLegacyBindings({ unrelated: { key: "k" } }), undefined)
})
