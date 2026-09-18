import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { libraryRequest as request } from "../server/research-library.mjs"
const pdf = Buffer.from("%PDF-1.4\nPaper directory fixture")
async function temporary(run) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-paper-files-")))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test("papers additions, renames, removal and recovery preserve paper identity and notes", async () =>
  temporary(async (root) => {
    await mkdir(path.join(root, "papers/related"), { recursive: true })
    await writeFile(path.join(root, "papers/related/Study.pdf"), pdf)
    const first = (await request(root, { action: "list" })).papers[0]
    assert.equal(first.attachmentPath, "papers/related/Study.pdf")
    await request(root, {
      action: "note",
      paperId: first.id,
      text: "Evidence on page 2",
      expectedRevision: 1,
    })
    await request(root, {
      action: "state",
      paperId: first.id,
      key: "chat",
      value: { id: "test", messages: [{ role: "user", text: "Question" }] },
    })
    await rename(path.join(root, first.attachmentPath), path.join(root, "papers/Renamed.pdf"))
    const renamed = (await request(root, { action: "list" })).papers[0]
    assert.equal(renamed.id, first.id)
    assert.equal(renamed.attachmentPath, "papers/Renamed.pdf")
    await rm(path.join(root, renamed.attachmentPath))
    assert.equal((await request(root, { action: "list" })).papers.length, 0)
    await writeFile(path.join(root, "papers/Restored.pdf"), pdf)
    const restored = (await request(root, { action: "list" })).papers[0]
    assert.equal(restored.id, first.id)
    const detail = await request(root, { action: "get", paperId: first.id })
    assert.equal(detail.note.text, "Evidence on page 2")
    assert.equal(detail.state.chat.messages[0].text, "Question")
    await request(root, { action: "remove", paperId: first.id })
    assert.equal((await request(root, { action: "list" })).papers.length, 0)
    await assert.rejects(readFile(path.join(root, "papers/Restored.pdf")), { code: "ENOENT" })
    const trash = await readdir(path.join(root, "papers/.trash"))
    assert.deepEqual(
      await readFile(path.join(root, "papers/.trash", trash[0], "Restored.pdf")),
      pdf,
    )
    await request(root, {
      action: "import",
      papers: [{ title: "Restored import", attachment: { $blob: pdf.toString("base64") } }],
    })
    assert.equal((await request(root, { action: "list" })).papers[0].id, first.id)
  }))
test("library import publishes files, migrates old storage and follows PDF content replacement", async () =>
  temporary(async (root) => {
    await request(root, {
      action: "import",
      papers: [
        {
          title: "Prior work",
          citationKey: "prior",
          attachment: { $blob: pdf.toString("base64") },
        },
      ],
    })
    const paper = (await request(root, { action: "list" })).papers[0]
    assert.deepEqual(await readFile(path.join(root, paper.attachmentPath)), pdf)
    const db = new DatabaseSync(path.join(root, ".envoi/library/library.sqlite"))
    db.exec("DROP TABLE paper_files; UPDATE meta SET value='1' WHERE key='schemaVersion'")
    db.close()
    await rm(path.join(root, "papers"), { recursive: true })
    const migrated = (await request(root, { action: "list" })).papers[0]
    assert.equal(migrated.id, paper.id)
    const upgraded = new DatabaseSync(path.join(root, ".envoi/library/library.sqlite"))
    assert.equal(
      upgraded.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get().value,
      "2",
    )
    upgraded.close()
    assert.deepEqual(await readFile(path.join(root, migrated.attachmentPath)), pdf)
    await request(root, {
      action: "state",
      paperId: paper.id,
      key: "reading",
      value: { page: 2, fraction: 0.5 },
    })
    const changed = Buffer.concat([pdf, Buffer.from("\nNew revision")])
    await writeFile(path.join(root, migrated.attachmentPath), changed)
    const fresh = await request(root, { action: "get", paperId: paper.id })
    assert.notEqual(fresh.attachmentHash, paper.attachmentHash)
    assert.equal(fresh.state.reading, undefined)
    assert.deepEqual(
      Buffer.from((await request(root, { action: "pdf", paperId: paper.id })).base64, "base64"),
      changed,
    )
    await writeFile(path.join(root, "papers/duplicate.pdf"), changed)
    const index = await request(root, { action: "list" })
    assert.equal(index.papers.length, 1)
    assert(index.warnings.some((w) => w.includes("重复 PDF")))
    await writeFile(path.join(root, "papers/not-a-pdf.pdf"), "HTML")
    assert(
      (await request(root, { action: "list" })).warnings.some((w) => w.includes("不是有效 PDF")),
    )
  }))

test("failed batches roll back published PDFs, snapshots and notes before retry", async () =>
  temporary(async (root) => {
    const paper = {
      id: "first",
      title: "Original title",
      author: "Original author",
      notes: "Original notes",
      attachment: { $blob: pdf.toString("base64") },
    }
    await assert.rejects(
      request(root, { action: "import", restore: true, papers: [paper, { title: null }] }),
      /无效文献标题/,
    )
    for (const dir of ["papers", ".envoi/library/attachments", ".envoi/library/notes"])
      assert.deepEqual(await readdir(path.join(root, dir)), [])
    assert.deepEqual((await request(root, { action: "list" })).papers, [])
    await request(root, { action: "import", restore: true, papers: [paper] })
    const restored = await request(root, { action: "get", paperId: "first" })
    assert.equal(restored.author, paper.author)
    assert.equal(restored.note.text, paper.notes)
    const before = await request(root, { action: "export" })
    const dirs = ["papers", ".envoi/library/attachments", ".envoi/library/notes"]
    await mkdir(path.join(root, ".envoi/library/notes/blocked.md"))
    const entries = await Promise.all(dirs.map((dir) => readdir(path.join(root, dir))))
    await assert.rejects(
      request(root, {
        action: "import",
        restore: true,
        papers: [
          {
            ...paper,
            id: "next",
            title: "Next",
            attachment: { $blob: Buffer.concat([pdf, Buffer.from("next")]).toString("base64") },
          },
          {
            ...paper,
            id: "blocked",
            attachment: { $blob: Buffer.concat([pdf, Buffer.from("blocked")]).toString("base64") },
          },
        ],
      }),
    )
    assert.deepEqual(await Promise.all(dirs.map((dir) => readdir(path.join(root, dir)))), entries)
    assert.deepEqual(await request(root, { action: "export" }), before)
  }))
