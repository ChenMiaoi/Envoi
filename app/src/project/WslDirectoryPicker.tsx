import { useEffect, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"

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
    <div className="space-y-2">
      <label className="block text-xs">
        {t("remote.directory")}
        <input
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
          className="mt-1 w-full rounded border bg-background p-2"
        />
      </label>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("wsl.loadingDirectories")}
        </p>
      )}
      {home && (
        <button type="button" onClick={() => onChange(home + "/")} className="text-xs text-primary">
          {t("wsl.home")}
        </button>
      )}
      {suggestions.length > 0 && (
        <div aria-label={t("wsl.suggestions")} className="max-h-36 overflow-auto rounded border">
          {suggestions.map((directory) => (
            <button
              type="button"
              key={directory}
              onClick={() => onChange(directory)}
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted"
              title={directory}
            >
              {directory}
            </button>
          ))}
        </div>
      )}
      {error && !home && (
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="text-xs text-primary"
        >
          {t("wsl.retry")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
