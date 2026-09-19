import { workspaceAiDefaults } from "../workspaces.mjs"
// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import path from "node:path"
import { dataDir, jsonFile, projectRoot, readProjectConfig } from "../local-data.mjs"

export const agentDir = path.join(dataDir, "pi"),
  settingsFile = path.join(dataDir, "ai/settings.json")
const defaults = { model: null, context: "current", tools: "read" }
export function normalizeAi(value, partial = false) {
  const result = partial ? {} : { ...defaults }
  if (value?.provider === null || typeof value?.provider === "string")
    result.provider = value.provider
  if (
    value?.thinking === null ||
    ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value?.thinking)
  )
    result.thinking = value.thinking
  if (value?.model === null || (typeof value?.model === "string" && value.model.includes("/")))
    result.model = value.model
  if (["none", "current"].includes(value?.context)) result.context = value.context
  if (["none", "read", "write"].includes(value?.tools)) result.tools = value.tools
  return result
}
export async function effective(projectId) {
  const global = normalizeAi(await jsonFile(settingsFile, {}))
  if (projectId === "global") return global
  const root = await projectRoot(projectId),
    { config: project } = await readProjectConfig(root)
  return {
    ...global,
    ...normalizeAi(await workspaceAiDefaults(root), true),
    ...normalizeAi(project?.ai, true),
  }
}
