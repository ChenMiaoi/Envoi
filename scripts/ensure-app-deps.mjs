import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = path.join(root, "app")
const required = [
  path.join(app, "node_modules", ".package-lock.json"),
  path.join(app, "node_modules", "electron-vite", "package.json"),
]

try {
  await Promise.all(required.map((file) => access(file, constants.F_OK)))
} catch {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = spawnSync(npm, ["--prefix", app, "ci"], { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
