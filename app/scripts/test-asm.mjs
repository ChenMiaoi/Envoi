import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, writeFile, mkdir, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  queryRiscv,
  riscvHover,
  formatRiscv,
  instructionNames,
  csrNames,
  assemblySymbols,
} from "../shared/riscv/features.mjs"
import { defaultAsmConfig, validateAsmConfig } from "../shared/asm-config.mjs"
import { pluginLanguageForPath } from "../server/plugin-registry.mjs"
import { installAsset, lspInstallable } from "../electron/main/lsp-installer.mjs"
import { runLanguageTool } from "../electron/main/language-tools.mjs"
import { probeCandidates } from "../server/tool-config.mjs"

test("official index covers base, privileged, hypervisor, vector and additional extensions", () => {
  for (const file of ["boot.S", "entry.s", "test.asm", "entry.riscv"])
    assert.equal(pluginLanguageForPath(file), "asm")
  for (const name of [
    "addi",
    "ecall",
    "mret",
    "sret",
    "wfi",
    "sfence.vma",
    "hfence.gvma",
    "vadd.vv",
    "czero.eqz",
    "aes64es",
  ])
    assert(instructionNames.has(name), name)
  for (const name of ["mstatus", "satp", "hstatus", "vsatp", "vl", "misa"])
    assert(csrNames.has(name), name)
  assert.match(riscvHover("mstatus"), /0x300/)
  assert.match(riscvHover("cycle"), /read-only/)
  assert.match(riscvHover("amoadd.w.aqrl"), /rv_a/)
  assert.equal(lspInstallable("asmLsp", "win32", "x64"), false)
  assert(installAsset("asmLsp", "linux", "x64").matches("asm-lsp-x86_64-unknown-linux-gnu.tar.gz"))
})
test("definitions resolve numeric labels by direction and ignore strings and comments", () => {
  const text =
    '# hidden:\n.ascii "fake:"\n1: nop\n j 1f\n j 1b\n1: ret\n.equ VALUE, 4\n#define MASK 1\n'
  const query = (at) => queryRiscv("boot.S", text, "textDocument/definition", at)
  assert.equal(query(text.indexOf("1f") + 1)[0].position.line, 5)
  assert.equal(query(text.indexOf("1b") + 1)[0].position.line, 2)
  assert.deepEqual(
    assemblySymbols(text).map((entry) => entry.name),
    ["1", "1", "VALUE", "MASK"],
  )
  const completion = queryRiscv("boot.S", "csrr a0, msta", "textDocument/completion", 13)
  assert(completion.some((item) => item.label === "mstatus"))
  assert.equal(queryRiscv("boot.S", "# csrr msta", "textDocument/completion", 11), null)
})
test("formatter preserves strings, macros, continuations, comments, CRLF and idempotence", () => {
  const source =
    '.ascii "a, b; # text"\r\n.macro add_one r\r\n  addi \\r,\\r,1\r\n.endm\r\n/* multi\r\n  addi x1,x1,1\r\n*/\r\n  addi   a0,a0,1 # keep me\r\nlabel: ret\r\nCUSTOM a0, a1'
  const result = formatRiscv(source)
  assert.equal(result, source.replace("  addi   a0,a0,1", "    addi a0,a0,1"))
  assert.equal(formatRiscv(result), result)
  assert.equal(
    formatRiscv("#define CODE \\\n  addi a0,a0,1\n"),
    "#define CODE \\\n  addi a0,a0,1\n",
  )
})
test("configuration rejects incompatible widths and command-like values", () => {
  assert.equal(validateAsmConfig(defaultAsmConfig()).march, "rv64gc")
  assert.throws(
    () => validateAsmConfig({ ...defaultAsmConfig(), march: "rv32imac" }),
    /do not match/,
  )
  assert.throws(
    () => validateAsmConfig({ ...defaultAsmConfig(), march: "rv64gc -o file" }),
    /Invalid/,
  )
  assert.throws(() => validateAsmConfig({ ...defaultAsmConfig(), defines: ["A\nB"] }), /Invalid/)
})

test("ordinary symbol names never resolve through JavaScript object prototypes", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(riscvHover(name), null)
    assert.equal(formatRiscv(`  ${name} a0`), `  ${name} a0`)
    const source = `${name}:\n  j ${name}\n`
    assert.equal(
      queryRiscv("boot.s", source, "textDocument/definition", source.lastIndexOf(name) + 1)[0]
        .position.line,
      0,
    )
  }
})
test("real Clang checks drafts, ISA constraints and uppercase-S preprocessing without writing sources", async (t) => {
  const compiler = (await probeCandidates("clang"))[0]?.path
  if (!compiler) return t.skip("Clang is not installed")
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-asm-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, ".envoi"))
  await writeFile(path.join(root, ".envoi/asm.json"), JSON.stringify(defaultAsmConfig()))
  const source = "#define VALUE 7\n.text\nentry:\n  addi a0,zero,VALUE\n  csrr a1,mstatus\n  mret\n"
  await writeFile(path.join(root, "boot.S"), source)
  const good = await runLanguageTool(root, "boot.S", source, "lint", compiler)
  assert.deepEqual(good.diagnostics, [])
  const bad = await runLanguageTool(
    root,
    "boot.S",
    source.replace("VALUE\n  csrr", "9000\n  csrr"),
    "lint",
    compiler,
  )
  assert(bad.diagnostics.some((item) => item.line === 4 && item.severity === "error"))
  const vector = await runLanguageTool(
    root,
    "boot.s",
    ".text\n vadd.vv v1,v2,v3\n",
    "lint",
    compiler,
  )
  assert(vector.diagnostics.some((item) => /requires|extension/i.test(item.message)))
  assert.equal(await readFile(path.join(root, "boot.S"), "utf8"), source)
  await writeFile(
    path.join(root, ".envoi/asm.json"),
    JSON.stringify({ ...defaultAsmConfig(), march: "rv64i_znotreal" }),
  )
  const invalid = await runLanguageTool(root, "boot.S", source, "lint", compiler)
  assert(
    invalid.diagnostics.some(
      (item) => item.severity === "error" && /invalid|unsupported/i.test(item.message),
    ),
  )
  await writeFile(path.join(root, ".envoi/asm.json"), "{invalid")
  const broken = await runLanguageTool(root, "boot.S", source, "lint", compiler)
  assert.match(broken.diagnostics[0].message, /ASM configuration/)
  await assert.rejects(
    runLanguageTool(root, "../escape.s", source, "format"),
    /outside the project/,
  )
})
