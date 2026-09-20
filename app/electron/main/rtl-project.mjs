import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { detectTool, validateToolPath } from "../../server/tool-config.mjs"
import {
  flagQuote,
  loadRtlConfiguration,
  resolveRtlFiles,
  saveRtlConfiguration,
} from "./rtl-config.mjs"
import { importVivadoProject, runVivadoCheck } from "./rtl-vivado.mjs"
import { rtlDiagnostics, runRtlCommand } from "./rtl-tools.mjs"

const running = new Set()
export async function rtlProjectRequest(root, input, { signal } = {}) {
  root = await realpath(root)
  signal?.throwIfAborted()
  if (!input || !["load", "save", "check", "importVivado"].includes(input.action))
    throw Error("Invalid RTL project request")
  if (input.action === "load") return { configuration: await loadRtlConfiguration(root) }
  if (running.has(root)) throw Error("An RTL project operation is already running")
  running.add(root)
  try {
    if (input.action === "save")
      return await saveRtlConfiguration(root, input.configuration, { signal })
    if (input.action === "importVivado")
      return await importVivadoProject(root, input.projectFile, input.toolPath, { signal })
    if (!["verilator", "vivado"].includes(input.tool)) throw Error("Unsupported RTL checker")
    const config = await resolveRtlFiles(root, await loadRtlConfiguration(root), { signal })
    if (!config.files.length || !config.top)
      throw Error("Configure source files and a top module before checking the RTL project")
    const directory = await mkdtemp(path.join(tmpdir(), "envoi-rtl-check-"))
    try {
      let result
      if (input.tool === "vivado")
        result = await runVivadoCheck(root, config, input.toolPath, directory, { signal })
      else {
        const command = input.toolPath
          ? validateToolPath("verilator", input.toolPath)
          : detectTool("verilator")
        if (!command) throw Error("Verilator is not installed")
        if (new Set(Object.values(config.libraries)).size > 1)
          throw Error("This project uses multiple HDL libraries; use the Vivado checker")
        const files = config.files.filter((file) => !/\.(vh|svh)$/i.test(file))
        const filelist = path.join(directory, "verilator.f")
        await writeFile(
          filelist,
          [
            ...config.includeDirs.map((value) => `-I${flagQuote(value)}`),
            ...config.defines.map((value) => `-D${JSON.stringify(value)}`),
            ...config.parameters.map((value) => `-G${JSON.stringify(value)}`),
            ...files.map(flagQuote),
          ].join("\n") + "\n",
        )
        result = await runRtlCommand(
          command,
          ["--lint-only", "-Wall", "-Wno-fatal", "--top-module", config.top, "-f", filelist],
          { cwd: directory, timeout: 120000, signal },
        )
      }
      const log = result.stdout + "\n" + result.stderr
      const diagnostics = rtlDiagnostics(log, input.tool === "vivado" ? "Vivado" : "Verilator").map(
        (issue) => {
          const absolute = path.resolve(directory, issue.path)
          const relative = path.relative(root, absolute)
          return {
            ...issue,
            path: (!relative.startsWith("..") && !path.isAbsolute(relative)
              ? relative
              : absolute
            ).replaceAll("\\", "/"),
          }
        },
      )
      return {
        ok: result.code === 0 && !diagnostics.some((issue) => issue.severity === "error"),
        diagnostics,
        log,
        files: config.files.length,
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } finally {
    running.delete(root)
  }
}
