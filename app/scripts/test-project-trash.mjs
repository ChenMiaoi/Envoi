import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rename, rm, readFile, access, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { inspectProjectDeletion, trashProjectDirectory } from "../server/workspaces.mjs"
const git = (cwd, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test Fixture", "-c", "user.email=fixture@example.invalid", ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  )

test("deletion protection resolves directory aliases and missing descendants", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "envoi-trash-alias-"))
  try {
    const project = path.join(temp, "project")
    const alias = path.join(temp, "alias")
    await mkdir(project)
    await symlink(project, alias, process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(inspectProjectDeletion(project, [alias]), /不能删除/)
    await assert.rejects(
      inspectProjectDeletion(project, [path.join(alias, "future", "data")]),
      /不能删除/,
    )
    const sibling = path.join(temp, "sibling")
    await mkdir(sibling)
    assert.equal((await inspectProjectDeletion(sibling, [alias])).kind, "project")
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
test("trash supports Markdown/code projects, protects roots, never falls back to deletion", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "envoi-trash-test-"))
  try {
    const project = path.join(temp, "project")
    await mkdir(project)
    await writeFile(path.join(project, "README.md"), "keep")
    await writeFile(path.join(project, "package.json"), "{}")
    assert.equal((await inspectProjectDeletion(project)).kind, "project")
    await assert.rejects(inspectProjectDeletion(temp, [project]), /不能删除/)
    await assert.rejects(
      trashProjectDirectory(project, "wrong", async () => assert.fail()),
      /完整/,
    )
    await assert.rejects(
      trashProjectDirectory(project, "project", async () => {
        throw Error("Trash unavailable")
      }),
      /Trash unavailable/,
    )
    assert.equal(await readFile(path.join(project, "README.md"), "utf8"), "keep")
    const result = await trashProjectDirectory(project, "project", (p) =>
      rename(p, path.join(temp, "trash")),
    )
    assert.deepEqual(result.warnings, [])
    assert.equal(await readFile(path.join(temp, "trash", "README.md"), "utf8"), "keep")
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
test("main deletion blocks linked worktrees; removing one preserves branch, other worktrees and results", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "envoi-trash-git-"))
  try {
    const main = path.join(temp, "main"),
      one = path.join(temp, "one"),
      two = path.join(temp, "two")
    await mkdir(main)
    git(main, "init", "-b", "main")
    await writeFile(path.join(main, "README.md"), "paper")
    git(main, "add", ".")
    git(main, "commit", "-m", "fixture")
    git(main, "worktree", "add", "-b", "one", one)
    git(main, "worktree", "add", "-b", "two", two)
    const plan = await inspectProjectDeletion(main)
    assert(plan.blocked)
    assert.equal(plan.related.length, 2)
    await assert.rejects(
      trashProjectDirectory(main, "main", () => assert.fail()),
      /关联/,
    )
    await assert.rejects(
      trashProjectDirectory(main, "wrong", () => assert.fail()),
      /完整/,
    )
    git(main, "worktree", "lock", one)
    assert((await inspectProjectDeletion(one)).blocked)
    git(main, "worktree", "unlock", one)
    const result = await trashProjectDirectory(one, "one", (p) =>
      rename(p, path.join(temp, "trash")),
    )
    assert.deepEqual(result.warnings, [])
    assert(!git(main, "worktree", "list", "--porcelain").includes(one.replaceAll("\\", "/")))
    assert(git(main, "branch", "--list", "one").includes("one"))
    await access(path.join(two, "README.md"))
    assert.equal(await readFile(path.join(temp, "trash", "README.md"), "utf8"), "paper")
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test("worktree cleanup cannot delete new files recreated at the old path", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "envoi-trash-race-"))
  try {
    const main = path.join(temp, "main"),
      worktree = path.join(temp, "worktree")
    await mkdir(main)
    git(main, "init", "-b", "main")
    await writeFile(path.join(main, "README.md"), "paper")
    git(main, "add", ".")
    git(main, "commit", "-m", "fixture")
    git(main, "worktree", "add", "-b", "experiment", worktree)
    const result = await trashProjectDirectory(worktree, "worktree", async (source) => {
      await rename(source, path.join(temp, "trash"))
      await mkdir(source)
      await writeFile(path.join(source, "new.txt"), "new data")
    })
    assert.equal(result.warnings.length, 1)
    assert.equal(await readFile(path.join(worktree, "new.txt"), "utf8"), "new data")
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
