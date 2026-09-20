import reference from "./opcodes.json" with { type: "json" }

export const instructionNames = new Set(Object.keys(reference.instructions))
export const csrNames = new Set(reference.csrs.map((entry) => entry.name))
const integerAliases =
  "zero ra sp gp tp t0 t1 t2 s0 s1 a0 a1 a2 a3 a4 a5 a6 a7 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 t3 t4 t5 t6".split(
    " ",
  )
const floatAliases =
  "ft0 ft1 ft2 ft3 ft4 ft5 ft6 ft7 fs0 fs1 fa0 fa1 fa2 fa3 fa4 fa5 fa6 fa7 fs2 fs3 fs4 fs5 fs6 fs7 fs8 fs9 fs10 fs11 ft8 ft9 ft10 ft11".split(
    " ",
  )
export const registers = new Map([
  ...integerAliases.flatMap((name, index) => [
    [name, `x${index} (${name})`],
    [`x${index}`, `x${index} (${name})`],
  ]),
  ["fp", "x8 (s0 / fp)"],
  ...floatAliases.flatMap((name, index) => [
    [name, `f${index} (${name})`],
    [`f${index}`, `f${index} (${name})`],
  ]),
  ...Array.from({ length: 32 }, (_, index) => [
    `v${index}`,
    `Vector register v${index}; requires V or an applicable vector extension`,
  ]),
])
const pseudo = {
  li: "Load an immediate; expansion depends on XLEN and the value.",
  la: "Load a symbol address; expansion depends on PIC mode and relocations.",
  lla: "Load a local symbol address.",
  lga: "Load a global symbol address via the GOT.",
  call: "Call a function; relocation and linker relaxation determine the final sequence.",
  tail: "Tail-call a function.",
  ret: "Return through ra (jalr x0, 0(ra)).",
  nop: "No operation (addi x0, x0, 0).",
  mv: "Copy a register (addi rd, rs, 0).",
}
const descriptions = {
  add: "Add two integer registers; keep the low XLEN bits.",
  addi: "Add a sign-extended 12-bit immediate to an integer register.",
  sub: "Subtract the second source register from the first; keep the low XLEN bits.",
  lui: "Load an upper immediate; the low 12 bits are zero.",
  auipc: "Add an upper immediate to this instruction's PC.",
  jal: "PC-relative jump and link; rd receives the return address.",
  jalr: "Jump to rs1 plus a sign-extended immediate, clearing target bit zero; rd receives the return address.",
  ecall:
    "Raise an environment-call exception. The cause and handler depend on the current privilege and execution environment.",
  ebreak: "Request a breakpoint trap or debug entry, depending on debug configuration.",
  mret: "Return from a machine-level trap using the saved machine exception PC and privilege/status state.",
  sret: "Return from a supervisor-level trap. Status and virtualization state determine the return mode and PC.",
  wfi: "Wait for an interrupt. Implementations may resume for other reasons; privilege/status controls can cause a trap.",
  "sfence.vma":
    "Synchronize local supervisor address translation with page-table updates. Operands select an address and ASID; this is not a remote-hart shootdown.",
  "hfence.vvma":
    "Synchronize local VS-stage address translation for the selected virtual address and ASID; requires the hypervisor extension.",
  "hfence.gvma":
    "Synchronize local G-stage address translation for the selected guest physical address (encoded shifted right by two) and VMID; requires the hypervisor extension.",
  csrrw: "Atomically exchange a CSR with rs1. A zero destination suppresses the CSR read.",
  csrrs: "Read a CSR and set bits selected by rs1. Using x0 as rs1 suppresses the write.",
  csrrc: "Read a CSR and clear bits selected by rs1. Using x0 as rs1 suppresses the write.",
  fence:
    "Order selected memory and I/O operations on this hart as defined by the execution environment and memory model.",
  "fence.i": "Synchronize this hart's instruction fetches with earlier stores; requires Zifencei.",
  "vadd.vv":
    "Element-wise integer vector addition. Active elements and masking depend on vector state and the instruction operands.",
}
const directives =
  ".text .data .bss .rodata .section .pushsection .popsection .globl .global .local .weak .hidden .type .size .align .balign .p2align .byte .half .word .dword .quad .zero .space .ascii .asciz .string .equ .set .option .attribute .insn .include .incbin .macro .endm .if .ifdef .ifndef .else .endif .rept .endr .cfi_startproc .cfi_endproc".split(
    " ",
  )
export const referenceInfo = {
  revision: reference.revision,
  instructions: instructionNames.size,
  csrs: csrNames.size,
}

// Preserve offsets while removing literals/comments. Preprocessor directives remain
// visible for #define lookup, but are never treated as instruction operands.
export function assemblyCode(text) {
  return text.replace(
    /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|#[^\n]*/g,
    (value, at) => {
      if (
        value.startsWith("#") &&
        /^\s*$/.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at)) &&
        /^#\s*(?:define|include|if|ifdef|ifndef|elif|else|endif|undef|pragma|line|error|warning)\b/.test(
          value,
        )
      )
        return value
      return value.replace(/[^\n\r]/g, " ")
    },
  )
}
export function assemblySymbols(text) {
  const code = assemblyCode(text),
    symbols = []
  const pattern =
    /(^|\n)[ \t]*(?:([\w.$]+):|\.(?:equ|equiv|set|macro)\s+([\w.$]+)|#\s*define\s+([\w]+))/g
  for (const match of code.matchAll(pattern)) {
    const name = match[2] ?? match[3] ?? match[4]
    symbols.push({
      name,
      offset: match.index + match[0].lastIndexOf(name),
      macro: !!match[3] || !!match[4],
    })
  }
  return symbols
}
function wordAt(text, at) {
  const left = text.slice(0, at).match(/[\w.$]+$/)?.[0] ?? ""
  const right = text.slice(at).match(/^[\w.$]*/)?.[0] ?? ""
  return { word: left + right, from: at - left.length }
}
export function riscvHover(word) {
  if (registers.has(word)) return `RISC-V register: ${registers.get(word)}`
  const csrs = reference.csrs.filter((entry) => entry.name === word)
  if (csrs.length)
    return csrs
      .map((entry) => {
        const address = Number(entry.address)
        const access = address >> 10 === 3 ? "read-only encoding" : "read/write encoding"
        const privilege = ["U", "S", "hypervisor/virtual-supervisor access rules", "M"][
          (address >> 8) & 3
        ]
        return `CSR ${word} = ${entry.address}${entry.rv32Only ? " (RV32 only)" : ""}\n${access}; CSR privilege encoding: ${privilege}.\nActual access also depends on enabled extensions, virtualization and control bits.\nRISC-V Privileged Architecture: https://docs.riscv.org/reference/isa/priv/priv-index.html`
      })
      .join("\n\n")
  const base = word.replace(/\.(?:aqrl|aq|rl)$/, "")
  const variants = Object.hasOwn(reference.instructions, base) ? reference.instructions[base] : null
  if (variants)
    return `${word}\n${descriptions[base] ?? pseudo[word] ?? ""}\n${variants.map((entry) => `${entry.extension}${entry.unratified ? " [UNRATIFIED]" : ""}${entry.pseudo ? " [encoding alias]" : ""}\nEncoding fields: ${entry.operands.join(", ") || "none"}\n${reference.repository}/blob/${reference.revision}/${entry.source}`).join("\n\n")}\n\nEncoding fields are not assembler operand syntax. ISA availability is checked by the configured assembler.`
  if (Object.hasOwn(pseudo, word))
    return `${word}: ${pseudo[word]}\nhttps://github.com/riscv-non-isa/riscv-asm-manual`
  if (directives.includes(word))
    return `${word}: GNU-style assembler directive.\nhttps://github.com/riscv-non-isa/riscv-asm-manual`
  return null
}
export function queryRiscv(file, text, method, at) {
  const code = assemblyCode(text)
  const { word, from } = wordAt(code, at)
  if (method === "textDocument/hover") {
    const value = riscvHover(word)
    return value ? { contents: { kind: "plaintext", value } } : null
  }
  if (method === "textDocument/definition") {
    const symbols = assemblySymbols(text)
    const numeric = word.match(/^(\d+)([fb])$/)
    const matches = symbols.filter((symbol) => symbol.name === (numeric?.[1] ?? word))
    const target = numeric
      ? numeric[2] === "f"
        ? matches.find((symbol) => symbol.offset > from)
        : matches.findLast((symbol) => symbol.offset < from)
      : matches[0]
    if (!target) return null
    const prefix = text.slice(0, target.offset).split("\n")
    return [{ path: file, position: { line: prefix.length - 1, character: prefix.at(-1).length } }]
  }
  if (method !== "textDocument/completion") return null
  const lineStart = text.lastIndexOf("\n", at - 1) + 1
  if (text.slice(lineStart, at) !== code.slice(lineStart, at)) return null
  if (text.slice(from, at) !== code.slice(from, at) || (/\S/.test(text.slice(at, at + 1)) && !word))
    return null
  const prefix = code.slice(from, at)
  const items = [
    ...assemblySymbols(text).map((symbol) => ({
      label: symbol.name,
      kind: 6,
      detail: "Local assembly symbol",
    })),
    ...[
      ...registers.keys(),
      ...csrNames,
      ...instructionNames,
      ...Object.keys(pseudo),
      ...directives,
    ]
      .filter((label) => label.startsWith(prefix))
      .slice(0, 200)
      .map((label) => ({
        label,
        kind: 14,
        detail: csrNames.has(label)
          ? "RISC-V CSR"
          : registers.has(label)
            ? "RISC-V register"
            : "RISC-V",
        documentation: riscvHover(label) ?? "",
      })),
  ]
  return [
    ...new Map(
      items.filter((item) => item.label.startsWith(prefix)).map((item) => [item.label, item]),
    ).values(),
  ].slice(0, 200)
}
export function formatRiscv(text) {
  let macro = 0,
    block = false,
    continued = false
  return text
    .split(/(\r?\n)/)
    .map((line, index) => {
      if (index % 2) return line
      const wasContinued = continued
      continued = /\\\s*$/.test(line)
      const wasBlock = block
      if (line.includes("/*")) block = true
      if (line.includes("*/")) block = false
      if (/^\s*\.(?:macro|rept|irp|irpc)\b/.test(line)) macro++
      if (/^\s*\.(?:endm|endr)\b/.test(line)) {
        macro = Math.max(0, macro - 1)
        return line
      }
      if (
        macro ||
        block ||
        wasBlock ||
        wasContinued ||
        continued ||
        /["';\\]/.test(line) ||
        line.includes("/*")
      )
        return line
      const match = line.match(/^\s*([a-z][\w.]*)(\s.*)?$/)
      if (
        !match ||
        (!instructionNames.has(match[1].replace(/\.(?:aqrl|aq|rl)$/, "")) &&
          !Object.hasOwn(pseudo, match[1]))
      )
        return line
      return `    ${match[1]}${match[2] ? " " + match[2].trimStart() : ""}`
    })
    .join("")
}
