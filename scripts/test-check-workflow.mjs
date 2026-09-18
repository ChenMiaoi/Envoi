import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  affectsStep,
  artifactKey,
  canReuse,
  maxCacheAge,
  sourceSnapshot,
  stepKey,
} from "./check-cache.mjs"
import { ensureAppDeps } from "./ensure-app-deps.mjs"

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-check-workflow-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}

test("source fingerprints include edits, additions, deletions but not Git metadata", async (t) => {
  const root = await fixture(t)
  git(root, ["init"])
  await writeFile(path.join(root, "source.js"), "original")
  git(root, ["add", "source.js"])
  const original = await sourceSnapshot(root)
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  ])
  assert.deepEqual(await sourceSnapshot(root), original)
  await writeFile(path.join(root, "source.js"), "changed")
  assert.notDeepEqual(await sourceSnapshot(root), original)
  await writeFile(path.join(root, "source.js"), "original")
  await writeFile(path.join(root, "new.js"), "new")
  assert.notEqual(stepKey(await sourceSnapshot(root), "unit", {}), stepKey(original, "unit", {}))
  await rm(path.join(root, "new.js"))
  await rm(path.join(root, "source.js"))
  assert.deepEqual(await sourceSnapshot(root), [["source.js", "missing"]])
})

test("only documented safe paths narrow validation; unknown inputs invalidate all suites", () => {
  const before = [
    ["app/src/main.ts", "a"],
    ["docs/guide.md", "old"],
  ]
  const after = [
    ["app/src/main.ts", "a"],
    ["docs/guide.md", "new"],
  ]
  assert.equal(stepKey(before, "build", {}), stepKey(after, "build", {}))
  assert.notEqual(stepKey(before, "format", {}), stepKey(after, "format", {}))
  assert.equal(affectsStep("app/tests/suite.ts", "unit"), true)
  assert.equal(affectsStep("app/tests/suite.ts", "lint"), true)
  assert.equal(affectsStep("app/tests/suite.ts", "desktop"), false)
  for (const step of ["workflow", "format", "lint", "build", "unit", "ai", "local", "desktop"]) {
    for (const file of [
      "unknown.config",
      "app/package-lock.json",
      "scripts/ci-check.mjs",
      "app/src/lib/project.ts",
      "app/scripts/test-git.mjs",
      "examples/demo/main.tex",
    ]) {
      assert.equal(affectsStep(file, step), true, `${file}: ${step}`)
    }
  }
})

test("cache requires a matching key and a recent success; reuse does not renew its age", () => {
  const entry = { key: "a", passedAt: 100 }
  assert.equal(canReuse(entry, "a", 101), true)
  assert.equal(canReuse(entry, "b", 101), false)
  assert.equal(canReuse(undefined, "a", 101), false)
  assert.equal(canReuse({ key: "a" }, "a", 101), false)
  assert.equal(canReuse(entry, "a", 99), false)
  assert.equal(canReuse(entry, "a", 100 + maxCacheAge), false)
  assert.notEqual(
    stepKey([], "build", { generation: "old" }),
    stepKey([], "build", { generation: "new" }),
  )
})

test("build cache detects missing and modified generated output", async (t) => {
  const root = await fixture(t)
  assert.equal(await artifactKey(root), null)
  await mkdir(path.join(root, "app/dist/main"), { recursive: true })
  await mkdir(path.join(root, "app/public/pdfjs"), { recursive: true })
  const entry = path.join(root, "app/dist/main/index.js")
  await writeFile(entry, "first build")
  const original = await artifactKey(root)
  assert.ok(original)
  assert.equal(await artifactKey(root), original)
  await writeFile(entry, "modified build")
  assert.notEqual(await artifactKey(root), original)
  await rm(entry)
  assert.equal(await artifactKey(root), null)
})

test("dependency reuse checks locked inputs and installation; failures cannot create a stamp", async (t) => {
  const root = await fixture(t)
  const app = path.join(root, "app")
  const modules = path.join(app, "node_modules")
  await mkdir(path.join(modules, "example"), { recursive: true })
  await writeFile(
    path.join(app, "package.json"),
    JSON.stringify({ dependencies: { example: "1.0.0" } }),
  )
  const lock = path.join(app, "package-lock.json")
  await writeFile(lock, "lock 1")
  await writeFile(path.join(modules, "example/package.json"), "{}")
  await writeFile(path.join(modules, ".package-lock.json"), "installed lock")
  let installs = 0
  const options = {
    repository: root,
    run: () => {
      installs++
      return { status: 0 }
    },
  }
  const first = await ensureAppDeps(options)
  assert.equal(installs, 1)
  assert.equal(await ensureAppDeps(options), first)
  assert.equal(installs, 1)
  await writeFile(lock, "lock 2")
  assert.notEqual(await ensureAppDeps(options), first)
  assert.equal(installs, 2)
  await writeFile(path.join(modules, ".package-lock.json"), "manual install")
  await ensureAppDeps(options)
  assert.equal(installs, 3)
  await rm(path.join(modules, "example/package.json"))
  await ensureAppDeps(options)
  assert.equal(installs, 4)
  await assert.rejects(
    ensureAppDeps({ ...options, force: true, run: () => ({ status: 1 }) }),
    /installation failed/,
  )
  await assert.rejects(readFile(path.join(modules, ".envoi-deps.json")), { code: "ENOENT" })
})
