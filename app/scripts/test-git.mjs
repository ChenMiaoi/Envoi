import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { gitRuntime, initializeBoundGit } from "../server/git.mjs"
assert(gitRuntime().available)
const root = await mkdtemp(path.join(tmpdir(), "envoi-git-"))
const proof = "a".repeat(64)
try {
  await mkdir(path.join(root, ".envoi"))
  await writeFile(path.join(root, ".envoi/git-proof"), proof)
  await assert.rejects(initializeBoundGit({ directory: root, proof: "b".repeat(64) }), /证明/)
  const result = await initializeBoundGit({ directory: root, proof })
  assert.equal(result.branch, "main")
  assert.equal(
    execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    "main",
  )
  assert.equal(execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" }), "")
  assert.throws(() =>
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: "pipe" }),
  )
  // Re-running init on the project's own repository adopts it instead of failing.
  const adopted = await initializeBoundGit({ directory: root, proof })
  assert.equal(adopted.existing, true)
  assert.equal(adopted.branch, "main")
  // An existing foreign repository keeps its branch and history.
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "one"], { cwd: root })
  execFileSync("git", ["branch", "-m", "main", "master"], { cwd: root })
  const foreign = await initializeBoundGit({ directory: root, proof })
  assert.equal(foreign.existing, true)
  assert.equal(foreign.branch, "master")
  assert.equal(
    execFileSync("git", ["log", "--format=%s"], { cwd: root, encoding: "utf8" }).trim(),
    "one",
  )
  // An enclosing repository (dotfiles home, monorepo) does not block a nested init.
  const outer = await mkdtemp(path.join(tmpdir(), "envoi-git-enclosing-"))
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: outer })
    const inner = path.join(outer, "paper")
    await mkdir(path.join(inner, ".envoi"), { recursive: true })
    await writeFile(path.join(inner, ".envoi/git-proof"), proof)
    const nested = await initializeBoundGit({ directory: inner, proof })
    assert.equal(nested.existing, undefined)
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: inner,
      encoding: "utf8",
    }).trim()
    assert.equal(await realpath(toplevel), await realpath(inner))
    assert.throws(() =>
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: outer, stdio: "pipe" }),
    )
  } finally {
    await rm(outer, { recursive: true, force: true })
  }
  console.log(
    "PASS bound native Git init, main, no commits/remotes, wrong proof rejected, existing repo adopted, nested init allowed",
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
