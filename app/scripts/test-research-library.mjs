import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-library-")))
process.env.ENVOI_DATA_DIR = path.join(temp, "data")
const { libraryRequest: request, paperNoteTools } = await import("../server/research-library.mjs")
const { createWorkspace } = await import("../server/workspaces.mjs")
const fixture = {
  title: "Attention study",
  author: "Test",
  collection: "相关工作",
  citationKey: "test2026",
  notes: "original",
  attachment: { $blob: Buffer.from("%PDF-1.4\nfixture").toString("base64") },
}
test("research library isolates projects, shares worktrees, persists notes and rejects stale AI writes", async () => {
  try {
    const main = path.join(temp, "main"),
      other = path.join(temp, "other")
    await mkdir(main)
    await mkdir(other)
    await request(main, {
      action: "import",
      papers: [fixture, { title: "Second paper", notes: "second" }],
    })
    assert.equal((await request(main, { action: "import", papers: [fixture] })).added, 0)
    const index = await request(main, { action: "list" }),
      paperId = index.papers[0].id,
      secondId = index.papers[1].id
    assert.equal((await request(other, { action: "list" })).papers.length, 0)
    await request(main, { action: "select", paperId, selectedAt: 2 })
    await request(main, { action: "select", paperId: secondId, selectedAt: 1 })
    assert.equal((await request(main, { action: "list" })).selected, paperId)
    const firstChat = {
      id: "legacy-chat",
      name: "First discussion",
      created: 1,
      status: "complete",
      piFile: "session.jsonl",
      messages: [{ id: "m", role: "user", text: "baseline question" }],
    }
    await request(main, { action: "state", paperId, key: "chat", value: firstChat })
    const next = await request(main, { action: "chat-new", paperId })
    assert.notEqual(next.id, firstChat.id)
    assert.equal(next.messages.length, 0)
    assert.equal(
      (await request(main, { action: "chat-list", paperId, query: "baseline" }))[0].id,
      firstChat.id,
    )
    assert.equal((await request(main, { action: "chat-list", paperId: secondId })).length, 0)
    await assert.rejects(
      request(main, { action: "chat-select", paperId: secondId, sessionId: firstChat.id }),
      /不存在/,
    )
    assert.deepEqual(
      await request(main, { action: "chat-select", paperId, sessionId: firstChat.id }),
      firstChat,
    )
    assert.equal(
      (await request(main, { action: "get", paperId })).state.chat.piFile,
      "session.jsonl",
    )
    const note = (await request(main, { action: "get", paperId })).note
    const tool = paperNoteTools(main, paperId)[0]
    await request(main, {
      action: "note",
      paperId,
      text: "user edit",
      expectedRevision: note.revision,
    })
    const conflict = JSON.parse(
      (
        await tool.execute("test", {
          action: "write",
          text: "stale AI edit",
          expectedRevision: note.revision,
        })
      ).content[0].text,
    )
    assert.equal(conflict.conflict, true)
    assert.equal((await request(main, { action: "get", paperId })).drafts[0].text, "stale AI edit")
    const fresh = JSON.parse((await tool.execute("read", { action: "read" })).content[0].text)
    await tool.execute("edit", {
      action: "write",
      text: "AI edited A",
      expectedRevision: fresh.note.revision,
    })
    assert.equal((await request(main, { action: "get", paperId: secondId })).note.text, "second")
    await assert.rejects(
      paperNoteTools(main, paperId, false)[0].execute("edit", {
        action: "write",
        text: "forbidden",
        expectedRevision: 3,
      }),
      /权限/,
    )
    await writeFile(path.join(main, ".envoi/library/notes", paperId + ".md"), "external edit")
    assert.equal((await request(main, { action: "get", paperId })).note.text, "external edit")
    const history = await request(main, { action: "history", paperId })
    assert(history.some((r) => r.text === "user edit"))
    assert(history.some((r) => r.text === "AI edited A" && r.actor === "ai"))
    await request(main, {
      action: "state",
      paperId,
      key: "reading",
      value: { page: 3, fraction: 0.2 },
    })
    await request(main, {
      action: "state",
      paperId,
      key: "chat",
      value: { id: "session", messages: [{ role: "user", text: "Research question" }] },
    })
    const archive = await request(main, { action: "export" })
    await request(other, { action: "import", papers: archive.papers, restore: true })
    assert.deepEqual((await request(other, { action: "get", paperId })).state.reading, {
      page: 3,
      fraction: 0.2,
    })
    assert.equal(
      (await request(other, { action: "get", paperId })).state.chat.messages[0].text,
      "Research question",
    )
    // A library is portable without its machine's global directory.
    const moved = path.join(temp, "moved")
    await rename(other, moved)
    assert.equal((await request(moved, { action: "get", paperId })).note.text, "external edit")
    execFileSync("git", ["init", "-b", "main", main], { stdio: "pipe" })
    await writeFile(path.join(main, ".gitignore"), ".envoi/\n")
    await writeFile(path.join(main, "README.md"), "test")
    for (const args of [
      ["add", "."],
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "-m",
        "fixture",
      ],
    ])
      execFileSync("git", args, { cwd: main, stdio: "pipe" })
    const worktree = await createWorkspace(main, { name: "experiment" })
    assert.equal((await request(worktree.path, { action: "list" })).researchId, index.researchId)
    const scoped = await request(worktree.path, { action: "list" }, () => true, { scoped: true })
    assert.notEqual(scoped.researchId, index.researchId)
    assert(!scoped.papers.some((paper) => paper.id === paperId))
    await request(
      worktree.path,
      { action: "import", papers: [{ title: "Worktree only" }] },
      () => true,
      { scoped: true },
    )
    assert(
      !(await request(main, { action: "list" })).papers.some(
        (paper) => paper.title === "Worktree only",
      ),
    )
    assert.equal(
      (await request(worktree.path, { action: "get", paperId })).note.text,
      "external edit",
    )
    const { listWorkspaces } = await import("../server/workspaces.mjs")
    const legacyStart = performance.now()
    for (let i = 0; i < 10; i++) await listWorkspaces(main)
    const legacyMs = performance.now() - legacyStart
    const { watchProjectDirectory } = await import("../electron/main/project-watch.mjs")
    const events = []
    const stop = watchProjectDirectory(main, (e) => events.push(e), { delay: 30, maxDelay: 100 })
    try {
      await new Promise((r) => setTimeout(r, 450))
      events.length = 0
      const start = performance.now()
      for (let i = 0; i < 10; i++)
        await request(main, {
          action: "state",
          paperId,
          key: "reading",
          value: { page: i + 1, fraction: 0 },
        })
      const readingMs = performance.now() - start
      await new Promise((r) => setTimeout(r, 450))
      assert.equal(
        events.length,
        0,
        "reading-state writes must not refresh the manuscript: " + JSON.stringify(events),
      )
      await writeFile(path.join(main, "README.md"), "external manuscript edit")
      await new Promise((r) => setTimeout(r, 450))
      assert(
        events.some((e) => e.paths.includes("README.md")),
        "ordinary file changes still reach the editor",
      )
      console.log(
        JSON.stringify({
          benchmark: "10 operations, temporary two-worktree project",
          legacyGitStatusMs: Math.round(legacyMs),
          readingStateMs: Math.round(readingMs),
          libraryRefreshEvents: 0,
        }),
      )
    } finally {
      stop()
    }
    const unsafe = path.join(temp, "unsafe")
    await mkdir(unsafe)
    await mkdir(path.join(unsafe, ".envoi"))
    await symlink(
      path.join(main, ".envoi/library"),
      path.join(unsafe, ".envoi/library"),
      process.platform === "win32" ? "junction" : "dir",
    )
    await assert.rejects(request(unsafe, { action: "list" }), /符号链接/)
    await assert.rejects(request(main, { action: "get", paperId: "../outside" }), /标识/)
    console.log(
      "PASS: isolation, worktree sharing, relocation, attachments, archive, conflict history, pinned AI and path guards",
    )
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 3 })
  }
})
