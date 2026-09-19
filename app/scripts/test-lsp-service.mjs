import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { once } from "node:events"
import { LspService, lspLanguage } from "../electron/main/lsp-service.mjs"
import { lspServersByLanguage } from "../server/tool-registry.mjs"

async function waitForExit(child) {
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "exit", { signal: AbortSignal.timeout(5000) })
}

async function cleanup(service, root, ...owners) {
  const sessions = [...service.sessions.values()]
  for (const owner of owners) service.dispose(owner)
  await Promise.all(sessions.map((session) => waitForExit(session.process)))
  await rm(root, { recursive: true, force: true })
}

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
    await writeFile(path.join(root, "main.cpp"), "int value;")
    assert.deepEqual(await service.open(3, root, "main.cpp", "int value;", "cpp-editor"), {
      available: true,
      server: "fixture",
    })
    assert.equal(service.plugins.status("envoi.cpp", service.key(3, root, "cpp")), "active")
    service.close(3, root, "main.cpp", "cpp-editor")
    assert.equal(service.plugins.status("envoi.cpp", service.key(3, root, "cpp")), "inactive")
    assert.deepEqual(await service.open(3, root, "main.py", "hello", "editor-one"), {
      available: true,
      server: "fixture",
    })
    service.change(3, root, "main.py", "hello\nworld")
    assert.deepEqual(
      await service.query(3, root, "main.py", "textDocument/completion", 8, "hello\nworld"),
      [{ label: "1:2" }],
    )
    assert.deepEqual(
      await service.query(3, root, "main.py", "textDocument/completion", 8, "new text"),
      [{ label: "0:8" }],
    )
    assert.equal(service.sessions.values().next().value.docs.get("main.py").text, "new text")
    assert.deepEqual(
      await service.query(3, root, "main.py", "textDocument/definition", 1, "new text"),
      [{ path: "main.py", position: { line: 0, character: 0 } }],
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
    await cleanup(service, root, 3)
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
    await cleanup(service, root, 3)
  }
})

test("closing pending documents and disposing owners cancels late activation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-pending-"))
  const resolvers = []
  const fixture = fileURLToPath(new URL("./fixtures/lsp-fixture.mjs", import.meta.url))
  const spec = { command: process.execPath, args: [fixture], name: "fixture" }
  const service = new LspService(
    () => {},
    () => new Promise((resolve) => resolvers.push(resolve)),
  )
  try {
    await writeFile(path.join(root, "main.py"), "x")
    const closed = service.open(1, root, "main.py", "x", "closed")
    const other = service.open(2, root, "main.py", "x", "other")
    service.dispose(1, root)
    resolvers.shift()(spec)
    resolvers.shift()(spec)
    assert.equal((await closed).available, false)
    assert.equal((await other).available, true)
    assert.equal(service.sessions.size, 1)
    const cancelled = service.open(1, root, "main.py", "x", "cancelled")
    service.close(1, root, "main.py", "cancelled")
    resolvers.shift()(spec)
    assert.equal((await cancelled).available, false)
    const retry = service.open(1, root, "main.py", "x", "retry")
    resolvers.shift()(spec)
    assert.equal((await retry).available, true)
    assert.equal(service.sessions.size, 2)
    const initializing = service.open(3, root, "main.py", "x", "initializing")
    const rejected = assert.rejects(initializing, /stopped|cancelled/)
    resolvers.shift()(spec)
    await new Promise((resolve) => setImmediate(resolve))
    const child = service.sessions.get(service.key(3, root, "python")).process
    service.dispose(3)
    await rejected
    assert.equal(service.sessions.has(service.key(3, root, "python")), false)
    assert(child.killed)
    await waitForExit(child)
    assert.equal(service.opening.size, 0)
  } finally {
    await cleanup(service, root, 1, 2, 3)
  }
})

test("persisted extension preferences stop disabled sessions and retain workspace overrides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-disable-"))
  const fixture = fileURLToPath(new URL("./fixtures/lsp-fixture.mjs", import.meta.url))
  const service = new LspService(
    () => {},
    () => ({ command: process.execPath, args: [fixture], name: "fixture" }),
  )
  try {
    await writeFile(path.join(root, "main.py"), "x")
    await writeFile(path.join(root, "main.cpp"), "x")
    await service.open(1, root, "main.py", "x", "py")
    await service.open(1, root, "main.cpp", "x", "cpp")
    const python = service.sessions.get(service.key(1, root, "python")).process
    service.configurePreferences({ pluginStates: { "envoi.python": false } }, 2)
    assert(python.killed)
    await waitForExit(python)
    assert.equal(service.sessions.size, 1)
    assert.equal((await service.open(1, root, "main.py", "x", "denied")).available, false)
    service.configurePreferences({}, 1)
    assert.equal((await service.open(1, root, "main.py", "x", "stale")).available, false)
    service.configurePreferences(
      {
        pluginStates: { "envoi.python": false },
        pluginWorkspaces: { [root]: { "envoi.python": true } },
      },
      3,
    )
    assert.equal((await service.open(1, root, "main.py", "x", "override")).available, true)
    const restarted = service.sessions.get(service.key(1, root, "python")).process
    assert.notEqual(restarted, python)
    service.configurePreferences(
      {
        pluginStates: { "envoi.python": true },
        pluginWorkspaces: { [root]: { "envoi.python": false } },
      },
      4,
    )
    assert(restarted.killed)
    await waitForExit(restarted)
    assert.equal(service.sessions.size, 1)
  } finally {
    await cleanup(service, root, 1, 2, 3)
  }
})

test("unexpected server exit clears diagnostics and publishes token-scoped failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-exit-"))
  const fixture = fileURLToPath(new URL("./fixtures/lsp-fixture.mjs", import.meta.url))
  const diagnostics = [],
    status = []
  const service = new LspService(
    (owner, event) => diagnostics.push({ owner, ...event }),
    () => ({ command: process.execPath, args: [fixture], name: "fixture" }),
    undefined,
    (owner, event) => status.push({ owner, ...event }),
  )
  try {
    await writeFile(path.join(root, "main.py"), "x")
    await service.open(1, root, "main.py", "x", "first")
    await service.open(2, root, "main.py", "x", "other")
    const child = service.sessions.get(service.key(1, root, "python")).process
    const exited = once(child, "exit")
    child.kill()
    await exited
    assert.deepEqual(status, [{ owner: 1, root, path: "main.py", token: "first", state: "failed" }])
    assert.deepEqual(diagnostics.filter((event) => event.owner === 1).at(-1).diagnostics, [])
    assert.equal(service.sessions.size, 1)
    assert.equal((await service.open(1, root, "main.py", "x", "retry")).available, true)
    assert.notEqual(service.sessions.get(service.key(1, root, "python")).process, child)
  } finally {
    await cleanup(service, root, 1, 2, 3)
  }
})
