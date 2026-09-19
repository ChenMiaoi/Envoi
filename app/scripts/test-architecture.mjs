import path from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { ProjectSessionManager } from "../electron/main/services/project-sessions.ts"
import { parseLibraryInput, parseWorkspaceInput, parseAgentInput } from "../shared/contracts.ts"
import { validateBackendCall } from "../shared/backend-contract.ts"
import { fileKind, isTextPath, safePathParts } from "../shared/file-rules.mjs"

test("close invalidates in-flight watcher registration and cancels owned resources", () => {
  const disposed = []
  const sessions = new ProjectSessionManager((...args) => disposed.push(args))
  sessions.bindProject(1, "project", "/project")
  sessions.bindBrowse(1, "/project")
  const browse = sessions.browse(1)
  const first = sessions.beginWatch(1)
  let closed = 0
  sessions.attachWatch(1, first, () => closed++)
  const { request, finish } = sessions.trackCompile(1, "/project")
  const pending = sessions.beginWatch(1)
  sessions.close(1)
  sessions.attachWatch(1, pending, () => closed++)
  assert.equal(closed, 2)
  assert.equal(sessions.activeRoot(1), undefined)
  assert.equal(browse.controller.signal.aborted, true)
  assert.equal(request.cancelled, true)
  assert.equal(sessions.isCurrentWatch(1, pending), false)
  assert.deepEqual(disposed.at(-1), [1])
  finish()
})
test("restriction affects descendants while forgetting revokes root tokens for every owner", () => {
  const sessions = new ProjectSessionManager(() => {})
  sessions.bindProject(1, "main", "/research")
  sessions.bindProject(2, "nested", "/research/experiment")
  sessions.bindProject(3, "other", "/research-other")
  sessions.bindProject(4, "main", "/research")
  const token = sessions.token("/research")
  const a = sessions.trackCompile(2, "/research/experiment")
  const b = sessions.trackCompile(3, "/research-other")
  assert.deepEqual(sessions.restrict("/research"), ["/research", "/research/experiment"])
  assert.equal(a.request.cancelled, true)
  assert.equal(b.request.cancelled, false)
  sessions.forget("/research")
  assert.equal(sessions.rootForToken(token), undefined)
  assert.equal(sessions.projectRoot("main"), undefined)
  assert.equal(sessions.activeRoot(1), undefined)
  assert.equal(sessions.activeRoot(4), undefined)
  assert.equal(sessions.activeRoot(3), "/research-other")
})
test("runtime contracts reject malformed and unknown operations", () => {
  assert.throws(() => parseLibraryInput({ action: "note", paperId: "p", text: "draft" }))
  assert.throws(() => parseLibraryInput({ action: "import", papers: {} }))
  assert.throws(() =>
    parseWorkspaceInput({ action: "save", source: "/x", title: "result", files: "a" }),
  )
  assert.throws(() => parseAgentInput("session", { projectId: "p" }))
  assert.throws(() => parseAgentInput("bind", { directory: "/tmp" }))
  assert.throws(() => validateBackendCall("toString", []))
  assert.throws(() => validateBackendCall("compile", [{ main: "main.tex" }]))
  assert.throws(() => validateBackendCall("agentRequest", ["oauth/answer", { id: "job" }]))
  assert.deepEqual(parseLibraryInput({ action: "get", paperId: "p" }), {
    action: "get",
    paperId: "p",
  })
  validateBackendCall("compile", [{ main: "main.tex", engine: "pdflatex", drafts: [] }])
})
test("shared file rules recognize plugin languages and reject traversal", () => {
  for (const file of ["main.py", "main.cpp", "main.rs", "Makefile", "src/main.C"]) {
    assert.equal(isTextPath(file), true)
    assert.equal(fileKind(file), "text")
  }
  assert.equal(fileKind("paper.tex"), "latex")
  assert.equal(fileKind("paper.pdf"), "pdf")
  for (const file of ["../secret", "/absolute", "a\\b", "a:b", "a/./b", "a\0b"])
    assert.throws(() => safePathParts(file))
})

test("settings requests preserve the service's partial-input defaults", () => {
  assert.deepEqual(parseAgentInput("settings", { settings: { model: null } }), {
    settings: { model: null },
  })
  validateBackendCall("agentRequest", ["settings", { settings: {} }])
  assert.throws(() => parseAgentInput("settings", { settings: { tools: "admin" } }))
})

test("switching projects invalidates pending and attached watches", () => {
  const sessions = new ProjectSessionManager(() => {})
  sessions.bindProject(1, "first", "/first")
  const ticket = sessions.beginWatch(1)
  let disposed = 0
  sessions.attachWatch(1, ticket, () => disposed++)
  sessions.bindProject(1, "second", "/second")
  assert.equal(disposed, 1)
  assert.equal(sessions.isCurrentWatch(1, ticket), false)
})

test("closing or superseding a project binding invalidates its asynchronous completion", () => {
  const sessions = new ProjectSessionManager(() => {})
  const first = sessions.beginBinding(1)
  const second = sessions.beginBinding(1)
  assert.equal(sessions.isCurrentBinding(1, first), false)
  assert.equal(sessions.isCurrentBinding(1, second), true)
  sessions.close(1)
  assert.equal(sessions.isCurrentBinding(1, second), false)
})

test("compile cancellation does not cancel pending AI or lint, but closing does", () => {
  const sessions = new ProjectSessionManager(() => {})
  const compile = sessions.trackCompile(1, "/project")
  const chat = sessions.trackOperation(1, "/project", "chat")
  const lint = sessions.trackOperation(1, "/project", "lint")
  sessions.cancelCompile(1)
  assert.equal(compile.request.cancelled, true)
  assert.equal(chat.request.cancelled, false)
  assert.equal(lint.request.cancelled, false)
  sessions.close(1)
  assert.equal(chat.request.cancelled, true)
  assert.equal(lint.request.cancelled, true)
  for (const operation of [compile, chat, lint]) operation.finish()
})

test("Windows containment handles drive letters, case, UNC paths and sibling names", () => {
  const sessions = new ProjectSessionManager(() => {}, path.win32)
  const roots = [
    String.raw`C:\Research`,
    String.raw`c:\research\experiment`,
    String.raw`C:\Research-other`,
    String.raw`D:\Research`,
    String.raw`\\server\share\Research`,
    String.raw`\\server\share\Research\child`,
    String.raw`\\server\other\Research`,
  ]
  roots.forEach((root, index) => sessions.bindProject(index, String(index), root))
  const pending = roots.map((root, index) => sessions.trackOperation(index, root, "chat"))
  assert.deepEqual(sessions.restrict(String.raw`c:\RESEARCH`), roots.slice(0, 2))
  assert.deepEqual(
    pending.map((item) => item.request.cancelled),
    [true, true, false, false, false, false, false],
  )
  assert.deepEqual(sessions.restrict(String.raw`\\SERVER\SHARE\research`), roots.slice(4, 6))
  assert.deepEqual(
    pending.map((item) => item.request.cancelled),
    [true, true, false, false, true, true, false],
  )
})
