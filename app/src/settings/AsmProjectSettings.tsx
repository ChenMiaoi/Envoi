import { useEffect, useRef, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { useProject } from "@/project/context"
import { useT } from "@/i18n/useT"
import { defaultAsmConfig, validateAsmConfig } from "../../shared/asm-config.mjs"
import { referenceInfo } from "../../shared/riscv/features.mjs"

export function AsmProjectSettings() {
  const { t } = useT()
  const root = useProject((state) => state.project.rootPath)
  const [config, setConfig] = useState(defaultAsmConfig)
  const [original, setOriginal] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const current = useRef(root)
  const generation = useRef(0)
  current.current = root
  useEffect(() => {
    const revision = ++generation.current
    current.current = root
    let cancelled = false
    setReady(false)
    setBusy(false)
    setError("")
    setMessage("")
    setConfig(defaultAsmConfig())
    setOriginal(null)
    if (root)
      void envoi()
        .fsRead(root, ".envoi/asm.json")
        .then((result) => {
          if (cancelled) return
          const text = result.text ?? ""
          setConfig(validateAsmConfig(JSON.parse(text)))
          setOriginal(text)
          setReady(true)
        })
        .catch((cause) => {
          if (cancelled) return
          if (/ENOENT|not found|不存在/i.test(ipcError(cause).message)) setReady(true)
          else setError(ipcError(cause).message)
        })
    return () => {
      cancelled = true
      generation.current = revision + 1
      current.current = undefined
    }
  }, [root])
  async function save(external: boolean) {
    if (!root || busy || !ready) return
    const target = root
    const revision = generation.current
    const active = () => current.current === target && generation.current === revision
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const text = JSON.stringify(validateAsmConfig(config), null, 2) + "\n"
      await envoi().fsMkdir(target, ".envoi")
      if (!active()) return
      const result = await envoi().fsSave(target, [
        { path: ".envoi/asm.json", text, expectedText: original },
      ])
      if (result.error) throw Error(result.error)
      if (!active()) return
      setOriginal(text)
      if (external) {
        const setup = await envoi().fsSave(target, [
          {
            path: ".asm-lsp.toml",
            expectedText: null,
            text: '[default_config]\nassembler = "gas"\ninstruction_set = "riscv"\n\n[default_config.opts]\ndiagnostics = false\ndefault_diagnostics = false\n',
          },
        ])
        if (setup.error) throw Error(setup.error)
      }
      if (active()) setMessage(t("extensions.asm.saved"))
    } catch (cause) {
      if (active()) setError(ipcError(cause).message)
    } finally {
      if (active()) setBusy(false)
    }
  }
  return (
    <section
      data-testid="asm-project-settings"
      className="space-y-3 rounded-xl border border-border/60 p-3 text-xs"
    >
      <p>{t("extensions.asm.builtin")}</p>
      <p className="text-muted-foreground">
        {t("extensions.asm.reference", {
          instructions: String(referenceInfo.instructions),
          csrs: String(referenceInfo.csrs),
        })}
      </p>
      <p className="text-muted-foreground">{t("extensions.asm.hint")}</p>
      {!root ? (
        <p>{t("extensions.openProject")}</p>
      ) : (
        <fieldset disabled={!ready || busy} className="space-y-2 disabled:opacity-60">
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              {t("extensions.asm.isa")}
              <input
                className="mt-1 w-full rounded border bg-background p-2 font-mono"
                value={config.march}
                onChange={(event) => setConfig({ ...config, march: event.target.value })}
              />
            </label>
            <label>
              ABI
              <input
                aria-label="RISC-V ABI"
                className="mt-1 w-full rounded border bg-background p-2 font-mono"
                value={config.abi}
                onChange={(event) => setConfig({ ...config, abi: event.target.value })}
              />
            </label>
            <label>
              {t("extensions.rtl.includes")}
              <textarea
                className="mt-1 w-full rounded border bg-background p-2 font-mono"
                value={config.includeDirs.join("\n")}
                onChange={(event) =>
                  setConfig({ ...config, includeDirs: event.target.value.split(/\r?\n/) })
                }
              />
            </label>
            <label>
              {t("extensions.rtl.defines")}
              <textarea
                className="mt-1 w-full rounded border bg-background p-2 font-mono"
                value={config.defines.join("\n")}
                onChange={(event) =>
                  setConfig({ ...config, defines: event.target.value.split(/\r?\n/) })
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded border px-2 py-1" onClick={() => void save(false)}>
              {t("extensions.asm.save")}
            </button>
            <button className="rounded border px-2 py-1" onClick={() => void save(true)}>
              {t("extensions.asm.setupLsp")}
            </button>
          </div>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
