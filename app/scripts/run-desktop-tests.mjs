import { tests, quickTests } from "./desktop-test-plan.mjs"
import { selectShard } from "../../scripts/test-shard.mjs"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import process from "node:process"
import { createRequire } from "node:module"

const visible = process.argv.includes("--visible")
const quick = process.argv.includes("--quick")
const started = performance.now()
const concurrency = Number(process.env.ENVOI_DESKTOP_TEST_CONCURRENCY || (process.env.CI ? 2 : 4))
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(
    `Invalid ENVOI_DESKTOP_TEST_CONCURRENCY: ${process.env.ENVOI_DESKTOP_TEST_CONCURRENCY}`,
  )
  process.exit(1)
}
console.log(
  `Desktop tests: ${quick ? "quick" : "full"}, ${visible ? "visible" : "hidden"} windows, concurrency ${concurrency}`,
)

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
  process.env.ENVOI_DESKTOP_TEST_SHARD || undefined,
)

// Buffer each test's output and release it when the test finishes, so parallel
// runs never interleave logs. A failure dumps everything the test printed.
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
    const elapsed = Math.round((performance.now() - testStarted) / 1000)
    if (status === 0) {
      process.stdout.write(output)
      console.log(`Desktop test ${name}: passed in ${elapsed}s`)
      return true
    }
    process.stdout.write(output)
    if (attempt === 1) console.log(`Retrying desktop test: ${name}`)
  }
  console.log(
    `Desktop test ${name}: failed in ${Math.round((performance.now() - testStarted) / 1000)}s`,
  )
  return false
}

let cursor = 0
const failed = []
async function worker() {
  while (cursor < selected.length && !failed.length) {
    const [name, args] = selected[cursor++]
    console.log(`\n==> Desktop test: ${name}`)
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
  console.error(`\nDesktop tests failed: ${failed.join(", ")}`)
  process.exit(1)
}
console.log(`\nDesktop tests passed in ${Math.round((performance.now() - started) / 1000)}s.`)
