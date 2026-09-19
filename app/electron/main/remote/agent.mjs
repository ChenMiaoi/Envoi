import { realpath, stat, mkdir, unlink, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import net from "node:net"
import { spawn } from "node:child_process"
import { RpcPeer } from "./rpc.mjs"
import { createLocalWorkspaceEnvironment } from "../workspace-environment.mjs"
import { watchProjectDirectory } from "../project-watch.mjs"
import { LspService } from "../lsp-service.mjs"
import { runLanguageTool } from "../language-tools.mjs"
import { pythonEnvironmentStatus, createPythonEnvironment } from "../python-environment.mjs"
import { gitInitAt, gitStatusAt, gitLogAt, gitShowAt, gitRuntime } from "../../../server/git.mjs"
import { runtimeInfo, compileSnapshot } from "../../../server/compiler.mjs"
import { lintText } from "../../../server/lint.mjs"
import { toolInfo } from "../../../server/tool-config.mjs"
import { createRemoteTerminal } from "./terminal.mjs"
import { restrictedPath } from "../restricted-path.mjs"

export const REMOTE_PROTOCOL = 1
export function createAgent(publish) {
  let root,
    files,
    watcher,
    trusted = false,
    terminal,
    compilation
  const lsp = new LspService(
    (_owner, payload) => publish({ channel: "envoi:lsp-diagnostics", payload }),
    undefined,
    undefined,
    (_owner, payload) => publish({ channel: "envoi:lsp-status", payload }),
  )
  const requireTrust = () => {
    if (!trusted) throw Error("Trust this remote workspace before running tools")
  }
  const disposeTools = () => {
    lsp.dispose(1)
    terminal?.dispose()
    terminal = undefined
    compilation?.abort()
  }
  return {
    async call(method, args) {
      if (method === "hello") {
        if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 22)
          throw Error("Linux workspaces require Linux and Node.js 22 or later")
        if (args[0] !== REMOTE_PROTOCOL) throw Error("Remote protocol version mismatch")
        const requested = args[1]
        if (typeof requested !== "string" || !path.isAbsolute(requested))
          throw Error("An absolute remote folder is required")
        const canonical = await realpath(requested)
        if (!(await stat(canonical)).isDirectory()) throw Error("Remote path is not a directory")
        if (root && root !== canonical) throw Error("Remote session is bound to another workspace")
        root = canonical
        files = createLocalWorkspaceEnvironment(root, {
          fileLimits: { entries: 50000, textBytes: 24_000_000, fileBytes: 32_000_000 },
        }).files
        return {
          protocol: REMOTE_PROTOCOL,
          directory: root,
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
        }
      }
      if (!root) throw Error("Remote handshake required")
      if (method === "ping") return true
      if (method === "release") {
        watcher?.()
        watcher = undefined
        trusted = false
        disposeTools()
        return null
      }
      if (method === "trust") {
        trusted = args[0] === true
        if (!trusted) disposeTools()
        return null
      }
      if (method === "preferences") {
        lsp.configurePreferences(args[0], args[1])
        return null
      }
      const fileMethods = {
        "fs-list": "list",
        "fs-children": "children",
        "fs-read": "read",
        "fs-save": "save",
        "fs-write": "write",
        "fs-write-files": "writeFiles",
        "fs-mkdir": "mkdir",
        "fs-remove": "remove",
        "fs-rename": "rename",
        "fs-copy": "copy",
      }
      if (Object.hasOwn(fileMethods, method)) return files[fileMethods[method]](...args)
      if (method === "watch-project") {
        watcher?.()
        watcher = undefined
        if (args[0])
          watcher = watchProjectDirectory(root, (payload) =>
            publish({ channel: "envoi:files-changed", payload }),
          )
        return null
      }
      if (method === "lsp-close") {
        lsp.close(1, root, ...args)
        return null
      }
      requireTrust()
      if (method === "lsp-open") {
        await restrictedPath(root, args[0])
        return lsp.open(1, root, ...args)
      }
      if (method === "lsp-change") {
        lsp.change(1, root, ...args)
        return null
      }
      if (method === "lsp-query") return lsp.query(1, root, ...args)
      if (method === "language-tool") {
        await restrictedPath(root, args[0])
        return runLanguageTool(root, ...args)
      }
      if (method === "python-environment")
        return args[0] === undefined
          ? pythonEnvironmentStatus(root)
          : createPythonEnvironment(root, args[0])
      if (method === "tools")
        return { ...(await toolInfo({ ...args[0], root })), latex: runtimeInfo({ trusted: true }) }
      if (method === "git-runtime") return gitRuntime()
      const git = {
        "git-init": gitInitAt,
        "git-status": gitStatusAt,
        "git-log": gitLogAt,
        "git-show": gitShowAt,
      }
      if (Object.hasOwn(git, method)) return git[method](root, ...args)
      if (method === "compiler-runtime") return runtimeInfo({ trusted: true })
      if (method === "compile") {
        if (compilation) throw Error("A remote compilation is already running")
        compilation = new AbortController()
        try {
          const input = { ...args[0], rootPath: root }
          return await compileSnapshot(input, {
            trustedRoot: root,
            sourceRoot: input.drafts ? root : undefined,
            signal: compilation.signal,
          })
        } finally {
          compilation = undefined
        }
      }
      if (method === "cancel-compile") {
        compilation?.abort()
        return null
      }
      if (method === "lint") return lintText({ ...args[0], rootPath: root }, { trustedRoot: root })
      if (method === "terminal-open") {
        if (!terminal) {
          const next = createRemoteTerminal(root, (event) => {
            publish(event)
            if (event.exit !== undefined && terminal === next) terminal = undefined
          })
          terminal = next
        }
        return { output: terminal.snapshot() }
      }
      if (method === "terminal-input") {
        if (!terminal) throw Error("Terminal is not running")
        terminal.write(args[0])
        return null
      }
      if (method === "terminal-close") {
        terminal?.dispose()
        terminal = undefined
        return null
      }
      throw Error(`Remote operation is not supported: ${method}`)
    },
    dispose() {
      watcher?.()
      disposeTools()
    },
  }
}

async function start() {
  const [mode, id] = process.argv.slice(2)
  if (!/^[a-f0-9]{32}$/.test(id ?? "")) throw Error("Invalid remote session ID")
  const directory = path.join(homedir(), ".envoi", "remote-sessions")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const socketPath = path.join(directory, `${id}.sock`)
  if (mode === "--daemon") {
    let peer, idle
    const agent = createAgent((event) => {
      if (peer && !peer.closed) peer.send({ event })
    })
    const shutdown = () => {
      agent.dispose()
      server.close()
      void unlink(socketPath).finally(() => process.exit())
    }
    const server = net.createServer((socket) => {
      if (peer && !peer.closed) {
        socket.destroy()
        return
      }
      clearTimeout(idle)
      peer = new RpcPeer(socket, socket, (method, args) => agent.call(method, args))
      peer.on("close", () => {
        socket.destroy()
        idle = setTimeout(shutdown, 300000)
      })
    })
    server.on("error", () => process.exit(1))
    server.listen(socketPath)
    idle = setTimeout(shutdown, 300000)
    process.on("SIGTERM", shutdown)
    return
  }
  if (mode !== "--proxy") throw Error("Invalid remote mode")
  const connect = () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(socketPath)
      socket.once("error", reject)
      socket.once("connect", () => {
        socket.removeListener("error", reject)
        resolve(socket)
      })
    })
  let socket
  try {
    socket = await connect()
  } catch {
    await unlink(socketPath).catch(() => {})
    const child = spawn(process.execPath, [process.argv[1], "--daemon", id], {
      detached: true,
      stdio: "ignore",
    })
    child.unref()
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      try {
        socket = await connect()
        break
      } catch {
        /* Wait for the daemon socket. */
      }
    }
  }
  if (!socket) throw Error("Remote agent failed to start")
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
  process.stdin.on("end", () => socket.end())
  socket.on("close", () => process.exit())
  socket.on("error", () => process.exit(1))
}
if (process.argv.includes("--daemon") || process.argv.includes("--proxy")) {
  start().catch((error) => {
    process.stderr.write(error.message + "\n")
    process.exit(1)
  })
}
