import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { GitBranch, History, RefreshCw, Tag } from "lucide-react"
import { useProject } from "@/project/context"

import {
  localGitLog,
  localGitShow,
  type GitCommit,
  type GitLog,
  type GitShow,
} from "@/lib/localGit"
import { layoutGraph } from "@/lib/gitGraph"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n/useT"
import { WorkspacePanel } from "./WorkspacePanel"

/** 车道颜色随主题的 hue 槽位解析；SVG 表现属性支持 var() 引用。 */
const LANE_COLORS = ["yellow", "blue", "green", "red", "violet", "orange", "cyan", "pink"].map(
  (name) => `hsl(var(--hue-${name}))`,
)
const ROW_H = 30,
  LANE_W = 16,
  PAD = 8
const cx = (lane: number) => PAD + lane * LANE_W + LANE_W / 2,
  cy = (row: number) => row * ROW_H + ROW_H / 2

function RefBadge({ commit }: { commit: GitCommit }) {
  return (
    <>
      {commit.head && (
        <span className="rounded-full border border-primary/50 px-1.5 text-[10px] leading-4 text-primary">
          HEAD
        </span>
      )}
      {commit.refs.map((ref) => (
        <span
          key={`${ref.kind}:${ref.name}`}
          className={cn(
            "flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-4",
            ref.kind === "branch"
              ? "border-primary/40 text-primary"
              : ref.kind === "tag"
                ? "border-warning/40 text-warning"
                : "border-border text-muted-foreground",
          )}
        >
          {ref.kind === "tag" ? (
            <Tag className="h-2.5 w-2.5" />
          ) : (
            <GitBranch className="h-2.5 w-2.5" />
          )}
          {ref.name}
        </span>
      ))}
    </>
  )
}

export function GitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: GitCommit[]
  selected: string | null
  onSelect: (hash: string) => void
}) {
  const { rows, edges, laneCount } = useMemo(() => layoutGraph(commits), [commits])
  const graphWidth = laneCount * LANE_W + PAD * 2
  return (
    <div className="relative" style={{ minHeight: rows.length * ROW_H }}>
      <svg
        aria-hidden
        className="absolute left-0 top-0"
        width={graphWidth}
        height={(rows.length + 1) * ROW_H}
      >
        {edges.map((edge, index) => (
          <path
            key={index}
            d={`M ${cx(edge.fromLane)} ${cy(edge.fromRow)} C ${cx(edge.fromLane)} ${(cy(edge.fromRow) + cy(edge.toRow)) / 2}, ${cx(edge.toLane)} ${(cy(edge.fromRow) + cy(edge.toRow)) / 2}, ${cx(edge.toLane)} ${cy(edge.toRow)}`}
            stroke={LANE_COLORS[edge.color % LANE_COLORS.length]}
            strokeWidth={1.6}
            fill="none"
          />
        ))}
        {rows.map(({ commit, lane }, row) => (
          <circle
            key={commit.hash}
            cx={cx(lane)}
            cy={cy(row)}
            r={4}
            fill={commit.head ? LANE_COLORS[lane % LANE_COLORS.length] : "hsl(var(--background))"}
            stroke={LANE_COLORS[lane % LANE_COLORS.length]}
            strokeWidth={2}
          />
        ))}
      </svg>
      {rows.map(({ commit }) => (
        <button
          key={commit.hash}
          onClick={() => onSelect(commit.hash)}
          className={cn(
            "relative flex w-full items-center gap-2 px-2 text-left text-xs transition-colors hover:bg-secondary/60",
            selected === commit.hash && "bg-accent/60",
          )}
          style={{ height: ROW_H, paddingLeft: graphWidth + 8 }}
        >
          <RefBadge commit={commit} />
          <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
          <span className="shrink-0 text-muted-foreground">
            {commit.author} · {commit.date.slice(0, 10)}
          </span>
          <span className="w-16 shrink-0 text-right font-editor text-muted-foreground">
            {commit.hash.slice(0, 7)}
          </span>
        </button>
      ))}
    </div>
  )
}

function CommitDetail({ show, error, busy }: { show?: GitShow; error: string; busy: boolean }) {
  const { t } = useT()
  if (busy) return <p className="p-4 text-xs text-muted-foreground">{t("history.loadingDetail")}</p>
  if (error)
    return (
      <p role="alert" className="p-4 text-xs text-warning">
        {error}
      </p>
    )
  if (!show) return null
  const rest = show.commit.body.split("\n").slice(1).join("\n").trim()
  return (
    <div className="p-4 text-xs">
      <p className="font-editor text-muted-foreground">{show.commit.hash}</p>
      <h2 className="mt-1 text-sm font-medium">{show.commit.subject}</h2>
      {rest && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{rest}</p>}
      <p className="mt-2 text-muted-foreground">
        {show.commit.author} ·{" "}
        <time dateTime={show.commit.date} title={show.commit.date}>
          {new Date(show.commit.date).toLocaleString(undefined, { timeZoneName: "short" })}
        </time>
      </p>
      {show.commit.parents.length > 1 && (
        <p className="mt-2 text-muted-foreground">{t("history.mergeNote")}</p>
      )}
      <h3 className="mt-4 border-t border-border pt-3 font-medium">
        {t("history.changedFiles", { n: show.files.length })}
      </h3>
      {show.files.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("history.noChanges")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {show.files.map((file) => (
            <li key={file.path} className="flex items-baseline gap-2">
              <span className="shrink-0 font-editor text-[10px]">
                {file.added === null ? (
                  <span className="text-muted-foreground">{t("history.binary")}</span>
                ) : (
                  <>
                    <span className="text-success">+{file.added}</span>{" "}
                    <span className="text-danger">−{file.deleted}</span>
                  </>
                )}
              </span>
              <span className="min-w-0 truncate" title={file.path}>
                {file.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function GitHistoryView() {
  return (
    <WorkspacePanel
      history={(root, revision) => (
        <CommitHistoryView key={root} directory={root} revision={revision} />
      )}
    />
  )
}
function CommitHistoryView({ directory, revision }: { directory: string; revision: number }) {
  const currentProject = useProject((state) => ({ id: state.project.id }))
  const project = { ...currentProject, rootPath: directory }
  const { t } = useT()
  const [log, setLog] = useState<GitLog | null>(null),
    [message, setMessage] = useState(() => t("history.notLoaded")),
    [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, GitShow>>({})
  const [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState("")
  const requests = useRef(0)
  const identity = useRef(project.id)
  identity.current = project.id
  const refresh = useCallback(async () => {
    const id = project.id
    const request = ++requests.current
    setBusy(true)
    try {
      if (!project.rootPath) {
        setMessage(t("history.noDirectory"))
        return
      }
      const result = await localGitLog(project.rootPath)
      if (identity.current !== id || requests.current !== request) return
      setLog(result)
      setSelected((current) =>
        result.commits.some((commit) => commit.hash === current) ? current : null,
      )
      setMessage(
        result.state === "nested"
          ? t("history.nested", { repo: result.enclosing ?? "" })
          : result.state === "not-initialized"
            ? t("history.notInitialized")
            : result.commits.length
              ? ""
              : t("history.empty"),
      )
    } catch (error) {
      if (identity.current === id && requests.current === request)
        setMessage((error as Error).message)
    } finally {
      if (identity.current === id && requests.current === request) setBusy(false)
    }
  }, [project.id, project.rootPath, t])
  useEffect(() => {
    void refresh()
  }, [refresh, revision])
  useEffect(() => {
    const listener = () => void refresh()
    window.addEventListener("envoi:connection-updated", listener)
    return () => window.removeEventListener("envoi:connection-updated", listener)
  }, [refresh])
  const select = useCallback(
    async (hash: string) => {
      setSelected(hash)
      if (details[hash]) return
      const id = project.id,
        directory = project.rootPath
      if (!directory) return
      setDetailBusy(true)
      setDetailError("")
      try {
        const show = await localGitShow(directory, hash)
        if (identity.current !== id) return
        setDetails((current) => ({ ...current, [hash]: show }))
      } catch (error) {
        if (identity.current === id) setDetailError((error as Error).message)
      } finally {
        if (identity.current === id) setDetailBusy(false)
      }
    },
    [project.id, project.rootPath, details],
  )
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">{t("view.history")}</h1>
          {log?.branch && (
            <span className="flex items-center gap-1 rounded-full border border-border px-2 text-[11px] leading-5 text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {log.detached ? t("history.detachedHead") + " · " : ""}
              {log.branch}
            </span>
          )}
          {log?.truncated && (
            <span className="text-[11px] text-muted-foreground">{t("history.truncated")}</span>
          )}
        </div>
        <button
          disabled={busy}
          aria-label={t("history.refreshAria")}
          onClick={() => void refresh()}
          className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </header>
      {!log && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <p role="status" className="text-sm text-muted-foreground">
            {busy ? t("history.loading") : message}
          </p>
        </div>
      )}
      {log && (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto py-1">
            {message && (
              <p role="status" className="p-6 text-center text-sm text-muted-foreground">
                {message}
              </p>
            )}
            {!message && (
              <GitGraph
                commits={log.commits}
                selected={selected}
                onSelect={(hash) => void select(hash)}
              />
            )}
          </div>
          {selected && (
            <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-card">
              <CommitDetail
                show={details[selected]}
                error={detailError}
                busy={detailBusy && !details[selected]}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
