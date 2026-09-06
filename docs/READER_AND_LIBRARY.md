# Reader and personal paper library

## File behavior

CSV/TSV defaults to an editable table. Every column measures all of its cell text using the actual browser font, including the header and longest line in multiline values. Columns can have different widths; long values allow horizontal table scrolling. A one-cell edit replaces only that field's source span. Unchanged quoting, delimiters, line endings, empty rows and precision-sensitive numeric strings remain unchanged. Malformed quoted input is explicitly reported and falls back to a source repair editor; binary/non-UTF-8 content is not edited as text.

Markdown uses one CodeMirror document with continuous cursor movement, selection, paste and undo. Display decorations show headings/emphasis/code and inactive tables, math and project images; the active syntax remains editable. Original source is authoritative, and changes map editor positions back to original line endings. There is no HTML-to-Markdown round trip, paragraph-mode button or source-mode toolbar. Raw HTML/scripts are never executed. Relative images are resolved only against files already present in the selected project; external images are not loaded. Ctrl/Command-click opens supported links. Preview text uses reader typography, exposed source uses editor typography, and PDFs/images remain independent.

`.tex` opens the selected file in Writer without changing the compilation main file. `.txt` and recognized code/config formats remain directly editable in Reader. Bib displays bibliography cards. Common browser images and PDF use existing renderers. Unsupported binary formats have an explicit fallback, not a text editor.

All document changes enter the same project buffer immediately. Tabs mark unsaved content. Browser session recovery, conflict detection and save-all semantics are shared with Writer. Default Ctrl/Command+S captures current input without requiring blur, saves once, and marks only the written snapshot as saved. Input made during that request stays dirty. Permission failure, moved handles and external edits produce errors while keeping drafts. Compilation is separate and source files are never auto-saved.

## Personal library

`/library` uses the same personal library whether or not a project is open. It contains only imported entries, not generated demo records or a project's compiled PDF. Multiple PDFs and Bib files can be imported. PDF title initially comes from the filename; authors and years are not guessed. Bib records preserve the original Bib source and supply parsed metadata. Attachment-less entries clearly require PDF association.

The compact layout provides collection navigation, search across metadata and tags, status/year filtering, editable details and PDF reading. PDFs open as Reader attachments without being added to the active project or changing its compiler input. Library selection never inserts a citation automatically.

Metadata and attachment copies are stored in IndexedDB `paperdesk-library-v1`, scoped to this browser profile and origin. They are not cloud-synced, Zotero-connected, or written to the user's original imported file. Clearing website data deletes this local collection; original PDF files remain unchanged. Storage/quota failures are reported and failed import transactions do not appear successful. PDF validation and a 100 MB per-file bound precede import; Bib files have a 5 MB bound.

## Verification boundaries

Automated tests use isolated temporary directories and a separate IndexedDB name. They cover source-preserving edits, original line endings, file type routing, immediate-save concurrency and conflicts, project-config migration and library attachment persistence/search. They do not claim recovery of the user's previously moved native directory handle. Visual/browser checks should use existing documents read-only or isolated test data, never silently modify the user's paper or populate their library with samples.
