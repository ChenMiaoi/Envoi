import { execFileSync, spawnSync } from "node:child_process"
import process from "node:process"

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
    ],
  ],
  ["numeric settings", ["scripts/test-number-settings.mjs"]],
  ["paper search settings", ["scripts/test-paper-search-settings-ui.mjs"]],
  ["system fonts", ["scripts/test-system-fonts.mjs"]],
  ["Git tree", ["scripts/test-git-tree.mjs"]],
  ["restricted mode", ["scripts/test-restricted-mode.mjs"]],
  ["desktop smoke", ["scripts/test-desktop-smoke.mjs"]],
  ["project removal UI", ["scripts/test-project-removal-ui.mjs"]],
  ["workspace UI", ["scripts/test-workspace-ui.mjs"]],
  ["background agent UI", ["scripts/test-background-agent-ui.mjs"]],
  ["research start UI", ["scripts/test-research-start-ui.mjs"]],
  ["save and compile", ["scripts/test-save-compile.mjs"]],
  ["model menu", ["scripts/test-model-menu.mjs"]],
  ["PDF scheduler", ["scripts/test-pdf-scheduler.mjs"]],
  ["research library UI", ["scripts/test-research-library-ui.mjs"]],
  ["diagnostics UI", ["scripts/test-diagnostics-ui.mjs"]],
]

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

for (const [name, args] of tests) {
  console.log(`\n==> Desktop test: ${name}`)
  let passed = false
  for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
    const before = electronPids()
    const child = spawnSync(process.execPath, args, {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    })
    cleanupTree(child.pid)
    cleanupNewElectronProcesses(before)
    if (child.error) throw child.error
    passed = child.status === 0
    if (!passed && attempt === 1) console.log(`Retrying desktop test: ${name}`)
  }
  if (!passed) process.exit(1)
}

console.log("\nDesktop tests passed.")
