import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
const root = fileURLToPath(new URL("../../examples/demo/", import.meta.url)),
  files = []
async function walk(directory, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith(".") && entry.name !== ".envoi") continue
    if (prefix === ".envoi/" && entry.name !== "project.json") continue
    const relative = prefix + entry.name,
      target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "output") await walk(target, relative + "/")
      continue
    }
    if (
      relative.endsWith(".log") ||
      ["build/diagnostics.json", "build/snapshot.json", "build/legacy-app-snapshot.json"].includes(
        relative,
      )
    )
      continue
    const extension = path.extname(relative),
      kind =
        extension === ".tex"
          ? "latex"
          : extension === ".bib"
            ? "bib"
            : extension === ".pdf"
              ? "pdf"
              : [".png", ".jpg", ".jpeg", ".svg"].includes(extension)
                ? "image"
                : extension === ".csv"
                  ? "csv"
                  : extension === ".tsv"
                    ? "tsv"
                    : extension === ".md"
                      ? "markdown"
                      : "text"
    const file = { id: relative, path: relative, kind }
    if ([".tex", ".bib", ".md", ".json", ".csv", ".txt"].includes(extension)) {
      file.text = await readFile(target, "utf8")
      file.saved = file.text
    } else {
      file.path = relative
    }
    files.push(file)
  }
}
await walk(root)
if (!files.some((file) => file.path === "build/main.pdf"))
  throw Error("Build the example PDF before refreshing the bundled snapshot.")
await mkdir(path.join(root, "build"), { recursive: true })
await writeFile(path.join(root, "build/snapshot.json"), JSON.stringify(files, null, 2) + "\n")
console.log(
  "Updated explicit example snapshot in examples/demo/build; application startup data unchanged.",
)
