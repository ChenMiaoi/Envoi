import type { PaperClient, ResearchPaper } from "@/lib/researchLibrary"
import { useEffect, useRef, useState } from "react"
export function usePaperAttachment(
  call: PaperClient,
  paper: ResearchPaper,
  hasDetail: boolean,
  setError: (message: string) => void,
) {
  const [file, setFile] = useState<File>()
  const [pdfText, setPdfText] = useState("")
  const readingPosition = useRef<{ page: number; fraction: number } | undefined>(undefined)
  const loadedHash = useRef(paper.attachmentHash)
  useEffect(() => {
    if (!hasDetail || !paper.attachmentHash) return
    let live = true
    if (loadedHash.current !== paper.attachmentHash) {
      readingPosition.current = undefined
      setPdfText("")
    }
    loadedHash.current = paper.attachmentHash
    setFile(undefined)
    void call("pdf")
      .then((attachment) => {
        if (live)
          setFile(
            new File(
              [Uint8Array.from(atob(attachment.base64), (c) => c.charCodeAt(0))],
              paper.attachmentName ?? "paper.pdf",
              { type: "application/pdf" },
            ),
          )
      })
      .catch((e) => {
        if (live) setError((e as Error).message)
      })
    return () => {
      live = false
    }
  }, [call, hasDetail, paper.attachmentHash, paper.attachmentName, setError])
  return { file, setFile, pdfText, setPdfText, readingPosition }
}
