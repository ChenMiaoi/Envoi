import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { validateWslTarget, listWslDistributions, wslArguments } from "./wsl.mjs"
import { ensureWslRuntime } from "./wsl-runtime.mjs"
import { RpcPeer } from "./rpc.mjs"

export function validateSshTarget(target) {
  if (
    !target ||
    typeof target.host !== "string" ||
    !/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(target.host)
  )
    throw Error("Enter an SSH config alias or user@host (without SSH command options)")
  if (
    target.port !== undefined &&
    (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)
  )
    throw Error("Invalid SSH port")
  if (
    typeof target.directory !== "string" ||
    !target.directory.startsWith("/") ||
    /[\0\r\n]/.test(target.directory) ||
    target.directory.length > 4096
  )
    throw Error("Enter an absolute Linux directory, for example /home/user/project")
  if (
    target.configFile !== undefined &&
    (typeof target.configFile !== "string" ||
      !path.isAbsolute(target.configFile) ||
      /[\0\r\n]/.test(target.configFile))
  )
    throw Error("SSH configuration must be an absolute local file path")
  return {
    ...(target.configFile ? { configFile: target.configFile } : {}),
    host: target.host,
    ...(target.port === undefined ? {} : { port: target.port }),
    directory: path.posix.normalize(target.directory),
  }
}
export function validateRemoteTarget(target) {
  if (target?.kind === "wsl") return validateWslTarget(target)
  if (target?.kind !== undefined && target.kind !== "ssh") throw Error("Unknown connection type")
  return validateSshTarget(target)
}
export function remoteRoot(target) {
  return (
    (target?.kind === "wsl" ? "wsl://" : "ssh://") +
    createHash("sha256")
      .update(JSON.stringify(validateRemoteTarget(target)))
      .digest("hex") +
    "/"
  )
}
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
export function deploymentScript(size, digest, session) {
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9]{32}$/.test(session)
  )
    throw Error("Invalid agent deployment")
  // Uploaded bytes are data on stdin; no workspace paths or user commands enter this script.
  const script = `set -eu\ncommand -v node >/dev/null || { echo 'Linux workspace requires Node.js 22 or later on the host' >&2; exit 1; }\numask 077\nd="$HOME/.envoi/remote-server"\nmkdir -p "$d"\nf="$d/${digest}.cjs"\nt=$(mktemp "$d/upload.XXXXXX")\ntrap 'rm -f "$t"' EXIT\nhead -c ${size} > "$t"\n[ "$(wc -c < "$t")" -eq ${size} ] || exit 1\n[ "$(sha256sum "$t" | cut -d ' ' -f 1)" = '${digest}' ] || exit 1\nmv "$t" "$f"\nexec node "$f" --proxy ${session}`
  return script
}
export function sshArguments(target, size, digest, session) {
  validateSshTarget(target)
  const script = deploymentScript(size, digest, session)
  return [
    ...(target.configFile ? ["-F", target.configFile] : []),
    "-T",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=20",
    ...(target.port ? ["-p", String(target.port)] : []),
    "--",
    target.host,
    "sh -c " + quote(script),
  ]
}

export class RemoteWorkspaces {
  constructor({ directory, binaryDirectory, executable, send, sessions, sshArgs = [] }) {
    this.directory = directory
    this.binaryDirectory = binaryDirectory
    this.executable = executable
    this.send = send
    this.sessions = sessions
    this.sshArgs = sshArgs
    this.entries = new Map()
    this.profiles = Object.create(null)
    this.prompts = new Map()
    this.writes = Promise.resolve()
    this.ready = readFile(path.join(directory, "connections.json"), "utf8")
      .then((raw) => {
        this.profiles = JSON.parse(raw)
      })
      .catch(() => {})
  }
  async saveProfiles() {
    const data = JSON.stringify(this.profiles, null, 2)
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        const temporary = path.join(this.directory, "connections.tmp")
        await writeFile(temporary, data, { mode: 0o600 })
        await rename(temporary, path.join(this.directory, "connections.json"))
      })
    return this.writes
  }
  state(entry, state, error) {
    entry.state = state
    entry.error = error
    this.send(entry.owner, "envoi:remote-event", { type: "state", value: this.describe(entry) })
  }
  describe(entry) {
    return {
      root: entry.root,
      kind: entry.target.kind ?? "ssh",
      host: entry.target.host,
      directory: entry.target.directory,
      state: entry.state,
      error: entry.error,
      generation: entry.generation,
    }
  }
  async list(owner) {
    await this.ready
    return Object.entries(this.profiles).map(([root, profile]) => {
      const entry = this.entries.get(`${owner}:${root}`)
      return entry
        ? this.describe(entry)
        : {
            root,
            kind: profile.target.kind ?? "ssh",
            host: profile.target.host,
            directory: profile.target.directory,
            state: "disconnected",
            generation: 0,
          }
    })
  }
  async configurePreferences(preferences, revision) {
    // Persistence has already succeeded. A failed transport must not turn a
    // local settings save into a failure or prevent other windows updating.
    await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        const plugin = entry.target.kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"
        entry.preferences = [
          {
            pluginStates: {
              ...preferences.pluginStates,
              ...preferences.pluginWorkspaces?.[entry.root],
            },
          },
          revision,
        ]
        if (preferences.pluginStates?.[plugin] === false)
          return this.disconnect(entry.owner, entry.root)
        if (entry.state !== "connected") return
        try {
          await this.call(entry.owner, entry.root, "preferences", entry.preferences)
        } catch {
          // Stop using an agent which has not acknowledged the current policy.
          await this.disconnect(entry.owner, entry.root)
        }
      }),
    )
  }
  async synchronizePolicy(entry, peer) {
    let revision, preferences
    do {
      if (entry.intentional) throw Error("Connection cancelled")
      revision = entry.trustRevision ?? 0
      preferences = entry.preferences
      await peer.call("trust", [entry.trusted])
      if (preferences) await peer.call("preferences", preferences)
    } while (revision !== (entry.trustRevision ?? 0) || preferences !== entry.preferences)
    if (entry.intentional) throw Error("Connection cancelled")
    this.state(entry, "connected")
  }
  async connect(owner, target, existingRoot, signal) {
    await this.ready
    signal?.throwIfAborted()
    target = validateRemoteTarget(target)
    const root = existingRoot ?? remoteRoot(target),
      key = `${owner}:${root}`
    let entry = this.entries.get(key)
    if (entry?.connecting) return entry.connecting
    if (entry?.state === "connected") return this.describe(entry)
    entry ??= {
      root,
      owner,
      target,
      session: randomBytes(16).toString("hex"),
      generation: 0,
      trusted: this.profiles[root]?.trusted === true,
      decided: this.profiles[root]?.decided === true,
    }
    entry.intentional = false
    this.entries.set(key, entry)
    const cancel = () => {
      void this.disconnect(owner, root)
    }
    signal?.addEventListener("abort", cancel, { once: true })
    entry.connecting = this.start(entry).finally(() => {
      signal?.removeEventListener("abort", cancel)
      entry.connecting = undefined
    })
    return entry.connecting
  }
  async start(entry) {
    const controller = new AbortController()
    entry.controller = controller
    this.state(entry, "connecting")
    let askpass,
      stderr = ""
    try {
      const wsl = entry.target.kind === "wsl"
      if (wsl && !(await listWslDistributions()).includes(entry.target.host))
        throw Error("WSL distribution is not installed")
      let runtime
      if (wsl)
        runtime = await ensureWslRuntime(
          entry.target.host,
          (stage) => {
            this.send(entry.owner, "envoi:remote-event", {
              type: "preparing",
              root: entry.root,
              stage,
            })
          },
          controller.signal,
        )
      askpass = wsl ? { env: {}, dispose() {} } : await this.askpass(entry.owner)
      const bytes = await readFile(path.join(this.binaryDirectory, "remote-agent.cjs"))
      const digest = createHash("sha256").update(bytes).digest("hex")
      if (entry.intentional) throw Error("Connection cancelled")
      const child = spawn(
        wsl ? "wsl.exe" : "ssh",
        wsl
          ? wslArguments(
              entry.target,
              `export PATH="$HOME/${runtime}/bin:$PATH"\n` +
                deploymentScript(bytes.length, digest, entry.session),
            )
          : [...this.sshArgs, ...sshArguments(entry.target, bytes.length, digest, entry.session)],
        {
          windowsHide: true,
          stdio: "pipe",
          env: { ...process.env, ...askpass.env },
        },
      )
      entry.child = child
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-6000)
      })
      // Queue deployment bytes before any protocol frames on the same SSH stream.
      child.stdin.write(bytes)
      const peer = new RpcPeer(child.stdout, child.stdin)
      entry.peer = peer
      child.on("error", (error) => peer.close(error))
      child.on("close", () => peer.close(Error(stderr || "Workspace connection closed")))
      peer.on("event", (event) => {
        if (entry.peer !== peer) return
        if (
          event.channel &&
          ["envoi:lsp-diagnostics", "envoi:lsp-status", "envoi:files-changed"].includes(
            event.channel,
          )
        )
          this.send(entry.owner, event.channel, { ...event.payload, root: entry.root })
        else if (event.type === "terminal")
          this.send(entry.owner, "envoi:remote-event", { ...event, root: entry.root })
      })
      peer.on("close", (error) => {
        clearInterval(entry.heartbeat)
        const wasConnected = entry.state === "connected"
        // Windows can report a broken stdin before SSH has delivered its stderr.
        // Let the authentication/host-key error drain before killing the process.
        setTimeout(() => {
          child.kill()
          askpass.dispose()
          if (entry.peer !== peer) return
          this.state(entry, "disconnected", entry.intentional ? undefined : stderr || error.message)
          if (wasConnected && !entry.intentional)
            entry.retry = setTimeout(() => {
              void this.reconnect(entry, 0)
            }, 2000)
        }, 150)
      })
      const hello = await peer.call("hello", [1, entry.target.directory], 150000)
      if (hello.protocol !== 1) throw Error("Remote protocol version mismatch")
      if (entry.intentional) throw Error("Connection cancelled")
      entry.generation++
      this.profiles[entry.root] = {
        target: entry.target,
        trusted: entry.trusted,
        decided: entry.decided,
      }
      await this.saveProfiles()
      if (entry.watching) await peer.call("watch-project", [true])
      await this.synchronizePolicy(entry, peer)
      this.send(entry.owner, "envoi:files-changed", { root: entry.root, paths: [] })
      entry.heartbeat = setInterval(() => {
        void peer.call("ping", [], 10000).catch((error) => peer.close(error))
      }, 15000)
      return this.describe(entry)
    } catch (error) {
      if (entry.child) await new Promise((resolve) => setTimeout(resolve, 200))
      entry.child?.kill()
      entry.peer?.close(error)
      askpass?.dispose()
      const failure = Error(stderr.trim() || error.message)
      this.state(entry, "disconnected", failure.message)
      throw failure
    }
  }
  async reconnect(entry, attempt) {
    if (entry.intentional || entry.state === "connected") return
    try {
      await this.connect(entry.owner, entry.target, entry.root)
    } catch {
      if (attempt < 2 && !entry.intentional)
        entry.retry = setTimeout(() => {
          void this.reconnect(entry, attempt + 1)
        }, 5000)
    }
  }
  async askpass(owner) {
    await mkdir(this.directory, { recursive: true })
    const token = randomBytes(32).toString("hex")
    const pipe =
      process.platform === "win32"
        ? `\\\\.\\pipe\\envoi-ssh-${randomUUID()}`
        : path.join(this.directory, `ask-${randomUUID()}.sock`)
    const sockets = new Set()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
      socket.on("error", () => {})
      socket.setEncoding("utf8")
      let data = "",
        handled = false
      socket.on("data", (chunk) => {
        if (handled) return
        data += chunk
        if (data.length > 8192) {
          socket.destroy()
          return
        }
        if (!data.includes("\n")) return
        handled = true
        try {
          const request = JSON.parse(data)
          if (request.token !== token || typeof request.prompt !== "string") {
            socket.destroy()
            return
          }
          const id = randomUUID()
          const timer = setTimeout(() => {
            this.prompts.delete(id)
            socket.destroy()
          }, 120000)
          this.prompts.set(id, {
            owner,
            answer: (answer) => {
              clearTimeout(timer)
              socket.end(JSON.stringify({ answer }) + "\n")
            },
          })
          socket.on("close", () => {
            clearTimeout(timer)
            this.prompts.delete(id)
          })
          this.send(owner, "envoi:remote-event", { type: "prompt", id, prompt: request.prompt })
        } catch {
          socket.destroy()
        }
      })
    })
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(pipe, resolve)
    })
    const script = path.join(
      this.directory,
      process.platform === "win32" ? "askpass.cmd" : "askpass.sh",
    )
    const helper = path.join(this.binaryDirectory, "remote-askpass.cjs")
    const command =
      process.platform === "win32"
        ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${this.executable}" "${helper}" %*\r\n`
        : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(this.executable)} ${quote(helper)} "$@"\n`
    await writeFile(script, command, { mode: 0o700 })
    await chmod(script, 0o700)
    return {
      env: {
        SSH_ASKPASS: script,
        SSH_ASKPASS_REQUIRE: "force",
        ENVOI_ASKPASS_PIPE: pipe,
        ENVOI_ASKPASS_TOKEN: token,
      },
      dispose() {
        for (const socket of sockets) socket.destroy()
        server.close()
      },
    }
  }
  answer(owner, id, answer) {
    const prompt = this.prompts.get(id)
    if (!prompt || prompt.owner !== owner || typeof answer !== "string" || answer.length > 4096)
      throw Error("SSH prompt expired")
    this.prompts.delete(id)
    prompt.answer(answer)
  }
  get(owner, root) {
    const entry = this.entries.get(`${owner}:${root}`)
    if (!entry || entry.state !== "connected")
      throw Error(
        "Workspace connection is disconnected; drafts are preserved. Reconnect before saving.",
      )
    return entry
  }
  async call(owner, root, method, args = []) {
    return this.get(owner, root).peer.call(method, args, method === "compile" ? 600000 : 60000)
  }
  disconnect(owner, root) {
    const closing = []
    for (const entry of this.entries.values()) {
      if (entry.owner !== owner || (root && entry.root !== root)) continue
      entry.intentional = true
      entry.controller?.abort(Error("Connection cancelled"))
      clearTimeout(entry.retry)
      clearInterval(entry.heartbeat)
      const peer = entry.peer,
        child = entry.child
      this.state(entry, "disconnected")
      const close = () => {
        peer?.close()
        child?.kill()
      }
      closing.push(
        peer && !peer.closed
          ? peer
              .call("release", [], 1000)
              .catch(() => {})
              .finally(close)
          : Promise.resolve().then(close),
      )
    }
    return Promise.all(closing)
  }
}
