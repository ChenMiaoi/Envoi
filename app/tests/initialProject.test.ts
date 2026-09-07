import "fake-indexeddb/auto"
import { test } from "node:test"
import assert from "node:assert/strict"
import { initialProject, emptyProject } from "../src/lib/initialProject"
import { saveSession, restoreSession } from "../src/lib/projectSession"
test("default startup has no synthetic project, files, PDF, diagnostics or engine status", () => {
  const project = initialProject()
  assert.deepEqual(project.files, [])
  assert.equal(project.rootId, "")
  assert.equal(project.compiled, undefined)
  assert.equal(project.diagnostics, undefined)
  assert.equal(project.engine, undefined)
  assert.equal(
    initialProject({
      ...emptyProject(),
      id: "demo",
      files: [{ id: "fake", path: "fake.tex", kind: "latex", text: "example" }],
    }).files.length,
    0,
  )
  const real = { ...emptyProject(), id: "real", name: "My paper" }
  assert.equal(initialProject(real), real)
})
test("legacy built-in cache is offered only for manual recovery and original drafts are retained", async () => {
  const cached = {
    ...emptyProject(),
    id: "demo",
    files: [
      {
        id: "main.tex",
        path: "main.tex",
        kind: "latex" as const,
        text: "user draft",
        saved: "old example",
      },
    ],
  }
  await saveSession(cached)
  const result = await restoreSession()
  assert.equal(result.project, undefined)
  assert.equal(result.recoverable?.files[0].text, "user draft")
  const again = await restoreSession()
  assert.equal(again.recoverable?.files[0].saved, "old example")
  assert.equal(again.recoverable?.files[0].text, "user draft")
})
