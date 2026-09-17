// 本机工具注册表：检测探测、LSP 服务启动与设置页展示的唯一事实源。
// 新增工具只需在此追加一条记录；数组顺序即展示顺序，同语言 LSP 的顺序即启动回退优先级。
//
// 字段约定：
// - probe: "version" 运行 `--version` 取首行；"presence" 只检查可执行文件存在；
//   "chktex" 为 tool-config.mjs 中的专用探测。
// - kind: "lsp" 且带 languages 时会被 lspServersByLanguage() 收入启动表。
// - binaries: 成组探测的工具链（如 GCC = gcc + g++），全部存在才算可用，版本取首个。
export const toolGroups = ["core", "latex", "cpp", "python", "rust", "build"]
export const toolCatalog = [
  { id: "git", binary: "git", label: "Git", group: "core", probe: "version" },

  { id: "chktex", binary: "chktex", label: "ChkTeX", group: "latex", probe: "chktex" },
  { id: "biber", binary: "biber", label: "Biber", group: "latex", probe: "version" },
  { id: "texlab", binary: "texlab", label: "texlab", group: "latex", probe: "presence" },

  {
    id: "gcc",
    binaries: ["gcc", "g++"],
    label: "GCC",
    group: "cpp",
    probe: "version",
  },
  {
    id: "clang",
    binaries: ["clang", "clang++"],
    label: "Clang/LLVM",
    group: "cpp",
    probe: "version",
  },
  {
    id: "clangd",
    binary: "clangd",
    label: "clangd",
    group: "cpp",
    kind: "lsp",
    languages: ["c", "cpp"],
    probe: "presence",
  },
  {
    id: "ccls",
    binary: "ccls",
    label: "ccls",
    group: "cpp",
    kind: "lsp",
    languages: ["c", "cpp"],
    probe: "presence",
  },

  { id: "python", binary: "python", label: "Python", group: "python", probe: "version" },
  { id: "uv", binary: "uv", label: "uv", group: "python", probe: "version" },
  {
    id: "basedpyright",
    binary: "basedpyright-langserver",
    label: "basedpyright",
    group: "python",
    kind: "lsp",
    languages: ["python"],
    args: ["--stdio"],
    probe: "presence",
  },
  {
    id: "pyright",
    binary: "pyright-langserver",
    label: "Pyright",
    group: "python",
    kind: "lsp",
    languages: ["python"],
    args: ["--stdio"],
    probe: "presence",
  },
  {
    id: "pylsp",
    binary: "pylsp",
    label: "python-lsp-server",
    group: "python",
    kind: "lsp",
    languages: ["python"],
    probe: "presence",
  },

  { id: "cargo", binary: "cargo", label: "Cargo", group: "rust", probe: "version" },
  { id: "rustc", binary: "rustc", label: "Rust", group: "rust", probe: "version" },
  {
    id: "rustAnalyzer",
    binary: "rust-analyzer",
    label: "rust-analyzer",
    group: "rust",
    kind: "lsp",
    languages: ["rust"],
    probe: "presence",
  },

  { id: "cmake", binary: "cmake", label: "CMake", group: "build", probe: "version" },
  { id: "make", binary: "make", label: "Make", group: "build", probe: "version" },
  { id: "ninja", binary: "ninja", label: "Ninja", group: "build", probe: "version" },
  { id: "meson", binary: "meson", label: "Meson", group: "build", probe: "version" },
  {
    id: "cmakeLanguageServer",
    binary: "cmake-language-server",
    label: "cmake-language-server",
    group: "build",
    kind: "lsp",
    languages: ["cmake"],
    probe: "presence",
  },
  {
    id: "makeLs",
    binary: "make-ls",
    label: "make-ls",
    group: "build",
    kind: "lsp",
    languages: ["make"],
    probe: "presence",
  },
  {
    id: "mesonlsp",
    binary: "mesonlsp",
    label: "mesonlsp",
    group: "build",
    kind: "lsp",
    languages: ["meson"],
    args: ["--lsp"],
    probe: "presence",
  },
  {
    id: "taplo",
    binary: "taplo",
    label: "Taplo",
    group: "build",
    kind: "lsp",
    languages: ["toml"],
    args: ["lsp", "stdio"],
    probe: "presence",
  },
]

/** 派生 LSP 启动表：{ 语言: [[binary, ...启动参数], ...] }，数组顺序即回退优先级。 */
export function lspServersByLanguage() {
  const servers = {}
  for (const tool of toolCatalog)
    if (tool.kind === "lsp" && tool.languages)
      for (const language of tool.languages)
        (servers[language] ??= []).push([tool.binary, ...(tool.args ?? [])])
  return servers
}
