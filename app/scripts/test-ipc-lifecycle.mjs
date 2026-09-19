import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import { ProjectSessionManager } from "../electron/main/services/project-sessions.ts"

// Bundle the production registrar without starting Electron or a user's AI session.
const parent = path.resolve(import.meta.dirname, "../tmp")
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(path.join(parent, "ipc-lifecycle-"))
const previousDataDirectory = process.env.ENVOI_DATA_DIR
process.env.ENVOI_DATA_DIR = path.join(directory, "data")
let registerAgentIpc, registerLanguageIpc, registerToolsIpc, registerProjectsIpc
try {
  const target = path.join(directory, "agent.mjs")
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "../electron/main/ipc/agent.ts")],
    outfile: target,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  })
  ;({ registerAgentIpc } = await import(pathToFileURL(target).href))
  const languageTarget = path.join(directory, "language.mjs")
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "../electron/main/ipc/language.ts")],
    outfile: languageTarget,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "isolated-language-dependencies",
        setup(builder) {
          builder.onLoad({ filter: /server[\\/]local-data\.mjs$/ }, () => ({
            contents: "export const dataStore = async () => ({ body: null })",
            loader: "js",
          }))
          builder.onLoad({ filter: /main[\\/]lsp-service\.mjs$/ }, () => ({
            contents: 'export const lspLanguage = () => "python"',
            loader: "js",
          }))
        },
      },
    ],
  })
  ;({ registerLanguageIpc } = await import(pathToFileURL(languageTarget).href))
  const toolsTarget = path.join(directory, "tools.mjs")
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "../electron/main/ipc/tools.ts")],
    outfile: toolsTarget,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  })
  ;({ registerToolsIpc } = await import(pathToFileURL(toolsTarget).href))
  const projectsTarget = path.join(directory, "projects.mjs")
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "../electron/main/ipc/projects.ts")],
    outfile: projectsTarget,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "isolated-project-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "fixture",
          }))
          builder.onResolve({ filter: /local-data\.mjs$/ }, (args) =>
            /[\\/]ipc[\\/]projects\.ts$/.test(args.importer)
              ? { path: "projects", namespace: "fixture" }
              : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "electron"
                ? "export const BrowserWindow = { getAllWindows: () => [] }; export const app = {}; export const dialog = {}"
                : 'export const dataDir = "/fixture"; export const registerProject = async root => ({ id: root, name: root })',
            loader: "js",
          }))
        },
      },
    ],
  })
  ;({ registerProjectsIpc } = await import(pathToFileURL(projectsTarget).href))
} finally {
  if (previousDataDirectory === undefined) delete process.env.ENVOI_DATA_DIR
  else process.env.ENVOI_DATA_DIR = previousDataDirectory
  await rm(directory, { recursive: true, force: true })
}
function fixture() {
  const handlers = new Map(),
    calls = []
  const sessions = new ProjectSessionManager(() => {})
  sessions.bindProject(1, "project", "/research")
  let resolve,
    destroyed = false
  const root = new Promise((done) => {
    resolve = done
  })
  const event = { sender: { id: 1, isDestroyed: () => destroyed, send() {} } }
  registerAgentIpc({
    handle: (name, callback) => handlers.set(name, callback),
    sessions,
    agentRoot: () => root,
    requireToolContext: async () => {},
    agentBackend: {
      call: async (...args) => {
        calls.push(args)
        return { status: 200, body: { ok: true } }
      },
    },
  })
  return {
    sessions,
    calls,
    event,
    resolve,
    destroy: () => {
      destroyed = true
    },
    chat: () =>
      handlers.get("envoi:agent-chat")(event, {
        projectId: "project",
        dirty: false,
        message: "hello",
      }),
  }
}
for (const action of ["close", "restrict", "destroy"]) {
  test(`AI waiting for trust cannot start after ${action}`, async () => {
    const f = fixture()
    const pending = f.chat()
    const rejected = assert.rejects(pending, /取消|关闭/)
    if (action === "close") f.sessions.close(1)
    if (action === "restrict") f.sessions.restrict("/research")
    if (action === "destroy") f.destroy()
    f.resolve("/research")
    await rejected
    assert.equal(f.calls.length, 0)
  })
}
test("switching the visible project preserves an authorized background AI request", async () => {
  const f = fixture()
  const pending = f.chat()
  f.sessions.bindProject(1, "other", "/other")
  f.resolve("/research")
  assert.deepEqual(await pending, { ok: true })
  assert.equal(f.calls[0][0], "agentChat")
  assert.deepEqual(f.calls[0][2].root, "/research")
})

for (const action of ["close", "restrict"]) {
  test(`LSP waiting for trust cannot start after ${action}`, async () => {
    const handlers = new Map(),
      calls = []
    const sessions = new ProjectSessionManager(() => {})
    sessions.bindProject(1, "project", "/research")
    let resolve
    const root = new Promise((done) => {
      resolve = done
    })
    registerLanguageIpc({
      sessions,
      handle: (name, callback) => handlers.set(name, callback),
      requireBoundRoot: () => root,
      lspService: {
        configurePreferences() {},
        open: (...args) => {
          calls.push(args)
          return { available: true }
        },
      },
    })
    const event = { sender: { id: 1, isDestroyed: () => false } }
    const pending = handlers.get("envoi:lsp-open")(
      event,
      "/research",
      "main.py",
      "",
      "00000000-0000-0000-0000-000000000000",
    )
    const rejected = assert.rejects(pending, /取消/)
    if (action === "close") sessions.close(1)
    else sessions.restrict("/research")
    resolve("/research")
    await rejected
    assert.equal(calls.length, 0)
  })
}

for (const action of ["close", "restrict"]) {
  test(`lint waiting for trust cannot start after ${action}`, async () => {
    const handlers = new Map(),
      calls = []
    const sessions = new ProjectSessionManager(() => {})
    sessions.bindProject(1, "project", "/research")
    let resolve
    const root = new Promise((done) => {
      resolve = done
    })
    registerToolsIpc({
      sessions,
      handle: (name, callback) => handlers.set(name, callback),
      requireBoundRoot: () => root,
      toolsBackend: { call: async (...args) => calls.push(args) },
    })
    const event = { sender: { id: 1, isDestroyed: () => false } }
    const pending = handlers.get("envoi:lint")(event, {
      rootPath: "/research",
      path: "main.tex",
      text: "",
    })
    const rejected = assert.rejects(pending, /取消/)
    if (action === "close") sessions.close(1)
    else sessions.restrict("/research")
    resolve("/research")
    await rejected
    assert.equal(calls.length, 0)
  })
}
for (const action of ["close", "supersede", "destroy"]) {
  test(`project binding cannot reactivate a project after ${action}`, async () => {
    const handlers = new Map()
    const sessions = new ProjectSessionManager(() => {})
    let resolve,
      destroyed = false
    const root = new Promise((done) => {
      resolve = done
    })
    registerProjectsIpc({
      sessions,
      handle: (name, callback) => handlers.set(name, callback),
      workspaceTrust: { open: () => root, isTrusted: async () => true },
    })
    const event = { sender: { id: 1, isDestroyed: () => destroyed } }
    const pending = handlers.get("envoi:bind-project")(event, "/research")
    const rejected = assert.rejects(pending, /取消/)
    if (action === "close") sessions.close(1)
    if (action === "destroy") destroyed = true
    if (action === "supersede") {
      sessions.beginBinding(1)
      sessions.bindProject(1, "new", "/other")
    }
    resolve("/research")
    await rejected
    assert.notEqual(sessions.activeRoot(1), "/research")
  })
}

test("preparing and cancelling a project preserves the active workspace resources", () => {
  const disposed = []
  const sessions = new ProjectSessionManager((owner) => disposed.push(owner))
  sessions.bindProject(1, "current", "/current")
  const watch = sessions.beginWatch(1)
  let stopped = false
  sessions.attachWatch(1, watch, () => {
    stopped = true
  })
  const count = disposed.length
  sessions.prepareProject(1, "candidate", "/candidate")
  assert.equal(sessions.activeRoot(1), "/current")
  assert.equal(sessions.preparedProject(2), undefined)
  assert.equal(stopped, false)
  assert.equal(disposed.length, count)
  sessions.cancelPreparation(1)
  assert.equal(sessions.preparedProject(1), undefined)
  assert.equal(sessions.activeRoot(1), "/current")
  assert.equal(stopped, false)
  sessions.prepareProject(1, "candidate", "/candidate")
  sessions.bindProject(1, "candidate", "/candidate")
  assert.equal(stopped, true)
  assert.equal(sessions.preparedProject(1), undefined)
  assert.equal(sessions.activeRoot(1), "/candidate")
})
