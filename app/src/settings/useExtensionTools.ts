import { useCallback, useEffect, useState } from "react"
import { envoi } from "@/lib/desktop"
import { useProject } from "@/project/context"
import { usePreferences } from "./context"
import { languagePlugins } from "./pluginCatalog"
import type { Preferences } from "./model"
import { pathsOf, type Tool, type ToolInfo } from "./extensionTools"
export function useExtensionTools(scope: "global" | "project") {
  const project = useProject((state) => ({ rootPath: state.project.rootPath }))
  const { preferences, update } = usePreferences()
  const [tools, setTools] = useState<ToolInfo | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [manual, setManual] = useState<Record<string, string>>({})
  const [manualTool, setManualTool] = useState<Record<string, string>>({})
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const [manualError, setManualError] = useState<Record<string, string>>({})
  const [verified, setVerified] = useState<Record<string, { path: string; version?: string }>>({})
  const [verifiedTools, setVerifiedTools] = useState<
    Record<string, { path: string; version?: string }>
  >({})
  const [lspProbed, setLspProbed] = useState(false)
  const [toolsProbed, setToolsProbed] = useState(false)
  const [installing, setInstalling] = useState<Record<string, boolean>>({})
  const root = scope === "project" ? project.rootPath : undefined
  const load = useCallback(
    async (refresh: boolean) => {
      setRefreshing(true)
      try {
        setTools((await envoi().tools({ refresh, root })) as ToolInfo)
        setError("")
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setRefreshing(false)
      }
    },
    [root],
  )
  useEffect(() => {
    void load(false)
  }, [load])
  useEffect(() => {
    if (!tools) return
    const next = { ...preferences.lspServers }
    let changed = false
    for (const plugin of languagePlugins) {
      const group = plugin.id.slice("envoi.".length)
      const available = (tools.groups?.[group] ?? []).filter(
        (tool) => tool.kind === "lsp" && pathsOf(tool).length,
      )
      const valid = (id?: string) =>
        !!id && (available.some((tool) => tool.id === id) || !!preferences.lspPaths[id])
      if (group === "cpp") {
        const chosen = [next.cpp, next.c].find(valid) ?? available[0]?.id
        if (chosen)
          for (const language of ["c", "cpp"])
            if (next[language] !== chosen) {
              next[language] = chosen
              changed = true
            }
      } else
        for (const entry of plugin.contributes.languages) {
          const chosen = valid(next[entry.id]) ? next[entry.id] : available[0]?.id
          if (chosen && next[entry.id] !== chosen) {
            next[entry.id] = chosen
            changed = true
          }
        }
    }
    if (changed) update({ lspServers: next })
  }, [tools, preferences.lspServers, preferences.lspPaths, update])
  useEffect(() => {
    setLspProbed(false)
    let cancelled = false
    void Promise.all(
      Object.entries(preferences.lspPaths).map(async ([id, selected]) => {
        try {
          return [id, await envoi().probeLspPath(id, selected)] as const
        } catch {
          return [id, null] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setVerified(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, { path: string; version?: string }] =>
              entry[1] !== null,
          ),
        ),
      )
      setLspProbed(true)
    })
    return () => {
      cancelled = true
    }
  }, [preferences.lspPaths])
  useEffect(() => {
    setToolsProbed(false)
    let cancelled = false
    void Promise.all(
      Object.entries(preferences.toolPaths).map(async ([id, selected]) => {
        try {
          return [id, await envoi().probeToolPath(id, selected)] as const
        } catch {
          return [id, null] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setVerifiedTools(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, { path: string; version?: string }] =>
              entry[1] !== null,
          ),
        ),
      )
      setToolsProbed(true)
    })
    return () => {
      cancelled = true
    }
  }, [preferences.toolPaths])

  // 路径记忆：探测成功后把选中路径写入偏好；已记住且仍可执行的路径优先于每次重新探测，
  // 仅当保存的路径失效且探测到新候选时才自动纠正，找不到时保留原路径并由界面提示。
  useEffect(() => {
    if (!tools || scope !== "global" || !lspProbed || !toolsProbed) return
    const lspPatch: Record<string, string> = {}
    const toolPatch: Record<string, string> = {}
    for (const list of Object.values(tools.groups ?? {}))
      for (const tool of list) {
        const candidates = pathsOf(tool)
        if (!candidates.length) continue
        const stored = (tool.kind === "lsp" ? preferences.lspPaths : preferences.toolPaths)[tool.id]
        if (
          stored &&
          (candidates.some((candidate) => candidate.path === stored) ||
            (tool.kind === "lsp" ? verified : verifiedTools)[tool.id])
        )
          continue
        ;(tool.kind === "lsp" ? lspPatch : toolPatch)[tool.id] = candidates[0].path
      }
    const patch: Partial<Preferences> = {}
    if (Object.keys(lspPatch).length) patch.lspPaths = { ...preferences.lspPaths, ...lspPatch }
    if (Object.keys(toolPatch).length) patch.toolPaths = { ...preferences.toolPaths, ...toolPatch }
    if (Object.keys(patch).length) update(patch)
  }, [
    tools,
    scope,
    lspProbed,
    toolsProbed,
    verified,
    verifiedTools,
    preferences.lspPaths,
    preferences.toolPaths,
    update,
  ])

  async function saveManual(language: string, server: string) {
    try {
      const result = await envoi().probeLspPath(server, manual[language]?.trim() ?? "")
      setVerified((previous) => ({ ...previous, [server]: result }))
      const servers = { ...preferences.lspServers, [language]: server }
      if (language === "cpp") servers.c = server
      update({
        lspServers: servers,
        lspPaths: { ...preferences.lspPaths, [server]: result.path },
      })
      setManualOpen((previous) => ({ ...previous, [language]: false }))
      setManualError((previous) => ({ ...previous, [language]: "" }))
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [language]: (cause as Error).message }))
    }
  }

  async function saveToolManual(id: string) {
    try {
      const result = await envoi().probeToolPath(id, manual[id]?.trim() ?? "")
      setVerifiedTools((previous) => ({ ...previous, [id]: result }))
      update({ toolPaths: { ...preferences.toolPaths, [id]: result.path } })
      setManualOpen((previous) => ({ ...previous, [id]: false }))
      setManualError((previous) => ({ ...previous, [id]: "" }))
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [id]: (cause as Error).message }))
    }
  }

  async function installToolById(tool: Tool) {
    setInstalling((previous) => ({ ...previous, [tool.id]: true }))
    try {
      const result = await envoi().installTool(tool.id)
      // 同一二进制的多个条目（如 ruff 格式化/检查）共享安装结果
      const peers = Object.values(tools?.groups ?? {})
        .flat()
        .filter((entry) => entry.binary && entry.binary === tool.binary)
      const targets = peers.length ? peers : [tool]
      const paths = { ...preferences.toolPaths }
      for (const peer of targets) paths[peer.id] = result.path
      update({ toolPaths: paths })
      setVerifiedTools((previous) => ({
        ...previous,
        ...Object.fromEntries(
          targets.map((peer) => [peer.id, { path: result.path, version: result.version }]),
        ),
      }))
      setManualError((previous) => ({ ...previous, [tool.id]: "" }))
      void load(true)
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [tool.id]: (cause as Error).message }))
    } finally {
      setInstalling((previous) => ({ ...previous, [tool.id]: false }))
    }
  }

  async function installLspFor(language: string) {
    setInstalling((previous) => ({ ...previous, [language]: true }))
    try {
      const result = await envoi().installLsp(language)
      const servers = { ...preferences.lspServers, [language]: result.id }
      if (language === "cpp") servers.c = result.id
      update({
        lspServers: servers,
        lspPaths: { ...preferences.lspPaths, [result.id]: result.path },
      })
      setVerified((previous) => ({
        ...previous,
        [result.id]: { path: result.path, version: result.version },
      }))
      setManualError((previous) => ({ ...previous, [language]: "" }))
      void load(true)
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [language]: (cause as Error).message }))
    } finally {
      setInstalling((previous) => ({ ...previous, [language]: false }))
    }
  }

  function setEnabled(id: string, enabled: boolean) {
    if (scope === "project" && root) {
      update({
        pluginWorkspaces: {
          ...preferences.pluginWorkspaces,
          [root]: { ...preferences.pluginWorkspaces[root], [id]: enabled },
        },
      })
    } else update({ pluginStates: { ...preferences.pluginStates, [id]: enabled } })
  }

  return {
    preferences,
    update,
    tools,
    error,
    refreshing,
    expanded,
    setExpanded,
    manual,
    setManual,
    manualTool,
    setManualTool,
    manualOpen,
    setManualOpen,
    manualError,
    verified,
    verifiedTools,
    installing,
    root,
    load,
    saveManual,
    saveToolManual,
    installToolById,
    installLspFor,
    setEnabled,
  }
}
