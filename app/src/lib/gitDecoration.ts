import type { GitStatus } from "./localGit"

export function gitDecoration(file: GitStatus["files"][number]) {
  const codes = file.index + file.worktree
  if (file.conflict) return { badge: "!", color: "text-[hsl(var(--hue-red))]" }
  if (file.untracked) return { badge: "U", color: "text-[hsl(var(--hue-green))]" }
  if (codes.includes("D")) return { badge: "D", color: "text-[hsl(var(--hue-red))]" }
  if (codes.includes("A")) return { badge: "A", color: "text-[hsl(var(--hue-green))]" }
  return { badge: codes.includes("R") ? "R" : "M", color: "text-[hsl(var(--hue-yellow))]" }
}
