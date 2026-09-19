export interface SshTarget {
  kind?: "ssh" | "wsl"
  host: string
  configFile?: string
  port?: number
  directory: string
}
export interface RemoteState {
  root: string
  kind?: "ssh" | "wsl"
  host: string
  directory: string
  state: "connecting" | "connected" | "disconnected"
  error?: string
  generation: number
}
export type RemoteEvent =
  | { type: "state"; value: RemoteState }
  | { type: "prompt"; id: string; prompt: string }
  | { type: "terminal"; root: string; data?: string; exit?: number }
