import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { copyIntoProject } from "../electron/main/file-transfer.mjs"

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
