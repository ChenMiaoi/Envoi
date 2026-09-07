import { useEffect, useState, useMemo } from "react"
import { verifyPreview } from "@/lib/pdfSync"
import { CompileControls } from "./CompileControls"
import { projectSignature } from "@/lib/compileClient"
import { paperPdf } from "@/lib/paperPdf"
import { TexCompilePreview } from "@/components/TexCompilePreview"
import { useProject } from "./context"
export function ProjectPdfPreview({
  target,
  syncPoint,
  onLocateSource,
}: {
  target?: { title: string; id: number }
  syncPoint?: { path: string; line: number; id: number }
  onLocateSource?: (path: string, line: number) => void
}) {
  const { project } = useProject()
  const active = useMemo(() => paperPdf(project), [project])
  const [verification, setVerification] = useState<{ project: typeof project; ok: boolean } | null>(
    null,
  )
  const [diskSync, setDiskSync] = useState<Uint8Array | null>(null)
  // 重新打开的项目没有内存态编译结果，从磁盘 build/main.synctex.gz 恢复映射。
  useEffect(() => {
    let live = true
    void (async () => {
      let bytes: Uint8Array | null = null
      try {
        const file = project.files.find((f) => f.path === "build/main.synctex.gz")?.file
        if (file) bytes = new Uint8Array(await file.arrayBuffer())
      } catch {
        /* 缺失或不可读时退化为无映射。 */
      }
      if (live) setDiskSync(bytes)
    })()
    return () => {
      live = false
    }
  }, [project])
  useEffect(() => {
    let live = true
    if (active)
      void verifyPreview(project, active).then((ok) => {
        if (live) setVerification({ project, ok })
      })
    return () => {
      live = false
    }
  }, [project, active])
  const syncReady = !active ? false : verification?.project === project ? verification.ok : null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CompileControls hasPdf={!!active} />
      {active?.id === "compiled" &&
        project.compiled &&
        project.compiled.signature !== projectSignature(project) && (
          <p className="shrink-0 bg-card px-3 py-1 text-[10px] text-warning">
            正文已有更新，显示上次成功编译结果。
          </p>
        )}
      <div className="min-h-0 flex-1">
        <TexCompilePreview
          paperOnly
          target={target}
          syncReady={syncReady}
          syncPoint={syncPoint}
          onLocateSource={onLocateSource}
          syncData={active?.id === "compiled" ? (project.compiled?.synctex ?? null) : diskSync}
          sourcePaths={project.files
            .filter((file) => file.kind === "latex" && file.text !== undefined)
            .map((file) => file.path)}
          key={`${project.rootId}:${active?.id ?? "empty"}:${active?.file?.lastModified ?? 0}:${active?.url ?? ""}`}
          initialSource={{ name: active?.path ?? "", file: active?.file, url: active?.url }}
        />
      </div>
    </div>
  )
}
