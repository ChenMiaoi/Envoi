import { translate } from "@/i18n/runtime"
import { envoi, ipcError } from "@/lib/desktop"
import type { PaperProject } from "@/project/model"
import { paperDependencies } from "./paperDependencies"
export function projectSignature(project: PaperProject) {
  return JSON.stringify([
    project.rootId,
    paperDependencies(project)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => [file.path, file.text ?? file.version ?? file.url ?? 0]),
  ])
}
function decode(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}
const aborted = () => new DOMException(translate("compile.aborted"), "AbortError")
export async function compileProject(project: PaperProject, engine: string, signal?: AbortSignal) {
  const runtime = (await envoi()
    .compilerRuntime()
    .catch((error) => {
      throw ipcError(error)
    })) as { available?: boolean; error?: string }
  if (!runtime.available) throw new Error(runtime.error ?? translate("compile.serviceUnavailable"))
  const main = project.files.find((file) => file.id === project.rootId)?.path
  if (!main) throw new Error(translate("compile.noMainFile"))
  const drafts = project.files
    .filter((file) => file.text !== undefined && file.text !== file.saved)
    .map((file) => ({ path: file.path, text: file.text! }))
  if (signal?.aborted) throw aborted()
  const cancel = () => {
    void envoi().cancelCompile()
  }
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    const result = await envoi()
      .compile({ rootPath: project.rootPath!, main, engine, drafts })
      .catch((error) => {
        throw signal?.aborted ? aborted() : ipcError(error)
      })
    if (signal?.aborted) throw aborted()
    if (!result.ok || !result.pdf)
      return {
        ok: false as const,
        error: result.error ?? translate("compile.failed"),
        log: result.log ?? "",
      }
    return {
      ok: true as const,
      file: new File([decode(result.pdf)], "compiled.pdf", { type: "application/pdf" }),
      synctex: typeof result.synctex === "string" ? decode(result.synctex) : undefined,
      log: result.log,
    }
  } finally {
    signal?.removeEventListener("abort", cancel)
  }
}
