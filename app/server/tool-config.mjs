import {
  readFileSync,
  realpathSync,
  accessSync,
  constants,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { execFile, execFileSync } from "node:child_process"
import { homedir, release, machine } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { toolCatalog, toolGroups } from "./tool-registry.mjs"
const configPath = path.join(homedir(), ".config/envoi/tools.json"),
  legacyConfigPath = path.join(homedir(), ".config/paperdesk/tools.json")
function config() {
  for (const file of [configPath, legacyConfigPath])
    try {
      return JSON.parse(readFileSync(file, "utf8"))
    } catch {
      /* try legacy location */
    }
  return {}
}
export function executableName(name) {
  return process.platform === "win32" && !path.extname(name) ? `${name}.exe` : name
}
export function toolDirectories() {
  const env = process.env
  const explicit = env.ENVOI_TEX_BIN ?? env.PAPERDESK_TEX_BIN
  const inherited = (env.PATH ?? "").split(path.delimiter)
  let fallback = []
  if (process.platform === "win32") {
    const programRoots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(
      Boolean,
    )
    fallback = programRoots.flatMap((root) => [
      path.join(root, "Git", "cmd"),
      path.join(root, "Programs", "Git", "cmd"),
      path.join(root, "LLVM", "bin"),
      path.join(root, "CMake", "bin"),
      path.join(root, "Programs", "CMake", "bin"),
      path.join(root, "MiKTeX", "miktex", "bin", "x64"),
      path.join(root, "Programs", "MiKTeX", "miktex", "bin", "x64"),
    ])
    fallback.push(path.join(homedir(), ".cargo", "bin"), path.join(homedir(), ".local", "bin"))
    const texRoot = path.join(env.SystemDrive ?? "C:", "texlive")
    try {
      fallback.push(
        ...readdirSync(texRoot)
          .filter((year) => /^\d{4}$/.test(year))
          .sort()
          .reverse()
          .flatMap((year) => [
            path.join(texRoot, year, "bin", "windows"),
            path.join(texRoot, year, "bin", "win32"),
          ]),
      )
    } catch {
      /* Optional installation directory. */
    }
  } else if (process.platform === "darwin")
    fallback = [
      "/opt/homebrew/bin",
      "/Library/TeX/texbin",
      "/usr/local/bin",
      "/usr/bin",
      path.join(homedir(), ".cargo", "bin"),
      path.join(homedir(), ".local", "bin"),
    ]
  else
    fallback = [
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      path.join(homedir(), ".cargo", "bin"),
      path.join(homedir(), ".local", "bin"),
    ]
  return [
    ...new Set(
      [explicit, ...inherited, ...fallback]
        .filter(Boolean)
        .map((prefix) => prefix.replace(/^"(.*)"$/, "$1"))
        .filter((prefix) => path.isAbsolute(prefix)),
    ),
  ]
}
export function detectTool(name) {
  return toolDirectories()
    .map((prefix) => path.join(prefix, executableName(name)))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK)
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    })
}
export function toolCandidates(name, root) {
  const local = pythonEnvironment(root)
  const prefixes = [
    ...(local ? [path.join(local, process.platform === "win32" ? "Scripts" : "bin")] : []),
    ...toolDirectories(),
  ]
  const seen = new Set()
  return prefixes.flatMap((prefix) => {
    const exact = executableName(name)
    const suffix = process.platform === "win32" ? "\\.exe" : ""
    const pattern = new RegExp(
      `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d+(?:\\.\\d+)*${name === "python" ? "|3(?:\\.\\d+)?" : ""})${suffix}$`,
      process.platform === "win32" ? "i" : "",
    )
    let names = name === "python" ? [exact, executableName("python3")] : [exact]
    try {
      names = [...names, ...readdirSync(prefix).filter((entry) => pattern.test(entry))]
    } catch {
      /* path may not exist */
    }
    return names.flatMap((entry) => {
      const candidate = path.join(prefix, entry)
      try {
        accessSync(candidate, constants.X_OK)
        if (!statSync(candidate).isFile()) return []
        const resolved = realpathSync(candidate)
        if (seen.has(resolved)) return []
        seen.add(resolved)
        return [candidate]
      } catch {
        return []
      }
    })
  })
}
export function validateToolPath(id, value) {
  const tool = toolCatalog.find((entry) => entry.id === id)
  if (
    !tool ||
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw Error("Invalid tool path")
  const actual =
    process.platform === "win32" ? path.basename(value).toLowerCase() : path.basename(value)
  const expected = executableName(tool.binary ?? tool.binaries?.[0])
  const base = process.platform === "win32" ? expected.slice(0, -4) : expected
  const pattern = new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d+(?:\\.\\d+)*${base === "python" ? "|3(?:\\.\\d+)?" : ""})?${process.platform === "win32" ? "\\.exe" : ""}$`,
  )
  if (!pattern.test(actual)) throw Error("Selected executable does not match the tool")
  accessSync(value, constants.X_OK)
  if (!statSync(value).isFile()) throw Error("Invalid tool executable")
  return value
}
export function validateLanguageServerPath(id, value) {
  if (!toolCatalog.some((entry) => entry.id === id && entry.kind === "lsp"))
    throw Error("Unknown language server")
  return validateToolPath(id, value)
}
async function executableVersion(executable) {
  try {
    const { stdout, stderr } = await executeFile(executable, ["--version"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 20000,
    })
    return (stdout || stderr).trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}
function versionParts(value) {
  return (value?.match(/\d+(?:\.\d+)+/)?.[0] ?? "").split(".").filter(Boolean).map(Number)
}
export function compareVersions(a, b) {
  const left = versionParts(a),
    right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return difference
  }
  return 0
}
export async function probeCandidates(name, root) {
  const candidates = await Promise.all(
    toolCandidates(name, root).map(async (path) => ({
      path,
      version: await executableVersion(path),
    })),
  )
  return candidates
    .filter(
      (candidate) =>
        !["rust-analyzer", "rustfmt", "cargo-clippy"].includes(name) || candidate.version,
    )
    .sort((a, b) => compareVersions(b.version, a.version))
}
export async function probeLanguageServerPath(id, value) {
  const resolved = validateLanguageServerPath(id, value)
  const version = await executableVersion(resolved)
  if (id === "rustAnalyzer" && !version)
    throw Error("rust-analyzer is not installed in this Rust toolchain")
  return { path: resolved, version }
}
export async function probeToolPath(id, value) {
  const resolved = validateToolPath(id, value)
  const tool = toolCatalog.find((entry) => entry.id === id)
  if (!hasCompanions(tool, resolved)) throw Error("Toolchain companion executable is missing")
  const version = await executableVersion(resolved)
  if (["rustfmt", "clippy"].includes(id) && !version)
    throw Error("The selected Rust component is not installed")
  return { path: resolved, version }
}
// 项目级 Python 环境：以 pyvenv.cfg 为凭据识别项目根下的 .venv/venv 目录。
// LSP 启动（lsp-service）与设置页展示（backend tools）共用这一份实现。
export function pythonEnvironment(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) return undefined
  return [".venv", "venv"]
    .map((name) => path.join(root, name))
    .find((folder) => existsSync(path.join(folder, "pyvenv.cfg")))
}
export function environmentInfo() {
  return {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    machine: machine(),
    node: process.versions.node,
  }
}
const executeFile = promisify(execFile)
// 导出供测试直接构造工具链探测；生产路径由 probeCatalog 调用。
export async function probeVersion(tool, args = ["--version"]) {
  const binaries = tool.binaries ?? [tool.binary]
  const paths = binaries.map((binary) => detectTool(binary))
  const missing = binaries.filter((_, index) => !paths[index])
  if (missing.length)
    return { available: false, path: "", error: `${missing.join(", ")} not found` }
  try {
    const { stdout } = await executeFile(paths[0], args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 100000,
    })
    return { available: true, path: paths[0], version: stdout.trim().split(/\r?\n/)[0] }
  } catch (error) {
    return { available: false, path: paths[0], error: error.message }
  }
}
async function probePresence(binary, root) {
  const candidates = await probeCandidates(binary, root)
  if (candidates.length)
    return { available: true, path: candidates[0].path, version: candidates[0].version, candidates }
  return { available: false, path: "", candidates: [], error: `${binary} not found` }
}
async function probeVersionCandidates(tool, root) {
  const binaries = tool.binaries ?? [tool.binary]
  const candidates = await probeCandidates(binaries[0], root)
  const complete = candidates.filter(({ path: executable }) => hasCompanions(tool, executable))
  return complete.length
    ? {
        available: true,
        path: complete[0].path,
        version: complete[0].version,
        candidates: complete,
      }
    : { available: false, path: "", candidates: [] }
}
function hasCompanions(tool, executable) {
  const binaries = tool.binaries ?? [tool.binary]
  const suffix = path
    .basename(executable)
    .slice(binaries[0].length, process.platform === "win32" ? -4 : undefined)
  return binaries.slice(1).every((binary) => {
    const companion = path.join(path.dirname(executable), executableName(binary + suffix))
    try {
      accessSync(companion, constants.X_OK)
      return statSync(companion).isFile()
    } catch {
      return false
    }
  })
}
function probeChktex() {
  const configured = config().chktexPath
  let status = {
    available: false,
    path: chktexPath() ?? "",
    configured: !!configured,
    error: "未找到 ChkTeX",
  }
  try {
    const executable = validateChktexPath(status.path)
    status = { ...status, available: true, path: executable, error: "" }
  } catch (error) {
    status.error = error.message
  }
  return status
}
async function probeCatalog(root) {
  const probed = new Map()
  await Promise.all(
    toolCatalog.map(async (tool) => {
      const status =
        tool.probe === "version"
          ? await (tool.kind === "lsp" || ["cpp", "python", "rust"].includes(tool.group)
              ? probeVersionCandidates(tool, tool.group === "python" ? root : undefined)
              : probeVersion(tool))
          : tool.probe === "presence"
            ? await probePresence(
                tool.binary,
                tool.kind === "lsp" && tool.group === "python" ? root : undefined,
              )
            : probeChktex()
      probed.set(tool.id, { ...tool, ...status })
    }),
  )
  const groups = Object.fromEntries(toolGroups.map((group) => [group, []]))
  for (const tool of toolCatalog) groups[tool.group].push(probed.get(tool.id))
  return { system: environmentInfo(), groups, configurationScope: "local-user" }
}
// 探测结果按进程缓存；设置页“重新检测”与保存 ChkTeX 配置时显式失效。
let cachedInfo
export function toolInfo({ refresh = false, root } = {}) {
  if (root) return probeCatalog(root)
  if (refresh) cachedInfo = undefined
  return (cachedInfo ??= probeCatalog())
}
export function chktexPath() {
  return config().chktexPath ?? detectTool("chktex")
}
export function validateChktexPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000-\u001f]/u.test(value))
    throw Error("请输入 ChkTeX 可执行文件的绝对路径，不支持命令或参数。")
  const resolved = realpathSync(value)
  if (
    (process.platform === "win32"
      ? path.basename(resolved).toLowerCase()
      : path.basename(resolved)) !== executableName("chktex")
  )
    throw Error("所选程序不是 chktex 可执行文件。")
  accessSync(resolved, constants.X_OK)
  const version = execFileSync(resolved, ["-W"], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 20000,
  })
  if (!/ChkTeX v\d/.test(version)) throw Error("程序未通过 ChkTeX 版本校验。")
  return resolved
}
export async function configureTools(input) {
  if (
    !input ||
    !Object.hasOwn(input, "chktexPath") ||
    Object.keys(input).some((key) => key !== "chktexPath")
  )
    throw Error("Unsupported tool configuration")
  const selected = input.chktexPath === null ? null : validateChktexPath(input.chktexPath)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ chktexPath: selected }, null, 2) + "\n", {
    mode: 0o600,
  })
  return toolInfo({ refresh: true })
}
const paperSearchPath = path.join(homedir(), ".config/envoi/paper-search.json")
const paperSearchSources = ["openalex", "semanticscholar", "crossref", "arxiv"]
const defaultSourceWeights = () =>
  Object.fromEntries(paperSearchSources.map((source) => [source, 1]))
const sourceWeights = (value, strict = false) => {
  const weights = defaultSourceWeights()
  if (value == null) return weights
  if (typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw Error("来源权重格式无效")
    return weights
  }
  if (strict && Object.keys(value).some((source) => !paperSearchSources.includes(source)))
    throw Error("来源权重包含未知检索来源")
  for (const source of paperSearchSources) {
    const weight = value[source]
    if (weight == null) continue
    if (!Number.isInteger(weight) || weight < 0 || weight > 3) {
      if (strict) throw Error("来源权重必须是 0 到 3 的整数")
      continue
    }
    weights[source] = weight
  }
  return weights
}
// 在线论文检索的用户级配置：个人 API Key 与联系邮箱（polite pool）。
// 独立文件存放，避免 configureTools 重写 tools.json 时丢失。
export function paperSearchConfig(file = paperSearchPath) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"))
    return {
      semanticScholarKey:
        typeof value.semanticScholarKey === "string" ? value.semanticScholarKey : "",
      contactEmail: typeof value.contactEmail === "string" ? value.contactEmail : "",
      sourceWeights: sourceWeights(value.sourceWeights),
    }
  } catch {
    return { semanticScholarKey: "", contactEmail: "", sourceWeights: defaultSourceWeights() }
  }
}
export async function configurePaperSearch(input, file = paperSearchPath) {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["semanticScholarKey", "contactEmail", "sourceWeights"].includes(key),
    )
  )
    throw Error("Unsupported paper search configuration")
  const key = String(input.semanticScholarKey ?? "").trim(),
    email = String(input.contactEmail ?? "").trim()
  if (key && !/^[\w-]{1,200}$/.test(key)) throw Error("Semantic Scholar API Key 格式无效")
  if (email && !/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,100}$/.test(email))
    throw Error("联系邮箱格式无效")
  const weights = sourceWeights(input.sourceWeights, true)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify(
      { semanticScholarKey: key, contactEmail: email, sourceWeights: weights },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  )
  return paperSearchConfig(file)
}
