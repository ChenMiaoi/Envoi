import { useProjectTrust } from "./useProjectTrust"
import { useEffect, useState } from "react"
import { useT } from "@/i18n/useT"
import { GitBranch, RefreshCw } from "lucide-react"
import { useProject } from "./context"
import { dirtyFiles } from "@/lib/projectFiles"

import { useGitStatus } from "./gitStatusContext"
import { gitDecoration } from "@/lib/gitDecoration"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
export function GitStatusPanel() {
  const { t } = useT()
  const { project } = useProject()
  const trusted = useProjectTrust(project.rootPath)?.trusted
  const [open, setOpen] = useState(false)
  const { status, message, busy, refresh } = useGitStatus()
  useEffect(() => {
    const listener = () => {
      setOpen(true)
      void refresh()
    }
    window.addEventListener("envoi:show-git", listener)
    return () => window.removeEventListener("envoi:show-git", listener)
  }, [refresh])
  const branch =
    status?.state === "not-initialized"
      ? t("git.notInitialized")
      : status?.state === "ready"
        ? status.detached
          ? t("git.detachedBranch", { branch: status.branch ?? "" })
          : status.branch
        : busy
          ? t("git.detecting")
          : t("git.notConnected")
  const shown =
    message || (dirtyFiles(project).length ? t("git.diskOnly") : busy ? t("git.detecting") : "")
  if (!trusted) return null
  return (
    <>
      <button
        className="flex items-center gap-1 text-primary hover:text-primary/80"
        title={shown || t("command.git")}
        onClick={() => setOpen(true)}
      >
        <GitBranch className="h-3 w-3" />
        {branch}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("command.git")}
              {status?.branch ? ` · ${status.branch}` : ""}
            </DialogTitle>
            <DialogDescription>{t("git.readonlyDesc", { name: project.name })}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3">
            {shown && (
              <p role="status" className="text-xs text-muted-foreground">
                {shown}
              </p>
            )}
            <button
              disabled={busy}
              aria-label={t("git.refreshAria")}
              onClick={() => void refresh()}
              className="ml-auto rounded border border-border p-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>
          {status?.state === "ready" && (
            <div className="max-h-80 overflow-auto rounded border border-border">
              {!status.files.length ? (
                <p className="p-5 text-center text-xs text-muted-foreground">{t("git.clean")}</p>
              ) : (
                status.files.map((file, index) => (
                  <div
                    key={`${file.path}:${index}`}
                    className="flex items-start gap-3 border-b border-border/50 px-3 py-2 text-xs last:border-0"
                  >
                    <span className="min-w-16 shrink-0 text-muted-foreground">
                      {file.conflict
                        ? t("git.conflict")
                        : file.untracked
                          ? t("git.untracked")
                          : `${file.index !== " " ? t("git.staged") : ""}${file.worktree !== " " ? t("git.worktreeModified") : ""}`}
                    </span>
                    <span className={`min-w-0 break-all ${gitDecoration(file).color}`}>
                      {file.originalPath ? `${file.originalPath} → ` : ""}
                      {file.path}
                    </span>
                    <code className="ml-auto whitespace-pre text-[10px] text-muted-foreground">
                      {file.index}
                      {file.worktree}
                    </code>
                  </div>
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
