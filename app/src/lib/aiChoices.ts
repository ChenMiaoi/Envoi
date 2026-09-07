import type { AgentStatus } from "./agentClient"
export function providerGroups(providers: AgentStatus["providers"]) {
  const sorted = [...new Map(providers.map((provider) => [provider.id, provider])).values()].sort(
    (a, b) => (a.name || a.id).localeCompare(b.name || b.id) || a.id.localeCompare(b.id),
  )
  return [true, false].map((configured) => ({
    configured,
    providers: sorted.filter((provider) => provider.auth.configured === configured),
  }))
}
