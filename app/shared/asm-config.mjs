/** @returns {{march: string, abi: string, includeDirs: string[], defines: string[]}} */
export const defaultAsmConfig = () => ({
  march: "rv64gc",
  abi: "lp64d",
  includeDirs: [],
  defines: [],
})
export function validateAsmConfig(value) {
  if (!value || !/^rv(?:32|64)[a-z0-9_]{1,150}$/.test(value.march))
    throw Error("Invalid RISC-V ISA string")
  if (
    !["ilp32", "ilp32f", "ilp32d", "ilp32e", "lp64", "lp64f", "lp64d", "lp64e"].includes(value.abi)
  )
    throw Error("Invalid RISC-V ABI")
  if (
    (value.march.startsWith("rv32") && !value.abi.startsWith("ilp32")) ||
    (value.march.startsWith("rv64") && !value.abi.startsWith("lp64"))
  )
    throw Error("RISC-V ISA width and ABI do not match")
  const result = { march: value.march, abi: value.abi, includeDirs: [], defines: [] }
  for (const key of ["includeDirs", "defines"]) {
    if (!Array.isArray(value[key]) || value[key].length > 1000) throw Error(`Invalid ASM ${key}`)
    result[key] = value[key]
      .map((item) => {
        if (typeof item !== "string" || item.length > 4096 || /[\r\n\0]/.test(item))
          throw Error(`Invalid ASM ${key}`)
        return item.trim()
      })
      .filter(Boolean)
  }
  for (const item of result.defines)
    if (!/^[a-zA-Z_]\w*(?:=.*)?$/.test(item)) throw Error("Invalid ASM macro definition")
  return result
}
