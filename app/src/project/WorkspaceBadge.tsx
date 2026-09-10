import { useProjectTrust } from "./useProjectTrust"
import { useT } from "@/i18n/useT"
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Check, ChevronDown, Plus, Pencil, GitBranch } from "lucide-react"
import { envoi, ipcError } from "@/lib/desktop"
import { dirtyFiles } from "@/lib/projectFiles"
import { saveSession } from "@/lib/projectSession"
import { useProject } from "./context"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
type Workspace = {
  path: string
  name: string
  main: boolean
  current: boolean
  available: boolean
  branch: string
}
export function WorkspaceBadge() {
  const { t } = useT()
  const {
      project,
      setProject,
      navigationBusy: busy,
      busy: taskBusy,
      saving,
      setMessage,
    } = useProject(),
    navigate = useNavigate()
  const [info, setInfo] = useState<{ root: string; workspaces: Workspace[] }>(),
    [mode, setMode] = useState<"create" | "rename" | null>(null),
    [name, setName] = useState(""),
    [purpose, setPurpose] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState("")
  const root = project.rootPath,
    locked = busy || saving || working
  const trusted = useProjectTrust(root)?.trusted
  const refresh = useCallback(async () => {
    if (!root || !trusted) {
      setInfo(undefined)
      return
    }
    const value = (await envoi().workspaces(root, { action: "list" })) as {
      projectName: string
      initialized: boolean
      workspaces: Workspace[]
    }
    setInfo({ root, workspaces: value.workspaces })
    if (value.projectName)
      setProject((old) =>
        old.rootPath === root && old.name !== value.projectName
          ? { ...old, name: value.projectName }
          : old,
      )
  }, [root, setProject, trusted])
  useEffect(() => {
    void refresh().catch(() => {})
    const changed = () => void refresh().catch(() => {})
    window.addEventListener("envoi:workspaces-updated", changed)
    return () => window.removeEventListener("envoi:workspaces-updated", changed)
  }, [refresh])
  const current = info && info.root === root ? info.workspaces.find((w) => w.current) : undefined
  if (!current) return null
  async function run(task: () => Promise<void>) {
    if (locked) return
    setWorking(true)
    setError("")
    try {
      await task()
    } catch (e) {
      const text = ipcError(e).message
      setError(text)
      setMessage(text)
    } finally {
      setWorking(false)
    }
  }
  async function open(target: string) {
    if (dirtyFiles(project).length) throw Error("请先保存当前工作区的修改，再切换工作区。")
    await saveSession(project)
    const path = (await envoi().workspaces(root!, { action: "target", target })) as string
    window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: path }))
  }
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void refresh().catch((e) => setMessage(ipcError(e).message))
        }}
      >
        <DropdownMenuTrigger
          disabled={locked}
          aria-label={`切换工作区：${current.name}`}
          className="flex max-w-52 items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] text-primary"
        >
          <GitBranch size={12} />
          <span className="truncate">{current.name}</span>
          <ChevronDown size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>工作区</DropdownMenuLabel>
          {info?.workspaces.map((w) => (
            <DropdownMenuItem
              key={w.path}
              disabled={locked || !w.available}
              onSelect={() => {
                if (!w.current) void run(() => open(w.path))
              }}
              className="gap-2"
            >
              <span className="w-4 shrink-0">{w.current && <Check size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{w.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {w.main ? "主工作区 · " : ""}
                  {w.branch || "游离提交"}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={locked || taskBusy}
            onSelect={() => {
              setName("")
              setPurpose("")
              setError("")
              setMode("create")
            }}
          >
            <Plus size={14} />
            新建工作区…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={locked || taskBusy}
            onSelect={() => {
              setName(current.name)
              setError("")
              setMode("rename")
            }}
          >
            <Pencil size={14} />
            重命名当前工作区…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigate("/history")}>
            查看版本与实验
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !working) setMode(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "新建工作区" : "重命名工作区"}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("workspace.createOpenHint") : t("workspace.renameHint")}
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs">
            工作区名称
            <input
              autoFocus
              aria-label="工作区名称"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded border border-input bg-background p-2"
            />
          </label>
          {mode === "create" && (
            <label className="text-xs">
              研究目的
              <textarea
                aria-label="研究目的"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded border border-input bg-background p-2"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-xs text-warning">
              {error}
            </p>
          )}
          <button
            disabled={locked || taskBusy || !name.trim()}
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
            onClick={() =>
              void run(async () => {
                if (mode === "create") {
                  if (dirtyFiles(project).length)
                    throw Error("请先保存当前工作区的修改，再创建并切换。")
                  const result = (await envoi().workspaces(root!, {
                    action: "create",
                    name,
                    purpose,
                  })) as { path: string }
                  await open(result.path)
                } else {
                  await envoi().workspaces(root!, { action: "rename", target: root, name })
                  await refresh()
                  window.dispatchEvent(new Event("envoi:workspaces-updated"))
                }
                setMode(null)
              })
            }
          >
            {working ? "处理中…" : mode === "create" ? "创建并打开" : "保存名称"}
          </button>
        </DialogContent>
      </Dialog>
    </>
  )
}
