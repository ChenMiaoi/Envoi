import type { LibraryAction, LibraryInput, LibraryResults } from "../../shared/contracts"
export type { ResearchPaper, PaperDetail, LibraryIndex } from "../../shared/library-model"
import { libraryMessage } from "./libraryMessages"
import { envoi } from "./desktop"
export function researchLibrary<A extends LibraryAction>(
  root: string,
  input: LibraryInput<A>,
): Promise<LibraryResults[A]> {
  return envoi()
    .library(root, input)
    .then((result) => {
      if (
        result &&
        typeof result === "object" &&
        "warnings" in result &&
        Array.isArray(result.warnings)
      )
        return { ...result, warnings: result.warnings.map(libraryMessage) } as LibraryResults[A]
      return result as LibraryResults[A]
    })
    .catch((error) => {
      throw new Error(libraryMessage(error))
    })
}

export type PaperAction = Extract<
  LibraryAction,
  | "get"
  | "select"
  | "attach"
  | "remove"
  | "pdf"
  | "note"
  | "dismiss-draft"
  | "history"
  | "chat-list"
  | "chat-new"
  | "chat-select"
  | "state"
  | "metadata"
>
type PaperFields<A extends PaperAction> = Omit<LibraryInput<A>, "action" | "paperId">
export function createPaperClient(root: string, paperId: string) {
  return <A extends PaperAction>(
    action: A,
    ...args: keyof PaperFields<A> extends never ? [extra?: PaperFields<A>] : [extra: PaperFields<A>]
  ) => researchLibrary<A>(root, { ...args[0], action, paperId } as LibraryInput<A>)
}
export type PaperClient = ReturnType<typeof createPaperClient>
