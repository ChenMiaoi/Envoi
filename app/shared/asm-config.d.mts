export interface AsmConfiguration {
  march: string
  abi: string
  includeDirs: string[]
  defines: string[]
}
export function defaultAsmConfig(): AsmConfiguration
export function validateAsmConfig(value: unknown): AsmConfiguration
