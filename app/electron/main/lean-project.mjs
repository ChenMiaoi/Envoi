import { existsSync } from "node:fs"
import path from "node:path"

export function leanProjectRoot(root, file) {
  let directory = file ? path.dirname(path.resolve(root, file)) : root
  while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    if (
      ["lean-toolchain", "lakefile.lean", "lakefile.toml"].some((name) =>
        existsSync(path.join(directory, name)),
      )
    )
      return directory
    if (directory === root) break
    directory = path.dirname(directory)
  }
  return root
}

export function leanServerSpec(spec, root, file) {
  const cwd = leanProjectRoot(root, file)
  const project = ["lakefile.lean", "lakefile.toml"].some((name) =>
    existsSync(path.join(cwd, name)),
  )
  if (!project) return { ...spec, cwd }
  const lake = path.join(
    path.dirname(spec.command),
    process.platform === "win32" ? "lake.exe" : "lake",
  )
  if (!existsSync(lake))
    throw Error("Lake is missing next to Lean; install the complete Lean 4 toolchain")
  return { ...spec, command: lake, args: ["serve", "--"], cwd }
}
