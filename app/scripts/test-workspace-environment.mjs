import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { once } from "node:events"
import { createLocalWorkspaceEnvironment } from "../electron/main/workspace-environment.mjs"

test("local environment confines file and process operations to its workspace", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "envoi-environment-"))
  const root = path.join(parent, "project")
  await mkdir(root)
  await writeFile(path.join(parent, "outside.txt"), "private")
  await symlink(parent, path.join(root, "escape"), "dir")
  const environment = createLocalWorkspaceEnvironment(root)
  try {
    assert.match(environment.identity.id, /^local:/)
    assert.equal(environment.identity.platform, process.platform)
    await environment.fs.write("source.txt", { text: "hello" })
    assert.equal((await environment.fs.read("source.txt")).toString(), "hello")
    assert.equal(await readFile(path.join(root, "source.txt"), "utf8"), "hello")
    assert((await environment.fs.list()).some((entry) => entry.name === "source.txt"))
    assert.match(environment.paths.uri("source.txt"), /^file:/)
    await assert.rejects(environment.fs.read("escape/outside.txt"), /outside|项目目录外/)
    assert.throws(() => environment.paths.resolve("../outside.txt"), /无效项目文件路径/)
    assert.throws(
      () => environment.process.spawn(process.execPath, [], { cwd: parent }),
      /outside workspace/,
    )
    const child = environment.process.spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    })
    const [code] = await once(child, "exit")
    assert.equal(code, 0)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
