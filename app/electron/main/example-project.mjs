import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rename,
  rm,
  realpath,
  lstat,
} from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { detectTool } from "../../server/tool-config.mjs"

const execute = promisify(execFile)
// Explicit template inputs: never import a development checkout's identity,
// credentials, nested .git, recovery data, or generated build products.
const stages = [
  {
    message: "demo: establish manuscript and research question",
    files: [".gitignore", "references.bib", "chapters/introduction.tex"],
  },
  {
    message: "demo: develop background, model and tiled schedule",
    files: [
      "chapters/background.tex",
      "chapters/model.tex",
      "chapters/design.tex",
      "assets/schedule.png",
    ],
  },
  {
    message: "demo: add synthetic data, figures and evaluation",
    files: [
      "chapters/evaluation.tex",
      "chapters/sensitivity.tex",
      "data/model-data.csv",
      "data/README.md",
      "assets/workspace.png",
      "assets/speedup-grid.png",
      "assets/runtime.png",
      "assets/efficiency.png",
      "assets/bandwidth.png",
      "assets/results-table.tex",
    ],
  },
  {
    message: "demo: discuss limitations and complete the paper",
    files: ["chapters/discussion.tex", "chapters/conclusion.tex", "chapters/appendix.tex"],
  },
  {
    message: "demo: document reproducibility and workspace walkthrough",
    files: [
      "README.md",
      "SHOWCASE.md",
      "TEMPLATE.md",
      "tools/generate-figures.py",
      "tools/requirements.txt",
    ],
  },
]

export async function createExampleProject({ source, dataDirectory, git = detectTool("git") }) {
  if (!git) throw Error("创建示例项目需要本机 Git，请安装 Git 后重试。")
  const parent = path.join(dataDirectory, "examples")
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(path.join(parent, ".creating-"))
  const target = path.join(parent, `demo-${randomUUID()}`)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key]
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null"
  env.GIT_CONFIG_NOSYSTEM = "1"
  // The history is explicitly illustrative and uses the actual creation time.
  // Do not inherit signing, hooks, templates, remotes or user author identity.
  const run = async (args) =>
    (
      await execute(
        git,
        [
          "-c",
          "user.name=Envoi Demonstration",
          "-c",
          "user.email=demo@envoi.invalid",
          "-c",
          "commit.gpgSign=false",
          "-c",
          "core.hooksPath=" + path.join(staging, ".git", "envoi-empty-hooks"),
          ...args,
        ],
        {
          cwd: staging,
          env,
          windowsHide: true,
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
        },
      )
    ).stdout
  try {
    const main = await readFile(path.join(source, "main.tex"), "utf8")
    await run(["init", "--template=", "-b", "main"])
    await run(["config", "core.autocrlf", "false"])
    await mkdir(path.join(staging, ".envoi"))
    await writeFile(
      path.join(staging, ".envoi", "project.json"),
      JSON.stringify(
        {
          name: "IO-Aware Attention: An Illustrative Systems Study",
          projectId: randomUUID(),
          main: "main.tex",
          template: "acm-conf",
          dataStatus: "synthetic and illustrative; no hardware measurements",
          buildDirectory: "build",
          git: { requested: true, branch: "main", status: "initialized" },
          settings: { version: 1, overrides: { engine: "pdflatex" } },
        },
        null,
        2,
      ) + "\n",
    )
    const present = new Set()
    for (const stage of stages) {
      for (const file of stage.files) {
        const input = path.join(source, file)
        if (
          !(await lstat(input)).isFile() ||
          (await realpath(input)) !== path.join(await realpath(source), file)
        )
          throw Error(`无效示例模板文件：${file}`)
        await mkdir(path.dirname(path.join(staging, file)), { recursive: true })
        await copyFile(input, path.join(staging, file))
        present.add(file)
      }
      const draft = main.replace(/^\\input\{([^}]+)\}.*$/gm, (line, file) =>
        present.has(file + ".tex") ? line : "",
      )
      await writeFile(path.join(staging, "main.tex"), draft)
      await run(["add", "--", "."])
      await run(["commit", "-m", stage.message])
    }
    if ((await run(["status", "--porcelain"])).trim()) throw Error("示例初始化后存在未提交文件。")
    if ((await run(["rev-list", "--count", "HEAD"])).trim() !== String(stages.length))
      throw Error("示例历史初始化不完整。")
    // Publish only the complete workspace. No watcher or renderer sees staging.
    await rename(staging, target)
    return await realpath(target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}
