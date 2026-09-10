import { pathToFileURL } from "node:url"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { indexedDB } from "fake-indexeddb"
const folder = await mkdtemp(path.join(os.tmpdir(), "envoi-migration-test-"))
process.env.ENVOI_DATA_DIR = path.join(folder, "data")
const { localDataPlugin, dataDir, dataStore } = await import("../server/local-data.mjs")
let handler
const server = http.createServer((req, res) => void handler(req, res, () => res.end()))
localDataPlugin().configureServer({
  middlewares: {
    use(fn) {
      handler = fn
    },
  },
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${server.address().port}`
const originalFetch = globalThis.fetch
globalThis.fetch = (url, options = {}) =>
  originalFetch(new URL(url, base), { ...options, headers: { ...options.headers, Origin: base } })
globalThis.indexedDB = indexedDB
globalThis.window = new EventTarget()
window.envoi = {
  dataGet: async (store, key) => {
    const result = await dataStore({ store, key, action: "get" })
    if (result.status >= 400) throw Error(result.body.error)
    return result.body
  },
  dataPut: async (store, value, key, opts) => {
    const result = await dataStore({ store, key, value, ...opts, action: "put" })
    if (result.status >= 400) throw Error(result.body.error)
    return result.body
  },
}
const warnings = []
window.addEventListener("envoi:storage-warning", (event) => warnings.push(event.detail))
await build({
  entryPoints: [
    "src/lib/gitBinding.ts",
    "src/lib/aiChoices.ts",
    "src/lib/localData.ts",
    "src/lib/projectSession.ts",
    "src/lib/recentProjects.ts",
    "src/lib/paperLibrary.ts",
  ],
  absWorkingDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  outdir: folder,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
})
const native = await import(pathToFileURL(path.join(folder, "localData.mjs")).href),
  sessions = await import(pathToFileURL(path.join(folder, "projectSession.mjs")).href),
  library = (await import(pathToFileURL(path.join(folder, "paperLibrary.mjs")).href)).paperLibrary,
  recents = await import(pathToFileURL(path.join(folder, "recentProjects.mjs")).href)
function seed(name, version, stores, store, values, key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      for (const [name, options] of stores) request.result.createObjectStore(name, options)
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(store, "readwrite")
      for (const value of values)
        key ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}
try {
  const initialized = await Promise.all(
    Array.from({ length: 8 }, () =>
      native.nativeMigrate("preferences", { theme: "graphite" }, "startup-race"),
    ),
  )
  assert(initialized.every((record) => record.revision === 1))
  const preserved = await native.nativeMigrate("preferences", { theme: "paper" }, "startup-race")
  assert.equal(preserved.value.theme, "graphite")
  assert.equal(preserved.migration.archived, true)
  await assert.rejects(
    () =>
      native.nativePut("preferences", { theme: "paper" }, "startup-race", { expectedRevision: 0 }),
    /另一窗口/,
  )
  console.log(
    "PASS concurrent first-run migration is atomic and different stale writes still conflict",
  )
  const { providerGroups } = await import(pathToFileURL(path.join(folder, "aiChoices.mjs")).href)
  const providers = [
    { id: "z", name: "Zeta", auth: { configured: false } },
    { id: "b", name: "Beta", auth: { configured: true } },
    { id: "a", name: "Alpha", auth: { configured: false } },
    { id: "b", name: "Beta", auth: { configured: true } },
  ]
  assert.deepEqual(
    providerGroups(providers).map((group) => group.providers.map((provider) => provider.id)),
    [["b"], ["a", "z"]],
  )
  providers[0].auth.configured = true
  assert.deepEqual(
    providerGroups(providers).map((group) => group.providers.map((provider) => provider.id)),
    [["b", "z"], ["a"]],
  )
  const file = new File(["%PDF attachment bytes"], "paper.pdf", {
    type: "application/pdf",
    lastModified: 123,
  })
  const encoded = await native.encodeNative({
    file,
    url: "blob:old",
    directory: { private: true },
    handle: { private: true },
    draft: "未保存",
  })
  assert(!("directory" in encoded))
  assert(!("url" in encoded))
  assert.equal(await native.decodeNative(encoded).file.text(), "%PDF attachment bytes")
  assert.equal(native.decodeNative(encoded).file.name, "paper.pdf")
  const paper = {
    id: "paper-one",
    title: "An actual imported title",
    author: "A",
    year: "2026",
    venue: "V",
    tags: ["tag"],
    collection: "C",
    status: "在读",
    notes: "notes",
    created: 1,
    bib: "@article{key, title={Saved}}",
    citationKey: "key",
    attachment: file,
  }
  await seed("paperdesk-library-v1", 1, [["papers", { keyPath: "id" }]], "papers", [paper])
  const migrated = await library.list()
  assert.equal(await migrated[0].attachment.text(), await file.text())
  assert.equal(migrated[0].bib, paper.bib)
  assert.equal((await native.nativeGet("library")).value[0].citationKey, "key")
  assert.equal((await library.list()).length, 1)
  await library.put([{ ...paper, title: "Edited" }])
  assert.equal((await library.list())[0].title, "Edited")
  const warningCount = warnings.length
  await native.nativePut(
    "library",
    await native.encodeNative([{ ...paper, title: "Native update" }]),
  )
  assert.equal((await library.list())[0].title, "Native update")
  assert.equal(
    warnings.length,
    warningCount,
    "ordinary cache differences must not trigger migration warnings",
  )
  await library.remove(paper.id)
  assert.deepEqual(await library.list(), [])
  const project = {
    id: "project-a",
    name: "A",
    files: [
      {
        id: "main.tex",
        path: "main.tex",
        kind: "latex",
        text: "draft text",
        saved: "original disk baseline",
      },
    ],
    directories: [],
    rootId: "main.tex",
    diagnostics: { status: "done", items: [{ message: "keep diagnostic" }] },
    compiled: file,
    compileLog: "keep log",
  }
  await seed("paperdesk-session", 1, [["current", undefined]], "current", [project], "project")
  const restored = await sessions.restoreSession()
  assert.equal(restored.project.files[0].text, "draft text")
  assert.equal(restored.project.files[0].saved, "original disk baseline")
  assert.equal((await native.nativeGet("session", "current")).value.compileLog, "keep log")
  await sessions.saveSession(project)
  assert(await native.nativeGet("session", "project-a"))
  const sessionWarningCount = warnings.length
  await seed(
    "paperdesk-session",
    1,
    [["current", undefined]],
    "current",
    [{ ...project, name: "Stale workspace label", compileLog: "older log" }],
    "project",
  )
  const reconciled = await sessions.restoreSession()
  assert.equal(reconciled.recoverable, undefined)
  assert.equal(
    warnings.length,
    sessionWarningCount,
    "normal cache differences must not warn about migration",
  )
  const latest = await native.nativeGet("session", "current")
  await native.nativePut("session", { ...latest.value, name: "Other window" }, "current", {
    expectedRevision: latest.revision,
  })
  await assert.rejects(
    () =>
      sessions.saveSession({
        ...project,
        name: "Local unsaved",
        files: [{ ...project.files[0], text: "new local draft" }],
      }),
    /另一窗口/,
  )
  const conflict = await sessions.restoreSession()
  assert.equal(conflict.project.name, "Other window")
  assert.equal(conflict.recoverable.files[0].text, "new local draft")
  assert((await readdir(path.join(dataDir, "migration"))).length > 0)
  await seed(
    "paperdesk-projects",
    2,
    [
      ["recent", { keyPath: "id" }],
      ["roots", { keyPath: "id" }],
    ],
    "recent",
    [{ id: "r1", name: "Remember me", updated: 2 }],
  )
  assert.equal((await recents.recentProjects())[0].name, "Remember me")
  await recents.forgetRecentProject("r1")
  assert.deepEqual((await native.nativeGet("recent")).value, [])
  const bindings = await import(pathToFileURL(path.join(folder, "gitBinding.mjs")).href)
  await Promise.all([
    bindings.rememberGitPath("parallel-a", "/one"),
    bindings.rememberGitPath("parallel-b", "/two"),
  ])
  assert.deepEqual((await native.nativeGet("bindings")).value, {
    "parallel-a": "/one",
    "parallel-b": "/two",
  })
  await bindings.forgetGitBindings(["parallel-a", "parallel-b"])
  await bindings.rememberGitPath("legacy-project", "/legacy/project")
  assert.deepEqual(await bindings.matchingGitBindings("/legacy"), ["legacy-project"])
  await bindings.forgetGitBindings(["legacy-project"])
  assert.deepEqual((await native.nativeGet("bindings")).value, {})
  const prefs = { uiFontSize: 15, shortcuts: { save: "Mod+S" } }
  await native.nativeMigrate("preferences", prefs)
  assert.deepEqual((await native.nativeMigrate("preferences", prefs)).value, prefs)
  window.envoi.dataPut = async () => {
    throw Error("offline fixture")
  }
  await assert.rejects(() => sessions.saveSession({ ...project, name: "Offline backup" }))
  assert(warnings.some((message) => message.includes("浏览器备份")))
  const files = await readdir(path.join(dataDir, "storage"))
  assert(files.includes("session") && files.includes("library"))
  assert(
    !JSON.stringify(
      await readFile(path.join(dataDir, "storage/session/current.json"), "utf8"),
    ).includes("blob:"),
  )
  console.log(
    "PASS native migration: real IndexedDB legacy records, PDF/BibTeX/notes, draft baseline/diagnostics, per-project recovery, conflict backup, recent removal, preferences idempotence and offline retention",
  )
} finally {
  globalThis.fetch = originalFetch
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(folder, { recursive: true, force: true })
}
