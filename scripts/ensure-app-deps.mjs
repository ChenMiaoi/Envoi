import { access, readFile, writeFile, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { digest } from "./check-cache.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function ensureAppDeps({
  repository = root,
  force = false,
  run = spawnSync,
  log = console.log,
} = {}) {
  const app = path.join(repository, "app")
  const modules = path.join(app, "node_modules")
  const stampPath = path.join(modules, ".envoi-deps.json")
  const manifest = await readFile(path.join(app, "package.json"), "utf8")
  const input = digest(
    JSON.stringify([
      manifest,
      await readFile(path.join(app, "package-lock.json"), "utf8"),
      process.version,
      process.platform,
      process.arch,
    ]),
  )
  const hiddenLock = () => readFile(path.join(modules, ".package-lock.json"))
  if (!force) {
    try {
      const stamp = JSON.parse(await readFile(stampPath, "utf8"))
      const pkg = JSON.parse(manifest)
      await Promise.all(
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).map((name) =>
          access(path.join(modules, name, "package.json")),
        ),
      )
      if (stamp.input === input && stamp.installed === digest(await hiddenLock())) {
        log("Locked dependencies unchanged; reusing installation.")
        return stamp.generation
      }
    } catch {
      // Missing, changed, or unrecognized installations must be recreated from the lockfile.
    }
  }
  await rm(stampPath, { force: true })
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const npmExecPath = process.env.npm_execpath
  const command = npmExecPath ? process.execPath : npm
  const args = ["--prefix", app, "ci", "--no-audit", "--no-fund"]
  const result = run(command, npmExecPath ? [npmExecPath, ...args] : args, {
    stdio: "inherit",
    shell: !npmExecPath && process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Dependency installation failed (exit ${result.status ?? "unknown"})`)
  const stamp = { input, installed: digest(await hiddenLock()), generation: randomUUID() }
  await writeFile(stampPath, JSON.stringify(stamp))
  return stamp.generation
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureAppDeps({ force: process.argv.includes("--force") })
}
