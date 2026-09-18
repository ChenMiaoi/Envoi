import { mountDirectory, installDesktopFixture } from "./desktopFixture"
import { saveProjectConfiguration } from "../src/settings/projectSettings"
import { paperTemplates, templateFiles } from "../src/lib/paperTemplates"
import assert from "node:assert/strict"
import { test, beforeEach } from "node:test"
beforeEach(installDesktopFixture)
import {
  persistBuild,
  persistDiagnostics,
  createPaper,
  createTextFile,
  dirtyFiles,
  projectTree,
  readProject,
  safePath,
  saveProject,
  renameProjectPath,
  removeProjectPath,
  mergeDiskProject,
} from "../src/lib/projectFiles"
class MemoryFile {
  kind = "file" as const
  failWrite = false
  constructor(
    public name: string,
    public contents = "",
  ) {}
  async getFile() {
    return new File([this.contents], this.name)
  }
  async createWritable() {
    if (this.failWrite) throw new DOMException("Permission denied", "NotAllowedError")
    let buffer = this.contents
    return {
      write: async (text: string) => {
        buffer = text
      },
      close: async () => {
        this.contents = buffer
      },
      abort: async () => {},
    }
  }
}
class MemoryDirectory {
  kind = "directory" as const
  async queryPermission() {
    return "granted" as const
  }
  children = new Map<string, MemoryDirectory | MemoryFile>()
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const child = this.children.get(name)
    if (child && child.kind !== "directory")
      throw new DOMException("File occupies name", "TypeMismatchError")
    if (child) return child
    if (!options?.create) throw new DOMException("Missing", "NotFoundError")
    const result = new MemoryDirectory(name)
    this.children.set(name, result)
    return result
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const child = this.children.get(name)
    if (child && child.kind !== "file")
      throw new DOMException("Directory occupies name", "TypeMismatchError")
    if (child) return child
    if (!options?.create) throw new DOMException("Missing", "NotFoundError")
    const result = new MemoryFile(name)
    this.children.set(name, result)
    return result
  }
  async *entries() {
    yield* this.children.entries()
  }
  asHandle() {
    return mountDirectory(this)
  }
}
test("renaming a directory keeps drafts saveable and persists the relocated main file", async () => {
  const root = new MemoryDirectory("rename"),
    source = new MemoryDirectory("source")
  source.children.set("main.tex", new MemoryFile("main.tex", "original"))
  source.children.set("notes.md", new MemoryFile("notes.md", "notes"))
  root.children.set("source", source)
  const config = new MemoryDirectory(".envoi")
  config.children.set(
    "project.json",
    new MemoryFile("project.json", JSON.stringify({ main: "source/main.tex" })),
  )
  root.children.set(".envoi", config)
  const initial = await readProject(root.asHandle())
  initial.files.find((file) => file.path === "source/main.tex")!.text = "unsaved"
  root.children.delete("source")
  root.children.set("renamed", source)
  const renamed = renameProjectPath(initial, "source", "renamed")
  const project = mergeDiskProject(renamed, await readProject(initial.rootPath!))
  assert.equal(project.rootId, "renamed/main.tex")
  assert(!project.files.some((file) => file.path.startsWith("source/")))
  assert.equal(project.files.find((file) => file.path === "renamed/main.tex")?.text, "unsaved")
  await saveProject(project, () => {})
  const reopened = await readProject(initial.rootPath!)
  assert.equal(reopened.rootId, "renamed/main.tex")
  assert.equal(reopened.files.find((file) => file.path === "renamed/main.tex")?.text, "unsaved")
  const deleted = removeProjectPath(project, "renamed")
  assert.equal(deleted.rootId, "")
  assert(!deleted.files.some((file) => file.path.startsWith("renamed/")))
  assert(!deleted.directories.includes("renamed"))
})

test("renamed binary assets regain their new URLs after disk refresh", () => {
  const project = {
    id: "asset",
    name: "asset",
    rootPath: "/asset",
    rootId: "",
    directories: [],
    files: [
      { id: "a.pdf", path: "a.pdf", kind: "pdf" as const, version: "1", url: "envoi://a.pdf" },
    ],
  }
  const renamed = renameProjectPath(project, "a.pdf", "b.pdf")
  const disk = {
    ...renamed,
    files: renamed.files.map((file) => ({ ...file, url: "envoi://b.pdf" })),
  }
  assert.equal(mergeDiskProject(renamed, disk).files[0].url, "envoi://b.pdf")
})

test("Markdown and code projects save project preferences without a LaTeX main", async () => {
  const root = new MemoryDirectory("research")
  root.children.set("notes.md", new MemoryFile("notes.md", "notes"))
  root.children.set("analysis.py", new MemoryFile("analysis.py", "print(1)"))
  const project = await readProject(root.asHandle())
  assert.equal(project.rootId, "")
  const changed = await saveProjectConfiguration(project, {
    version: 1,
    overrides: { lintEnabled: false },
  })
  assert.equal((await readProject(project.rootPath!)).settings?.overrides.lintEnabled, false)
  await assert.rejects(
    saveProjectConfiguration(changed, { version: 1, overrides: {} }, "analysis.py"),
    /LaTeX/,
  )
  await saveProjectConfiguration(changed, { version: 1, overrides: {} })
  assert.deepEqual((await readProject(project.rootPath!)).settings?.overrides, {})
})
test("safe paths reject traversal, absolute paths and empty components", () => {
  for (const path of ["../x.tex", "/x.tex", "chapters//x.tex", "a/../b", "a\\b", ""])
    assert.throws(() => safePath(path))
  assert.deepEqual(safePath("chapters/method.tex"), ["chapters", "method.tex"])
})
test("new project creates a real directory model and never overwrites a namesake", async () => {
  const parent = new MemoryDirectory("chosen")
  const directory = await createPaper(parent.asHandle(), "paper")
  const project = await readProject(directory)
  assert.equal(project.rootId, "main.tex")
  assert(project.files.some((f) => f.path === "chapters/introduction.tex"))
  assert(project.directories.includes("build"))
  assert.equal(dirtyFiles(project).length, 0)
  assert.equal(
    JSON.parse(project.files.find((f) => f.path === ".envoi/project.json")!.text!).git.status,
    "pending-local-init",
  )
  assert(
    !projectTree(project.files, project.directories).some((n) =>
      ["build", ".gitignore", "paperdesk.json"].includes(n.name),
    ),
  )
  await assert.rejects(createPaper(parent.asHandle(), "paper"), /已存在/)
  await assert.rejects(createTextFile(directory, "main.tex", "overwrite"), /已存在/)
  assert.match(project.files.find((f) => f.path === "main.tex")!.text!, /documentclass/)
  const tree = projectTree(project.files, project.directories)
  assert(tree.find((n) => n.name === "assets")?.kind === "folder")
})
test("saving persists edits, detects external changes before writing anything", async () => {
  const root = new MemoryDirectory("paper")
  root.children.set("main.tex", new MemoryFile("main.tex", "original"))
  root.children.set("references.bib", new MemoryFile("references.bib", "bib"))
  const project = await readProject(root.asHandle())
  project.files.find((f) => f.id === "main.tex")!.text = "edited"
  const saved: string[] = []
  await saveProject(project, (id, text) => {
    saved.push(id)
    project.files.find((f) => f.id === id)!.saved = text
  })
  assert.deepEqual(saved, ["main.tex"])
  assert.equal((root.children.get("main.tex") as MemoryFile).contents, "edited")
  assert.equal(dirtyFiles(project).length, 0)
  project.files.find((f) => f.id === "main.tex")!.text = "next"
  project.files.find((f) => f.id === "references.bib")!.text = "new bib"
  ;(root.children.get("references.bib") as MemoryFile).contents = "external"
  await assert.rejects(
    saveProject(project, () => assert.fail("must not save")),
    /外部修改/,
  )
  assert.equal((root.children.get("main.tex") as MemoryFile).contents, "edited")
  assert.equal(dirtyFiles(project).length, 2)
})
test("permission/write failure retains unsaved data and marks only completed writes", async () => {
  const root = new MemoryDirectory("paper")
  root.children.set("a.tex", new MemoryFile("a.tex", "a"))
  const blocked = new MemoryFile("b.tex", "b")
  blocked.failWrite = true
  root.children.set("b.tex", blocked)
  const project = await readProject(root.asHandle())
  project.files.forEach((f) => (f.text += " changed"))
  const saved: string[] = []
  await assert.rejects(
    saveProject(project, (id, text) => {
      saved.push(id)
      project.files.find((f) => f.id === id)!.saved = text
    }),
  )
  assert.deepEqual(saved, ["a.tex"])
  assert.equal(dirtyFiles(project)[0].id, "b.tex")
  assert.equal(blocked.contents, "b")
})
test("loading another project produces independent sources without mutating dirty project", async () => {
  const first = new MemoryDirectory("first")
  first.children.set("main.tex", new MemoryFile("main.tex", "first"))
  const second = new MemoryDirectory("second")
  second.children.set("main.tex", new MemoryFile("main.tex", "second"))
  const old = await readProject(first.asHandle())
  old.files[0].text = "unsaved"
  const next = await readProject(second.asHandle())
  assert.notEqual(old.id, next.id)
  assert.equal(old.files[0].text, "unsaved")
  assert.equal(next.files[0].text, "second")
  assert.equal(dirtyFiles(next).length, 0)
})

test("Git opt-out creates no repository; PDF inputs remain visible", async () => {
  const parent = new MemoryDirectory("root")
  const directory = await createPaper(parent.asHandle(), "no-git", "acm-conf", false)
  assert(!(await readProject(directory)).directories.includes(".git"))
  const tree = projectTree(
    [
      { id: "assets/plot.pdf", path: "assets/plot.pdf", kind: "pdf" },
      { id: "build/main.pdf", path: "build/main.pdf", kind: "pdf" },
    ],
    ["build", "assets"],
  )
  assert.equal(tree.length, 1)
  assert.equal(tree[0].children![0].name, "plot.pdf")
})

test("research and writing templates provide their own files and explicit Git opt-out", () => {
  for (const template of paperTemplates) {
    const files = templateFiles(template.id)
    for (const key of template.id === "research"
      ? ["notes/research-plan.md", "references.bib", ".gitignore", ".envoi/project.json"]
      : [
          "main.tex",
          "chapters/introduction.tex",
          "references.bib",
          ".gitignore",
          ".envoi/project.json",
          "data/README.md",
          "build/README.md",
        ])
      assert(key in files)
    assert(!files["references.bib"].includes("@book"))
    if (template.id === "research") assert.equal(files["main.tex"], undefined)
    assert.equal(JSON.parse(files[".envoi/project.json"]).git.branch, "main")
    assert.equal(
      JSON.parse(templateFiles(template.id, false)[".envoi/project.json"]).git.requested,
      false,
    )
    assert.match(files[".gitignore"], /\/build\//)
    assert(!files[".gitignore"].includes("*.pdf"))
  }
})

test("project build diagnostics restore result, engine, timestamp and source position", async () => {
  const directory = new MemoryDirectory("paper")
  directory.children.set("main.tex", new MemoryFile("main.tex", "text"))
  const record = {
    items: [
      { id: "one", severity: "warning" as const, message: "warning", path: "main.tex", line: 1 },
    ],
    signature: "fingerprint",
    rootId: "main.tex",
    status: "success" as const,
    log: "actual log",
    engine: "pdflatex",
    timestamp: 12345,
  }
  await persistDiagnostics(directory.asHandle(), record)
  const project = await readProject(directory.asHandle())
  assert.deepEqual(project.diagnostics, record)
  assert.equal(project.compileLog, "actual log")
  assert(!projectTree(project.files, project.directories).some((n) => n.name === "build"))
})

test("project preferences persist, restore inheritance and stay isolated from another project", async () => {
  const a = new MemoryDirectory("a"),
    b = new MemoryDirectory("b")
  for (const root of [a, b]) {
    root.children.set("main.tex", new MemoryFile("main.tex", "text"))
    root.children.set(
      "paperdesk.json",
      new MemoryFile(
        "paperdesk.json",
        JSON.stringify({ main: "main.tex", engine: "pdflatex", name: root.name }),
      ),
    )
  }
  const original = await readProject(a.asHandle())
  assert.equal(original.settings!.overrides.engine, "pdflatex")
  const changed = await saveProjectConfiguration(original, {
    version: 1,
    overrides: { engine: "xelatex", lintEnabled: false, disabledRules: [26] },
  })
  assert.equal((await readProject(a.asHandle())).settings!.overrides.engine, "xelatex")
  assert.equal((await readProject(b.asHandle())).settings!.overrides.engine, "pdflatex")
  await saveProjectConfiguration(changed, { version: 1, overrides: {} })
  const restored = await readProject(a.asHandle())
  assert.deepEqual(restored.settings!.overrides, {})
  assert.equal(restored.engine, undefined)
  assert.equal(JSON.parse(restored.files.find((f) => f.path === "paperdesk.json")!.text!).name, "a")
})

test("project settings write to isolated disk directories and reject external conflicts", async () => {
  const fs = await import("node:fs/promises"),
    { join, basename } = await import("node:path"),
    { tmpdir } = await import("node:os")
  const temporary = await fs.mkdtemp(join(tmpdir(), "envoi-settings-"))
  function diskFile(path: string) {
    return {
      kind: "file",
      name: basename(path),
      async getFile() {
        return new File([await fs.readFile(path)], basename(path))
      },
      async createWritable() {
        let content: string | Blob = ""
        return {
          async write(text: string | Blob) {
            content = text
          },
          async close() {
            await fs.writeFile(
              path,
              typeof content === "string" ? content : new Uint8Array(await content.arrayBuffer()),
            )
          },
          async abort() {},
        }
      },
    }
  }
  function diskDirectory(path: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: basename(path),
      async queryPermission() {
        return "granted"
      },
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const target = join(path, name)
        if (options?.create) await fs.mkdir(target, { recursive: true })
        try {
          await fs.access(target)
        } catch {
          throw new DOMException("Missing", "NotFoundError")
        }
        return diskDirectory(target)
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const target = join(path, name)
        try {
          await fs.access(target)
        } catch {
          if (!options?.create) throw new DOMException("Missing", "NotFoundError")
          await fs.writeFile(target, "")
        }
        return diskFile(target)
      },
      async *entries() {
        for (const entry of await fs.readdir(path, { withFileTypes: true }))
          yield [
            entry.name,
            entry.isDirectory()
              ? diskDirectory(join(path, entry.name))
              : diskFile(join(path, entry.name)),
          ]
      },
    } as unknown as FileSystemDirectoryHandle
  }
  try {
    for (const name of ["a", "b"]) {
      await fs.mkdir(join(temporary, name))
      await fs.writeFile(join(temporary, name, "main.tex"), "original source")
      await fs.writeFile(join(temporary, name, "other.tex"), "second source")
      await fs.writeFile(
        join(temporary, name, "paperdesk.json"),
        JSON.stringify({ main: "main.tex", name, settings: { version: 1, overrides: {} } }),
      )
    }
    const a = await readProject(mountDirectory(diskDirectory(join(temporary, "a")))),
      beforeB = await fs.readFile(join(temporary, "b", "paperdesk.json"), "utf8")
    const changed = await saveProjectConfiguration(
      a,
      { version: 1, overrides: { engine: "xelatex", lintEnabled: false, disabledRules: [26] } },
      "other.tex",
    )
    const reopened = await readProject(mountDirectory(diskDirectory(join(temporary, "a"))))
    assert.equal(reopened.rootId, "other.tex")
    assert.deepEqual(reopened.settings?.overrides, {
      engine: "xelatex",
      lintEnabled: false,
      disabledRules: [26],
    })
    assert.equal(await fs.readFile(join(temporary, "b", "paperdesk.json"), "utf8"), beforeB)
    assert.equal(await fs.readFile(join(temporary, "a", "main.tex"), "utf8"), "original source")
    await saveProjectConfiguration(changed, { version: 1, overrides: {} })
    assert.deepEqual(
      (await readProject(mountDirectory(diskDirectory(join(temporary, "a"))))).settings?.overrides,
      {},
    )
    const external = '{"main":"main.tex","name":"external change"}'
    await fs.writeFile(join(temporary, "a", ".envoi", "project.json"), external)
    await assert.rejects(
      saveProjectConfiguration(changed, { version: 1, overrides: { engine: "pdflatex" } }),
      /外部修改/,
    )
    assert.equal(
      await fs.readFile(join(temporary, "a", ".envoi", "project.json"), "utf8"),
      external,
    )
    await persistBuild(
      mountDirectory(diskDirectory(join(temporary, "a"))),
      new File(["%PDF-fixture"], "main.pdf"),
      "success log",
      '{"version":1}',
    )
    await persistDiagnostics(mountDirectory(diskDirectory(join(temporary, "a"))), {
      items: [],
      signature: "snapshot",
      rootId: "other.tex",
      status: "failed",
      log: "failed log",
    })
    assert.equal(
      await fs.readFile(join(temporary, "a", "build", "main.pdf"), "utf8"),
      "%PDF-fixture",
    )
    assert.equal(
      await fs.readFile(join(temporary, "a", "build", "compile.log"), "utf8"),
      "failed log",
    )
    assert.equal(
      JSON.parse(await fs.readFile(join(temporary, "a", "build", "diagnostics.json"), "utf8"))
        .status,
      "failed",
    )
    assert.deepEqual(
      JSON.parse(await fs.readFile(join(temporary, "a", "build", "preview.json"), "utf8")),
      { version: 1 },
    )
    await assert.rejects(fs.access(join(temporary, "b", "build")))
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

test("build output is scoped to the selected project and denied diagnostics are not reported saved", async () => {
  const a = new MemoryDirectory("paper-a"),
    b = new MemoryDirectory("paper-b")
  await persistBuild(
    a.asHandle(),
    new File(["%PDF-output"], "main.pdf"),
    "actual log",
    '{"version":1}',
  )
  await persistDiagnostics(a.asHandle(), {
    items: [],
    signature: "source",
    rootId: "main.tex",
    status: "failed",
    log: "later failed compile log",
  })
  const build = await a.getDirectoryHandle("build")
  assert.deepEqual([...build.children.keys()].sort(), [
    "compile.log",
    "diagnostics.json",
    "main.pdf",
    "preview.json",
  ])
  assert.equal(
    await ((await build.getFileHandle("compile.log")) as MemoryFile)
      .getFile()
      .then((f) => f.text()),
    "later failed compile log",
  )
  assert.equal(b.children.size, 0)
  const denied = "/missing-root"
  await assert.rejects(persistBuild(denied, new File(["pdf"], "main.pdf"), "log"), /目录不可用/)
  await assert.rejects(
    persistDiagnostics(denied, {
      items: [],
      signature: "",
      rootId: "main.tex",
      status: "failed",
      log: "failure",
    }),
    /目录不可用/,
  )
})

test("hidden project configuration wins, migration preserves legacy and refuses competing new files", async () => {
  const directory = new MemoryDirectory("paper")
  directory.children.set("main.tex", new MemoryFile("main.tex", "source"))
  const legacy = JSON.stringify({
    main: "main.tex",
    engine: "xelatex",
    unknown: { keep: true },
    apiKey: "private",
  })
  directory.children.set("paperdesk.json", new MemoryFile("paperdesk.json", legacy))
  const old = await readProject(directory.asHandle())
  const changed = await saveProjectConfiguration(old, {
    version: 1,
    overrides: { engine: "xelatex" },
  })
  assert.equal((directory.children.get("paperdesk.json") as MemoryFile).contents, legacy)
  const management = await directory.getDirectoryHandle(".envoi"),
    stored = (management.children.get("project.json") as MemoryFile).contents
  assert(!stored.includes("private"))
  assert(!stored.includes("unknown"))
  await assert.rejects(saveProjectConfiguration(old, { version: 1, overrides: {} }), /新配置已存在/)
  assert.equal((await readProject(directory.asHandle())).settings?.overrides.engine, "xelatex")
  ;(directory.children.get("paperdesk.json") as MemoryFile).contents = "{}"
  assert.equal((await readProject(directory.asHandle())).settings?.overrides.engine, "xelatex")
  await saveProjectConfiguration(changed, { version: 1, overrides: {} })
  assert.deepEqual((await readProject(directory.asHandle())).settings?.overrides, {})
  ;(management.children.get("project.json") as MemoryFile).contents = "invalid"
  await assert.rejects(readProject(directory.asHandle()), /格式无效/)
})

test("legacy .paperdesk configuration still opens and saves migrate forward to .envoi", async () => {
  const directory = new MemoryDirectory("paper")
  directory.children.set("main.tex", new MemoryFile("main.tex", "source"))
  const management = new MemoryDirectory(".paperdesk")
  management.children.set(
    "project.json",
    new MemoryFile(
      "project.json",
      JSON.stringify({
        projectId: "legacy-id",
        main: "main.tex",
        settings: { version: 1, overrides: { engine: "xelatex" } },
      }),
    ),
  )
  directory.children.set(".paperdesk", management)
  const project = await readProject(directory.asHandle())
  assert.equal(project.id, "legacy-id")
  assert.equal(project.settings?.overrides.engine, "xelatex")
  await saveProjectConfiguration(project, { version: 1, overrides: { engine: "pdflatex" } })
  const reopened = await readProject(directory.asHandle())
  assert.equal(reopened.id, "legacy-id")
  assert.equal(reopened.settings?.overrides.engine, "pdflatex")
  assert(directory.children.has(".envoi"))
  assert.equal(
    (management.children.get("project.json") as MemoryFile).contents.includes("xelatex"),
    true,
  )
})

test("immediate save uses latest buffer once, preserves edits during write and reports failures", async () => {
  const { createProjectSaver } = await import("../src/lib/projectSaver")
  const root = new MemoryDirectory("paper")
  const file = new MemoryFile("notes.md", "original")
  root.children.set("notes.md", file)
  let project = await readProject(root.asHandle()),
    status = ""
  let writes = 0,
    finish: () => void = () => {}
  file.createWritable = async () => {
    writes++
    let value = ""
    return {
      write: async (text) => {
        value = text
      },
      close: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            file.contents = value
            resolve()
          }
        }),
      abort: async () => {},
    }
  }
  const save = createProjectSaver({
    getProject: () => project,
    setProject: (fn) => {
      project = fn(project)
    },
    message: (value) => {
      status = value
    },
    saving: () => {},
  })
  project = { ...project, files: project.files.map((f) => ({ ...f, text: "unblurred input" })) }
  const pending = save()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await save()
  assert.equal(writes, 1)
  project = { ...project, files: project.files.map((f) => ({ ...f, text: "typed during save" })) }
  finish()
  await pending
  assert.equal(file.contents, "unblurred input")
  assert.equal(project.files[0].saved, "unblurred input")
  assert.equal(project.files[0].text, "typed during save")
  assert.match(status, /新修改仍未保存/)
  file.contents = "external"
  await save()
  assert.equal(writes, 1)
  assert.match(status, /外部修改/)
  assert.equal(project.files[0].text, "typed during save")
})

test("disk refresh keeps dirty and deleted drafts while updating clean files", async () => {
  const { mergeDiskProject } = await import("../src/lib/projectFiles")
  const root = new MemoryDirectory("paper")
  root.children.set("main.tex", new MemoryFile("main.tex", "old"))
  root.children.set("notes.md", new MemoryFile("notes.md", "old note"))
  const initial = await readProject(root.asHandle())
  const current = {
    ...initial,
    files: initial.files.map((file) =>
      file.path === "main.tex" ? { ...file, text: "unsaved draft" } : file,
    ),
  }
  ;(root.children.get("main.tex") as MemoryFile).contents = "external version"
  ;(root.children.get("notes.md") as MemoryFile).contents = "new note"
  const disk = await readProject(initial.rootPath!)
  const merged = mergeDiskProject(current, disk)
  assert.equal(merged.files.find((file) => file.path === "main.tex")?.text, "unsaved draft")
  assert.equal(merged.files.find((file) => file.path === "main.tex")?.saved, "old")
  assert.equal(merged.files.find((file) => file.path === "notes.md")?.text, "new note")
  assert.equal(mergeDiskProject(merged, disk), merged)
  root.children.delete("main.tex")
  const deleted = mergeDiskProject(merged, await readProject(initial.rootPath!))
  assert.equal(deleted.files.find((file) => file.path === "main.tex")?.text, "unsaved draft")
})

test("project settings reject a competing write after reading their baseline", async () => {
  const directory = new MemoryDirectory("settings-race")
  directory.children.set("main.tex", new MemoryFile("main.tex", "source"))
  const first = await saveProjectConfiguration(await readProject(directory.asHandle()), {
    version: 1,
    overrides: {},
  })
  const config = (await directory.getDirectoryHandle(".envoi")).children.get(
    "project.json",
  ) as MemoryFile
  const save = window.envoi!.fsSave
  const competing = JSON.stringify({ ...JSON.parse(config.contents), otherWindow: "preserve me" })
  window.envoi!.fsSave = async (...args) => {
    config.contents = competing
    return save(...args)
  }
  await assert.rejects(
    saveProjectConfiguration(first, {
      version: 1,
      overrides: { engine: "xelatex" },
    }),
    /外部修改/,
  )
  assert.equal(config.contents, competing)
})

test("ignore write failure leaves project settings unchanged and permits retry", async () => {
  const directory = new MemoryDirectory("settings-permission")
  directory.children.set("main.tex", new MemoryFile("main.tex", "source"))
  const ignore = new MemoryFile(".gitignore", "custom-rule\n")
  ignore.failWrite = true
  directory.children.set(".gitignore", ignore)
  const project = await readProject(directory.asHandle())
  await assert.rejects(
    saveProjectConfiguration(project, {
      version: 1,
      overrides: { engine: "xelatex" },
    }),
    /Permission denied/,
  )
  assert.equal(directory.children.has(".envoi"), false)
  assert.equal(ignore.contents, "custom-rule\n")
  ignore.failWrite = false
  await saveProjectConfiguration(project, { version: 1, overrides: { engine: "xelatex" } })
  assert.equal((await readProject(project.rootPath!)).settings?.overrides.engine, "xelatex")
})

test("unreadable settings are not treated as missing configuration", async () => {
  const directory = new MemoryDirectory("settings-unreadable")
  directory.children.set("main.tex", new MemoryFile("main.tex", "source"))
  const project = await readProject(directory.asHandle())
  window.envoi!.fsRead = async () => {
    throw new DOMException("Permission denied", "NotAllowedError")
  }
  await assert.rejects(
    saveProjectConfiguration(project, { version: 1, overrides: {} }),
    /Permission denied/,
  )
  assert.equal(directory.children.has(".envoi"), false)
})
