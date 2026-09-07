import { execFileSync } from "node:child_process"
import path from "node:path"

// TeX can launch BibTeX, converters and shell-escape children. Stop the whole job.
export function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    if (process.platform === "win32") {
      execFileSync(
        path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore", timeout: 5000 },
      )
    } else process.kill(-pid, "SIGKILL")
  } catch {
    /* The process may already have exited. */
  }
}
