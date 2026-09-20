import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { probeCandidates, validateToolPath } from "../../server/tool-config.mjs"
import { runToolProcess } from "./tool-process.mjs"

export function rtlDiagnostics(output, source) {
  return output.split(/\r?\n/).flatMap((line) => {
    let match
    if (source === "Verible" && (match = line.match(/^(.+?):(\d+):(\d+)(?:-\d+)?:\s*(.*)$/)))
      return [
        {
          path: match[1],
          line: +match[2],
          column: +match[3],
          message: match[4],
          severity: /syntax error/i.test(match[4]) ? "error" : "warning",
          source,
        },
      ]
    if (
      source === "Verilator" &&
      (match = line.match(/^%(Warning|Error)(?:-([\w-]+))?:\s*(.+?):(\d+)(?::(\d+))?:\s*(.*)$/))
    )
      return [
        {
          path: match[3],
          line: +match[4],
          column: +(match[5] ?? 1),
          message: (match[2] ? `${match[2]}: ` : "") + match[6],
          severity: match[1] === "Error" ? "error" : "warning",
          source,
        },
      ]
    if (
      source === "Vivado" &&
      (match = line.match(/^(ERROR|WARNING):\s*(.*)\s+\[(.+?):(\d+)(?::(\d+))?\]\s*$/))
    )
      return [
        {
          path: match[3],
          line: +match[4],
          column: +(match[5] ?? 1),
          message: match[2],
          severity: match[1] === "ERROR" ? "error" : "warning",
          source,
        },
      ]
    return []
  })
}
async function nearestRules(root, file, name) {
  let directory = path.dirname(file)
  while (directory === root || directory.startsWith(root + path.sep)) {
    const candidate = path.join(directory, name)
    try {
      await readFile(candidate)
      return candidate
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    if (directory === root) break
    directory = path.dirname(directory)
  }
}
export async function runVeribleTool(root, file, text, kind, selectedPath, { signal } = {}) {
  const absolute = path.resolve(root, file)
  if (!absolute.startsWith(root + path.sep)) throw Error("File is outside the project")
  const actualParent = await realpath(path.dirname(absolute))
  if (actualParent !== root && !actualParent.startsWith(root + path.sep))
    throw Error("File is outside the project")
  const format = kind === "format"
  const binary = format ? "verible-verilog-format" : "verible-verilog-lint"
  const command = selectedPath
    ? validateToolPath(format ? "veribleFormat" : "veribleLint", selectedPath)
    : (await probeCandidates(binary))[0]?.path
  if (!command) throw Error("Verible is not installed")
  const rules = await nearestRules(
    root,
    absolute,
    format ? ".rules.verible_format" : ".rules.verible_lint",
  )
  const args = rules ? [format ? `--flagfile=${rules}` : `--rules_config=${rules}`] : []
  let temporary
  try {
    if (format) args.push(`--stdin_name=${absolute}`, "-")
    else {
      temporary = await mkdtemp(path.join(tmpdir(), "envoi-verible-"))
      const snapshot = path.join(temporary, path.basename(absolute))
      await writeFile(snapshot, text)
      args.push(snapshot)
    }
    const result = await runToolProcess(command, args, {
      input: format ? text : "",
      cwd: root,
      signal,
    })
    if (format) {
      if (result.code !== 0) throw Error(result.stderr.trim() || "Verible formatting failed")
      return { text: result.stdout, tool: "Verible" }
    }
    const diagnostics = rtlDiagnostics(result.stdout + "\n" + result.stderr, "Verible").map(
      (issue) => {
        const line = text.split("\n")[issue.line - 1] ?? ""
        const prefix = Buffer.from(line)
          .subarray(0, issue.column - 1)
          .toString("utf8")
        return { ...issue, path: file, column: prefix.length + 1 }
      },
    )
    if (result.code !== 0 && !diagnostics.length)
      throw Error(result.stderr.trim() || result.stdout.trim() || "Verible lint failed")
    return { diagnostics, tool: "Verible" }
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}

// Vivado's Windows launchers are batch files. Only fixed argument vectors reach cmd;
// reject expansion/metacharacters rather than allowing command-line interpretation.
export function rtlCommand(command, args, platform = process.platform) {
  if (platform !== "win32" || !/\.(bat|cmd)$/i.test(command)) return { command, args }
  const quote = (value) => {
    if (/["%!^&|<>\r\n\0]/.test(value))
      throw Error("Vivado batch arguments contain unsupported shell characters")
    return `"${value}"`
  }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`],
    windowsVerbatimArguments: true,
  }
}
export function runRtlCommand(command, args, options) {
  const spec = rtlCommand(command, args)
  return runToolProcess(spec.command, spec.args, {
    ...options,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  })
}
