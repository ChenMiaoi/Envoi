import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { defaultAsmConfig, validateAsmConfig } from "../../shared/asm-config.mjs"
import { formatRiscv } from "../../shared/riscv/features.mjs"
import { probeCandidates, validateToolPath } from "../../server/tool-config.mjs"
import { runToolProcess } from "./tool-process.mjs"

export async function readAsmConfig(root) {
  try {
    const file = await realpath(path.join(root, ".envoi/asm.json"))
    if (!file.startsWith(root + path.sep)) throw Error("ASM configuration is outside the project")
    if ((await stat(file)).size > 200000) throw Error("ASM configuration is too large")
    return validateAsmConfig(JSON.parse(await readFile(file, "utf8")))
  } catch (error) {
    if (error.code === "ENOENT") return defaultAsmConfig()
    throw error
  }
}
export async function runAsmTool(root, file, text, kind, selectedPath, { signal } = {}) {
  const parent = await realpath(path.dirname(path.resolve(root, file)))
  if (parent !== root && !parent.startsWith(root + path.sep))
    throw Error("File is outside the project")
  if (kind === "format") return { text: formatRiscv(text), tool: "RISC-V formatter" }
  let config
  try {
    config = await readAsmConfig(root)
  } catch (error) {
    return {
      diagnostics: [
        {
          line: 1,
          column: 1,
          message: `ASM configuration: ${error.message}`,
          severity: "error",
          source: "Clang RISC-V",
        },
      ],
      tool: "Clang RISC-V",
    }
  }
  const command = selectedPath
    ? validateToolPath("asmClang", selectedPath)
    : (await probeCandidates("clang"))[0]?.path
  if (!command) throw Error("Clang with RISC-V target support is not installed")
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-asm-check-"))
  try {
    const result = await runToolProcess(
      command,
      [
        `--target=${config.march.startsWith("rv32") ? "riscv32" : "riscv64"}-unknown-elf`,
        `-march=${config.march}`,
        `-mabi=${config.abi}`,
        "-fno-color-diagnostics",
        "-fno-caret-diagnostics",
        "-x",
        file.endsWith(".S") ? "assembler-with-cpp" : "assembler",
        "-c",
        "-",
        "-o",
        path.join(directory, "check.o"),
        "-I",
        parent,
        "-I",
        root,
        ...config.includeDirs.flatMap((value) => ["-I", path.resolve(root, value)]),
        ...config.defines.map((value) => `-D${value}`),
      ],
      { input: text, cwd: parent, signal },
    )
    const diagnostics = (result.stdout + "\n" + result.stderr).split(/\r?\n/).flatMap((row) => {
      const match = row.match(/^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.+)$/)
      if (!match) return []
      const current = ["<stdin>", "<inline asm>"].includes(match[1])
      const prefix = Buffer.from(text.split("\n")[+match[2] - 1] ?? "")
        .subarray(0, +match[3] - 1)
        .toString("utf8")
      return [
        {
          line: current ? +match[2] : 1,
          column: current ? prefix.length + 1 : 1,
          message: current ? match[5] : `${match[1]}:${match[2]}:${match[3]}: ${match[5]}`,
          severity: match[4] === "warning" ? "warning" : "error",
          source: "Clang RISC-V",
        },
      ]
    })
    if (result.code !== 0 && !diagnostics.length)
      diagnostics.push({
        line: 1,
        column: 1,
        message: result.stderr.trim() || "RISC-V assembly check failed",
        severity: "error",
        source: "Clang RISC-V",
      })
    return { diagnostics, tool: "Clang RISC-V" }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
