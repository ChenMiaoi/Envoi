const extensions: Record<string, string> = {
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  "h++": "cpp",
  rs: "rust",
  py: "python",
  pyi: "python",
  pyw: "python",
  cmake: "cmake",
  mk: "make",
  mak: "make",
  meson: "meson",
  toml: "toml",
}

export function lspLanguageForPath(path: string) {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ""
  if (name === "cmakelists.txt") return "cmake"
  if (name === "makefile" || name === "gnumakefile") return "make"
  if (name === "meson.build" || name === "meson.options" || name === "meson_options.txt")
    return "meson"
  if (/\.[CH]$/.test(path)) return "cpp"
  return extensions[name.split(".").at(-1) ?? ""]
}
