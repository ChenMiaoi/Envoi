import type { CompileInput } from "../../../server/compiler.mjs"
import {
  configurePaperSearch,
  detectTool,
  paperSearchConfig,
  probeLanguageServerPath,
  probeToolPath,
} from "../../../server/tool-config.mjs"
import { safePathParts } from "../../../shared/file-rules.mjs"
import { runLanguageTool } from "../language-tools.mjs"
import { installLanguageServer, installedServer, lspInstallable } from "../lsp-installer.mjs"
import { createPythonEnvironment, pythonEnvironmentStatus } from "../python-environment.mjs"
import type { MainServices } from "../runtime"
import { installTool, installedTool, toolInstallPlan } from "../tool-installer.mjs"
export function registerToolsIpc(
  services: Pick<
    MainServices,
    | "requireBoundRoot"
    | "compilerBackend"
    | "toolsBackend"
    | "managedLspDirectory"
    | "managedToolsDirectory"
    | "requireToolContext"
    | "handle"
    | "sessions"
  >,
) {
  const {
    requireBoundRoot,
    compilerBackend,
    toolsBackend,
    managedLspDirectory,
    managedToolsDirectory,
    requireToolContext,
    handle,
    sessions,
  } = services
  handle("envoi:compiler-runtime", async (event) => {
    await requireToolContext(event)
    return compilerBackend.call("runtime")
  })
  handle("envoi:compile", async (event, input: CompileInput) => {
    const owner = event.sender.id
    const { request, finish } = sessions.trackCompile(owner, input.rootPath)
    try {
      const root = await requireBoundRoot(input.rootPath!)
      if (request.cancelled || event.sender.isDestroyed()) throw Error("编译已取消")
      return await compilerBackend.call("compile", [input], { owner, root })
    } finally {
      finish()
    }
  })
  handle("envoi:cancel-compile", (event) => {
    sessions.cancelCompile(event.sender.id)
    return compilerBackend.cancel(event.sender.id)
  })
  handle(
    "envoi:lint",
    async (
      event,
      input: { rootPath?: string; path: string; text: string; disabledRules?: number[] },
    ) => {
      const { request, finish } = sessions.trackOperation(event.sender.id, input.rootPath, "lint")
      try {
        const root = await requireBoundRoot(input.rootPath ?? "")
        if (request.cancelled || event.sender.isDestroyed()) throw Error("检查已取消")
        return await toolsBackend.call("lint", [input], { owner: event.sender.id, root })
      } finally {
        finish()
      }
    },
  )
  handle("envoi:tools", async (event, options?: { refresh?: boolean; root?: string }) => {
    await requireToolContext(event)
    const root = options?.root ? await requireBoundRoot(options.root) : undefined
    const info = (await toolsBackend.call("tools", [{ refresh: options?.refresh, root }])) as {
      groups?: Record<
        string,
        {
          id: string
          available: boolean
          path?: string
          version?: string
          candidates?: { path: string; version?: string }[]
        }[]
      >
    }
    const mergeInstalled = (
      row: {
        available: boolean
        path?: string
        version?: string
        candidates?: { path: string; version?: string }[]
      },
      installed: { path: string; version?: string },
    ) => {
      const candidates = row.candidates ?? []
      Object.assign(row, {
        available: true,
        path: installed.path,
        version: installed.version,
        candidates: candidates.some((candidate) => candidate.path === installed.path)
          ? candidates
          : [{ path: installed.path, version: installed.version }, ...candidates],
      })
    }
    const brew = detectTool("brew")
    const rustup = detectTool("rustup")
    for (const rows of Object.values(info.groups ?? {}))
      for (const row of rows) {
        const installed = await installedTool(managedToolsDirectory(), row.id)
        if (installed) mergeInstalled(row, installed)
        // probeCatalog 生成的行带有注册表中的可选 kind 字段。
        const { kind } = row as { kind?: string }
        const plan =
          kind === "lsp" ? null : toolInstallPlan(row.id, { brew: !!brew, rustup: !!rustup })
        Object.assign(row, {
          installable: kind === "lsp" ? lspInstallable(row.id) : !!plan,
          installMethod: plan?.method ?? null,
        })
      }
    for (const language of ["cpp", "python", "rust", "lean"]) {
      const installed = await installedServer(managedLspDirectory(), language)
      const group = info.groups?.[language]
      const row = group?.find((entry) => entry.id === installed?.id)
      if (row && installed) mergeInstalled(row, installed)
    }
    return info
  })
  handle("envoi:python-environment", async (event, root: string, manager?: string) => {
    root = await requireBoundRoot(root)
    if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
    if (manager === undefined) return pythonEnvironmentStatus(root)
    await requireToolContext(event)
    return createPythonEnvironment(root, manager)
  })
  handle("envoi:install-lsp", async (event, language: string) => {
    await requireToolContext(event)
    const installed = await installLanguageServer(managedLspDirectory(), language)
    if (!installed) throw Error("Language server installation failed")
    return { id: installed.id, path: installed.path, version: installed.version }
  })
  handle("envoi:install-tool", async (event, id: string) => {
    await requireToolContext(event)
    return installTool(managedToolsDirectory(), id)
  })
  handle(
    "envoi:language-tool",
    async (
      event,
      root: string,
      file: string,
      text: string,
      kind: string,
      selectedPath?: string,
    ) => {
      root = await requireBoundRoot(root)
      if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
      safePathParts(file)
      return runLanguageTool(root, file, text, kind, selectedPath)
    },
  )
  handle("envoi:probe-lsp-path", async (event, id: string, value: string) => {
    await requireToolContext(event)
    return probeLanguageServerPath(id, value)
  })
  handle("envoi:probe-tool-path", async (event, id: string, value: string) => {
    await requireToolContext(event)
    return probeToolPath(id, value)
  })
  handle("envoi:paper-search-config", () => paperSearchConfig())
  handle("envoi:configure-paper-search", (_event, input: unknown) => configurePaperSearch(input))
  handle("envoi:configure-tools", async (event, input: { chktexPath: string | null }) => {
    await requireToolContext(event)
    return toolsBackend.call("configureTools", [input])
  })
  handle("envoi:git-runtime", async (event) => {
    await requireToolContext(event)
    return toolsBackend.call("gitRuntime")
  })
  for (const [channel, method] of [
    ["git-init", "gitInit"],
    ["git-status", "gitStatus"],
    ["git-log", "gitLog"],
    ["git-show", "gitShow"],
  ] as const) {
    handle(`envoi:${channel}`, async (_event, directory: string, extra?: Record<string, unknown>) =>
      toolsBackend.call(method, [await requireBoundRoot(directory), extra]),
    )
  }
}
