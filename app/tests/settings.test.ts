import { test } from "node:test"
import assert from "node:assert/strict"
import {
  defaults,
  normalizePreferences,
  projectConfiguration,
  effectivePreferences,
} from "../src/settings/model"
test("settings inherit global defaults and explicit overrides can be removed", () => {
  const global = normalizePreferences({
    ...defaults,
    engine: "xelatex",
    fontFamily: "monaco",
    fontSize: 16,
  })
  const inherited = projectConfiguration({ version: 1, overrides: {} })
  assert.equal(effectivePreferences(global, inherited).engine, "xelatex")
  const overridden = projectConfiguration({
    version: 1,
    overrides: { engine: "pdflatex", lintEnabled: false },
  })
  assert.equal(effectivePreferences(global, overridden).engine, "pdflatex")
  assert.equal(effectivePreferences(global, overridden).fontSize, 16)
  assert.equal(effectivePreferences(global, inherited).lintEnabled, true)
})
test("legacy engine remains explicit but new projects inherit; credential fields never serialize", () => {
  assert.equal(projectConfiguration(undefined, "xelatex").overrides.engine, "xelatex")
  assert.deepEqual(projectConfiguration({ version: 1, overrides: {} }, "xelatex").overrides, {})
  const normalized = projectConfiguration({
    version: 1,
    overrides: { engine: "xelatex", apiKey: "secret", endpoint: "https://private" },
  })
  assert(!JSON.stringify(normalized).includes("secret"))
  assert(!JSON.stringify(normalizePreferences({ apiKey: "secret" })).includes("secret"))
})
test("invalid preferences and rule values cannot reach consumers", () => {
  const preferences = normalizePreferences({
    engine: "lualatex",
    fontSize: 500,
    disabledRules: [26, 26, -1, "command", 43],
    lineHeight: 100,
  })
  assert.equal(preferences.engine, "pdflatex")
  assert.equal(preferences.fontSize, 12.5)
  assert.equal(preferences.lineHeight, 1.75)
  assert.deepEqual(preferences.disabledRules, [26])
})

test("shortcut preferences store canonical binding strings and migrate legacy overrides", () => {
  assert.deepEqual(normalizePreferences({}).bindings, [])
  assert.deepEqual(normalizePreferences({ bindings: ["MOD + S = save", "bad line"] }).bindings, [
    "mod+s = save",
  ])
  const migrated = normalizePreferences({
    shortcuts: { save: { key: "k", shift: false, alt: false } },
  })
  assert(migrated.bindings.includes("mod+k = save"))
  assert(migrated.bindings.includes("mod+alt+enter = compile"))
})

test("legacy editor typography remains independent of UI and reading preferences", () => {
  const migrated = normalizePreferences({ fontFamily: "monaco", fontSize: 18 })
  assert.equal(migrated.fontSize, 18)
  assert.equal(migrated.fontFamily, "monaco")
  assert.equal(migrated.uiFontSize, 13)
  assert.equal(migrated.previewFontSize, 14)
  const restored = normalizePreferences(
    JSON.parse(
      JSON.stringify({
        ...migrated,
        uiFontSize: 16,
        uiFontFamily: "serif",
        previewFontSize: 20,
        previewFontFamily: "sans",
      }),
    ),
  )
  assert.equal(restored.fontSize, 18)
  assert.equal(restored.uiFontSize, 16)
  assert.equal(restored.previewFontSize, 20)
  assert.equal(restored.fontFamily, "monaco")
  assert.equal(restored.uiFontFamily, "serif")
  assert.equal(restored.previewFontFamily, "sans")
  const invalid = normalizePreferences({
    uiFontSize: 99,
    previewFontSize: -1,
    uiFontFamily: "missing",
    previewFontFamily: "missing",
  })
  assert.equal(invalid.uiFontSize, 13)
  assert.equal(invalid.previewFontSize, 14)
  assert.equal(invalid.uiFontFamily, "system")
})
