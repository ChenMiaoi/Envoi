import type { ProjectFile } from "./projectFiles"

// Compare references/metadata, not serialized document contents, on the typing path.
export function sameFileNavigation(left: ProjectFile[], right: ProjectFile[]) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((file, index) => {
        const next = right[index]
        return file.id === next.id && file.path === next.path && file.kind === next.kind
      }))
  )
}
export function sameSavedFiles(left: ProjectFile[], right: ProjectFile[]) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((file, index) => {
        const next = right[index]
        return file.path === next.path && file.saved === next.saved
      }))
  )
}
