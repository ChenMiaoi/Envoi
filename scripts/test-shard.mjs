// Split after quick/full selection so each selected test runs exactly once.
export function selectShard(items, shard) {
  if (shard === undefined) return items
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard)
  const index = Number(match?.[1])
  const total = Number(match?.[2])
  if (!match || index > total || total > items.length) {
    throw new Error(`Invalid desktop shard: ${shard}`)
  }
  return items.filter((_, offset) => offset % total === index - 1)
}
