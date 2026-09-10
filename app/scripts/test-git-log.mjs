import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import {
  initializeBoundGit,
  readBoundGitLog,
  readBoundGitShow,
  parseLog,
  parseRefs,
} from "../server/git.mjs"
assert.deepEqual(parseRefs("HEAD -> main, tag: v1.0, origin/main"), {
  refs: [
    { name: "main", kind: "branch" },
    { name: "v1.0", kind: "tag" },
    { name: "origin/main", kind: "remote" },
  ],
  head: true,
})
assert.deepEqual(parseRefs("HEAD"), { refs: [], head: true })
assert.equal(
  parseLog("\x1eaaa\x1f\x1f\x1fA\x1f2026-01-01T00:00:00+00:00\x1finit\n")[0].subject,
  "init",
)
assert.equal(
  parseLog("\x1eaaa\x1f\x1f\x1fA\x1f2026-01-01T00:00:00+00:00\x1finit\r\n")[0].subject,
  "init",
)
const root = await mkdtemp(path.join(tmpdir(), "envoi-git-log-")),
  proof = "c".repeat(64),
  input = { directory: root, proof }
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@envoi.dev", ...args], {
    cwd: root,
    encoding: "utf8",
  })
try {
  await mkdir(path.join(root, ".envoi"))
  await writeFile(path.join(root, ".envoi/git-proof"), proof)
  assert.equal((await readBoundGitLog(input)).state, "not-initialized")
  await initializeBoundGit(input)
  assert.deepEqual((await readBoundGitLog(input)).commits, []) // unborn HEAD: ready repo, no commits yet
  // Fixture history is confined to this temporary test repository, never the demo.
  await writeFile(path.join(root, "main.tex"), "one\n")
  git("add", "main.tex")
  git("commit", "-m", "Initial draft")
  git("checkout", "-b", "feature")
  await writeFile(path.join(root, "feature.tex"), "two\n")
  git("add", "feature.tex")
  git("commit", "-m", "Feature section")
  git("checkout", "main")
  await writeFile(path.join(root, "main.tex"), "one\nmain edit\n")
  git("add", "main.tex")
  git("commit", "-m", "Main edit")
  git("merge", "--no-ff", "feature", "-m", "Merge feature")
  git("tag", "v0.1")
  const log = await readBoundGitLog(input)
  assert.equal(log.state, "ready")
  assert.equal(log.branch, "main")
  assert.equal(log.commits.length, 4)
  assert.equal(log.truncated, false)
  const bySubject = Object.fromEntries(log.commits.map((c) => [c.subject, c])),
    merge = bySubject["Merge feature"],
    mainEdit = bySubject["Main edit"],
    feature = bySubject["Feature section"],
    initial = bySubject["Initial draft"]
  assert.equal(merge.parents.length, 2)
  assert.equal(merge.parents[0], mainEdit.hash)
  assert.equal(merge.parents[1], feature.hash)
  assert(feature.refs.some((r) => r.name === "feature"))
  assert.equal(initial.parents.length, 0)
  const shown = await readBoundGitShow({ ...input, commit: merge.hash })
  assert.equal(shown.commit.subject, "Merge feature")
  assert.deepEqual(
    shown.files.map((f) => [f.path, f.added]),
    [["feature.tex", 1]],
  ) // merge described against first parent
  const rootShow = await readBoundGitShow({ ...input, commit: initial.hash })
  assert.deepEqual(rootShow.files, [{ path: "main.tex", added: 1, deleted: 0 }])
  await assert.rejects(readBoundGitShow({ ...input, commit: "../../etc/passwd" }), /Invalid commit/)
  // A subdirectory without its own .git must not inherit the enclosing repository's history.
  const outer = await mkdtemp(path.join(tmpdir(), "envoi-git-nested-"))
  try {
    const inner = path.join(outer, "demo")
    await mkdir(path.join(inner, ".envoi"), { recursive: true })
    await writeFile(path.join(inner, ".envoi/git-proof"), proof)
    execFileSync("git", ["init", "-b", "main"], { cwd: outer })
    execFileSync(
      "git",
      ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "outer"],
      { cwd: outer },
    )
    const nested = await readBoundGitLog({ directory: inner, proof })
    assert.equal(nested.state, "nested")
    assert.equal(nested.commits.length, 0)
    assert.match(nested.enclosing, /envoi-git-nested-/)
    execFileSync("git", ["init", "-b", "main"], { cwd: inner })
    assert.equal((await readBoundGitLog({ directory: inner, proof })).state, "ready") // own .git wins
  } finally {
    await rm(outer, { recursive: true, force: true })
  }
  console.log(
    "PASS native Git log/show: branch+merge topology, refs, first-parent merge stat, root tree, commit validation",
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
