import { pluginLanguageForPath } from "./plugin-registry.mjs"
export function isTextPath(value) {
  return (
    !!pluginLanguageForPath(value) ||
    /\.(tex|bib|md|markdown|txt|csv|tsv|json|sty|cls|bst|log|yaml|yml|toml|ini|cfg|py|pyi|pyw|r|js|ts|jsx|tsx|css|html|xml|sh|sql|c|h|cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|inl|tpp|rs|go|jl|cmake|mk|mak|meson)$/i.test(
      value,
    ) ||
    /(^|\/)(README|LICENSE|GNUmakefile|Makefile|makefile|CMakeLists\.txt|meson\.build|meson\.options|meson_options\.txt|Cargo\.lock|uv\.lock|lean-toolchain|Dockerfile|\.gitignore|\.clangd|\.clang-format|\.python-version)$/i.test(
      value,
    )
  )
}

export function fileKind(value) {
  const extension = value.split(".").pop()?.toLowerCase()
  return extension === "tex"
    ? "latex"
    : extension === "bib"
      ? "bib"
      : extension === "pdf"
        ? "pdf"
        : ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "ico"].includes(
              extension ?? "",
            )
          ? "image"
          : extension === "csv"
            ? "csv"
            : extension === "tsv"
              ? "tsv"
              : ["md", "markdown"].includes(extension ?? "")
                ? "markdown"
                : isTextPath(value)
                  ? "text"
                  : "binary"
}

export function safePathParts(relPath, message = "无效文件路径") {
  if (typeof relPath !== "string") throw new Error(message)
  const parts = relPath.trim().split("/")
  if (
    !parts.length ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\:]/.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    )
  )
    throw new Error(message)
  return parts
}
