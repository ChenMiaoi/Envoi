import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { once } from "node:events"
import { LspService, lspLanguage } from "../electron/main/lsp-service.mjs"
import { lspServersByLanguage } from "../server/tool-registry.mjs"

test("LSP opens source, updates drafts, returns completions and stops sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-"))
  const events = []
  const fixture = fileURLToPath(new URL("./fixtures/lsp-fixture.mjs", import.meta.url))
  const service = new LspService(
    (owner, event) => events.push({ owner, ...event }),
    () => ({
      command: process.execPath,
      args: [fixture],
      name: "fixture",
    }),
  )
  try {
    await writeFile(path.join(root, "main.py"), "old")
    assert.equal(lspLanguage("main.cpp"), "cpp")
    assert.equal(lspLanguage("Cargo.toml"), "toml")
    assert.equal(lspLanguage("meson.build"), "meson")
    assert.equal(lspLanguage("Makefile"), "make")
    assert.equal(lspLanguage("notes.txt"), undefined)
    assert.deepEqual(await service.open(3, root, "main.py", "hello", "editor-one"), {
      available: true,
      server: "fixture",
    })
    service.change(3, root, "main.py", "hello\nworld")
    assert.deepEqual(
      await service.query(3, root, "main.py", "textDocument/completion", 8, "hello\nworld"),
      [{ label: "1:2" }],
    )
    assert.equal(
      await service.query(3, root, "main.py", "textDocument/completion", 8, "stale"),
      null,
    )
    await assert.rejects(
      service.open(3, root, "../outside.py", "x", "invalid"),
      /Invalid source path/,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert(events.some((event) => event.owner === 3 && event.path === "main.py"))
    const child = service.sessions.values().next().value.process
    service.close(3, root, "main.py", "older-editor")
    assert.equal(service.sessions.size, 1)
    service.close(3, root, "main.py", "editor-one")
    if (child.exitCode === null) await once(child, "exit")
    assert.equal(service.sessions.size, 0)
  } finally {
    service.dispose(3)
    await rm(root, { recursive: true, force: true })
  }
})

test("LSP fallback chains derive from the tool registry in catalog order", () => {
  const servers = lspServersByLanguage()
  assert.deepEqual(servers.c, [["clangd"], ["ccls"]])
  assert.deepEqual(servers.cpp, [["clangd"], ["ccls"]])
  assert.deepEqual(servers.python, [
    ["basedpyright-langserver", "--stdio"],
    ["pyright-langserver", "--stdio"],
    ["pylsp"],
  ])
  assert.deepEqual(servers.meson, [["mesonlsp", "--lsp"]])
  assert.deepEqual(servers.toml, [["taplo", "lsp", "stdio"]])
})

test("changing the preferred language server replaces the active session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-switch-"))
  const fixture = fileURLToPath(new URL("./fixtures/lsp-fixture.mjs", import.meta.url))
  const requested = []
  const service = new LspService(
    () => {},
    (_root, _language, preferred) => {
      requested.push(preferred)
      return { command: process.execPath, args: [fixture], name: preferred ?? "automatic" }
    },
  )
  try {
    await writeFile(path.join(root, "main.py"), "hello")
    await service.open(3, root, "main.py", "hello", "editor-one")
    const first = service.sessions.values().next().value
    assert.equal(first.spec.name, "automatic")
    assert.deepEqual(await service.open(3, root, "main.py", "hello", "editor-two", "pylsp"), {
      available: true,
      server: "pylsp",
    })
    const second = service.sessions.values().next().value
    assert.notEqual(second, first)
    assert.deepEqual(requested, [undefined, "pylsp"])
    if (first.process.exitCode === null && first.process.signalCode === null)
      await once(first.process, "exit")
    service.close(3, root, "main.py", "editor-one")
    assert.equal(service.sessions.size, 1)
    service.close(3, root, "main.py", "editor-two")
    if (second.process.exitCode === null && second.process.signalCode === null)
      await once(second.process, "exit")
    assert.equal(service.sessions.size, 0)
  } finally {
    service.dispose(3)
    await rm(root, { recursive: true, force: true })
  }
})
