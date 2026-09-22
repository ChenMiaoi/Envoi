import { spawn, spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { formatLogLine, isFormattedLogLine, logColorEnabled } from "../app/shared/log-format.mjs"
import { selectShard } from "./test-shard.mjs"
import { checkProfile } from "./check-profile.mjs"
import { ensureAppDeps } from "./ensure-app-deps.mjs"
import { artifactKey, canReuse, digest, sourceSnapshot, stepKey } from "./check-cache.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const npmExecPath = process.env.npm_execpath
const npmCommand = npmExecPath ? process.execPath : npm
const npmArgs = (args) => (npmExecPath ? [npmExecPath, ...args] : args)
const local = process.argv.includes("--local") && !process.env.CI
const force = process.argv.includes("--force")
const verbose = process.env.ENVOI_CI_VERBOSE === "1"
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
  npm_config_loglevel: "silent",
  npm_config_registry: "https://registry.npmjs.org",
  npm_config_replace_registry_host: "always",
}
const color = logColorEnabled({ env, stream: process.stdout })
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

function emit(status, event, fields = {}, message = "", scope = "ci", stderr = false) {
  const line = formatLogLine({ scope, status, event, message, fields }, { color })
  ;(stderr ? process.stderr : process.stdout).write(line + "\n")
}

function outputLine(step, stream, line, status = "INFO") {
  if (!line) return
  emit(status, stream, {}, line, "tool:" + step, status === "ERROR")
}

function syncTool(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: "pipe",
  })
  if (verbose || result.status !== 0) {
    const status = result.status === 0 ? "INFO" : "ERROR"
    for (const line of String(result.stdout ?? "").split(/\r?\n/))
      outputLine("dependencies", "stdout", line, status)
    for (const line of String(result.stderr ?? "").split(/\r?\n/))
      outputLine("dependencies", "stderr", line, status)
  }
  return result
}

async function runTool(step, args) {
  const buffered = []
  const child = spawn(npmCommand, npmArgs(args), {
    cwd: root,
    env,
    shell: !npmExecPath && process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const consume = (readable, stream) => {
    let pending = ""
    readable.setEncoding("utf8")
    readable.on("data", (chunk) => {
      pending += chunk
      const lines = pending.split(/\r?\n|\r/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (!line) continue
        if (isFormattedLogLine(line)) process.stdout.write(line + "\n")
        else if (verbose) outputLine(step, stream, line)
        else buffered.push({ stream, line })
      }
    })
    readable.on("end", () => {
      if (!pending) return
      if (isFormattedLogLine(pending)) process.stdout.write(pending + "\n")
      else if (verbose) outputLine(step, stream, pending)
      else buffered.push({ stream, line: pending })
    })
  }
  consume(child.stdout, "stdout")
  consume(child.stderr, "stderr")
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })
  if (status !== 0)
    for (const entry of buffered) outputLine(step, entry.stream, entry.line, "ERROR")
  return status
}

try {
  const shard = process.env.ENVOI_DESKTOP_TEST_SHARD || undefined
  if (shard) {
    selectShard([1, 2], shard)
    if (local || !process.env.CI) throw new Error("Desktop sharding is only supported in CI")
    if (!["darwin", "win32"].includes(process.platform))
      throw new Error("Desktop sharding requires macOS or Windows")
  }
  emit("INFO", "checks.started", {
    mode: local ? "local" : "full",
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    ...(shard ? { shard } : {}),
  })
  const installStarted = Date.now()
  const generation = await ensureAppDeps({
    log: (message) => emit("INFO", "dependencies", {}, message),
    run: syncTool,
  })
  emit("PASS", "dependencies", { durationMs: Date.now() - installStarted })
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
      emit("SKIP", id, { reason: "unchanged" }, name)
      next[id] = previous[id]
      continue
    }
    const command = npm + " " + args.join(" ")
    emit("START", id, { command }, name)
    const stepStarted = Date.now()
    const status = await runTool(id, args)
    if (status !== 0) throw new Error(name + " failed (exit " + status + ")")
    emit("PASS", id, { durationMs: Date.now() - stepStarted }, name)
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
  emit("PASS", "complete", {
    mode: shard ? "shard" : local ? "local" : "full",
    ...(shard ? { shard } : {}),
    durationMs: Date.now() - started,
  })
} catch (error) {
  emit("FAIL", "complete", { error: error.message }, "", "ci", true)
  process.exitCode = 1
}
