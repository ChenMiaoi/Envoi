import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { realpath, mkdtemp, readFile, writeFile, rm, mkdir, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-workspaces-")))
const readText = async (file) => (await readFile(file, "utf8")).replaceAll("\r\n", "\n")
// Exercise a noncanonical data directory, as with RUNNER~1 on Windows CI.
await mkdir(path.join(temp, "actual-data"))
await symlink(
  path.join(temp, "actual-data"),
  path.join(temp, "data-alias"),
  process.platform === "win32" ? "junction" : "dir",
)
process.env.ENVOI_DATA_DIR = path.join(temp, "data-alias")
const { createExampleProject } = await import("../electron/main/example-project.mjs")
const {
  createWorkspace,
  workspaceAiDefaults,
  listWorkspaces,
  saveWorkspaceResult,
  listWorkspaceResults,
  workspaceTarget,
  renameWorkspace,
  workspaceName,
  workspaceProjectName,
} = await import("../server/workspaces.mjs")
const { registerProject, projectRoot } = await import("../server/local-data.mjs")
test("workspaces isolate identities and edits, preserve result provenance, and bind AI tool selection", async () => {
  try {
    const root = await createExampleProject({
      source: path.resolve("../examples/demo"),
      dataDirectory: temp,
    })
    const main = await registerProject(root)
    const alias = path.join(temp, "project-alias")
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir")
    assert.equal((await registerProject(alias)).id, main.id)
    const configFile = path.join(root, ".envoi/project.json")
    const config = JSON.parse(await readText(configFile))
    config.ai = { model: "fixture/inexpensive", thinking: "off" }
    await writeFile(configFile, JSON.stringify(config))
    const created = await createWorkspace(root, {
      name: "敏感性分析",
      purpose: "使用现有演示数据验证保存流程",
    })
    assert.equal(created.path, await realpath(created.path))
    const original = await readText(path.join(created.path, ".envoi/project.json"))
    assert.deepEqual(await workspaceAiDefaults(created.path), config.ai)
    const experiment = await registerProject(created.path, { copy: true })
    assert.equal(await projectRoot(experiment.id), created.path)
    assert.equal(await projectRoot(main.id), root)
    assert.notEqual(main.id, experiment.id)
    assert.equal((await registerProject(created.path, { copy: true })).id, experiment.id)
    assert.equal(await readText(path.join(created.path, ".envoi/project.json")), original)
    assert.equal((await listWorkspaces(created.path)).main, root)
    await renameWorkspace(root, { target: created.path, name: "带宽扫描" })
    assert.equal(await workspaceName(created.path), "带宽扫描")
    assert.equal(await workspaceProjectName(created.path), path.basename(root))
    assert.equal(await workspaceProjectName(root), path.basename(root))
    assert.equal((await listWorkspaces(created.path)).projectName, path.basename(root))
    assert.equal(
      (await listWorkspaces(created.path)).workspaces.find((w) => w.current).name,
      "带宽扫描",
    )
    assert.equal(await readText(path.join(created.path, ".envoi/project.json")), original)
    await assert.rejects(renameWorkspace(root, { target: created.path, name: "  " }), /名称/)
    const result = await saveWorkspaceResult(root, {
      source: created.path,
      title: "演示结果",
      files: ["data/model-data.csv"],
      summary: "Synthetic data, not measurements",
      command: "Existing deterministic demo model",
    })
    assert.equal((await listWorkspaceResults(created.path))[0].id, result.id)
    execFileSync(
      "git",
      [
        "clone",
        path.join(root, "results", result.id, "source.bundle"),
        path.join(temp, "restored-source"),
      ],
      { windowsHide: true, stdio: "pipe" },
    )
    assert.equal(
      await readText(path.join(temp, "restored-source", "main.tex")),
      await readText(path.join(created.path, "main.tex")),
    )
    assert.equal(
      await readText(path.join(root, "results", result.id, "files/data/model-data.csv")),
      await readText(path.join(created.path, "data/model-data.csv")),
    )
    await assert.rejects(
      saveWorkspaceResult(root, { source: created.path, title: "escape", files: ["../main.tex"] }),
      /无效/,
    )
    await assert.rejects(workspaceTarget(root, temp), /不属于/)
    const { researchTools } = await import("../server/workspace-agent.mjs")
    const tools = researchTools(root),
      selector = tools.find((t) => t.name === "research_workspace")
    await selector.execute("select", { action: "select", target: created.path })
    await tools
      .find((t) => t.name === "write")
      .execute("write", { path: "ai-experiment.txt", content: "isolated experiment" })
    assert.equal(
      await readText(path.join(created.path, "ai-experiment.txt")),
      "isolated experiment",
    )
    await assert.rejects(readFile(path.join(root, "ai-experiment.txt")))
    await assert.rejects(
      saveWorkspaceResult(root, {
        source: created.path,
        title: "untracked",
        files: ["data/model-data.csv"],
      }),
      /未跟踪/,
    )
    await writeFile(path.join(created.path, "main.tex"), "changed experiment")
    await assert.rejects(
      saveWorkspaceResult(root, {
        source: created.path,
        title: "dirty",
        files: ["data/model-data.csv"],
      }),
      /先提交/,
    )
    assert.notEqual(await readText(path.join(root, "main.tex")), "changed experiment")
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 3 })
  }
})
