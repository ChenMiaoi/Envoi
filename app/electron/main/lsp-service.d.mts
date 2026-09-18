export function lspLanguage(file: string): string | undefined
export class LspService {
  constructor(
    publish?: (
      owner: number,
      event: { root: string; path?: string; diagnostics: unknown[] },
    ) => void,
    resolve?: (
      root: string,
      language: string,
      preferredServer?: string,
      preferredPath?: string,
      managedDirectory?: string,
    ) =>
      | { command: string; args: string[]; name: string }
      | undefined
      | Promise<{ command: string; args: string[]; name: string } | undefined>,
    managedDirectory?: string | (() => string),
  )
  configurePreferences(value: unknown, revision: number): void
  open(
    owner: number,
    root: string,
    file: string,
    text: string,
    token: string,
    preferredServer?: string,
    preferredPath?: string,
  ): Promise<{ available: boolean; server?: string; error?: string }>
  change(owner: number, root: string, file: string, text: string): void
  query(
    owner: number,
    root: string,
    file: string,
    method: string,
    offset: number,
    text: string,
  ): Promise<unknown>
  close(owner: number, root: string, file: string, token: string): void
  dispose(owner: number, root?: string): void
}
