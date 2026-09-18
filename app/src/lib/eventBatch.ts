// Bound rendering frequency without dropping/reordering stream events. Finish flushes
// synchronously so completion, cancellation and errors cannot lose the final chunk.
export function createEventBatch<T>(consume: (events: T[]) => void, delay = 32) {
  let pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!pending.length) return
    const events = pending
    pending = []
    consume(events)
  }
  return {
    push(event: T) {
      if (finished) return
      pending.push(event)
      timer ??= setTimeout(flush, delay)
    },
    finish() {
      finished = true
      flush()
    },
  }
}
