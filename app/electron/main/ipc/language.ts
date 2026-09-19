import { dataStore } from "../../../server/local-data.mjs"
import { safePathParts } from "../../../shared/file-rules.mjs"
import { lspLanguage } from "../lsp-service.mjs"
import type { MainServices } from "../runtime"
export function registerLanguageIpc(
  services: Pick<MainServices, "requireBoundRoot" | "lspService" | "handle" | "sessions">,
) {
  const { requireBoundRoot, lspService, handle, sessions } = services
  async function authorized<T>(
    event: Electron.IpcMainInvokeEvent,
    directory: string,
    operation: (root: string, assertCurrent: () => void) => T | Promise<T>,
  ) {
    const { request, finish } = sessions.trackOperation(event.sender.id, directory, "lsp")
    try {
      const root = await requireBoundRoot(directory)
      const assertCurrent = () => {
        if (request.cancelled || event.sender.isDestroyed()) throw Error("语言服务请求已取消")
        if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
      }
      assertCurrent()
      return await operation(root, assertCurrent)
    } finally {
      finish()
    }
  }

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
    ) =>
      authorized(event, root, async (root, assertCurrent) => {
        const preferences = (await dataStore({
          store: "preferences",
          key: "default",
          action: "get",
        })) as { body: { value?: unknown; revision?: number } | null }
        assertCurrent()
        lspService.configurePreferences(preferences.body?.value, preferences.body?.revision ?? 0)
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
      }),
  )
  handle("envoi:lsp-change", (event, root: string, file: string, text: string) =>
    authorized(event, root, (root) => {
      safePathParts(file)
      lspService.change(event.sender.id, root, file, text)
    }),
  )
  handle(
    "envoi:lsp-query",
    (event, root: string, file: string, method: string, offset: number, text: string) =>
      authorized(event, root, (root) => {
        safePathParts(file)
        if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null
        return lspService.query(event.sender.id, root, file, method, offset, text)
      }),
  )
  handle("envoi:lsp-close", (event, root: string, file: string, token: string) => {
    if (typeof root === "string" && typeof file === "string" && typeof token === "string")
      lspService.close(event.sender.id, root, file, token)
  })
}
