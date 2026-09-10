import { readFileSync, realpathSync, accessSync, constants, readdirSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { homedir, release, machine } from "node:os"
import path from "node:path"
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
      path.join(root, "MiKTeX", "miktex", "bin", "x64"),
      path.join(root, "Programs", "MiKTeX", "miktex", "bin", "x64"),
    ])
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
    fallback = ["/opt/homebrew/bin", "/Library/TeX/texbin", "/usr/local/bin", "/usr/bin"]
  else fallback = ["/usr/local/bin", "/usr/bin", "/bin"]
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
export function environmentInfo() {
  return {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    machine: machine(),
    node: process.versions.node,
  }
}
function probeTool(name, args = ["--version"]) {
  const executable = detectTool(name)
  if (!executable) return { available: false, path: "", error: `${name} not found` }
  try {
    return {
      available: true,
      path: executable,
      version: execFileSync(executable, args, {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 100000,
        stdio: ["ignore", "pipe", "pipe"],
      })
        .trim()
        .split(/\r?\n/)[0],
    }
  } catch (error) {
    return { available: false, path: executable, error: error.message }
  }
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
export function toolInfo() {
  const configured = config().chktexPath
  let chktex = {
    available: false,
    path: chktexPath() ?? "",
    configured: !!configured,
    error: "未找到 ChkTeX",
  }
  try {
    const executable = validateChktexPath(chktex.path)
    chktex = { ...chktex, available: true, path: executable, error: "" }
  } catch (error) {
    chktex.error = error.message
  }
  const texlab = detectTool("texlab")
  return {
    system: environmentInfo(),
    git: probeTool("git"),
    biber: probeTool("biber"),
    chktex,
    texlab: { available: !!texlab, path: texlab ?? "", integrationAvailable: false },
    configurationScope: "local-user",
  }
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
  return toolInfo()
}
const paperSearchPath = path.join(homedir(), ".config/envoi/paper-search.json")
// 在线论文检索的用户级配置：个人 API Key 与联系邮箱（polite pool）。
// 独立文件存放，避免 configureTools 重写 tools.json 时丢失。
export function paperSearchConfig(file = paperSearchPath) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"))
    return {
      semanticScholarKey:
        typeof value.semanticScholarKey === "string" ? value.semanticScholarKey : "",
      contactEmail: typeof value.contactEmail === "string" ? value.contactEmail : "",
    }
  } catch {
    return { semanticScholarKey: "", contactEmail: "" }
  }
}
export async function configurePaperSearch(input, file = paperSearchPath) {
  if (
    !input ||
    Object.keys(input).some((key) => !["semanticScholarKey", "contactEmail"].includes(key))
  )
    throw Error("Unsupported paper search configuration")
  const key = String(input.semanticScholarKey ?? "").trim(),
    email = String(input.contactEmail ?? "").trim()
  if (key && !/^[\w-]{1,200}$/.test(key)) throw Error("Semantic Scholar API Key 格式无效")
  if (email && !/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,100}$/.test(email))
    throw Error("联系邮箱格式无效")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({ semanticScholarKey: key, contactEmail: email }, null, 2) + "\n",
    { mode: 0o600 },
  )
  return paperSearchConfig(file)
}
