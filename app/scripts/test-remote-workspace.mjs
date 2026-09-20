import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { RpcPeer } from "../electron/main/remote/rpc.mjs"
import {
  RemoteWorkspaces,
  validateSshTarget,
  remoteRoot,
  sshArguments,
} from "../electron/main/remote/connection.mjs"
import { workspaceFiles } from "../electron/main/workspace-files.mjs"
import { ProjectSessionManager } from "../electron/main/services/project-sessions.ts"

function remoteFixture(entries = []) {
  const remote = Object.create(RemoteWorkspaces.prototype)
  remote.entries = new Map(entries.map((entry) => [`${entry.owner}:${entry.root}`, entry]))
  remote.send = () => {}
  return remote
}

for (const kind of ["ssh", "wsl"])
  test(`disabling ${kind} only closes that transport`, async () => {
    const entries = ["ssh", "wsl"].map((kind, owner) => ({
      owner,
      root: `${kind}://fixture/`,
      target: { kind },
      state: "connected",
    }))
    const remote = remoteFixture(entries),
      closed = [],
      updated = []
    remote.disconnect = async (_owner, root) => closed.push(root)
    remote.call = async (_owner, root) => updated.push(root)
    await remote.configurePreferences(
      {
        pluginStates: {
          [kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"]: false,
        },
      },
      1,
    )
    assert.deepEqual(closed, [`${kind}://fixture/`])
    assert.deepEqual(updated, [`${kind === "ssh" ? "wsl" : "ssh"}://fixture/`])
  })

test("a failed preference delivery does not fail persistence or skip another window", async () => {
  const remote = remoteFixture(
    [1, 2].map((owner) => ({
      owner,
      root: "wsl://fixture/",
      target: { kind: "wsl" },
      state: "connected",
    })),
  )
  const delivered = [],
    closed = []
  remote.call = async (owner) => {
    if (owner === 1) throw Error("Disconnected during settings save")
    delivered.push(owner)
  }
  remote.disconnect = async (owner) => {
    closed.push(owner)
  }
  await remote.configurePreferences({ pluginStates: { "envoi.python": false } }, 3)
  assert.deepEqual(delivered, [2])
  assert.deepEqual(closed, [1])
  for (const entry of remote.entries.values()) {
    assert.equal(entry.preferences[1], 3)
    assert.equal(entry.preferences[0].pluginStates["envoi.python"], false)
  }
})

for (const trusted of [true, false])
  test(`connection acknowledges a concurrent trust change to ${trusted} before publishing connected`, async () => {
    const entry = {
      owner: 1,
      root: "ssh://fixture/",
      target: {},
      state: "connecting",
      trusted: !trusted,
    }
    const remote = remoteFixture([entry])
    let calls = 0,
      agentTrust
    const peer = {
      call: async (method, args) => {
        assert.equal(entry.state, "connecting")
        if (method === "trust") {
          agentTrust = args[0]
          if (++calls === 1) {
            entry.trusted = trusted
            entry.trustRevision = 1
          }
        }
      },
    }
    await remote.synchronizePolicy(entry, peer)
    assert.equal(entry.state, "connected")
    assert.equal(agentTrust, trusted)
    assert.equal(calls, 2)
  })

test("policy changes and cancellation during the handshake cannot publish stale connected state", async () => {
  const entry = {
    owner: 1,
    root: "wsl://fixture/",
    target: {},
    state: "connecting",
    trusted: true,
    preferences: [{}, 1],
  }
  const remote = remoteFixture([entry]),
    revisions = []
  await remote.synchronizePolicy(entry, {
    call: async (method, args) => {
      if (method !== "preferences") return
      revisions.push(args[1])
      if (args[1] === 1) entry.preferences = [{}, 2]
    },
  })
  assert.deepEqual(revisions, [1, 2])
  entry.state = "connecting"
  await assert.rejects(
    remote.synchronizePolicy(entry, {
      call: async () => {
        entry.intentional = true
      },
    }),
    /cancelled/,
  )
  assert.equal(entry.state, "connecting")
})

test("slow environment creation and language tools have room for their execution and cleanup", async () => {
  const remote = remoteFixture([
    {
      owner: 1,
      root: "wsl://fixture/",
      state: "connected",
      peer: {
        call: async (_method, _args, timeout) => timeout,
      },
    },
  ])
  for (const method of ["python-environment", "language-tool"])
    assert.equal(await remote.call(1, "wsl://fixture/", method), 180000)
})

test("RPC timeout cancels its remote operation without closing other requests", async () => {
  const requests = new PassThrough(),
    replies = new PassThrough()
  let cancelled
  const cancellation = new Promise((resolve) => {
    cancelled = resolve
  })
  const server = new RpcPeer(requests, replies, (method, _args, signal) => {
    if (method === "ping") return true
    return new Promise((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          cancelled()
          reject(signal.reason)
        },
        { once: true },
      ),
    )
  })
  const client = new RpcPeer(replies, requests)
  try {
    await assert.rejects(client.call("slow", [], 20), /timed out/)
    await cancellation
    assert.equal(await client.call("ping"), true)
  } finally {
    client.close()
    server.close()
    requests.destroy()
    replies.destroy()
  }
})

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

test("WSL directory responses preserve spaces and runtime plans pin architecture and integrity", async () => {
  const { parseWslDirectories } = await import("../electron/main/remote/wsl.mjs")
  const { wslRuntimePlan, WSL_NODE_VERSION } =
    await import("../electron/main/remote/wsl-runtime.mjs")
  assert.deepEqual(parseWslDirectories("/home/user\0/home/user/\0/home/user/space dir/\0"), {
    home: "/home/user",
    directory: "/home/user/",
    directories: ["/home/user/space dir/"],
  })
  assert.throws(() => parseWslDirectories("bad output"))
  for (const machine of ["x86_64", "aarch64"]) {
    const plan = wslRuntimePlan(machine)
    assert(plan.url.startsWith(`https://nodejs.org/dist/v${WSL_NODE_VERSION}/`))
    assert.match(plan.digest, /^[a-f0-9]{64}$/)
    assert(plan.relative.startsWith(".envoi/runtimes/"))
  }
  assert.throws(() => wslRuntimePlan("unsupported"))
})

test("prepared remote projects allow reads but cannot run tools or replace the active project on load failure", async () => {
  const { routeRemoteWorkspace } = await import("../electron/main/remote/workspace-routing.mjs")
  const sessions = new ProjectSessionManager(() => {})
  sessions.bindProject(1, "old", "ssh://old/")
  sessions.prepareProject(1, "new", "wsl://new/")
  const remote = {
    ready: Promise.resolve(),
    profiles: {},
    entries: new Map([["1:wsl://new/", { trusted: true, target: { directory: "/project" } }]]),
    call: async () => {
      throw Error("Workspace text exceeds 24 MB")
    },
  }
  await assert.rejects(
    routeRemoteWorkspace(remote, sessions, 1, "envoi:fs-list", ["wsl://new/"]),
    /24 MB/,
  )
  assert.equal(sessions.activeRoot(1), "ssh://old/")
  for (const method of ["fs-save", "terminal-open", "git-log"])
    await assert.rejects(
      routeRemoteWorkspace(remote, sessions, 1, `envoi:${method}`, ["wsl://new/"]),
      /not active/,
    )
  sessions.cancelPreparation(1)
  await assert.rejects(
    routeRemoteWorkspace(remote, sessions, 1, "envoi:fs-read", ["wsl://new/", "notes.md"]),
    /not active/,
  )
})

test("cancelled WSL preparation never invokes the distribution", async () => {
  const { ensureWslRuntime } = await import("../electron/main/remote/wsl-runtime.mjs")
  const progress = []
  await assert.rejects(
    ensureWslRuntime(
      "fixture",
      (stage) => progress.push(stage),
      AbortSignal.abort(Error("cancelled")),
    ),
    /cancelled/,
  )
  assert.deepEqual(progress, [])
})

test("cancelling before saved connections load cannot start a late connection", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-cancel-connect-"))
  try {
    const remote = new RemoteWorkspaces({ directory, send() {} })
    await remote.ready
    let release
    remote.ready = new Promise((resolve) => {
      release = resolve
    })
    let started = false
    remote.start = async () => {
      started = true
    }
    const controller = new AbortController()
    const promise = remote.connect(
      1,
      { host: "fixture", directory: "/work" },
      undefined,
      controller.signal,
    )
    controller.abort(Error("cancelled"))
    release()
    await assert.rejects(promise, /cancelled/)
    assert.equal(started, false)
    assert.equal(remote.entries.size, 0)
  } finally {
    assert(
      path.dirname(directory) === tmpdir() &&
        path.basename(directory).startsWith("envoi-cancel-connect-"),
    )
    await rm(directory, { recursive: true, force: true })
  }
})
