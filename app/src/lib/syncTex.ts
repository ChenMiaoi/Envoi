export interface SyncTexRecord {
  input: number
  line: number
  page: number
  x: number
  y: number
}
export interface SyncTexDB {
  inputs: string[]
  records: SyncTexRecord[]
}

/** 解析 SyncTeX 文本；坐标统一转换为 PDF 点（左上角原点，y 向下），与 pdf.js scale=1 viewport 一致。 */
export function parseSyncTex(text: string): SyncTexDB {
  const inputs: string[] = [],
    records: SyncTexRecord[] = []
  let page = 0,
    unit = 1,
    mag = 1000,
    xOffset = 0,
    yOffset = 0
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("Input:")) {
      const rest = raw.slice(6),
        sep = rest.indexOf(":")
      inputs[Number(rest.slice(0, sep))] = rest.slice(sep + 1)
      continue
    }
    if (raw.startsWith("Unit:")) {
      unit = Number(raw.slice(5)) || 1
      continue
    }
    if (raw.startsWith("Magnification:")) {
      mag = Number(raw.slice(14)) || 1000
      continue
    }
    if (raw.startsWith("X Offset:")) {
      xOffset = Number(raw.slice(9)) || 0
      continue
    }
    if (raw.startsWith("Y Offset:")) {
      yOffset = Number(raw.slice(9)) || 0
      continue
    }
    const sheet = /^\{(\d+)$/.exec(raw)
    if (sheet) {
      page = Number(sheet[1])
      continue
    }
    if (!page) continue
    const record =
      /^[[(](\d+),(\d+):(-?\d+),(-?\d+)/.exec(raw) ??
      /^[hvkxg$](\d+),(\d+):(-?\d+),(-?\d+)/.exec(raw)
    if (record)
      records.push({
        input: Number(record[1]),
        line: Number(record[2]),
        page,
        x: Number(record[3]),
        y: Number(record[4]),
      })
  }
  const scale = (1000 / mag / 65536) * unit
  return {
    inputs,
    records: records.map((record) => ({
      ...record,
      x: (record.x - xOffset) * scale,
      y: (record.y - yOffset) * scale,
    })),
  }
}

export async function gunzipSyncTex(bytes: Uint8Array): Promise<string> {
  // 部分静态服务器会给 .gz 加 Content-Encoding:gzip，浏览器透明解压后传入的已是文本。
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    return new TextDecoder().decode(bytes as Uint8Array<ArrayBuffer>)
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}
function normalize(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/\/\.\//g, "/")
    .replace(/^\.\//, "")
}

/** 项目相对路径 ↔ synctex 输入路径（可能是沙盒临时绝对路径）：取最长的后缀匹配。 */
export function matchSyncTexPath(paths: string[], input: string): string | undefined {
  const normalized = normalize(input)
  let best: string | undefined
  for (const path of paths)
    if (
      (normalized === path || normalized.endsWith("/" + path)) &&
      (!best || path.length > best.length)
    )
      best = path
  return best
}

/** 正向：源文件 + 行号 → PDF 位置；优先取不超过目标行的最近记录。 */
export function forwardLookup(
  db: SyncTexDB,
  pathOfInput: (input: number) => string | undefined,
  path: string,
  line: number,
): { page: number; x: number; y: number } | null {
  let best: SyncTexRecord | undefined,
    bestScore = Infinity
  for (const record of db.records) {
    if (pathOfInput(record.input) !== path) continue
    const distance = Math.abs(record.line - line),
      over = record.line > line ? 1 : 0
    const score = distance + over * 0.5
    if (score < bestScore) {
      bestScore = score
      best = record
    }
  }
  return best ? { page: best.page, x: best.x, y: best.y } : null
}

/** 反向：PDF 位置（scale=1 viewport 坐标）→ 源文件 + 行号；按行距优先、水平距离次要取最近记录。 */
export function inverseLookup(
  db: SyncTexDB,
  pathOfInput: (input: number) => string | undefined,
  page: number,
  x: number,
  y: number,
): { path: string; line: number } | null {
  let best: SyncTexRecord | undefined,
    bestScore = Infinity
  for (const record of db.records) {
    if (record.page !== page) continue
    const path = pathOfInput(record.input)
    if (!path) continue
    const score = Math.abs(record.y - y) * 8 + Math.abs(record.x - x) * 0.05
    if (score < bestScore) {
      bestScore = score
      best = record
    }
  }
  if (!best) return null
  return { path: pathOfInput(best.input)!, line: best.line }
}
