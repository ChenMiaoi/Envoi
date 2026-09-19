import { useEffect, useState } from "react"
import { AlertCircle, Folder, Home, RotateCw } from "lucide-react"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

export function WslDirectoryPicker({
  host,
  value,
  onChange,
}: {
  host: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useT()
  const [retry, setRetry] = useState(0)
  const [home, setHome] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let alive = true
    onChange("")
    setHome("")
    setSuggestions([])
    setError("")
    setLoading(Boolean(host))
    if (!host) return
    void envoi()
      .wslDirectories(host)
      .then((result) => {
        if (!alive) return
        setHome(result.home)
        onChange(result.directory)
        setSuggestions(result.directories)
      })
      .catch((error) => {
        if (alive) setError(ipcError(error).message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [host, onChange, retry])
  useEffect(() => {
    if (!host || !home || !value) return
    let alive = true
    const timer = setTimeout(() => {
      void envoi()
        .wslDirectories(host, value)
        .then((result) => {
          if (alive) {
            setSuggestions(result.directories)
            setError("")
          }
        })
        .catch((error) => {
          if (alive) {
            setSuggestions([])
            setError(ipcError(error).message)
          }
        })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [host, home, value])
  return (
    <div className="space-y-1.5">
      <Label>{t("remote.directory")}</Label>
      <Input
        required
        disabled={loading || !home}
        aria-label={t("remote.directory")}
        value={value}
        onChange={(event) => {
          const input = event.target.value
          setSuggestions([])
          onChange(
            input === "~" ? home + "/" : input.startsWith("~/") ? home + input.slice(1) : input,
          )
        }}
        className="font-mono"
      />
      {loading && (
        <p role="status" className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("wsl.loadingDirectories")}
        </p>
      )}
      {home && (
        <div className="pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-primary hover:text-primary"
            onClick={() => onChange(home + "/")}
          >
            <Home className="size-3.5" />
            {t("wsl.home")}
          </Button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div
          aria-label={t("wsl.suggestions")}
          className="max-h-36 divide-y divide-border/60 overflow-auto rounded-lg border border-border/70 bg-card/60"
        >
          {suggestions.map((directory) => (
            <button
              type="button"
              key={directory}
              onClick={() => onChange(directory)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted focus:bg-muted"
              title={directory}
            >
              <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{directory}</span>
            </button>
          ))}
        </div>
      )}
      {error && !home && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-primary hover:text-primary"
          onClick={() => setRetry((value) => value + 1)}
        >
          <RotateCw className="size-3.5" />
          {t("wsl.retry")}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  )
}
