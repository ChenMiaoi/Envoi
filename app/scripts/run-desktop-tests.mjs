import { tests, quickTests } from "./desktop-test-plan.mjs"
import { selectShard } from "../../scripts/test-shard.mjs"
import { execFileSync, spawnSync } from "node:child_process"
import process from "node:process"

const visible = process.argv.includes("--visible")
const quick = process.argv.includes("--quick")
const started = performance.now()
console.log(`Desktop tests: ${quick ? "quick" : "full"}, ${visible ? "visible" : "hidden"} windows`)

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
for (const [name, args] of selected) {
  console.log(`\n==> Desktop test: ${name}`)
  const testStarted = performance.now()
  let passed = false
  for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
    const before = electronPids()
    const child = spawnSync(process.execPath, args, {
      env: { ...process.env, ENVOI_DESKTOP_TEST_HIDDEN: visible ? "0" : "1" },
      stdio: "inherit",
      windowsHide: true,
    })
    cleanupTree(child.pid)
    cleanupNewElectronProcesses(before)
    if (child.error) throw child.error
    passed = child.status === 0
    if (!passed && attempt === 1) console.log(`Retrying desktop test: ${name}`)
  }
  console.log(
    `Desktop test ${name}: ${passed ? "passed" : "failed"} in ${Math.round((performance.now() - testStarted) / 1000)}s`,
  )
  if (!passed) process.exit(1)
}

console.log(`\nDesktop tests passed in ${Math.round((performance.now() - started) / 1000)}s.`)
