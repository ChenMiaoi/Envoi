import { readdirSync, lstatSync, readFileSync, existsSync, renameSync } from "node:fs"
import { randomUUID, createHash } from "node:crypto"
import path from "node:path"
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

// papers/ is the editable filesystem view. Hash-addressed attachments are recovery snapshots.
export function paperFiles({ root, db, attachments, notes, safeDirectory, safeFile, atomic }) {
  const directory = safeDirectory(root, "papers")
  db.exec(
    "CREATE TABLE IF NOT EXISTS paper_files(paper TEXT PRIMARY KEY,path TEXT NOT NULL,hash TEXT NOT NULL,visible INTEGER NOT NULL DEFAULT 1,mtime REAL,size INTEGER)",
  )
  const link = (paper) => db.prepare("SELECT * FROM paper_files WHERE paper=?").get(paper)
  const remember = (paper, relative, hash) => {
    const stat = lstatSync(safeFile(path.join(root, relative)))
    db.prepare("INSERT OR REPLACE INTO paper_files VALUES (?,?,?,?,?,?)").run(
      paper,
      relative,
      hash,
      1,
      stat.mtimeMs,
      stat.size,
    )
  }
  function publish(paper, bytes) {
    if (!/^[a-f0-9]{64}$/.test(paper.attachment)) throw Error("无效 PDF 指纹")
    const metadata = JSON.parse(paper.metadata)
    const stem =
      String(metadata.attachmentName || metadata.title || "paper")
        .replace(/\.pdf$/i, "")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/^\.+|[. ]+$/g, "")
        .slice(0, 100) || "paper"
    let relative = `papers/${stem}-${paper.attachment.slice(0, 12)}.pdf`
    if (existsSync(path.join(root, relative))) {
      const current = readFileSync(safeFile(path.join(root, relative)))
      if (digest(current) !== paper.attachment) relative = `papers/${stem}-${randomUUID()}.pdf`
    }
    if (!existsSync(path.join(root, relative))) atomic(path.join(root, relative), bytes)
    remember(paper.id, relative, paper.attachment)
  }
  function remove(paper) {
    const current = link(paper.id)
    if (!current) {
      db.prepare("INSERT INTO paper_files VALUES (?,?,?,?,?,?)").run(
        paper.id,
        "",
        paper.attachment ?? "",
        0,
        0,
        0,
      )
      return true
    }
    if (!current.path) return true
    if (
      !current.path.startsWith("papers/") ||
      current.path.includes("\\") ||
      current.path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw Error("无效论文文件映射")
    const file = path.join(root, current.path)
    if (existsSync(file)) {
      const trash = safeDirectory(root, `papers/.trash/${randomUUID()}`)
      renameSync(safeFile(file), path.join(trash, path.basename(file)))
    }
    db.prepare("UPDATE paper_files SET visible=0 WHERE paper=?").run(paper.id)
    return true
  }
  function sync() {
    const warnings = []
    for (const paper of db
      .prepare(
        "SELECT * FROM papers WHERE attachment IS NOT NULL AND id NOT IN (SELECT paper FROM paper_files)",
      )
      .all()) {
      const old = safeFile(path.join(attachments, paper.attachment + ".pdf"))
      if (existsSync(old)) publish(paper, readFileSync(old))
    }
    const files = new Map()
    function scan(folder) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue
        const file = path.join(folder, entry.name)
        if (entry.isSymbolicLink()) {
          warnings.push(`已跳过链接：${path.relative(root, file)}`)
          continue
        }
        if (entry.isDirectory()) scan(file)
        else if (entry.isFile() && /\.pdf$/i.test(entry.name))
          files.set(path.relative(root, file).split(path.sep).join("/"), file)
      }
    }
    scan(directory)
    const valid = new Set()
    for (const [relative, file] of files) {
      const previous = db
        .prepare("SELECT * FROM paper_files WHERE path=? ORDER BY visible DESC")
        .get(relative)
      const stat = lstatSync(safeFile(file))
      if (previous && previous.mtime === stat.mtimeMs && previous.size === stat.size) {
        valid.add(relative)
        db.prepare("UPDATE paper_files SET visible=1 WHERE paper=?").run(previous.paper)
        continue
      }
      if (stat.size > 100_000_000) {
        warnings.push(`PDF 超过 100 MB：${relative}`)
        continue
      }
      const bytes = readFileSync(safeFile(file))
      if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
        warnings.push(`不是有效 PDF：${relative}`)
        continue
      }
      const hash = digest(bytes)
      let paper = previous
        ? db.prepare("SELECT * FROM papers WHERE id=?").get(previous.paper)
        : db.prepare("SELECT * FROM papers WHERE attachment=?").get(hash)
      if (paper && !previous) {
        const existing = link(paper.id)
        if (
          existing &&
          existing.visible &&
          existing.path !== relative &&
          files.has(existing.path)
        ) {
          warnings.push(`重复 PDF 未重复收录：${relative}`)
          continue
        }
      }
      atomic(path.join(attachments, hash + ".pdf"), bytes)
      if (!paper) {
        const paperId = randomUUID()
        const metadata = {
          title: path.basename(file).replace(/\.pdf$/i, ""),
          author: "",
          year: "",
          venue: "",
          tags: [],
          collection: "",
          status: "待读",
          attachmentName: path.basename(file),
          created: Date.now(),
        }
        atomic(path.join(notes, paperId + ".md"), "")
        db.prepare("INSERT INTO papers VALUES (?,?,?,?,?)").run(
          paperId,
          JSON.stringify(metadata),
          hash,
          1,
          digest(""),
        )
        db.prepare("INSERT INTO revisions VALUES (?,?,?,?,?)").run(
          paperId,
          1,
          "",
          "folder",
          Date.now(),
        )
        paper = { id: paperId, attachment: hash }
      } else if (paper.attachment !== hash) {
        db.prepare("UPDATE papers SET attachment=? WHERE id=?").run(hash, paper.id)
        db.prepare("DELETE FROM state WHERE paper=? AND key='reading'").run(paper.id)
      }
      remember(paper.id, relative, hash)
      valid.add(relative)
    }
    for (const entry of db.prepare("SELECT * FROM paper_files").all())
      if (!valid.has(entry.path))
        db.prepare("UPDATE paper_files SET visible=0 WHERE paper=?").run(entry.paper)
    return warnings
  }
  return { sync, publish, remove, link }
}
