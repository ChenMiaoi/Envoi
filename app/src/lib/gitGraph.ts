import type { GitCommit } from "./localGit"
export interface GraphRow {
  commit: GitCommit
  lane: number
}
export interface GraphEdge {
  fromRow: number
  fromLane: number
  toRow: number
  toLane: number
  color: number
}
export interface GraphLayout {
  rows: GraphRow[]
  edges: GraphEdge[]
  laneCount: number
}
// Lane assignment over topo-ordered commits: each lane tracks the hash it waits for;
// a commit takes the lane waiting for it (or a free/new one) and hands lanes to its parents.
export function layoutGraph(commits: GitCommit[]): GraphLayout {
  const lanes: (string | null)[] = [],
    rows: GraphRow[] = [],
    pending: {
      fromRow: number
      fromLane: number
      toHash: string
      toLane: number
      color: number
    }[] = []
  const rowOf = new Map<string, number>()
  const alloc = (hash: string) => {
    let lane = lanes.indexOf(null)
    if (lane === -1) {
      lane = lanes.length
      lanes.push(hash)
    } else lanes[lane] = hash
    return lane
  }
  commits.forEach((commit, row) => {
    rowOf.set(commit.hash, row)
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) lane = alloc(commit.hash)
    lanes[lane] = null
    rows.push({ commit, lane })
    commit.parents.forEach((parent, index) => {
      let target = lanes.indexOf(parent)
      if (target === -1)
        target =
          index === 0 && lanes[lane] === null ? ((lanes[lane] = parent), lane) : alloc(parent)
      pending.push({ fromRow: row, fromLane: lane, toHash: parent, toLane: target, color: target })
    })
  })
  const edges = pending.map(({ toHash, ...rest }) => ({
    ...rest,
    toRow: rowOf.get(toHash) ?? rows.length,
  }))
  return { rows, edges, laneCount: lanes.length }
}
