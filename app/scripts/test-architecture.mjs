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
