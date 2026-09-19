import { dataStore } from "../../../server/local-data.mjs"
import { safePathParts } from "../../../shared/file-rules.mjs"
import { lspLanguage } from "../lsp-service.mjs"
import type { MainServices } from "../runtime"
export function registerLanguageIpc(
  services: Pick<MainServices, "requireBoundRoot" | "lspService" | "handle" | "sessions">,
) {
  const { requireBoundRoot, lspService, handle, sessions } = services
  handle(
    "envoi:lsp-open",
    async (
      event,
      root: string,
      file: string,
      text: string,
      token: string,
      preferredServer?: string,
      preferredPath?: string,
    ) => {
      const preferences = (await dataStore({
        store: "preferences",
        key: "default",
        action: "get",
      })) as { body: { value?: unknown; revision?: number } | null }
      lspService.configurePreferences(preferences.body?.value, preferences.body?.revision ?? 0)
      root = await requireBoundRoot(root)
      if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
      if (typeof file !== "string" || !lspLanguage(file))
        return { available: false, error: "No language server for this file" }
      safePathParts(file)
      if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token))
        throw Error("Invalid editor token")
      return lspService.open(
        event.sender.id,
        root,
        file,
        text,
        token,
        preferredServer,
        preferredPath,
      )
    },
  )
  handle("envoi:lsp-change", async (event, root: string, file: string, text: string) => {
    root = await requireBoundRoot(root)
    if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
    safePathParts(file)
    lspService.change(event.sender.id, root, file, text)
  })
  handle(
    "envoi:lsp-query",
    async (event, root: string, file: string, method: string, offset: number, text: string) => {
      root = await requireBoundRoot(root)
      if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
      safePathParts(file)
      if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null
      return lspService.query(event.sender.id, root, file, method, offset, text)
    },
  )
  handle("envoi:lsp-close", (event, root: string, file: string, token: string) => {
    if (typeof root === "string" && typeof file === "string" && typeof token === "string")
      lspService.close(event.sender.id, root, file, token)
  })
}
