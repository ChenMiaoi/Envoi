import "fake-indexeddb/auto"
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  assertCanClose,
  verifyDeletionTarget,
  deleteVerifiedProject,
} from "../src/lib/projectManagement"
import { emptyProject } from "../src/lib/initialProject"
import { installDesktopFixture } from "./desktopFixture"
test("closing keeps unsaved-work and busy-operation guards", () => {
  const dirty = {
    ...emptyProject(),
    id: "real",
    files: [{ id: "a.tex", path: "a.tex", kind: "latex" as const, text: "draft", saved: "disk" }],
  }
  assert.throws(() => assertCanClose(dirty, false, false, false), /未保存/)
  assert.throws(() => assertCanClose(dirty, true, false, true), /等待/)
  assert.doesNotThrow(() => assertCanClose(dirty, false, false, true))
})
test("native deletion checks the selected path and typed name without asking for a parent folder", async () => {
  installDesktopFixture()
  let removed = false
  window.envoi!.fsList = async () => {
    if (removed) throw Error("Missing")
    return { files: [{ path: "main.tex", kind: "latex" }], directories: [] }
  }
  window.envoi!.fsTrashProject = async (root) => {
    assert.equal(root, "/papers/paper")
    removed = true
    return { warnings: [] }
  }
  window.envoi!.fsInspectDeletion = async (path) => ({
    path,
    name: "paper",
    label: path,
    kind: "project",
    related: [],
  })
  const plan = await verifyDeletionTarget("/papers/paper")
  await assert.rejects(deleteVerifiedProject(plan, "wrong"), /完整/)
  assert(!removed)
  await deleteVerifiedProject(plan, "paper")
  assert(removed)
})
test("native deletion rechecks contents and propagates disk failures", async () => {
  installDesktopFixture()
  window.envoi!.fsList = async () => ({
    files: [{ path: "main.tex", kind: "latex" }],
    directories: [],
  })
  window.envoi!.fsInspectDeletion = async (path) => ({
    path,
    name: "paper",
    label: path,
    kind: "project",
    related: [],
  })
  const plan = await verifyDeletionTarget("/papers/paper")
  window.envoi!.fsInspectDeletion = async (path) => ({
    path,
    name: "paper",
    label: path,
    kind: "project",
    related: [],
    blocked: "关联工作区",
  })
  await assert.rejects(deleteVerifiedProject(plan, "paper"), /关联工作区/)
  window.envoi!.fsInspectDeletion = async (path) => ({
    path,
    name: "paper",
    label: path,
    kind: "project",
    related: [],
  })
  window.envoi!.fsList = async () => ({
    files: [{ path: "main.tex", kind: "latex" }],
    directories: [],
  })
  window.envoi!.fsTrashProject = async () => {
    throw Error("Disk failure")
  }
  await assert.rejects(deleteVerifiedProject(plan, "paper"), /Disk failure/)
})

test("deletion rejects a changed workspace and preserves cleanup warnings after trash", async () => {
  installDesktopFixture()
  const plan = {
    path: "/papers/code",
    name: "code",
    label: "/papers/code",
    kind: "project" as const,
  }
  window.envoi!.fsInspectDeletion = async () => ({ ...plan, kind: "worktree", related: [] })
  await assert.rejects(deleteVerifiedProject(plan, "code"), /已改变/)
  window.envoi!.fsInspectDeletion = async () => ({ ...plan, related: [] })
  window.envoi!.fsTrashProject = async () => ({ warnings: ["Git cleanup failed"] })
  assert.deepEqual(await deleteVerifiedProject(plan, "code"), ["Git cleanup failed"])
})

test("discarding closes the workspace and does not restore discarded project drafts", async () => {
  installDesktopFixture()
  const { closeProjectSession, restoreSession, restoreProjectSession, saveSession } =
    await import("../src/lib/projectSession")
  const project = {
    ...emptyProject(),
    id: "close-test",
    files: [{ id: "a.tex", path: "a.tex", kind: "latex" as const, text: "draft", saved: "disk" }],
  }
  await saveSession(project)
  await closeProjectSession(project, true)
  assert.equal((await restoreSession()).project?.id, "empty")
  const reopened = await restoreProjectSession({
    ...project,
    files: project.files.map((file) => ({ ...file, text: "disk" })),
  })
  assert.equal(reopened.files[0].text, "disk")
})
test("removing a recent project preserves saved locations and files", async () => {
  installDesktopFixture()
  const { forgetRecentProject, recentProjects, authorizedRoots } =
    await import("../src/lib/recentProjects")
  await window.envoi!.dataPut("recent", [
    { id: "removed", name: "paper", path: "/papers/paper", updated: 1 },
  ])
  await window.envoi!.dataPut("roots", [
    { id: "shortcut", name: "paper", path: "/alias/paper", updated: 1 },
    { id: "parent", name: "papers", path: "/papers", updated: 1 },
  ])
  window.envoi!.canonicalDirectory = async (path) =>
    path === "/alias/paper" ? "/papers/paper" : path
  const rootsBefore = await window.envoi!.dataGet("roots")
  await forgetRecentProject("removed")
  assert.deepEqual(await window.envoi!.dataGet("roots"), rootsBefore)
  assert.equal((await recentProjects()).length, 0)
  assert.deepEqual((await authorizedRoots()).map((item) => item.id).sort(), ["parent", "shortcut"])
})

test("failed startup restore returns home and preserves recoverable drafts", async () => {
  installDesktopFixture()
  const { saveSession, restoreSession } = await import("../src/lib/projectSession")
  const project = {
    ...emptyProject(),
    id: "missing-home-test",
    rootPath: "/missing/paper",
    files: [
      {
        id: "main.tex",
        path: "main.tex",
        kind: "latex" as const,
        text: "recover me",
        saved: "old",
      },
    ],
  }
  window.envoi!.bindProject = async () => {
    throw Error("ENOENT: project moved")
  }
  await saveSession(project)
  const result = await restoreSession()
  assert.equal(result.project?.id, "empty")
  assert.equal(result.recoverable?.files[0].text, "recover me")
  assert.ok(result.warning)
})

test("old desktop bridges cannot invoke legacy permanent deletion", async () => {
  installDesktopFixture()
  let legacyCalled = false
  Object.assign(window.envoi!, {
    fsRemoveTree: async () => {
      legacyCalled = true
    },
  })
  await assert.rejects(verifyDeletionTarget("/papers/paper"), /完全退出/)
  await assert.rejects(
    deleteVerifiedProject({ path: "/papers/paper", name: "paper", label: "paper" }, "paper"),
    /完全退出/,
  )
  assert.equal(legacyCalled, false)
  window.envoi!.fsInspectDeletion = async () => {
    throw Error("No handler registered for 'envoi:fs-inspect-deletion'")
  }
  await assert.rejects(verifyDeletionTarget("/papers/paper"), /完全退出/)
})
