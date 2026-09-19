import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"

const prompted = new Set<string>()

export function PythonEnvironment({ root, onCreated }: { root: string; onCreated: () => void }) {
  const { t } = useT()
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const promptRef = useRef<string | number | undefined>(undefined)
  const showRef = useRef<() => void>(() => {})
  const createRef = useRef(onCreated)
  createRef.current = onCreated
  const notification = `python-environment:${root}`

  useEffect(() => {
    let alive = true
    void envoi()
      .pythonEnvironment?.(root)
      .then((result) => {
        if (alive) setMissing(!result.path)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [root])

  useEffect(() => {
    if (!missing || busy) return
    const create = async (manager: "venv" | "uv") => {
      setBusy(true)
      toast.loading(t("python.environment.creating"), { id: `${notification}:progress` })
      try {
        await envoi().pythonEnvironment(root, manager)
        setMissing(false)
        toast.success(t("python.environment.created"), { id: `${notification}:progress` })
        createRef.current()
      } catch (error) {
        toast.error(t("python.environment.failed"), {
          id: `${notification}:progress`,
          description: ipcError(error).message,
        })
      } finally {
        setBusy(false)
      }
    }
    const show = () => {
      promptRef.current = toast(t("python.environment.title"), {
        id: promptRef.current,
        onDismiss: () => {
          promptRef.current = undefined
        },
        description: t("python.environment.description"),
        duration: Infinity,
        action: {
          label: "venv",
          onClick: () => {
            void create("venv")
          },
        },
        cancel: {
          label: "uv",
          onClick: () => {
            void create("uv")
          },
        },
      })
    }
    showRef.current = show
    if (!prompted.has(root)) {
      prompted.add(root)
      show()
    }
    return () => {
      if (promptRef.current !== undefined) toast.dismiss(promptRef.current)
      promptRef.current = undefined
    }
  }, [root, missing, busy, notification, t])
  if (!missing) return null
  return (
    <button
      type="button"
      disabled={busy}
      className="shrink-0 border-b px-3 py-1 text-left text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      onClick={() => showRef.current()}
    >
      {t(busy ? "python.environment.creating" : "python.environment.title")}
    </button>
  )
}
