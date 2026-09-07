// Version 10.0.1 omits the declaration files advertised in its package exports.
declare module "@retorquere/bibtex-parser" {
  export function parse(input: string): {
    errors: { error: string }[]
    entries: {
      key: string
      input: string
      fields: {
        title?: string
        year?: string
        date?: string
        journal?: string
        booktitle?: string
        author?: {
          name?: string
          firstName?: string
          lastName?: string
          prefix?: string
          suffix?: string
        }[]
      }
    }[]
  }
}
