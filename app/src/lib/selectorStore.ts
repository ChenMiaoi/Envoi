import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react"

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  const keys = Object.keys(left) as (keyof T)[]
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]),
    )
  )
}

export function createSelectorStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (next: T) => {
      if (shallowEqual(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}
export type SelectorStore<T> = ReturnType<typeof createSelectorStore<T>>

// Publish after commit, never during render; abandoned React renders cannot leak state.
export function useProvidedStore<T>(value: T) {
  const [store] = useState(() => createSelectorStore(value))
  useLayoutEffect(() => store.publish(value), [store, value])
  return store
}

export function useStoreSelection<T, S>(
  store: SelectorStore<T>,
  select: (value: T) => S,
  equal: (left: S, right: S) => boolean = shallowEqual,
) {
  const getSelection = useMemo(() => {
    let initialized = false
    let previousValue: T
    let selection: S
    return () => {
      const value = store.getSnapshot()
      if (initialized && Object.is(value, previousValue)) return selection
      const next = select(value)
      previousValue = value
      if (!initialized || !equal(selection, next)) selection = next
      initialized = true
      return selection
    }
  }, [store, select, equal])
  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}
