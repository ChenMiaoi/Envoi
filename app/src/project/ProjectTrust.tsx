import { useProjectTrust } from "./useProjectTrust"
import { initializeLocalGit } from "@/lib/localGit"
import { useEffect, useRef, useState } from "react"
import { ShieldCheck, ShieldAlert } from "lucide-react"
import { envoi, ipcError } from "@/lib/desktop"
import { useProject } from "./context"
import { useT } from "@/i18n/useT"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

export function ProjectTrust() {
  const project = useProject((state) => ({ rootPath: state.project.rootPath }))
  const root = project.rootPath
  const state = useProjectTrust(root)
  const [remoteLocation, setRemoteLocation] = useState<{ root: string; label: string }>()
  useEffect(() => {
    if (!root || !/^(ssh|wsl):\/\//.test(root)) return
    let alive = true
    void envoi()
      .remoteList()
      .then((entries) => {
        const entry = entries.find((candidate) => candidate.root === root)
        if (alive && entry) setRemoteLocation({ root, label: `${entry.host} · ${entry.directory}` })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [root])
  const identified = !/^(ssh|wsl):\/\//.test(root ?? "") || remoteLocation?.root === root
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [localTrusted, setLocalTrusted] = useState<boolean>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const request = useRef(0)
  const dismiss = () => {
    request.current++
    setOpen(false)
    setWorking(false)
    setError("")
  }
  const undecided = !!state && !state.decided
  useEffect(() => {
    request.current++
    setOpen(false)
    setWorking(false)
    setError("")
    setLocalTrusted(undefined)
  }, [root])
  useEffect(() => {
    if (!root || !/^(ssh|wsl):\/\//.test(root)) return
    return envoi().onRemoteEvent((event) => {
      if (event.type === "state" && event.value.root === root && event.value.state !== "connected")
        dismiss()
    })
  }, [root])
  useEffect(() => {
    if (undecided) setOpen(true)
  }, [root, undecided])
  useEffect(() => {
    const show = () => {
      setOpen(true)
      setError("")
    }
    window.addEventListener("envoi:show-trust", show)
    return () => window.removeEventListener("envoi:show-trust", show)
  }, [])
  if (!root) return null
  async function decide(trusted: boolean) {
    if (!root || working) return
    const serial = ++request.current
    const current = () => serial === request.current
    setWorking(true)
    try {
      if (
        typeof envoi().grantProjectTrust !== "function" ||
        typeof envoi().restrictProject !== "function"
      )
        throw Error(t("trust.restart"))
      if (trusted) {
        await envoi().grantProjectTrust(root)
        if (!current()) return
        setLocalTrusted(true)
        setOpen(false)
        await state?.refresh()
        if (!current()) return
        const config = await envoi()
          .fsRead(root, ".envoi/project.json")
          .then((file) => {
            try {
              return JSON.parse(file.text ?? "{}")
            } catch {
              return {}
            }
          })
          .catch(() => ({}))
        if (!current()) return
        if (config.git?.requested && config.git?.status === "pending-local-init") {
          await initializeLocalGit(root)
          window.dispatchEvent(new Event("envoi:connection-updated"))
          window.dispatchEvent(new Event("envoi:workspaces-updated"))
        }
      } else {
        await envoi().restrictProject(root)
        if (!current()) return
        setLocalTrusted(false)
        setOpen(false)
        await state?.refresh()
        if (!current()) return
      }
    } catch (reason) {
      if (current()) {
        setError(ipcError(reason).message)
        setOpen(true)
      }
    } finally {
      if (current()) setWorking(false)
    }
  }
  return (
    <>
      <button className="flex items-center gap-1 text-primary" onClick={() => setOpen(true)}>
        {(localTrusted ?? state?.trusted) ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
        {t((localTrusted ?? state?.trusted) ? "trust.trusted" : "trust.restricted")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            // Preserve the local restricted-mode choice without blocking dismissal.
            // Remote decisions require a live connection and remain explicit.
            if (
              !working &&
              !/^(ssh|wsl):\/\//.test(root) &&
              !state?.decided &&
              localTrusted === undefined
            )
              void decide(false)
            dismiss()
          } else setOpen(true)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("trust.title")}</DialogTitle>
            <DialogDescription>{t("trust.description")}</DialogDescription>
          </DialogHeader>
          <p className="break-all text-xs text-muted-foreground">
            {/^(ssh|wsl):\/\//.test(root)
              ? remoteLocation?.root === root
                ? remoteLocation.label
                : t("remote.connecting")
              : root}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              disabled={working}
              className="rounded border px-3 py-2 text-sm"
              onClick={() => void decide(false)}
            >
              {t("trust.continueRestricted")}
            </button>
            <button
              disabled={working || !identified}
              className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={() => void decide(true)}
            >
              {t("trust.grant")}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function TrustRequired() {
  const { t } = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p>{t("trust.required")}</p>
      <button
        className="text-primary"
        onClick={() => window.dispatchEvent(new Event("envoi:show-trust"))}
      >
        {t("trust.grant")}
      </button>
    </div>
  )
}
