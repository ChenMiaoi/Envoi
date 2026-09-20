import { builtinPlugins } from "./plugin-registry.mjs"

export const toolGroups = ["core", "latex", "cpp", "python", "rust", "lean", "rtl", "asm", "build"]

// Unmigrated tools retain their existing discovery and LSP behavior.
const compatibilityTools = [
  { id: "git", binary: "git", label: "Git", group: "core", probe: "version" },

  { id: "chktex", binary: "chktex", label: "ChkTeX", group: "latex", probe: "chktex" },
  { id: "biber", binary: "biber", label: "Biber", group: "latex", probe: "version" },
  { id: "texlab", binary: "texlab", label: "texlab", group: "latex", probe: "presence" },

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

export const toolCatalog = [
  ...compatibilityTools,
  ...builtinPlugins.flatMap((plugin) => plugin.contributes.tools ?? []),
]

/** Derive LSP fallback order from registered tool contributions. */
export function lspServersByLanguage() {
  const servers = {}
  for (const tool of toolCatalog)
    if (tool.kind === "lsp" && tool.languages)
      for (const language of tool.languages)
        (servers[language] ??= []).push([tool.binary, ...(tool.args ?? [])])
  return servers
}
