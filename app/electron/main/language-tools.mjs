import { runVeribleTool } from "./rtl-tools.mjs"
import { leanProjectRoot } from "./lean-project.mjs"
import { runToolProcess } from "./tool-process.mjs"
import { cp, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pluginLanguageForPath } from "../../server/plugin-registry.mjs"
import { toolCatalog } from "../../server/tool-registry.mjs"
import { probeCandidates, validateToolPath } from "../../server/tool-config.mjs"

const maxSourceBytes = 5_000_000
const maxOutputBytes = 3_000_000
const maxSnapshotBytes = 50_000_000
const maxSnapshotFiles = 2_000
const ignoredSnapshotDirectories = new Set([
  ".git",
  ".envoi",
  ".venv",
  "node_modules",
  "target",
  "build",
  "dist",
])

async function snapshotWorkspace(root, file, text, directory, signal) {
  const workspace = path.join(directory, "workspace")
  let bytes = 0
  let files = 0
  await cp(root, workspace, {
    recursive: true,
    filter: async (source) => {
      signal?.throwIfAborted()
      if (source === root) return true
      const info = await lstat(source)
      if (info.isSymbolicLink()) return false
      if (info.isDirectory()) return !ignoredSnapshotDirectories.has(path.basename(source))
      if (!info.isFile()) return false
      bytes += info.size
      files++
      if (bytes > maxSnapshotBytes || files > maxSnapshotFiles)
        throw Error("Rust project is too large for live Clippy checks")
      return true
    },
  })
  const relative = path.relative(root, file)
  const snapshot = path.join(workspace, relative)
  await writeFile(snapshot, text)
  return { workspace, snapshot }
}

async function nearestProjectFile(root, file, name) {
  let directory = path.dirname(file)
  while (inside(root, directory)) {
    try {
      return { directory, text: await readFile(path.join(directory, name), "utf8") }
    } catch {
      /* Keep searching toward the workspace root */
    }
    directory = path.dirname(directory)
  }
  try {
    return { directory: root, text: await readFile(path.join(root, name), "utf8") }
  } catch {
    return null
  }
}

function inside(root, file) {
  const relative = path.relative(root, file)
  return (
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function ruffDiagnostics(output) {
  const entries = JSON.parse(output || "[]")
  if (!Array.isArray(entries)) throw Error("Invalid Ruff diagnostics")
  return entries.map((item) => ({
    line: item.location?.row ?? 1,
    column: item.location?.column ?? 1,
    message: `${item.code}: ${item.message}`,
    severity: "warning",
    source: "Ruff",
  }))
}

function clangDiagnostics(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(.+?):(\d+):(\d+): (warning|error): (.+?)(?: \[([^\]]+)\])?$/)
    return match
      ? [
          {
            line: Number(match[2]),
            column: Number(match[3]),
            message: match[5],
            severity: match[4],
            source: match[6] ?? "clang-tidy",
          },
        ]
      : []
  })
}

function clippyDiagnostics(output, root, file) {
  return output.split(/\r?\n/).flatMap((line) => {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      return []
    }
    if (entry.reason !== "compiler-message") return []
    const message = entry.message
    if (!["warning", "error"].includes(message?.level)) return []
    const span = message.spans?.find(
      (item) => item.is_primary && path.resolve(root, item.file_name) === file,
    )
    return span
      ? [
          {
            line: span.line_start,
            column: span.column_start,
            message: message.message,
            severity: message.level,
            source: message.code?.code ?? "Clippy",
          },
        ]
      : []
  })
}

export async function runLanguageTool(root, file, text, kind, selectedPath, { signal } = {}) {
  signal?.throwIfAborted()
  root = await realpath(root)
  const language = pluginLanguageForPath(file)
  if (
    !language ||
    !["format", "lint"].includes(kind) ||
    typeof text !== "string" ||
    Buffer.byteLength(text) > maxSourceBytes
  )
    throw Error("Unsupported language tool request")
  if (["verilog", "systemverilog"].includes(language))
    return runVeribleTool(root, file, text, kind, selectedPath, { signal })
  const group = language === "c" ? "cpp" : language
  const tool = toolCatalog.find((entry) => entry.group === group && entry.kind === kind)
  if (!tool) throw Error("Language tool is unavailable")
  const absolute = path.resolve(root, file)
  if (!inside(root, absolute)) throw Error("File is outside the project")
  const command = selectedPath
    ? validateToolPath(tool.id, selectedPath)
    : (await probeCandidates(tool.binary, group === "python" ? root : undefined))[0]?.path
  signal?.throwIfAborted()
  if (!command) throw Error(`${tool.label} is not installed`)
  let args
  let input = text
  let cwd = root
  let temporary
  if (kind === "format") {
    if (tool.id === "clangFormat") args = [`--assume-filename=${absolute}`]
    else if (tool.id === "leanFmt") {
      args = ["format", "-"]
      cwd = leanProjectRoot(root, file)
    } else if (tool.id === "ruffFormat") args = ["format", "--stdin-filename", absolute, "-"]
    else {
      let edition = "2021"
      const cargo = await nearestProjectFile(root, absolute, "Cargo.toml")
      edition = cargo?.text.match(/^edition\s*=\s*["'](2015|2018|2021|2024)["']/m)?.[1] ?? edition
      args = ["--emit", "stdout", "--edition", edition]
    }
  } else if (tool.id === "ruffLint")
    args = ["check", "--output-format", "json", "--stdin-filename", absolute, "-"]
  else {
    const actual = await realpath(absolute)
    if (!inside(root, actual)) throw Error("File is outside the project")
    input = ""
    if (tool.id === "clippy") {
      const cargo = await nearestProjectFile(root, absolute, "Cargo.toml")
      if (!cargo) throw Error("Cargo.toml was not found for this Rust file")
      temporary = await mkdtemp(path.join(tmpdir(), "envoi-live-lint-"))
      try {
        const copy = await snapshotWorkspace(root, absolute, text, temporary, signal)
        cwd = path.join(copy.workspace, path.relative(root, cargo.directory))
        file = copy.snapshot
      } catch (error) {
        await rm(temporary, { recursive: true, force: true })
        throw error
      }
    } else {
      temporary = await mkdtemp(path.join(tmpdir(), "envoi-live-lint-"))
      try {
        const snapshot = path.join(temporary, path.basename(absolute))
        await writeFile(snapshot, text)
        const overlay = path.join(temporary, "overlay.json")
        await writeFile(
          overlay,
          JSON.stringify({
            version: 0,
            "use-external-names": false,
            roots: [{ name: absolute, type: "file", "external-contents": snapshot }],
          }),
        )
        args = [absolute, "--quiet", `--vfsoverlay=${overlay}`]
      } catch (error) {
        await rm(temporary, { recursive: true, force: true })
        throw error
      }
    }
    if (tool.id === "clippy") args = ["clippy", "--message-format=json", "--quiet", "--offline"]
  }
  let result
  try {
    result = await runToolProcess(command, args, {
      input,
      cwd,
      timeout: tool.id === "clippy" ? 120_000 : 30_000,
      maxBuffer: maxOutputBytes,
      signal,
    })
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
  if (kind === "format") {
    if (result.code !== 0) throw Error(result.stderr.trim() || `${tool.label} failed`)
    return { text: result.stdout, tool: tool.label }
  }
  if (tool.id === "ruffLint") {
    if (![0, 1].includes(result.code)) throw Error(result.stderr.trim() || "Ruff failed")
    return { diagnostics: ruffDiagnostics(result.stdout), tool: tool.label }
  }
  const diagnostics =
    tool.id === "clangTidy"
      ? clangDiagnostics(result.stdout + "\n" + result.stderr)
      : clippyDiagnostics(result.stdout, cwd, file)
  if (result.code !== 0 && !diagnostics.length)
    throw Error(result.stderr.trim() || `${tool.label} failed`)
  return { diagnostics, tool: tool.label }
}
