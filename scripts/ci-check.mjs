import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { selectShard } from "./test-shard.mjs"
import { checkProfile } from "./check-profile.mjs"
import { ensureAppDeps } from "./ensure-app-deps.mjs"
import { artifactKey, canReuse, digest, sourceSnapshot, stepKey } from "./check-cache.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const local = process.argv.includes("--local") && !process.env.CI
const force = process.argv.includes("--force")
const profile = checkProfile({
  local,
  desktopConcurrency: process.env.ENVOI_DESKTOP_TEST_CONCURRENCY,
})
const started = Date.now()
const cachePath = path.join(root, "app/tmp/check-results.json")
const env = {
  ...process.env,
  CI: "1",
  ENVOI_DESKTOP_TEST_CONCURRENCY: profile.desktopConcurrency,
  npm_config_registry: "https://registry.npmjs.org",
  npm_config_replace_registry_host: "always",
}
const steps = [
  ["workflow", "Check validation workflow", ["run", "test:workflow"]],
  ["format", "Check formatting", ["run", "format:check"]],
  ["lint", "Lint", ["run", "lint"]],
  ["build", "Build", ["run", "build"]],
  ["unit", "Run tests", ["test"]],
  ["ai", "Run AI tests", ["run", "test:ai"]],
  ["local", "Run local integration tests", ["run", "test:local"]],
]
if (["darwin", "win32"].includes(process.platform)) {
  steps.push(["desktop", "Run desktop tests", ["run", profile.desktopScript]])
}

try {
  const shard = process.env.ENVOI_DESKTOP_TEST_SHARD || undefined
  if (shard) {
    selectShard([1, 2], shard)
    if (local || !process.env.CI) throw new Error("Desktop sharding is only supported in CI")
    if (!["darwin", "win32"].includes(process.platform))
      throw new Error("Desktop sharding requires macOS or Windows")
  }
  console.log(
    `${local ? "Local" : "Full CI"} checks: ${process.platform} ${process.arch}, Node ${process.version}`,
  )
  const installStarted = Date.now()
  const generation = await ensureAppDeps()
  console.log(`Dependencies ready (${((Date.now() - installStarted) / 1000).toFixed(1)}s)`)
  const context = {
    generation,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    environment: digest(
      JSON.stringify(
        Object.entries(env)
          .filter(([key]) =>
            /^(PATH|HOME|USERPROFILE|LANG|LC_|ENVOI_|PAPERDESK_|TEX|ELECTRON_|DISPLAY)/.test(key),
          )
          .sort(),
      ),
    ),
  }
  let previous = {}
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"))
    if (cached && typeof cached === "object" && !Array.isArray(cached)) previous = cached
  } catch {
    /* A missing/corrupt cache is a cold run. */
  }
  // Publish only a completely successful run; a failed/interrupted run leaves no reusable results.
  await rm(cachePath, { force: true })
  const snapshot = await sourceSnapshot(root)
  const next = {}
  let artifacts = await artifactKey(root)
  let rebuilt = false
  for (const [id, name, args] of steps) {
    const key = stepKey(snapshot, id, { ...context, args })
    const outputValid =
      id !== "build" || (artifacts !== null && artifacts === previous[id]?.artifacts)
    if (
      local &&
      !force &&
      canReuse(previous[id], key) &&
      outputValid &&
      !(id === "desktop" && rebuilt)
    ) {
      console.log(`\n==> ${name}: reused successful result (unchanged inputs)`)
      next[id] = previous[id]
      continue
    }
    console.log(`\n==> ${name}: ${npm} ${args.join(" ")}`)
    const stepStarted = Date.now()
    const result = spawnSync(npm, args, {
      cwd: root,
      env,
      shell: process.platform === "win32",
      stdio: "inherit",
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status ?? "unknown"})`)
    console.log(`${name} passed (${((Date.now() - stepStarted) / 1000).toFixed(1)}s)`)
    if (id === "build") {
      rebuilt = true
      artifacts = await artifactKey(root)
    }
    next[id] = { key, passedAt: Date.now(), ...(id === "build" ? { artifacts } : {}) }
  }
  if (digest(JSON.stringify(snapshot)) !== digest(JSON.stringify(await sourceSnapshot(root)))) {
    throw new Error("Source files changed during validation; rerun checks on the final contents")
  }
  if (!shard) {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(next, null, 2))
  }
  console.log(`\n${shard ? `CI desktop shard ${shard}` : local ? "Local" : "CI"} checks passed.`)
  console.log(`Total: ${((Date.now() - started) / 1000).toFixed(1)}s`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
