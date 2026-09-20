// 文件类型图标:映射到 vendored 的 material-icon-theme SVG(src/assets/file-icons/,MIT,见 LICENSE)。
// 未覆盖的类型返回 undefined,由调用方回退到 lucide 通用图标。
const modules = import.meta.glob<string>("../assets/file-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
})
const icons = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url]),
)

const byFileName: Record<string, string> = {
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  "meson.build": "meson",
  "meson_options.txt": "meson",
}
const byExtension: Record<string, string> = {
  c: "c",
  h: "h",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hh: "hpp",
  hpp: "hpp",
  hxx: "hpp",
  "h++": "hpp",
  py: "python",
  pyi: "python",
  pyw: "python",
  rs: "rust",
  lean: "lean",
  s: "assembly",
  asm: "assembly",
  riscv: "assembly",
  v: "verilog",
  vh: "verilog",
  sv: "verilog",
  svh: "verilog",
  cmake: "cmake",
  mk: "makefile",
  mak: "makefile",
  meson: "meson",
  toml: "toml",
  tex: "tex",
  md: "markdown",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  csv: "table",
  tsv: "table",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  sh: "console",
  bash: "console",
  zsh: "console",
  ini: "settings",
  cfg: "settings",
  conf: "settings",
}

export function fileIconUrl(name: string): string | undefined {
  const lower = name.toLowerCase()
  const special = byFileName[lower]
  if (special) return icons[special]
  const dot = lower.lastIndexOf(".")
  if (dot < 1) return undefined
  const icon = byExtension[lower.slice(dot + 1)]
  return icon ? icons[icon] : undefined
}
