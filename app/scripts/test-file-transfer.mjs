import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { copyIntoProject } from "../electron/main/file-transfer.mjs"
import {
  renameProjectFile,
  removeProjectFile,
  saveProjectFiles,
} from "../electron/main/file-service.mjs"

test("rename preserves existing destinations and deletion handles directories without following links", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "envoi-file-actions-"))
  try {
    await writeFile(path.join(temp, "a.md"), "source")
    await writeFile(path.join(temp, "b.md"), "destination")
    await assert.rejects(renameProjectFile(temp, "a.md", "b.md"), /目标已存在/)
    assert.equal(await readFile(path.join(temp, "a.md"), "utf8"), "source")
    assert.equal(await readFile(path.join(temp, "b.md"), "utf8"), "destination")
    await renameProjectFile(temp, "a.md", "a.md")
    await renameProjectFile(temp, "a.md", "c.md")
    assert.deepEqual(
      await saveProjectFiles(temp, [{ path: "c.md", expectedText: "source", text: "draft" }]),
      { saved: ["c.md"] },
    )
    await mkdir(path.join(temp, "empty"))
    await removeProjectFile(temp, "empty")
    await mkdir(path.join(temp, "nested", "child"), { recursive: true })
    await writeFile(path.join(temp, "nested", "child", "note.md"), "note")
    await mkdir(path.join(temp, "outside"))
    await writeFile(path.join(temp, "outside", "keep.md"), "keep")
    await symlink(path.join(temp, "outside"), path.join(temp, "nested", "linked"), "junction")
    await removeProjectFile(temp, "nested")
    assert.equal(await readFile(path.join(temp, "outside", "keep.md"), "utf8"), "keep")
    await assert.rejects(removeProjectFile(temp, "../outside"), /无效/)
    await assert.rejects(renameProjectFile(temp, "c.md", "../escape"), /无效/)
    await assert.rejects(readFile(path.join(temp, "nested", "child", "note.md")), {
      code: "ENOENT",
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test("copies files and directories without overwriting or following links", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "envoi-transfer-"))
  try {
    const source = path.join(temp, "source")
    const project = path.join(temp, "project")
    await mkdir(path.join(source, "nested"), { recursive: true })
    await mkdir(project)
    await writeFile(path.join(source, "nested", "paper.pdf"), Buffer.from([0, 1, 255]))
    await copyIntoProject(project, source, path.join(project, "source"))
    assert.deepEqual(
      await readFile(path.join(project, "source", "nested", "paper.pdf")),
      Buffer.from([0, 1, 255]),
    )
    await assert.rejects(
      copyIntoProject(project, source, path.join(project, "source")),
      /目标已存在/,
    )
    await assert.rejects(
      copyIntoProject(project, project, path.join(project, "inside")),
      /不能将目录复制到自身/,
    )
    await symlink(path.join(source, "nested"), path.join(project, "linked"), "junction")
    await assert.rejects(
      copyIntoProject(project, source, path.join(project, "linked", "copy")),
      /符号链接/,
    )
    await symlink(path.join(source, "nested"), path.join(source, "linked"), "junction")
    await assert.rejects(
      copyIntoProject(project, source, path.join(project, "another")),
      /符号链接/,
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
