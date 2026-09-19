import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"
export function RemoteTerminal({ root }: { root: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState("")
  const { t } = useT()
  useEffect(() => {
    if (!host.current) return
    let alive = true,
      ready = false
    const pending: string[] = []
    const terminal = new Terminal({
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
      screenReaderMode: true,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    const fail = (error: unknown) => {
      if (alive) setError(ipcError(error).message)
    }
    const off = envoi().onRemoteEvent((event) => {
      if (event.type !== "terminal" || event.root !== root) return
      if (event.data) {
        if (ready) terminal.write(event.data)
        else pending.push(event.data)
      }
      if (event.exit !== undefined) {
        terminal.writeln(`\r\n[exit ${event.exit}]`)
        ready = false
      }
    })
    const input = terminal.onData((data) => {
      if (ready) void envoi().terminalInput({ data }).catch(fail)
    })
    const resize = () => {
      fit.fit()
      if (ready)
        void envoi().terminalInput({ cols: terminal.cols, rows: terminal.rows }).catch(fail)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    void envoi()
      .terminalOpen()
      .then(({ output }) => {
        if (!alive) return
        terminal.write(output)
        pending.forEach((data) => terminal.write(data))
        ready = true
        if (host.current) host.current.dataset.terminalReady = "true"
        resize()
        terminal.focus()
      })
      .catch(fail)
    return () => {
      alive = false
      observer.disconnect()
      off()
      input.dispose()
      terminal.dispose()
    }
  }, [root])
  return (
    <div className="flex h-80 flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("remote.terminalHint")}</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div ref={host} className="min-h-0 flex-1 bg-black p-2" />
    </div>
  )
}
