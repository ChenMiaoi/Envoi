export const isRemoteWorkspace = (root?: string) => /^(ssh|wsl):\/\//.test(root ?? "")

export interface WorkspaceLocation {
  kind: "ssh" | "wsl"
  host: string
  directory: string
}

export function locationLabel(entry: { path?: string; location?: WorkspaceLocation }) {
  if (entry.location) {
    const { kind, host, directory } = entry.location
    return `${kind === "wsl" ? "WSL" : "SSH"}: ${host} · ${directory}`
  }
  return isRemoteWorkspace(entry.path) ? "SSH / WSL" : (entry.path ?? "")
}
