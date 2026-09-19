import type { PaperClient, PaperDetail } from "@/lib/researchLibrary"
import { useCallback, useEffect, useRef, useState } from "react"
import { notice } from "./ui"
export function usePaperNote(
  call: PaperClient,
  active: boolean,
  detail: PaperDetail | undefined,
  setError: (message: string) => void,
) {
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<{ text: string; revision: number }>()
  const draft = useRef(""),
    saved = useRef(""),
    revision = useRef(0),
    queue = useRef(Promise.resolve()),
    blocked = useRef(false)
  const initialize = useCallback((note: { text: string; revision: number }) => {
    draft.current = saved.current = note.text
    revision.current = note.revision
    setText(note.text)
  }, [])
  const refreshNote = useCallback(async () => {
    const latest = await call("get")
    if (draft.current === saved.current) {
      revision.current = latest.note.revision
      draft.current = saved.current = latest.note.text
      setText(latest.note.text)
    } else if (latest.note.revision !== revision.current) {
      await call("note", { text: draft.current, expectedRevision: revision.current })
      blocked.current = true
      setConflict(latest.note)
    }
    return latest
  }, [call])
  const flush = useCallback(() => {
    queue.current = queue.current.then(async () => {
      if (blocked.current || draft.current === saved.current) return
      setSaving(true)
      const value = draft.current
      try {
        const result = await call("note", {
          text: value,
          expectedRevision: revision.current,
        })
        if (result.conflict) {
          blocked.current = true
          setConflict(result)
          return
        }
        revision.current = result.revision
        saved.current = value
        setError("")
      } catch (e) {
        setError((e as Error).message)
        notice(e)
      } finally {
        setSaving(false)
      }
    })
    return queue.current
  }, [call, setError])
  useEffect(() => {
    if (!detail) return
    const timer = setTimeout(() => void flush(), 450)
    return () => clearTimeout(timer)
  }, [text, detail, flush])
  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )
  useEffect(() => {
    if (active && detail) void refreshNote().catch((e) => setError((e as Error).message))
  }, [active, detail, refreshNote, setError])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (draft.current !== saved.current) {
        void flush()
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", protect)
    return () => window.removeEventListener("beforeunload", protect)
  }, [flush])
  const edit = (value: string) => {
    draft.current = value
    setText(value)
  }
  const beginMerge = (value: string) => {
    blocked.current = true
    setConflict({ text: saved.current, revision: revision.current })
    edit(value)
  }
  const saveMerged = () => {
    if (!conflict) return
    revision.current = conflict.revision
    blocked.current = false
    setConflict(undefined)
    void flush()
  }
  const useLatest = () => {
    if (!conflict) return
    revision.current = conflict.revision
    saved.current = conflict.text
    edit(conflict.text)
    blocked.current = false
    setConflict(undefined)
  }
  return {
    text,
    saving,
    conflict,
    initialize,
    refreshNote,
    flush,
    edit,
    beginMerge,
    saveMerged,
    useLatest,
    isSaved: draft.current === saved.current,
    isBlocked: () => blocked.current,
    currentText: () => draft.current,
  }
}
