// Native directory paths differ from the project's slash-separated relative files.
export function nativeBasename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}
export function nativePathKey(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "")
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized
}
export function nativePathWithin(value: string, root: string) {
  const candidate = nativePathKey(value),
    base = nativePathKey(root)
  return candidate === base || candidate.startsWith(base + "/")
}
