import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectTool, executableName, validateToolPath } from "../../server/tool-config.mjs"
import { emptyRtlConfiguration, validateRtlConfiguration } from "./rtl-config.mjs"
import { runRtlCommand } from "./rtl-tools.mjs"

export const vivadoExportScript = `proc enc {value} { return [binary encode base64 -maxlen 0 [encoding convertto utf-8 $value]] }
if {[catch {
  open_project -read_only [lindex $argv 0]
  set projectDir [get_property DIRECTORY [current_project]]
  set fs [current_fileset]
  update_compile_order -fileset $fs
  puts "ENVOI_RTL\\ttop\\t[enc [get_property TOP $fs]]"
  foreach value [get_property INCLUDE_DIRS $fs] { puts "ENVOI_RTL\\tinclude\\t[enc [file normalize [file join $projectDir $value]]]" }
  foreach value [get_property VERILOG_DEFINE $fs] { puts "ENVOI_RTL\\tdefine\\t[enc $value]" }
  foreach value [get_property GENERIC $fs] { puts "ENVOI_RTL\\tparameter\\t[enc $value]" }
  foreach f [get_files -compile_order sources -used_in synthesis] {
    set type [get_property FILE_TYPE $f]
    if {$type in {Verilog SystemVerilog {Verilog Header} {SystemVerilog Header}}} {
      puts "ENVOI_RTL\\tfile\\t[enc [file normalize [file join $projectDir $f]]]\\t[enc [get_property LIBRARY $f]]\\t[enc $type]"
    } elseif {[string match -nocase *vhdl* $type]} { error "VHDL sources require a separate VHDL workflow" }
  }
  close_project
} message]} { puts stderr $message; exit 1 }
exit 0
`
export function parseVivadoExport(root, output) {
  const config = emptyRtlConfiguration()
  const portable = (value) => {
    const relative = path.relative(root, value)
    return (
      relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : value
    ).replaceAll("\\", "/")
  }
  for (const row of output.split(/\r?\n/)) {
    if (!row.startsWith("ENVOI_RTL\t")) continue
    const [, type, ...fields] = row.split("\t")
    const [value, library, fileType] = fields.map((item) =>
      Buffer.from(item, "base64").toString("utf8"),
    )
    if (type === "top") config.top = value
    else if (type === "include") config.includeDirs.push(portable(value))
    else if (type === "define") config.defines.push(value)
    else if (type === "parameter") config.parameters.push(value)
    else if (type === "file") {
      const file = portable(value)
      config.files.push(file)
      if (library) config.libraries[file] = library
      if (fileType?.includes("Header")) config.includeDirs.push(portable(path.dirname(value)))
      if (fileType === "SystemVerilog") config.systemVerilogFiles.push(file)
    }
  }
  if (!config.files.length)
    throw Error(
      "Vivado exported no Verilog/SystemVerilog sources; generate the IP sources in Vivado first",
    )
  return validateRtlConfiguration(config)
}
export async function importVivadoProject(root, projectFile, toolPath, { signal } = {}) {
  if (typeof projectFile !== "string" || !/\.xpr$/i.test(projectFile))
    throw Error("Select a Vivado .xpr project")
  const project = await realpath(path.resolve(root, projectFile))
  if (!(await stat(project)).isFile()) throw Error("Vivado project was not found")
  const command = toolPath ? validateToolPath("vivado", toolPath) : detectTool("vivado")
  if (!command) throw Error("Vivado is not installed")
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-vivado-import-"))
  try {
    const script = path.join(directory, "export.tcl")
    await writeFile(script, vivadoExportScript)
    const result = await runRtlCommand(
      command,
      ["-mode", "batch", "-nojournal", "-nolog", "-source", script, "-tclargs", project],
      { cwd: directory, timeout: 180000, signal },
    )
    const log = result.stdout + "\n" + result.stderr
    if (result.code !== 0) throw Error(log.trim() || "Vivado project import failed")
    return { configuration: parseVivadoExport(root, log), log }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
export function vivadoParserPath(selected) {
  if (selected && /^vivado(?:\.|$)/i.test(path.basename(selected)))
    return path.join(path.dirname(validateToolPath("vivado", selected)), executableName("xvlog"))
  return selected ? validateToolPath("xvlog", selected) : detectTool("xvlog")
}
export async function runVivadoCheck(root, config, toolPath, directory, { signal } = {}) {
  const command = vivadoParserPath(toolPath)
  if (!command) throw Error("Vivado xvlog is not installed")
  const toAbsoluteMap = (values) =>
    Object.fromEntries(
      Object.entries(values).map(([file, value]) => [path.resolve(root, file), value]),
    )
  const libraries = toAbsoluteMap(config.libraries)
  const systemVerilog = new Set(config.systemVerilogFiles.map((file) => path.resolve(root, file)))
  const sources = config.files.filter((file) => !/\.(vh|svh)$/i.test(file))
  const project = sources
    .map((file) => {
      if (/["\r\n]/.test(file)) throw Error("Invalid Vivado source filename")
      return `${/\.sv$/i.test(file) || systemVerilog.has(file) ? "sv" : "verilog"} ${libraries[file] || "xil_defaultlib"} "${file.replaceAll("\\", "/")}"`
    })
    .join("\n")
  const prj = path.join(directory, "sources.prj")
  await writeFile(prj, project + "\n")
  const args = [
    "-prj",
    prj,
    ...config.includeDirs.flatMap((value) => ["-i", value]),
    ...config.defines.flatMap((value) => ["-d", value]),
  ]
  const parsed = await runRtlCommand(command, args, { cwd: directory, timeout: 120000, signal })
  if (parsed.code !== 0) return parsed
  const xelab = path.join(path.dirname(command), executableName("xelab"))
  if (!(await stat(xelab)).isFile()) throw Error("Vivado xelab is missing next to xvlog")
  const libraryNames = [...new Set(["xil_defaultlib", ...Object.values(config.libraries)])]
  const compiled = await runRtlCommand(
    xelab,
    [
      ...libraryNames.flatMap((value) => ["-L", value]),
      "-L",
      "unisims_ver",
      "-L",
      "unimacro_ver",
      "-L",
      "secureip",
      config.top,
      "-s",
      "envoi_rtl_check",
      ...config.parameters.flatMap((value) => ["-generic_top", value]),
    ],
    { cwd: directory, timeout: 120000, signal },
  )
  // Keep both stages so parser warnings remain visible after successful elaboration.
  return {
    code: compiled.code,
    stdout: parsed.stdout + "\n" + compiled.stdout,
    stderr: parsed.stderr + "\n" + compiled.stderr,
  }
}
