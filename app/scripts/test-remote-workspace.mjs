import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { RpcPeer } from "../electron/main/remote/rpc.mjs"
import { validateSshTarget, remoteRoot, sshArguments } from "../electron/main/remote/connection.mjs"
import { workspaceFiles } from "../electron/main/workspace-files.mjs"

test("SSH destinations reject option and shell injection; identities include host and path", () => {
  for (const host of [
    "-oProxyCommand=x",
    "host;touch x",
    "user@host\n",
    "host $(id)",
    "user@-host",
  ])
    assert.throws(() => validateSshTarget({ host, directory: "/project" }))
  assert.throws(() => validateSshTarget({ host: "research", directory: "~/project" }))
  assert.throws(() => validateSshTarget({ host: "research", directory: "/project", port: 65536 }))
  const one = { host: "research", directory: "/project" }
  assert.notEqual(remoteRoot(one), remoteRoot({ ...one, host: "other" }))
  assert.notEqual(remoteRoot(one), remoteRoot({ ...one, port: 2222 }))
  assert.equal(remoteRoot(one), remoteRoot({ ...one, directory: "/project/../project" }))
  const args = sshArguments(
    { ...one, directory: "/project/$(touch ignored)" },
    123,
    "a".repeat(64),
    "b".repeat(32),
  )
  assert(!args.at(-1).includes("touch ignored"))
  assert(!args.some((arg) => /StrictHostKeyChecking=no/.test(arg)))
  assert.deepEqual(args.slice(-3, -1), ["--", "research"])
})

test("RPC multiplexes responses, preserves unicode, and rejects outstanding calls on disconnect", async () => {
  const requests = new PassThrough(),
    replies = new PassThrough()
  const server = new RpcPeer(requests, replies, async (_method, args) => {
    if (args[0] === "fail") throw Error("remote failure")
    if (args[0] === "hang") return new Promise(() => {})
    return args[0]
  })
  const client = new RpcPeer(replies, requests)
  assert.deepEqual(
    await Promise.all([client.call("echo", ["中文\nα"]), client.call("echo", [42])]),
    ["中文\nα", 42],
  )
  await assert.rejects(client.call("echo", ["fail"]), /remote failure/)
  const pending = client.call("echo", ["hang"])
  client.close()
  await assert.rejects(pending, /closed/)
  await assert.rejects(client.call("echo", []), /disconnected/)
  server.close()
  requests.destroy()
  replies.destroy()
})

test("shared workspace filesystem preserves drafts on conflicts and blocks path escapes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-remote-fs-"))
  try {
    const root = path.join(directory, "project"),
      outside = path.join(directory, "outside")
    await mkdir(root)
    await mkdir(outside)
    await writeFile(path.join(root, "main.cpp"), "int value = 1;\n")
    await writeFile(path.join(outside, "private.txt"), "outside")
    await symlink(
      outside,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    )
    const files = workspaceFiles(root)
    assert.deepEqual(
      (await files.list()).files.map((file) => file.path),
      ["main.cpp"],
    )
    await assert.rejects(files.read("../outside/private.txt"))
    await assert.rejects(files.read("link/private.txt"))
    await assert.rejects(files.write("link/new.txt", { text: "escape" }))
    assert.deepEqual(
      await files.save([{ path: "main.cpp", text: "draft", expectedText: "int value = 1;\n" }]),
      { saved: ["main.cpp"] },
    )
    await writeFile(path.join(root, "main.cpp"), "external")
    const conflict = await files.save([
      { path: "main.cpp", text: "new draft", expectedText: "draft" },
    ])
    assert.deepEqual(conflict.saved, [])
    assert.match(conflict.error, /修改/)
    assert.equal(await readFile(path.join(root, "main.cpp"), "utf8"), "external")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const scheme of ["ssh", "wsl"])
  test(`${scheme} trust decisions survive restriction and apply to every window, including offline sessions`, async () => {
    const { routeRemoteWorkspace } = await import("../electron/main/remote/workspace-routing.mjs")
    const root = `${scheme}://fixture/`,
      calls = []
    const first = { owner: 1, root, trusted: true, state: "connected" }
    const second = { owner: 2, root, trusted: true, state: "disconnected" }
    const remote = {
      ready: Promise.resolve(),
      profiles: { [root]: { trusted: true } },
      entries: new Map([
        [`1:${root}`, first],
        [`2:${root}`, second],
      ]),
      async saveProfiles() {},
      async call(owner, _root, method, args) {
        calls.push({ owner, method, args })
      },
      send() {},
    }
    const sessions = { activeRoot: () => root }
    await routeRemoteWorkspace(remote, sessions, 1, "envoi:restrict-project", [root])
    assert.equal(first.trusted, false)
    assert.equal(second.trusted, false)
    assert.equal(remote.profiles[root].decided, true)
    assert.deepEqual(calls, [{ owner: 1, method: "trust", args: [false] }])
    assert.deepEqual(
      await routeRemoteWorkspace(remote, sessions, 2, "envoi:project-trust", [root]),
      {
        value: { trusted: false, decided: true },
      },
    )
    await assert.rejects(
      routeRemoteWorkspace(remote, { activeRoot: () => "other" }, 1, "envoi:fs-read", [
        root,
        "main.cpp",
      ]),
      /not active/,
    )
    assert.equal(
      await routeRemoteWorkspace(remote, sessions, 1, "envoi:remote-reconnect", [root]),
      undefined,
    )
  })

test("WSL discovery decodes Windows output and isolates distribution identities", async () => {
  const { parseWslDistributions, validateWslTarget, wslArguments } =
    await import("../electron/main/remote/wsl.mjs")
  const { validateRemoteTarget, deploymentScript } =
    await import("../electron/main/remote/connection.mjs")
  const { isRemoteRoot } = await import("../electron/main/remote/workspace-routing.mjs")
  assert.deepEqual(
    parseWslDistributions(Buffer.from("Ubuntu\r\nFedora\r\nUbuntu\r\n", "utf16le")),
    ["Ubuntu", "Fedora"],
  )
  const target = { kind: "wsl", host: "Ubuntu", directory: "/work/space and 'quotes'" }
  assert.match(remoteRoot(target), /^wsl:\/\//)
  assert(isRemoteRoot(remoteRoot(target)))
  assert.notEqual(remoteRoot(target), remoteRoot({ ...target, kind: "ssh" }))
  assert.notEqual(remoteRoot(target), remoteRoot({ ...target, host: "Fedora" }))
  for (const host of ["--exec", "Ubuntu;id", "Ubuntu\n", "$(id)"])
    assert.throws(() => validateWslTarget({ ...target, host }))
  assert.throws(() => validateWslTarget({ ...target, port: 22 }))
  assert.throws(() => validateWslTarget({ ...target, directory: "C:\\work" }))
  assert.throws(() => validateRemoteTarget({ ...target, kind: "unknown" }))
  const script = deploymentScript(100, "a".repeat(64), "b".repeat(32))
  assert(!script.includes(target.directory))
  assert.deepEqual(wslArguments(target, script), [
    "--distribution",
    "Ubuntu",
    "--cd",
    "~",
    "--exec",
    "sh",
    "-c",
    script,
  ])
})
