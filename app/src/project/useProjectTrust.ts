import { useCallback, useEffect, useRef, useState } from "react"
import { envoi } from "@/lib/desktop"
type TrustState = { root: string; trusted: boolean; decided: boolean }
export function useProjectTrust(root?: string) {
  const [state, setState] = useState<TrustState>()
  const requestSerial = useRef(0)
  const refresh = useCallback(async () => {
    if (!root || typeof envoi().projectTrust !== "function") return
    const serial = ++requestSerial.current
    try {
      const next = await envoi().projectTrust(root)
      if (serial === requestSerial.current) setState({ root, ...next })
    } catch {
      if (serial === requestSerial.current) setState({ root, trusted: false, decided: true })
    }
  }, [root])
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
    void refresh()
    const off = envoi().onTrustChanged(() => {
      if (active) void refresh()
    })
    return () => {
      active = false
      off()
    }
  }, [refresh, root])
  return state?.root === root ? { ...state, refresh } : undefined
}
