import { test } from "node:test"
import assert from "node:assert/strict"
import { builtinPlugins, registerPlugins, pluginForLanguage } from "../server/plugin-registry.mjs"
import { toolCatalog, lspServersByLanguage } from "../server/tool-registry.mjs"

test("official language plugins preserve existing tools and fallback order", () => {
  assert.deepEqual(
    builtinPlugins.map((plugin) => plugin.id),
    ["envoi.cpp", "envoi.python", "envoi.rust"],
  )
  assert.equal(pluginForLanguage("cpp")?.id, "envoi.cpp")
  assert.equal(toolCatalog.find((tool) => tool.id === "clangd")?.group, "cpp")
  assert.deepEqual(lspServersByLanguage().cpp, [["clangd"], ["ccls"]])
  assert.deepEqual(lspServersByLanguage().python, [
    ["basedpyright-langserver", "--stdio"],
    ["pyright-langserver", "--stdio"],
    ["pylsp"],
  ])
  assert.deepEqual(lspServersByLanguage().rust, [["rust-analyzer"]])
  assert.deepEqual(lspServersByLanguage().meson, [["mesonlsp", "--lsp"]])
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
