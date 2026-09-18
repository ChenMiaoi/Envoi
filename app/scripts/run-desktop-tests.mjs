import { execFileSync, spawnSync } from "node:child_process"
import process from "node:process"

const visible = process.argv.includes("--visible")
const quick = process.argv.includes("--quick")
const started = performance.now()
console.log(`Desktop tests: ${quick ? "quick" : "full"}, ${visible ? "visible" : "hidden"} windows`)

const tests = [
  [
    "node:test fixtures",
    [
      "--test",
      "--test-concurrency=1",
      "scripts/test-project-trash.mjs",
      "scripts/test-logging.mjs",
      "scripts/test-workspace-trust.mjs",
      "scripts/test-desktop-backend.mjs",
      "scripts/test-example-project.mjs",
      "scripts/test-workspaces.mjs",
      "scripts/test-research-library.mjs",
      "scripts/test-paper-download.mjs",
      "scripts/test-paper-search.mjs",
      "scripts/test-paper-files.mjs",
      "scripts/test-updates.mjs",
    ],
  ],
  ["component performance", ["scripts/test-performance-ui.mjs"]],
  ["numeric settings", ["scripts/test-number-settings.mjs"]],
  ["paper search settings", ["scripts/test-paper-search-settings-ui.mjs"]],
  ["update settings", ["scripts/test-settings-display.mjs"]],
  ["system fonts", ["scripts/test-system-fonts.mjs"]],
  ["Git tree", ["scripts/test-git-tree.mjs"]],
  ["code editor", ["scripts/test-code-editor-ui.mjs"]],
  ["file actions", ["scripts/test-file-actions-ui.mjs"]],
  ["restricted mode", ["scripts/test-restricted-mode.mjs"]],
  ["desktop smoke", ["scripts/test-desktop-smoke.mjs"]],
  ["project removal UI", ["scripts/test-project-removal-ui.mjs"]],
  ["workspace UI", ["scripts/test-workspace-ui.mjs"]],
  ["background agent UI", ["scripts/test-background-agent-ui.mjs"]],
  ["research start UI", ["scripts/test-research-start-ui.mjs"]],
  ["save and compile", ["scripts/test-save-compile.mjs"]],
  ["model menu", ["scripts/test-model-menu.mjs"]],
  ["status bar settings", ["scripts/test-status-bar-settings.mjs"]],
  ["PDF scheduler", ["scripts/test-pdf-scheduler.mjs"]],
  ["research library UI", ["scripts/test-research-library-ui.mjs"]],
  ["diagnostics UI", ["scripts/test-diagnostics-ui.mjs"]],
]

const quickTests = new Set([
  "component performance",
  "node:test fixtures",
  "numeric settings",
  "Git tree",
  "code editor",
  "file actions",
  "restricted mode",
  "desktop smoke",
  "save and compile",
  "status bar settings",
  "PDF scheduler",
  "diagnostics UI",
])

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

for (const [name, args] of tests.filter(([name]) => !quick || quickTests.has(name))) {
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
