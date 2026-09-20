import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  probeCandidates,
  probeLanguageServerPath,
  pythonEnvironment,
} from "../../server/tool-config.mjs"
import { lspServersByLanguage, toolCatalog } from "../../server/tool-registry.mjs"
import { pluginForLanguage, pluginLanguageForPath } from "../../server/plugin-registry.mjs"
import { PluginHost } from "../../server/plugin-host.mjs"
import { createLocalWorkspaceEnvironment } from "./workspace-environment.mjs"
import { leanProjectRoot, leanServerSpec } from "./lean-project.mjs"
import { installedServer } from "./lsp-installer.mjs"

// 服务器回退链由 tool-registry.mjs 的目录派生：kind 为 lsp 的条目按目录顺序排优先级。
const servers = lspServersByLanguage()
const extensionLanguage = {
  ".cmake": "cmake",
  ".mk": "make",
  ".mak": "make",
  ".meson": "meson",
  ".toml": "toml",
}
export function lspLanguage(file) {
  const contributed = pluginLanguageForPath(file)
  if (contributed) return contributed
  const name = path.basename(file).toLowerCase()
  if (name === "cmakelists.txt") return "cmake"
  if (["makefile", "gnumakefile"].includes(name)) return "make"
  if (["meson.build", "meson.options", "meson_options.txt"].includes(name)) return "meson"
  return extensionLanguage[path.extname(name)]
}

// 服务器可能规范化 URI(rust-analyzer 在 Windows 上把盘符转小写),匹配前先解码并统一大小写。
function uriKey(uri) {
  try {
    const file = fileURLToPath(uri)
    return process.platform === "win32" ? path.normalize(file).toLowerCase() : file
  } catch {
    return null
  }
}
const discovered = new Map()
async function executable(root, language, preferredServer, preferredPath, managedDirectory) {
  if (managedDirectory) {
    const managed = await installedServer(managedDirectory, language, preferredServer)
    // 面板会把托管安装的路径写回偏好;该路径指向托管目录时仍按托管安装启动
    // (Pyright 需以 node 运行 langserver.index.js,逐字校验会误判为不匹配)。
    if (managed && (!preferredPath || managed.path === preferredPath)) return managed
  }
  const preferred = preferredServer
    ? toolCatalog.find(
        (tool) =>
          tool.id === preferredServer && tool.kind === "lsp" && tool.languages?.includes(language),
      )
    : undefined
  if (preferredServer && !preferred) return undefined
  if (preferredPath && preferred) {
    try {
      const selected = await probeLanguageServerPath(preferred.id, preferredPath)
      return {
        command: selected.path,
        args: preferred.args ?? [],
        name: preferred.binary,
      }
    } catch {
      return undefined
    }
  }
  const candidates = preferred
    ? [[preferred.binary, ...(preferred.args ?? [])]]
    : (servers[language] ?? [])
  for (const [name, ...args] of candidates) {
    const key = `${root}\0${name}\0${process.env.PATH ?? ""}`
    let detected = discovered.get(key)
    if (!detected) {
      detected = probeCandidates(name, language === "python" ? root : undefined)
      discovered.set(key, detected)
    }
    const command = (await detected)[0]?.path
    if (!command) discovered.delete(key)
    if (command) return { command, args, name }
  }
}
function within(root, file) {
  const relative = path.relative(root, file)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function localDefinition(root, location) {
  try {
    const target = fileURLToPath(location?.targetUri ?? location?.uri)
    const canonicalRoot = realpathSync(root)
    const canonicalTarget = realpathSync(target)
    if (!within(canonicalRoot, canonicalTarget)) return null
    const position = location?.targetSelectionRange?.start ?? location?.range?.start
    if (!Number.isInteger(position?.line) || !Number.isInteger(position?.character)) return null
    return {
      path: path.relative(canonicalRoot, canonicalTarget).split(path.sep).join("/"),
      position,
    }
  } catch {
    return null
  }
}
function position(text, offset) {
  const prefix = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = prefix.split("\n")
  return { line: lines.length - 1, character: lines.at(-1).length }
}

export class LspService {
  constructor(
    publish = () => {},
    resolve = executable,
    managedDirectory,
    publishStatus = () => {},
  ) {
    this.sessions = new Map()
    this.opening = new Set()
    this.preferences = {}
    this.preferencesRevision = -1
    this.plugins = new PluginHost()
    this.publish = publish
    this.publishStatus = publishStatus
    this.resolve = async (root, language, preferredServer, preferredPath, file) => {
      const spec = await resolve(
        root,
        language,
        preferredServer,
        preferredPath,
        typeof managedDirectory === "function" ? managedDirectory() : managedDirectory,
      )
      return spec && language === "lean" ? leanServerSpec(spec, root, file) : spec
    }
  }
  enabled(root, language) {
    const id = pluginForLanguage(language)?.id
    return (
      !id ||
      (this.preferences.pluginWorkspaces?.[root]?.[id] ??
        this.preferences.pluginStates?.[id] ??
        true) !== false
    )
  }
  configurePreferences(value, revision) {
    if (!Number.isSafeInteger(revision) || revision < this.preferencesRevision) return
    this.preferences = value ?? {}
    this.preferencesRevision = revision
    for (const pending of this.opening)
      if (!this.enabled(pending.root, pending.language)) pending.cancelled = true
    for (const [key, session] of this.sessions) {
      if (this.enabled(session.root, session.language)) continue
      this.sessions.delete(key)
      session.stop()
      const id = pluginForLanguage(session.language)?.id
      if (id) void this.plugins.deactivate(id, key)
    }
  }
  key(owner, root, language, file) {
    const project = language === "lean" ? `\0${leanProjectRoot(root, file)}` : ""
    return `${owner}\0${root}\0${language}${project}`
  }
  async open(owner, root, file, text, token, preferredServer, preferredPath) {
    const language = lspLanguage(file)
    if (!this.enabled(root, language))
      return { available: false, error: "Language extension is disabled" }
    if (!language) return { available: false, error: "No language server for this file" }
    if (typeof text !== "string" || Buffer.byteLength(text) > 5_000_000)
      throw Error("Source file exceeds the language server limit")
    const target = path.resolve(root, file)
    const existing = existsSync(target) ? realpathSync(target) : realpathSync(path.dirname(target))
    if (!within(path.resolve(root), target) || !within(realpathSync(root), existing))
      throw Error("Invalid source path")
    for (const pending of this.opening)
      if (pending.owner === owner && pending.root === root && pending.file === file)
        pending.cancelled = true
    const request = { owner, root, file, token, language, cancelled: false }
    this.opening.add(request)
    try {
      const spec = await this.resolve(root, language, preferredServer, preferredPath, file)
      if (request.cancelled)
        return { available: false, error: "Language server activation cancelled" }
      if (!spec) return { available: false, error: `No ${language} language server found` }
      const key = this.key(owner, root, language, file)
      const pluginId = pluginForLanguage(language)?.id
      let session = this.sessions.get(key)
      if (session && (session.spec.name !== spec.name || session.spec.command !== spec.command)) {
        session.docs.clear()
        session.stop()
        this.sessions.delete(key)
        if (pluginId) void this.plugins.deactivate(pluginId, key)
        session = undefined
      }
      if (!session) {
        session = new Session(
          spec,
          root,
          language,
          (uri, diagnostics, version) => {
            const key = uriKey(uri)
            const doc = [...session.docs.values()].find((item) => item.uriKey === key)
            if (doc && (version === undefined || version === doc.version))
              this.publish(owner, { root, path: doc.path, diagnostics })
          },
          () => {
            if (this.sessions.get(key) === session) {
              for (const doc of session.docs.values()) {
                this.publish(owner, { root, path: doc.path, diagnostics: [] })
                this.publishStatus(owner, {
                  root,
                  path: doc.path,
                  token: doc.token,
                  state: "failed",
                })
              }
              this.sessions.delete(key)
              if (pluginId) void this.plugins.deactivate(pluginId, key)
            }
          },
        )
        this.sessions.set(key, session)
        session.ready = pluginId
          ? this.plugins.activate(pluginId, key, async (context) => {
              context.add(() => session.stop())
              await session.start()
            })
          : session.start()
      }
      try {
        await session.ready
      } catch (error) {
        if (this.sessions.get(key) === session) {
          this.sessions.delete(key)
          session.stop()
        }
        throw error
      }
      if (request.cancelled || this.sessions.get(key) !== session) {
        if (
          this.sessions.get(key) === session &&
          !session.docs.size &&
          ![...this.opening].some(
            (other) =>
              other !== request &&
              !other.cancelled &&
              other.owner === owner &&
              other.root === root &&
              other.language === language,
          )
        ) {
          session.stop()
          this.sessions.delete(key)
          if (pluginId) void this.plugins.deactivate(pluginId, key)
        }
        return { available: false, error: "Language server activation cancelled" }
      }
      const uri = pathToFileURL(target).href
      const previous = session.docs.get(file)
      if (previous) session.notify("textDocument/didClose", { textDocument: { uri } })
      session.docs.set(file, { path: file, uri, uriKey: uriKey(uri), text, version: 1, token })
      session.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: language === "make" ? "makefile" : language,
          version: 1,
          text,
        },
      })
      return { available: true, server: spec.name }
    } finally {
      this.opening.delete(request)
    }
  }

  documentSession(owner, root, file) {
    // Project markers may change while documents are open; retain their original session.
    const prefix = `${owner}\0${root}\0`
    return [...this.sessions].find(
      ([key, session]) => key.startsWith(prefix) && session.docs.has(file),
    )
  }
  change(owner, root, file, text) {
    const session = this.documentSession(owner, root, file)?.[1]
    const doc = session?.docs.get(file)
    if (!doc || typeof text !== "string" || Buffer.byteLength(text) > 5_000_000) return
    doc.text = text
    doc.version++
    session.notify("textDocument/didChange", {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text }],
    })
  }
  async query(owner, root, file, method, offset, text) {
    if (
      !["textDocument/completion", "textDocument/hover", "textDocument/definition"].includes(method)
    )
      return null
    const session = this.documentSession(owner, root, file)?.[1]
    const doc = session?.docs.get(file)
    if (!doc || typeof text !== "string" || Buffer.byteLength(text) > 5_000_000) return null
    // Editor updates and feature requests travel over separate IPC calls. A request can
    // arrive first, so synchronize its snapshot before asking the server to analyze it.
    if (text !== doc.text) this.change(owner, root, file, text)
    const result = await session.request(method, {
      textDocument: { uri: doc.uri },
      position: position(text, offset),
    })
    if (method !== "textDocument/definition") return result
    return (Array.isArray(result) ? result : [result])
      .map((location) => localDefinition(root, location))
      .filter(Boolean)
  }
  close(owner, root, file, token) {
    for (const pending of this.opening)
      if (
        pending.owner === owner &&
        pending.root === root &&
        pending.file === file &&
        pending.token === token
      )
        pending.cancelled = true
    const [key, session] = this.documentSession(owner, root, file) ?? []
    const doc = session?.docs.get(file)
    if (!doc || doc.token !== token) return
    session.notify("textDocument/didClose", { textDocument: { uri: doc.uri } })
    session.docs.delete(file)
    if (!session.docs.size) {
      session.stop()
      this.sessions.delete(key)
      const pluginId = pluginForLanguage(lspLanguage(file))?.id
      if (pluginId) void this.plugins.deactivate(pluginId, key)
    }
  }
  dispose(owner, root) {
    for (const pending of this.opening)
      if (pending.owner === owner && (!root || pending.root === root)) pending.cancelled = true
    for (const [key, session] of this.sessions)
      if (key.startsWith(`${owner}\0`) && (!root || key.startsWith(`${owner}\0${root}\0`))) {
        session.stop()
        this.sessions.delete(key)
        const pluginId = pluginForLanguage(session.language)?.id
        if (pluginId) void this.plugins.deactivate(pluginId, key)
      }
  }
}

class Session {
  constructor(spec, root, language, publish, onExit) {
    this.spec = spec
    this.root = root
    this.environment = createLocalWorkspaceEnvironment(root)
    this.language = language
    this.publish = publish
    this.onExit = onExit
    this.docs = new Map()
    this.pending = new Map()
    this.id = 0
    this.buffer = Buffer.alloc(0)
  }
  async start() {
    const venv = this.language === "python" ? pythonEnvironment(this.root) : undefined
    this.process = this.environment.process.spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd ?? this.root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        ...(process.platform === "win32" ? { PYTHONIOENCODING: "utf-8" } : {}),
        ...(this.spec.env ?? {}),
        ...(venv
          ? {
              VIRTUAL_ENV: venv,
              PATH: `${path.join(venv, process.platform === "win32" ? "Scripts" : "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
            }
          : {}),
      },
    })
    this.process.stdout.on("data", (chunk) => this.read(chunk))
    this.process.stdin.on("error", (error) => {
      if (!this.stopping) this.fail(error)
    })
    this.process.on("error", (error) => this.fail(error))
    this.process.on("exit", () => this.fail(Error(`${this.spec.name} stopped`)))
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.spec.cwd ?? this.root).href,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          // 渲染进程按 TextMate 模板展开 snippet(占位符 Tab 跳转),可安全声明支持。
          completion: { completionItem: { snippetSupport: true } },
          hover: {},
          definition: {},
          publishDiagnostics: {},
        },
      },
      workspaceFolders: [
        { uri: pathToFileURL(this.spec.cwd ?? this.root).href, name: path.basename(this.root) },
      ],
    })
    this.notify("initialized", {})
  }
  send(message) {
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    this.process.stdin.write(`Content-Length: ${bytes.length}\r\n\r\n`)
    this.process.stdin.write(bytes)
  }
  notify(method, params) {
    this.send({ method, params })
  }
  request(method, params) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(Error(`${method} timed out`))
        },
        method === "initialize" ? 30000 : 10000,
      )
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const end = this.buffer.indexOf("\r\n\r\n")
      if (end < 0) break
      const match = this.buffer
        .subarray(0, end)
        .toString()
        .match(/(?:^|\r\n)Content-Length:\s*(\d+)/i)
      const length = Number(match?.[1])
      if (!length || length > 8_000_000) {
        this.fail(Error("Invalid LSP message"))
        return
      }
      if (this.buffer.length < end + 4 + length) break
      const body = this.buffer.subarray(end + 4, end + 4 + length)
      this.buffer = this.buffer.subarray(end + 4 + length)
      try {
        this.message(JSON.parse(body.toString("utf8")))
      } catch {
        /* malformed server message */
      }
    }
    if (this.buffer.length > 8_100_000) this.fail(Error("LSP response too large"))
  }
  message(value) {
    if (value.id !== undefined && value.method) {
      if (value.method === "workspace/configuration")
        this.send({ id: value.id, result: (value.params?.items ?? []).map(() => ({})) })
      else if (value.method === "workspace/workspaceFolders")
        this.send({
          id: value.id,
          result: [
            { uri: pathToFileURL(this.spec.cwd ?? this.root).href, name: path.basename(this.root) },
          ],
        })
      else if (
        [
          "window/workDoneProgress/create",
          "window/showMessageRequest",
          "client/registerCapability",
          "client/unregisterCapability",
        ].includes(value.method)
      )
        this.send({ id: value.id, result: null })
      else this.send({ id: value.id, error: { code: -32601, message: "Method not found" } })
      return
    }
    if (value.id !== undefined) {
      const pending = this.pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      if (value.error) pending.reject(Error(value.error.message ?? "Language server error"))
      else pending.resolve(value.result)
    } else if (value.method === "textDocument/publishDiagnostics")
      this.publish(value.params?.uri, value.params?.diagnostics ?? [], value.params?.version)
  }
  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.stop()
    this.onExit()
  }
  stop() {
    this.stopping = true
    this.process?.kill()
  }
}
