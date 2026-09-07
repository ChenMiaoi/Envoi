import { createRequire } from "node:module"
import { mkdtemp, rm, cp, mkdir, writeFile, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
const require = createRequire(import.meta.url),
  { _electron } = require("playwright")
const samples = [],
  projectMode = process.argv.includes("--project")
for (let index = 0; index < 3; index++) {
  const temp = await mkdtemp(path.join(tmpdir(), "envoi-startup-"))
  let instance
  try {
    if (projectMode) {
      const root = path.join(temp, "paper")
      await cp(path.resolve("../examples/demo"), root, {
        recursive: true,
        filter: (source) => !source.split(path.sep).includes(".git"),
      })
      const canonical = await realpath(root),
        data = path.join(temp, "data")
      await mkdir(path.join(data, "storage/session"), { recursive: true })
      await writeFile(
        path.join(data, "workspace-trust.json"),
        JSON.stringify({ version: 1, roots: [canonical] }),
      )
      await writeFile(
        path.join(data, "storage/session/current.json"),
        JSON.stringify({
          revision: 1,
          value: {
            id: "startup",
            name: "paper",
            rootPath: canonical,
            rootId: "main.tex",
            files: [],
            directories: [],
          },
        }),
      )
    }
    const start = performance.now()
    instance = await _electron.launch({
      executablePath: process.env.ENVOI_DESKTOP_EXECUTABLE ?? require("electron"),
      args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
      env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
    })
    const page = await instance.firstWindow()
    if (projectMode)
      await page.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true }).waitFor()
    else await page.getByRole("button", { name: "打开项目", exact: true }).waitFor()
    const readyMs = Math.round(performance.now() - start)
    const gitStart = performance.now()
    await page.evaluate(() => window.envoi.gitRuntime())
    const firstGitMs = Math.round(performance.now() - gitStart)
    samples.push({
      readyMs,
      firstGitMs,
      paints: await page.evaluate(() =>
        performance
          .getEntriesByType("paint")
          .map((entry) => ({ name: entry.name, ms: Math.round(entry.startTime) })),
      ),
    })
  } finally {
    await instance?.close()
    await rm(temp, { recursive: true, force: true })
  }
}
console.log(JSON.stringify(samples, null, 2))
