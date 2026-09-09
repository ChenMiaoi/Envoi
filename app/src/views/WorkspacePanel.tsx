import { openDirectory } from "@/lib/desktop"
import { useT } from "@/i18n/useT"
import { Notification } from "@/components/Notification"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Plus,
  RefreshCw,
  Archive,
} from "lucide-react"
import { envoi, ipcError } from "@/lib/desktop"
import { useProject } from "@/project/context"
import { dirtyFiles } from "@/lib/projectFiles"
import { saveSession } from "@/lib/projectSession"
type Workspace = {
  path: string
  name: string
  main: boolean
  current: boolean
  branch: string
  changes: number
  available: boolean
  purpose: string
  base?: string
}
type Overview = { main: string; initialized: boolean; workspaces: Workspace[] }
type Result = {
  id: string
  title: string
  summary: string
  command: string
  created: string
  experiment: string
  commit: string
  source: string
  files: { path: string; sha256: string }[]
}
const button =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary disabled:opacity-40"
export function WorkspacePanel({
  history,
}: {
  history: (root: string, revision: number) => ReactNode
}) {
  const { t } = useT()
  const { project, navigationBusy: projectBusy, agentWriting: taskBusy, saving } = useProject()
  const [overview, setOverview] = useState<Overview>(),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState<"history" | "results" | "changes">("history")
  const [changes, setChanges] = useState<{ path: string; index: string; worktree: string }[]>([])
  const [results, setResults] = useState<Result[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false)
  const [form, setForm] = useState<"create" | "save" | null>(null),
    [name, setName] = useState(""),
    [purpose, setPurpose] = useState(""),
    [command, setCommand] = useState(""),
    [files, setFiles] = useState<string[]>([]),
    [choices, setChoices] = useState<string[]>([])
  const [revision, setRevision] = useState(0)
  const [commitMessage, setCommitMessage] = useState("")
  const root = project.rootPath
  const refresh = useCallback(async () => {
    if (!root) return
    try {
      const value = (await envoi().workspaces(root, { action: "list" })) as Overview
      setOverview(value)
      setRevision((value) => value + 1)
      setSelected((old) => (value.workspaces.some((w) => w.path === old) ? old : root))
      setError("")
    } catch (e) {
      setError(ipcError(e).message)
    }
  }, [root])
  useEffect(() => {
    void refresh()
    let timer: ReturnType<typeof setTimeout>
    const listener = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    }
    const off = envoi().onFilesChanged((event) => {
      if (event.root === root) listener()
    })
    window.addEventListener("envoi:workspaces-updated", listener)
    window.addEventListener("focus", listener)
    return () => {
      clearTimeout(timer)
      off()
      window.removeEventListener("envoi:workspaces-updated", listener)
      window.removeEventListener("focus", listener)
    }
  }, [refresh, root])
  useEffect(() => {
    let live = true
    if (selected && tab === "changes")
      void envoi()
        .gitStatus(selected)
        .then((value) => {
          if (live) setChanges((value as { files: typeof changes }).files)
        })
        .catch((e) => {
          if (live) setError(ipcError(e).message)
        })
    return () => {
      live = false
    }
  }, [selected, tab, revision])
  const active = overview?.workspaces.find((w) => w.path === selected),
    locked = busy || projectBusy || saving
  async function run(task: () => Promise<void>) {
    if (locked) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await task()
    } catch (e) {
      setError(ipcError(e).message)
    } finally {
      setBusy(false)
    }
  }
  async function loadResults() {
    if (!root || !overview) return
    await openDirectory(overview.main)
    setResults((await envoi().workspaces(root, { action: "results" })) as Result[])
  }
  async function open(target: string) {
    if (!root) return
    if (dirtyFiles(project).length) throw Error("请先保存当前工作区的修改，再切换工作区。")
    await saveSession(project)
    const directory = (await envoi().workspaces(root, { action: "target", target })) as string
    window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: directory }))
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="research-workspaces">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
        <div>
          <h1 className="text-sm font-medium">版本与实验</h1>
        </div>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={locked}
            aria-label="刷新工作区"
            onClick={() => void run(refresh)}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className={button}
            disabled={locked || taskBusy || !overview}
            onClick={() => {
              setForm("create")
              setName("")
              setPurpose("")
            }}
          >
            <Plus size={14} />
            新建实验
          </button>
        </div>
      </header>
      {error && <Notification message={error} kind={"error"} />}
      {notice && <Notification message={notice} kind={"success"} />}
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-card/30 p-3 max-md:max-h-44 max-md:w-full max-md:border-b max-md:border-r-0">
          <p className="mb-3 px-2 text-[11px] text-muted-foreground">
            工作区 · {overview?.workspaces.length ?? 0}
          </p>
          {overview?.workspaces.map((w) => (
            <button
              key={w.path}
              disabled={locked || !w.available}
              onClick={() =>
                void run(async () => {
                  await openDirectory(w.path)
                  setSelected(w.path)
                  setForm(null)
                })
              }
              className={`mb-2 block w-full rounded-lg border p-3 text-left ${w.path === selected ? "border-primary/40 bg-accent/40" : "border-transparent hover:bg-secondary"}`}
            >
              <div className="flex items-center gap-2 text-sm">
                {w.main ? <FolderOpen size={15} /> : <FlaskConical size={15} />}
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.current && <span className="text-[10px] text-primary">当前</span>}
              </div>
              {w.purpose && (
                <p className="mt-2 truncate text-[11px] text-muted-foreground">{w.purpose}</p>
              )}
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                <GitBranch size={11} />
                {w.branch || "游离提交"} ·{" "}
                {!w.available ? "目录不可用" : w.changes ? `${w.changes} 项修改` : "工作区干净"}
              </p>
            </button>
          ))}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {form ? (
            <div className="max-w-2xl overflow-auto p-6">
              <button
                className="mb-5 flex items-center gap-1 text-xs text-muted-foreground"
                onClick={() => setForm(null)}
              >
                <ArrowLeft size={14} />
                返回工作区
              </button>
              <h2 className="text-lg font-medium">
                {form === "create" ? "开始一个实验" : "保存结果到主工作区"}
              </h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {form === "create" ? t("workspace.createHint") : t("workspace.saveHint")}
              </p>
              <label className="mt-5 block text-xs">
                {form === "create" ? "实验名称" : "结果名称"}
                <input
                  aria-label={form === "create" ? "实验名称" : "结果名称"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded border border-input bg-background p-2"
                  placeholder={form === "create" ? "例如：带宽敏感性分析" : "例如：带宽扫描结果"}
                />
              </label>
              <label className="mt-4 block text-xs">
                {form === "create" ? "研究目的" : "结论与环境说明"}
                <textarea
                  aria-label="实验说明"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded border border-input bg-background p-2"
                />
              </label>
              {form === "save" && (
                <>
                  <label className="mt-4 block text-xs">
                    运行命令与参数
                    <input
                      aria-label="运行命令与参数"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      className="mt-2 w-full rounded border border-input bg-background p-2"
                    />
                  </label>
                  <p className="mb-2 mt-5 text-xs">结果文件 · 已选 {files.length}</p>
                  <div className="max-h-48 overflow-auto rounded border border-border p-3">
                    {Object.entries(
                      choices.reduce<Record<string, string[]>>((groups, file) => {
                        const folder = file.includes("/")
                          ? file.slice(0, file.lastIndexOf("/"))
                          : "项目根目录"
                        ;(groups[folder] ??= []).push(file)
                        return groups
                      }, {}),
                    ).map(([folder, paths]) => (
                      <details key={folder} open className="mb-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {folder} · {paths.length}
                        </summary>
                        {paths.map((file) => (
                          <label key={file} className="ml-3 flex items-center gap-2 py-1 text-xs">
                            <input
                              type="checkbox"
                              checked={files.includes(file)}
                              onChange={(e) =>
                                setFiles((old) =>
                                  e.target.checked ? [...old, file] : old.filter((p) => p !== file),
                                )
                              }
                            />
                            <span className="break-all">{file}</span>
                          </label>
                        ))}
                      </details>
                    ))}
                  </div>
                </>
              )}
              <button
                className={`${button} mt-5 bg-primary text-primary-foreground hover:bg-primary/90`}
                disabled={locked || taskBusy || !name.trim() || (form === "save" && !files.length)}
                onClick={() =>
                  void run(async () => {
                    if (!root) return
                    if (form === "create") {
                      const created = (await envoi().workspaces(root, {
                        action: "create",
                        name,
                        purpose,
                      })) as { path: string }
                      await openDirectory(created.path)
                      await refresh()
                      setSelected(created.path)
                      setNotice(t("workspace.created"))
                    } else {
                      await envoi().workspaces(root, {
                        action: "save",
                        source: selected,
                        title: name,
                        summary: purpose,
                        command,
                        files,
                      })
                      await loadResults()
                      setTab("results")
                      setNotice(t("workspace.resultSaved"))
                    }
                    setForm(null)
                  })
                }
              >
                {busy ? "处理中…" : form === "create" ? "创建实验" : "保存结果"}
              </button>
            </div>
          ) : (
            <>
              {active && (
                <div className="shrink-0 border-b border-border px-5 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-medium">{active.name}</h2>
                      {active.purpose && (
                        <p className="mt-1 text-xs text-muted-foreground">{active.purpose}</p>
                      )}
                      <p
                        className="mt-2 break-all text-[10px] text-muted-foreground"
                        title={active.path}
                      >
                        {active.path}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!active.main && (
                        <button
                          className={button}
                          disabled={locked || taskBusy || !active.available}
                          onClick={() =>
                            void run(async () => {
                              await openDirectory(selected)
                              await openDirectory(overview!.main)
                              const listing = await envoi().fsList(selected)
                              setChoices(
                                listing.files
                                  .filter(
                                    (f) =>
                                      !f.path
                                        .split("/")
                                        .some(
                                          (part) =>
                                            part.startsWith(".") ||
                                            ["__pycache__", "node_modules"].includes(part),
                                        ) && !/\.(bundle|pyc|aux|synctex|blg|fls)$/i.test(f.path),
                                  )
                                  .map((f) => f.path),
                              )
                              setFiles([])
                              setName("")
                              setPurpose("")
                              setCommand("")
                              setForm("save")
                            })
                          }
                        >
                          <Archive size={14} />
                          保存结果
                        </button>
                      )}
                      <button
                        className={button}
                        disabled={locked || active.current || !active.available}
                        onClick={() => void run(() => open(selected))}
                      >
                        <ArrowUpRight size={14} />
                        {active.current ? "正在此工作区" : "打开工作区"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-5 text-xs">
                    <button
                      className={`border-b-2 pb-3 ${tab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                      onClick={() => setTab("history")}
                    >
                      提交历史
                    </button>
                    <button
                      className={`border-b-2 pb-3 ${tab === "changes" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                      onClick={() => setTab("changes")}
                    >
                      文件变化
                    </button>
                    <button
                      className={`border-b-2 pb-3 ${tab === "results" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
                      onClick={() =>
                        void run(async () => {
                          await loadResults()
                          setTab("results")
                        })
                      }
                    >
                      已保存结果
                    </button>
                  </div>
                </div>
              )}
              {active && tab === "history" && (
                <div className="min-h-0 flex-1">{history(selected, revision)}</div>
              )}
              {tab === "changes" && (
                <div className="flex-1 overflow-auto p-5">
                  {!!changes.length && (
                    <form
                      className="mb-4 space-y-2 rounded border p-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (taskBusy || !commitMessage.trim()) return
                        void run(async () => {
                          if (dirtyFiles(project).length)
                            throw Error("请先保存当前工作区的修改，再提交基线。")
                          await envoi().workspaces(selected, {
                            action: "commit",
                            message: commitMessage.trim(),
                          })
                          setCommitMessage("")
                          setNotice("已提交当前列出的全部修改，可以基于此版本创建实验。")
                          await refresh()
                        })
                      }}
                    >
                      <p className="text-xs text-muted-foreground">
                        将下方全部文件变化保存为一个版本，作为可复现的实验基线。
                      </p>
                      <input
                        aria-label="基线提交说明"
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="例如：记录假设与实验计划"
                      />
                      <button
                        className={button}
                        disabled={locked || taskBusy || !commitMessage.trim()}
                        type="submit"
                      >
                        提交列出的全部修改
                      </button>
                    </form>
                  )}
                  {!changes.length ? (
                    <p className="text-sm text-muted-foreground">{t("git.clean")}</p>
                  ) : (
                    changes.map((file) => (
                      <div
                        key={file.path}
                        className="flex gap-3 border-b border-border py-3 text-xs"
                      >
                        <code className="text-primary">
                          {file.index}
                          {file.worktree}
                        </code>
                        <span className="break-all">{file.path}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === "results" && (
                <div className="flex-1 overflow-auto p-5">
                  {!results.length ? (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      还没有保存的实验结果。选中实验后，点击“保存结果”。
                    </div>
                  ) : (
                    results
                      .filter((r) => active?.main || r.source === selected)
                      .map((r) => (
                        <article
                          key={r.id}
                          className="mb-3 rounded-lg border border-border bg-card p-4"
                        >
                          <h3 className="text-sm font-medium">{r.title}</h3>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {r.experiment} · {new Date(r.created).toLocaleString()} ·{" "}
                            {r.commit.slice(0, 8)}
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-xs leading-6">{r.summary}</p>
                          {r.command && (
                            <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">
                              {r.command}
                            </pre>
                          )}
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {r.files.map((f) => (
                              <li key={f.path}>{f.path}</li>
                            ))}
                          </ul>
                          <p className="mt-3 break-all text-[10px] text-muted-foreground">
                            results/{r.id}
                          </p>
                        </article>
                      ))
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
