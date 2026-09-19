import { useEffect, useState } from "react"
import { Network, TerminalSquare } from "lucide-react"
import { envoi, ipcError } from "@/lib/desktop"
import { useProject } from "./context"
import { useT } from "@/i18n/useT"
import { usePreferences } from "@/settings/context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RemoteState } from "../../shared/remote"
import { WslDirectoryPicker } from "./WslDirectoryPicker"
import { RemoteTerminal } from "./RemoteTerminal"
export function RemoteWorkspaceControls() {
  const { t } = useT()
  const { preferences } = usePreferences()
  const { project, navigationBusy, saving } = useProject()
  const [open, setOpen] = useState(false),
    [terminal, setTerminal] = useState(false)
  const [kind, setKind] = useState<"ssh" | "wsl">("ssh")
  const [distributions, setDistributions] = useState<string[]>([])
  const [host, setHost] = useState(""),
    [directory, setDirectory] = useState(""),
    [port, setPort] = useState("")
  const [states, setStates] = useState<RemoteState[]>([])
  const [configFile, setConfigFile] = useState("")
  const [preparing, setPreparing] = useState<"checking" | "downloading" | "installing">()
  const [working, setWorking] = useState(false),
    [error, setError] = useState("")
  const [prompt, setPrompt] = useState<{ id: string; prompt: string }>(),
    [answer, setAnswer] = useState("")
  const root = /^(ssh|wsl):\/\//.test(project.rootPath ?? "") ? project.rootPath : undefined
  const current = states.find((entry) => entry.root === root)
  const enabled =
    preferences.pluginStates[kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"] !== false
  useEffect(() => {
    const show = (event: Event) => {
      setKind((event as CustomEvent).detail === "wsl" ? "wsl" : "ssh")
      setOpen(true)
      setError("")
    }
    window.addEventListener("envoi:open-remote", show)
    if (typeof envoi().remoteList !== "function")
      return () => window.removeEventListener("envoi:open-remote", show)
    void envoi()
      .remoteList()
      .then(setStates)
      .catch(() => {})
    const off = envoi().onRemoteEvent((event) => {
      if (event.type === "state")
        setStates((previous) => [
          ...previous.filter((entry) => entry.root !== event.value.root),
          event.value,
        ])
      if (event.type === "preparing") setPreparing(event.stage)
      if (event.type === "prompt") {
        setPrompt(event)
        setAnswer("")
      }
    })
    return () => {
      off()
      window.removeEventListener("envoi:open-remote", show)
    }
  }, [])
  useEffect(() => {
    if (!open || kind !== "wsl") return
    let alive = true
    void envoi()
      .wslDistributions()
      .then((names) => {
        if (alive) {
          setDistributions(names)
          setHost(names[0] ?? "")
        }
      })
      .catch((error) => {
        if (alive) setError(ipcError(error).message)
      })
    return () => {
      alive = false
    }
  }, [open, kind])
  const run = async (action: () => Promise<void>) => {
    if (working) return
    setPreparing(undefined)
    setWorking(true)
    setError("")
    try {
      await action()
    } catch (error) {
      setError(ipcError(error).message)
    } finally {
      setPreparing(undefined)
      setWorking(false)
    }
  }
  const activate = (root: string) => {
    window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root }))
    setOpen(false)
  }
  return (
    <>
      {root && (
        <div className="flex items-center gap-2 text-xs">
          <button
            className="max-w-64 truncate rounded border border-primary/30 px-2 py-1 text-primary"
            onClick={() => {
              setKind(current?.kind ?? "ssh")
              setOpen(true)
            }}
          >
            {current?.kind === "wsl" ? "WSL" : "SSH"}: {current?.host ?? "…"} ·{" "}
            {t(`remote.${current?.state ?? "disconnected"}`)}
          </button>
          <button
            aria-label={t("remote.terminal")}
            disabled={current?.state !== "connected"}
            onClick={() => setTerminal(true)}
          >
            <TerminalSquare size={15} />
          </button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t(kind === "wsl" ? "wsl.title" : "remote.title")}</DialogTitle>
            <DialogDescription>
              {t(kind === "wsl" ? "wsl.requirements" : "remote.requirements")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                const result = await envoi().remoteConnect({
                  kind,
                  host: host.trim(),
                  ...(kind === "ssh" && configFile.trim() ? { configFile: configFile.trim() } : {}),
                  directory: directory.trim(),
                  ...(kind === "ssh" && port ? { port: Number(port) } : {}),
                })
                activate(result.root)
              })
            }}
          >
            <label className="block text-xs">
              {t(kind === "wsl" ? "wsl.distribution" : "remote.host")}
              {kind === "wsl" ? (
                <select
                  required
                  aria-label={t("wsl.distribution")}
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  className="mt-1 w-full rounded border bg-background p-2"
                >
                  <option value="">{t("wsl.select")}</option>
                  {distributions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  aria-label={t("remote.host")}
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="research / user@host"
                  className="mt-1 w-full rounded border bg-background p-2"
                />
              )}
            </label>
            {kind === "wsl" ? (
              <WslDirectoryPicker host={host} value={directory} onChange={setDirectory} />
            ) : (
              <div className="flex gap-3">
                <label className="min-w-0 flex-1 text-xs">
                  {t("remote.directory")}
                  <input
                    required
                    aria-label={t("remote.directory")}
                    value={directory}
                    onChange={(event) => setDirectory(event.target.value)}
                    placeholder="/home/user/project"
                    className="mt-1 w-full rounded border bg-background p-2"
                  />
                </label>
                {kind === "ssh" && (
                  <label className="w-24 text-xs">
                    {t("remote.port")}
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      aria-label={t("remote.port")}
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      placeholder="config"
                      className="mt-1 w-full rounded border bg-background p-2"
                    />
                  </label>
                )}
              </div>
            )}
            {kind === "ssh" && (
              <label className="block text-xs">
                {t("remote.configFile")}
                <input
                  aria-label={t("remote.configFile")}
                  value={configFile}
                  onChange={(event) => setConfigFile(event.target.value)}
                  className="mt-1 w-full rounded border bg-background p-2"
                />
              </label>
            )}
            <button
              disabled={working || navigationBusy || saving || !enabled || !host || !directory}
              className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
            >
              {t(working ? "remote.connecting" : "remote.connect")}
            </button>
            {working && kind === "wsl" && preparing && (
              <p role="status" className="text-xs text-muted-foreground">
                {t(`wsl.${preparing}`)}
              </p>
            )}
            {working && (
              <button
                type="button"
                className="ml-3 text-xs underline"
                onClick={() =>
                  void Promise.all(
                    states
                      .filter((state) => state.state === "connecting")
                      .map((state) => envoi().remoteDisconnect(state.root)),
                  ).catch(() => {})
                }
              >
                {t("remote.cancel")}
              </button>
            )}
          </form>
          {!enabled && <p className="text-xs">{t("extensions.disabled")}</p>}
          <div className="max-h-60 space-y-2 overflow-auto">
            {states
              .filter((state) => (state.kind ?? "ssh") === kind)
              .map((state) => (
                <div key={state.root} className="rounded border p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Network size={14} />
                    <strong>{state.host}</strong>
                    <span>{t(`remote.${state.state}`)}</span>
                  </div>
                  <p className="mt-1 break-all text-muted-foreground">{state.directory}</p>
                  {state.error && (
                    <p className="mt-1 break-words text-destructive">{state.error}</p>
                  )}
                  <button
                    disabled={working || navigationBusy || saving || !enabled}
                    className="mt-2 text-primary disabled:opacity-50"
                    onClick={() =>
                      void run(async () => {
                        await envoi().remoteReconnect(state.root)
                        activate(state.root)
                      })
                    }
                  >
                    {t(state.state === "connected" ? "remote.open" : "remote.reconnect")}
                  </button>
                  {state.state === "connected" && (
                    <button
                      className="ml-4 text-muted-foreground"
                      onClick={() =>
                        void run(async () => {
                          await envoi().remoteDisconnect(state.root)
                        })
                      }
                    >
                      {t("remote.disconnect")}
                    </button>
                  )}
                </div>
              ))}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!prompt}
        onOpenChange={(open) => {
          if (!open && prompt) {
            void envoi()
              .remoteAnswer(prompt.id, "")
              .catch(() => {})
            setPrompt(undefined)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("remote.authentication")}</DialogTitle>
            <DialogDescription className="break-words whitespace-pre-wrap">
              {prompt?.prompt}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (prompt)
                void envoi()
                  .remoteAnswer(prompt.id, answer)
                  .catch(() => {})
              setPrompt(undefined)
              setAnswer("")
            }}
          >
            <input
              autoFocus
              aria-label={t("remote.answer")}
              type={
                /yes\/no|fingerprint|authenticity/i.test(prompt?.prompt ?? "") ? "text" : "password"
              }
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="w-full rounded border bg-background p-2"
            />
            <button className="mt-3 rounded bg-primary px-3 py-2 text-xs text-primary-foreground">
              {t("remote.continue")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={terminal && !!root} onOpenChange={setTerminal}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {t("remote.terminal")} · {current?.host}
            </DialogTitle>
            <DialogDescription>{current?.directory}</DialogDescription>
          </DialogHeader>
          {root && <RemoteTerminal key={`${root}:${current?.generation}`} root={root} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
