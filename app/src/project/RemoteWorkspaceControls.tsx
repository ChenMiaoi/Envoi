import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Network, SquareTerminal, TerminalSquare, X } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RemoteState } from "../../shared/remote"
import { remoteStatusDot, remoteStatusPill } from "./remoteStatus"
import { WslDirectoryPicker } from "./WslDirectoryPicker"
import { RemoteTerminal } from "./RemoteTerminal"
const visuals = {
  ssh: { icon: Network, color: "bg-emerald-500/10 text-emerald-400 ring-emerald-400/20" },
  wsl: { icon: SquareTerminal, color: "bg-violet-500/10 text-violet-400 ring-violet-400/20" },
} as const
export function RemoteWorkspaceControls() {
  const { t } = useT()
  const { preferences } = usePreferences()
  const { project, navigationBusy, saving, setMessage } = useProject()
  const [open, setOpen] = useState(false),
    [terminal, setTerminal] = useState(false)
  const [kind, setKind] = useState<"ssh" | "wsl">("ssh")
  const [distributions, setDistributions] = useState<string[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [ssh, setSsh] = useState({ host: "", directory: "" })
  const [wsl, setWsl] = useState({ host: "", directory: "" })
  const [port, setPort] = useState("")
  const { host, directory } = kind === "ssh" ? ssh : wsl
  const setHost = (host: string) =>
    kind === "ssh"
      ? setSsh((old) => ({ ...old, host }))
      : setWsl((old) => (old.host === host ? old : { host, directory: "" }))
  const setDirectory = useCallback(
    (directory: string) => {
      const update = kind === "ssh" ? setSsh : setWsl
      update((old) => ({ ...old, directory }))
    },
    [kind],
  )
  const attempt = useRef<{ id: string; cancelled: boolean } | null>(null)
  const cancel = () => {
    const pending = attempt.current
    if (!pending) return
    pending.cancelled = true
    void envoi()
      .remoteCancel(pending.id)
      .catch((error) => setMessage(ipcError(error).message))
  }
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
      setDiscovering(true)
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
      if (event.type === "state") {
        setStates((previous) => [
          ...previous.filter((entry) => entry.root !== event.value.root),
          event.value,
        ])
      }
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
    setDiscovering(true)
    void envoi()
      .wslDistributions()
      .then((names) => {
        if (alive) {
          setDistributions(names)
          setWsl((old) => (names.includes(old.host) ? old : { host: "", directory: "" }))
        }
      })
      .catch((error) => {
        if (alive) setError(ipcError(error).message)
      })
      .finally(() => {
        if (alive) setDiscovering(false)
      })
    return () => {
      alive = false
    }
  }, [open, kind])
  const run = async (action: () => Promise<void>) => {
    if (working || attempt.current) return
    attempt.current = { id: crypto.randomUUID(), cancelled: false }
    setPreparing(undefined)
    setWorking(true)
    setError("")
    try {
      await action()
    } catch (error) {
      if (!attempt.current?.cancelled) setError(ipcError(error).message)
    } finally {
      setPreparing(undefined)
      setWorking(false)
      attempt.current = null
    }
  }
  const activate = (root: string) => {
    if (attempt.current?.cancelled) return
    window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root }))
    setOpen(false)
  }
  const sessions = states.filter((state) => (state.kind ?? "ssh") === kind)
  const Icon = visuals[kind].icon
  return (
    <>
      {root && (
        <div className="flex min-w-0 items-center gap-1 text-xs">
          <button
            className="flex min-w-0 max-w-64 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-primary transition-colors hover:bg-primary/10"
            onClick={() => {
              setKind(root?.startsWith("wsl://") ? "wsl" : "ssh")
              setDiscovering(true)
              if (current) {
                const update = root.startsWith("wsl://") ? setWsl : setSsh
                update({ host: current.host, directory: current.directory })
                setPort(current.port ? String(current.port) : "")
                setConfigFile(current.configFile ?? "")
              }
              setError("")
              setOpen(true)
            }}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${remoteStatusDot(current?.state ?? "disconnected")}`}
            />
            <span className="truncate">
              {root?.startsWith("wsl://") ? "WSL" : "SSH"}: {current?.host ?? "…"} ·{" "}
              {t(`remote.${current?.state ?? "disconnected"}`)}
            </span>
          </button>
          <button
            aria-label={t("remote.terminal")}
            disabled={current?.state !== "connected"}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={() => setTerminal(true)}
          >
            <TerminalSquare size={15} />
          </button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) cancel()
          setOpen(value)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
            <span
              aria-hidden
              className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ${visuals[kind].color}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <DialogTitle>{t(kind === "wsl" ? "wsl.title" : "remote.title")}</DialogTitle>
              <DialogDescription>
                {t(kind === "wsl" ? "wsl.requirements" : "remote.requirements")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                const result = await envoi().remoteConnect(
                  {
                    kind,
                    host: host.trim(),
                    ...(kind === "ssh" && configFile.trim()
                      ? { configFile: configFile.trim() }
                      : {}),
                    directory: directory.trim(),
                    ...(kind === "ssh" && port ? { port: Number(port) } : {}),
                  },
                  attempt.current!.id,
                )
                activate(result.root)
              })
            }}
          >
            <div className="space-y-1.5">
              <Label>{t(kind === "wsl" ? "wsl.distribution" : "remote.host")}</Label>
              {kind === "wsl" ? (
                <Select
                  value={host}
                  onValueChange={(value) => {
                    if (value) setHost(value)
                  }}
                >
                  <SelectTrigger aria-label={t("wsl.distribution")} className="w-full">
                    <SelectValue placeholder={t("wsl.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {distributions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  required
                  aria-label={t("remote.host")}
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="research / user@host"
                />
              )}
            </div>
            {kind === "wsl" ? (
              <WslDirectoryPicker host={host} value={directory} onChange={setDirectory} />
            ) : (
              <div className="flex gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label>{t("remote.directory")}</Label>
                  <Input
                    required
                    aria-label={t("remote.directory")}
                    value={directory}
                    onChange={(event) => setDirectory(event.target.value)}
                    placeholder="/home/user/project"
                  />
                </div>
                <div className="w-24 space-y-1.5">
                  <Label>{t("remote.port")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    aria-label={t("remote.port")}
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    placeholder="config"
                  />
                </div>
              </div>
            )}
            {kind === "ssh" && (
              <div className="space-y-1.5">
                <Label>{t("remote.configFile")}</Label>
                <Input
                  aria-label={t("remote.configFile")}
                  value={configFile}
                  onChange={(event) => setConfigFile(event.target.value)}
                />
              </div>
            )}
            {!enabled && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {t("extensions.disabled")}
              </p>
            )}
            {kind === "wsl" && discovering && (
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner />
                {t("wsl.discovering")}
              </p>
            )}
            {kind === "wsl" && !discovering && !error && !distributions.length && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("wsl.noDistributions")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={working || navigationBusy || saving || !enabled || !host || !directory}
              >
                {working && <Spinner />}
                {t(working ? "remote.connecting" : "remote.connect")}
              </Button>
              {working && (
                <Button type="button" variant="ghost" onClick={cancel}>
                  {t("remote.cancel")}
                </Button>
              )}
              {working && kind === "wsl" && preparing && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Spinner className="size-3.5" />
                  {t(`wsl.${preparing}`)}
                </span>
              )}
            </div>
          </form>
          {sessions.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("remote.sessions")}</p>
              <div className="max-h-60 space-y-2 overflow-auto pr-0.5">
                {sessions.map((state) => (
                  <div
                    key={state.root}
                    className="rounded-xl border border-border/70 bg-card/60 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`size-2 shrink-0 rounded-full ${remoteStatusDot(state.state)}`}
                      />
                      <strong className="truncate text-xs font-semibold">{state.host}</strong>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${remoteStatusPill(state.state)}`}
                      >
                        {t(`remote.${state.state}`)}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-primary hover:text-primary"
                          disabled={working || navigationBusy || saving || !enabled}
                          onClick={() =>
                            void run(async () => {
                              await envoi().remoteReconnect(state.root, attempt.current!.id)
                              activate(state.root)
                            })
                          }
                        >
                          {t(state.state === "connected" ? "remote.open" : "remote.reconnect")}
                        </Button>
                        {state.state === "connected" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() =>
                              void run(async () => {
                                await envoi().remoteDisconnect(state.root)
                              })
                            }
                          >
                            {t("remote.disconnect")}
                          </Button>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 break-all pl-4 font-mono text-[11px] text-muted-foreground">
                      {state.directory}
                    </p>
                    {state.error && state.error !== error && (
                      <p className="mt-1 break-words pl-4 text-[11px] text-destructive">
                        {state.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 break-words whitespace-pre-wrap">
                {error.length < 500 ? (
                  error
                ) : (
                  <details>
                    <summary>{error.split("\n")[0].slice(0, 180)}</summary>
                    {error}
                  </details>
                )}
              </div>
            </div>
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
            <Input
              autoFocus
              aria-label={t("remote.answer")}
              type={
                /yes\/no|fingerprint|authenticity/i.test(prompt?.prompt ?? "") ? "text" : "password"
              }
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <Button type="submit" className="mt-3">
              {t("remote.continue")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {terminal &&
        root &&
        document.getElementById("workspace-terminal") &&
        createPortal(
          <section
            aria-label={t("remote.terminal")}
            className="flex h-72 min-h-48 max-h-[55vh] resize-y flex-col overflow-auto rounded-lg border border-border bg-background"
          >
            <header className="flex shrink-0 items-center gap-3 border-b px-3 py-2 text-xs">
              <TerminalSquare size={14} />
              <span className="min-w-0 flex-1 truncate" title={current?.directory}>
                {t("remote.terminal")} · {current?.host} · {current?.directory}
              </span>
              <span>{t(`remote.${current?.state ?? "disconnected"}`)}</span>
              <button
                disabled={current?.state !== "connected"}
                className="rounded px-2 py-1 hover:bg-secondary disabled:opacity-40"
                onClick={() =>
                  void envoi()
                    .terminalClose(root)
                    .then(() => setTerminal(false))
                    .catch((error) => setMessage(ipcError(error).message))
                }
              >
                {t("remote.endTerminal")}
              </button>
              <button
                aria-label={t("remote.hideTerminal")}
                onClick={() => setTerminal(false)}
                className="rounded p-1 hover:bg-secondary"
              >
                <X size={15} />
              </button>
            </header>
            <div className="min-h-0 flex-1 p-2">
              <RemoteTerminal key={`${root}:${current?.generation}`} root={root} />
            </div>
          </section>,
          document.getElementById("workspace-terminal")!,
        )}
    </>
  )
}
