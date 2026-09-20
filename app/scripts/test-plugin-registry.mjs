import { test } from "node:test"
import assert from "node:assert/strict"
import {
  builtinPlugins,
  registerPlugins,
  pluginForLanguage,
  pluginLanguageForPath,
} from "../server/plugin-registry.mjs"
import { toolCatalog, lspServersByLanguage } from "../server/tool-registry.mjs"

test("official language plugins preserve existing tools and fallback order", () => {
  assert.deepEqual(
    builtinPlugins.map((plugin) => plugin.id),
    [
      "envoi.cpp",
      "envoi.python",
      "envoi.rust",
      "envoi.remote-ssh",
      "envoi.wsl",
      "envoi.lean",
      "envoi.rtl",
      "envoi.asm",
    ],
  )
  assert.equal(pluginForLanguage("cpp")?.id, "envoi.cpp")
  assert.equal(pluginLanguageForPath("main.cpp"), "cpp")
  assert.equal(pluginLanguageForPath("include/Math.H"), "cpp")
  assert.equal(pluginLanguageForPath("hello.py"), "python")
  assert.equal(pluginLanguageForPath("main.rs"), "rust")
  assert.equal(pluginLanguageForPath("notes.txt"), undefined)
  assert.equal(toolCatalog.find((tool) => tool.id === "clangd")?.group, "cpp")
  assert.deepEqual(lspServersByLanguage().cpp, [["clangd"], ["ccls"]])
  assert.deepEqual(lspServersByLanguage().python, [
    ["basedpyright-langserver", "--stdio"],
    ["pyright-langserver", "--stdio"],
    ["pylsp"],
  ])
  assert.deepEqual(lspServersByLanguage().rust, [["rust-analyzer"]])
  assert.deepEqual(lspServersByLanguage().meson, [["mesonlsp", "--lsp"]])
  for (const group of ["cpp", "python", "rust"]) {
    const tools = toolCatalog.filter((tool) => tool.group === group)
    assert(tools.some((tool) => tool.kind === "format"))
    assert(tools.some((tool) => tool.kind === "lint"))
  }
  assert.equal(toolCatalog.find((tool) => tool.id === "ruffFormat")?.binary, "ruff")
  assert.equal(toolCatalog.find((tool) => tool.id === "ruffLint")?.binary, "ruff")
})

test("registration rejects incompatible and colliding contributions", () => {
  const manifest = structuredClone(builtinPlugins[0])
  assert.throws(() => registerPlugins([manifest, manifest]), /duplicate plugin ID/)
  assert.throws(() => registerPlugins([{ ...manifest, apiVersion: 2 }]), /Incompatible plugin API/)
  assert.throws(
    () => registerPlugins([{ ...manifest, contributes: { unknown: [] } }]),
    /Invalid plugin contribution/,
  )
  const other = structuredClone(builtinPlugins[1])
  other.contributes.tools[0].id = manifest.contributes.tools[0].id
  assert.throws(() => registerPlugins([manifest, other]), /Duplicate or invalid tools/)
})

test("a rejected plugin cannot abort or reserve contributions for later plugins", async () => {
  const { loadPlugins } = await import("../server/plugin-registry.mjs")
  const invalid = structuredClone(builtinPlugins[0])
  invalid.apiVersion = 999
  const loaded = loadPlugins([invalid, builtinPlugins[1], builtinPlugins[2]])
  assert.deepEqual(
    loaded.plugins.map((plugin) => plugin.id),
    ["envoi.python", "envoi.rust"],
  )
  assert.equal(loaded.errors[0].id, "envoi.cpp")
  const partial = structuredClone(builtinPlugins[1])
  partial.id = "envoi.invalid"
  partial.contributes.tools.push({ id: builtinPlugins[0].contributes.tools[0].id })
  const recovered = loadPlugins([builtinPlugins[0], partial, ...builtinPlugins.slice(1)])
  assert.deepEqual(recovered.plugins, builtinPlugins)
  assert.equal(recovered.errors.length, 1)
  assert.equal(loadPlugins([null, { id: "bad" }]).plugins.length, 0)
})
