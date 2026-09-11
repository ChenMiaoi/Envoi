import { spawnSync } from "node:child_process"
import process from "node:process"

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const env = { ...process.env, CI: "1" }
const spawnOptions = {
  env,
  shell: process.platform === "win32",
}
const steps = [
  ["Install locked dependencies", ["run", "setup"]],
  ["Check formatting", ["run", "format:check"]],
  ["Lint", ["run", "lint"]],
  ["Build", ["run", "build"]],
  ["Run tests", ["test"]],
  ["Run AI tests", ["run", "test:ai"]],
  ["Run local integration tests", ["run", "test:local"]],
]

if (process.platform === "win32") steps.push(["Run desktop tests", ["run", "test:desktop"]])

function reportEnvironment() {
  console.error("CI environment:")
  console.error(`- platform: ${process.platform} ${process.arch}`)
  console.error(`- node: ${process.version}`)
  console.error(
    `- npm: ${spawnSync(npm, ["--version"], { ...spawnOptions, encoding: "utf8" }).stdout?.trim()}`,
  )
  console.error(`- CI: ${env.CI}`)
  const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  if (git.status === 0) console.error(`- commit: ${git.stdout.trim()}`)
  const registry = spawnSync(npm, ["config", "get", "registry"], {
    ...spawnOptions,
    encoding: "utf8",
  })
  if (registry.status === 0) console.error(`- npm registry: ${registry.stdout.trim()}`)
}

reportEnvironment()
for (const [name, args] of steps) {
  console.log(`\n==> ${name}: ${npm} ${args.join(" ")}`)
  const result = spawnSync(npm, args, { ...spawnOptions, stdio: "inherit" })
  if (result.error) {
    console.error(`Failed to start ${npm}: ${result.error.message}`)
    reportEnvironment()
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`Step failed: ${name} (exit ${result.status ?? "unknown"})`)
    reportEnvironment()
    process.exit(result.status ?? 1)
  }
}

console.log("\nCI checks passed.")
