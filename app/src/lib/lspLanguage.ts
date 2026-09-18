import { pluginLanguageForPath } from "@/settings/pluginCatalog"

const extensions: Record<string, string> = {
  cmake: "cmake",
  mk: "make",
  mak: "make",
  meson: "meson",
  toml: "toml",
}

export function lspLanguageForPath(path: string) {
  const contributed = pluginLanguageForPath(path)
  if (contributed) return contributed
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ""
  if (name === "cmakelists.txt") return "cmake"
  if (name === "makefile" || name === "gnumakefile") return "make"
  if (name === "meson.build" || name === "meson.options" || name === "meson_options.txt")
    return "meson"
  return extensions[name.split(".").at(-1) ?? ""]
}
