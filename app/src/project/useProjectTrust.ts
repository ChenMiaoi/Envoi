import { useEffect, useState } from "react"
import { envoi } from "@/lib/desktop"
export function useProjectTrust(root?: string) {
  const [state, setState] = useState<{ root: string; trusted: boolean; decided: boolean }>()
  useEffect(() => {
    if (!root) return
    if (
      typeof envoi().projectTrust !== "function" ||
      typeof envoi().onTrustChanged !== "function"
    ) {
      setState({ root, trusted: false, decided: true })
      return
    }
    let active = true
    const refresh = () =>
      void envoi()
        .projectTrust(root)
        .then((result) => {
          if (active) setState({ root, ...result })
        })
        .catch(() => {
          if (active) setState({ root, trusted: false, decided: true })
        })
    refresh()
    const off = envoi().onTrustChanged(refresh)
    return () => {
      active = false
      off()
    }
  }, [root])
  return state?.root === root ? state : undefined
}
