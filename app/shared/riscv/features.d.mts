export const instructionNames: Set<string>
export const csrNames: Set<string>
export const registers: Map<string, string>
export const referenceInfo: { revision: string; instructions: number; csrs: number }
export function assemblyCode(text: string): string
export function assemblySymbols(text: string): { name: string; offset: number; macro: boolean }[]
export function riscvHover(word: string): string | null
export function formatRiscv(text: string): string
export function queryRiscv(
  file: string,
  text: string,
  method: string,
  at: number,
):
  | { contents: { kind: string; value: string } }
  | { path: string; position: { line: number; character: number } }[]
  | { label: string; kind: number; detail: string; documentation?: string }[]
  | null
