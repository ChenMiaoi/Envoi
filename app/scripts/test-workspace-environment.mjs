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
  await symlink(
    parent,
    path.join(root, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  )
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

test("Python environments create once, preserve existing paths and allow retry after failure", async () => {
  const { createPythonEnvironment, pythonEnvironmentStatus } =
    await import("../electron/main/python-environment.mjs")
  const { realpath } = await import("node:fs/promises")
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-python-")))
  const target = path.join(root, ".venv")
  const resolve = (name) => `/tools/${name}`
  try {
    assert.equal(pythonEnvironmentStatus(root).path, null)
    await assert.rejects(createPythonEnvironment(root, "pip", undefined, resolve), /Unknown/)
    await assert.rejects(
      createPythonEnvironment(root, "uv", undefined, () => undefined),
      /uv is not installed/,
    )
    await mkdir(target)
    await writeFile(path.join(target, "keep"), "existing")
    await assert.rejects(
      createPythonEnvironment(root, "venv", async () => assert.fail("must not run"), resolve),
      /EEXIST/,
    )
    assert.equal(await readFile(path.join(target, "keep"), "utf8"), "existing")
    await rm(target, { recursive: true })
    await assert.rejects(
      createPythonEnvironment(
        root,
        "venv",
        async () => {
          throw Error("failed")
        },
        resolve,
      ),
      /failed/,
    )
    let calls = 0
    const run = async (command, args, options) => {
      calls++
      assert.equal(command, "/tools/python3")
      assert.deepEqual(args, ["-m", "venv", target])
      assert.equal(options.cwd, root)
      await writeFile(path.join(target, "pyvenv.cfg"), "home = /tools")
    }
    await Promise.all([
      createPythonEnvironment(root, "venv", run, resolve),
      createPythonEnvironment(root, "venv", run, resolve),
    ])
    assert.equal(calls, 1)
    assert.equal(pythonEnvironmentStatus(root).path, target)
    await createPythonEnvironment(root, "uv", async () => assert.fail("must reuse"), resolve)
    await rm(target, { recursive: true })
    await createPythonEnvironment(
      root,
      "uv",
      async (command, args) => {
        assert.equal(command, "/tools/uv")
        assert.deepEqual(args, ["venv", target])
        await writeFile(path.join(target, "pyvenv.cfg"), "home = /tools")
      },
      resolve,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
