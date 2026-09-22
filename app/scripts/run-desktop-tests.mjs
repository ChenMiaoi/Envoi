import { tests, quickTests } from "./desktop-test-plan.mjs"
import { selectShard } from "../../scripts/test-shard.mjs"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import process from "node:process"
import { createRequire } from "node:module"
import { stripVTControlCharacters } from "node:util"
import { formatLogLine, logColorEnabled } from "../shared/log-format.mjs"

const visible = process.argv.includes("--visible")
const quick = process.argv.includes("--quick")
const verbose = process.env.ENVOI_CI_VERBOSE === "1"
const started = performance.now()
const concurrency = Number(process.env.ENVOI_DESKTOP_TEST_CONCURRENCY || (process.env.CI ? 2 : 4))
const shard = process.env.ENVOI_DESKTOP_TEST_SHARD
const scope = "desktop:" + (shard ?? "local")
const color = logColorEnabled({ env: process.env, stream: process.stdout })
function emit(status, event, fields = {}, message = "", stderr = false) {
  const line = formatLogLine({ scope, status, event, message, fields }, { color })
  ;(stderr ? process.stderr : process.stdout).write(line + "\n")
}
function emitOutput(name, output, status) {
  for (const line of stripVTControlCharacters(output.toString()).split(/\r?\n/))
    if (line) emit(status, "test.output", { test: name }, line, status === "ERROR")
}
if (!Number.isInteger(concurrency) || concurrency < 1) {
  emit("FAIL", "suite.configuration", {
    concurrency: process.env.ENVOI_DESKTOP_TEST_CONCURRENCY,
  })
  process.exit(1)
}
emit("INFO", "suite.started", {
  mode: quick ? "quick" : "full",
  windows: visible ? "visible" : "hidden",
  concurrency,
})

function cleanupTree(pid) {
  if (process.platform !== "win32" || !pid) return
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  })
}

function electronPids() {
  if (process.platform !== "win32") return new Set()
  const output = execFileSync(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq electron.exe", "/FO", "CSV", "/NH"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  )
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^"electron\.exe","(\d+)"/i)?.[1])
      .filter(Boolean),
  )
}

function cleanupNewElectronProcesses(before) {
  for (const pid of electronPids()) if (!before.has(pid)) cleanupTree(pid)
}

const selected = selectShard(
  tests.filter(([name]) => !quick || quickTests.has(name)),
  shard || undefined,
)

// Buffer each test's output so parallel runs never interleave raw tool output.
// Successful details are opt-in; failures always replay their captured context.
async function runTest(name, args) {
  const testStarted = performance.now()
  let output = Buffer.alloc(0)
  for (let attempt = 1; attempt <= 2; attempt++) {
    output = Buffer.alloc(0)
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ENVOI_DESKTOP_TEST_HIDDEN: visible ? "0" : "1" },
      windowsHide: true,
    })
    child.stdout.on("data", (chunk) => (output = Buffer.concat([output, chunk])))
    child.stderr.on("data", (chunk) => (output = Buffer.concat([output, chunk])))
    const status = await new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code) => resolve(code ?? 1))
    })
    cleanupTree(child.pid)
    const durationMs = Math.round(performance.now() - testStarted)
    if (status === 0) {
      if (verbose) emitOutput(name, output, "INFO")
      emit("PASS", "test.complete", { test: name, attempt, durationMs })
      return true
    }
    emitOutput(name, output, "ERROR")
    if (attempt === 1) emit("RETRY", "test.retry", { test: name, attempt: 2 })
  }
  emit("FAIL", "test.complete", {
    test: name,
    attempts: 2,
    durationMs: Math.round(performance.now() - testStarted),
  })
  return false
}

let cursor = 0
const failed = []
async function worker() {
  while (cursor < selected.length && !failed.length) {
    const [name, args] = selected[cursor++]
    emit("START", "test.start", { test: name })
    if (!(await runTest(name, args))) failed.push(name)
  }
}

// Sweep only after every worker finishes: a mid-run global sweep would kill
// sibling tests' Electron processes when running concurrently.
// Resolve Electron once before workers start: a cold install downloads and unpacks
// shared binaries, which must finish before any test launches or resolves them.
createRequire(import.meta.url)("electron")
const baseline = electronPids()
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker))
cleanupNewElectronProcesses(baseline)

if (failed.length) {
  emit("FAIL", "suite.complete", { failed }, "", true)
  process.exit(1)
}
emit("PASS", "suite.complete", {
  tests: selected.length,
  durationMs: Math.round(performance.now() - started),
})
