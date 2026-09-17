import { spawn } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { detectTool, pythonEnvironment } from "../../server/tool-config.mjs"
import { lspServersByLanguage, toolCatalog } from "../../server/tool-registry.mjs"

// 服务器回退链由 tool-registry.mjs 的目录派生：kind 为 lsp 的条目按目录顺序排优先级。
const servers = lspServersByLanguage()
const extensionLanguage = {
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".rs": "rust",
  ".py": "python",
  ".pyi": "python",
  ".pyw": "python",
  ".cmake": "cmake",
  ".mk": "make",
  ".mak": "make",
  ".meson": "meson",
  ".toml": "toml",
}
export function lspLanguage(file) {
  if (/\.[CH]$/.test(file)) return "cpp"
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
function executable(root, language, preferredServer) {
  const preferred = preferredServer
    ? toolCatalog.find(
        (tool) =>
          tool.id === preferredServer && tool.kind === "lsp" && tool.languages?.includes(language),
      )
    : undefined
  if (preferredServer && !preferred) return undefined
  const candidates = preferred
    ? [[preferred.binary, ...(preferred.args ?? [])]]
    : (servers[language] ?? [])
  for (const [name, ...args] of candidates) {
    const local =
      language === "python" && pythonEnvironment(root)
        ? path.join(
            pythonEnvironment(root),
            process.platform === "win32" ? "Scripts" : "bin",
            process.platform === "win32" ? `${name}.exe` : name,
          )
        : ""
    const command =
      local && existsSync(local) && statSync(local).isFile() ? local : detectTool(name)
    if (command) return { command, args, name }
  }
}
function within(root, file) {
  const relative = path.relative(root, file)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function position(text, offset) {
  const prefix = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = prefix.split("\n")
  return { line: lines.length - 1, character: lines.at(-1).length }
}

export class LspService {
  constructor(publish = () => {}, resolve = executable) {
    this.sessions = new Map()
    this.publish = publish
    this.resolve = resolve
  }
  key(owner, root, language) {
    return `${owner}\0${root}\0${language}`
  }
  async open(owner, root, file, text, token, preferredServer) {
    const language = lspLanguage(file)
    if (!language) return { available: false, error: "No language server for this file" }
    if (typeof text !== "string" || Buffer.byteLength(text) > 5_000_000)
      throw Error("Source file exceeds the language server limit")
    const target = path.resolve(root, file)
    const existing = existsSync(target) ? realpathSync(target) : realpathSync(path.dirname(target))
    if (!within(path.resolve(root), target) || !within(realpathSync(root), existing))
      throw Error("Invalid source path")
    const spec = this.resolve(root, language, preferredServer)
    if (!spec) return { available: false, error: `No ${language} language server found` }
    const key = this.key(owner, root, language)
    let session = this.sessions.get(key)
    if (session && (session.spec.name !== spec.name || session.spec.command !== spec.command)) {
      session.docs.clear()
      session.stop()
      this.sessions.delete(key)
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
          if (this.sessions.get(key) === session) this.sessions.delete(key)
        },
      )
      this.sessions.set(key, session)
      session.ready = session.start()
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
  }
  change(owner, root, file, text) {
    const session = this.sessions.get(this.key(owner, root, lspLanguage(file)))
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
    const session = this.sessions.get(this.key(owner, root, lspLanguage(file)))
    const doc = session?.docs.get(file)
    if (!doc || typeof text !== "string" || text !== doc.text) return null
    return session.request(method, {
      textDocument: { uri: doc.uri },
      position: position(text, offset),
    })
  }
  close(owner, root, file, token) {
    const key = this.key(owner, root, lspLanguage(file))
    const session = this.sessions.get(key)
    const doc = session?.docs.get(file)
    if (!doc || doc.token !== token) return
    session.notify("textDocument/didClose", { textDocument: { uri: doc.uri } })
    session.docs.delete(file)
    if (!session.docs.size) {
      session.stop()
      this.sessions.delete(key)
    }
  }
  dispose(owner, root) {
    for (const [key, session] of this.sessions)
      if (key.startsWith(`${owner}\0`) && (!root || key.startsWith(`${owner}\0${root}\0`))) {
        session.stop()
        this.sessions.delete(key)
      }
  }
}

class Session {
  constructor(spec, root, language, publish, onExit) {
    this.spec = spec
    this.root = root
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
    this.process = spawn(this.spec.command, this.spec.args, {
      cwd: this.root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        ...(process.platform === "win32" ? { PYTHONIOENCODING: "utf-8" } : {}),
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
      rootUri: pathToFileURL(this.root).href,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: false } },
          hover: {},
          definition: {},
          publishDiagnostics: {},
        },
      },
      workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
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
          result: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
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
