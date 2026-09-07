# Project research library

The library belongs to one research project (idea), not to a machine-wide account. Linked worktrees resolve the registered main workspace; without an Envoi worktree registry the primary Git worktree is used. Projects without Git use their own root.

## Layout and authority

`.envoi/library/library.sqlite` holds schema version, stable research ID, literature metadata, groups, attachment hashes, selected paper, reading positions, per-paper chat records, note revisions and preserved conflict drafts. `.envoi/library/notes/<paperId>.md` is the editable note body. Attachments are immutable PDFs addressed by full SHA-256 under `attachments/`. Pi conversation files live under `conversations/<paperId>/<sessionId>/`.

All renderer changes pass through the trusted Electron library IPC. The AI has a dedicated note tool bound to a paper ID, using the same persistence service and SQLite transaction checks. `BEGIN IMMEDIATE` and a busy timeout serialize writes across the desktop and AI backend processes. No renderer overwrites a whole global literature array. Markdown changes outside the application are detected by their content hash and recorded as a new revision before a write is accepted.

A note write carries its expected revision. Stale content is retained as a conflict draft rather than overwriting the current note. The UI keeps the editor content and offers explicit merge/reload choices. Historical versions can be restored as a new edit. Markdown replacement is atomic; if a process exits between file replacement and the database commit, the next read detects and records the changed file.

## Reading and AI

Each paper retains its own note, reading page/fraction and conversation. Only pages near the viewport are rendered; offscreen bitmap and text layers are released. Each page bitmap is capped at four million pixels. Opening a paper does not start a second full-document text scan. Paper components retain running tasks across paper switches; the task's root and paper ID are captured at send time. Reading chats use only the dedicated note tool, so changing the selected paper cannot retarget an edit. Ordinary questions do not authorize note edits; explicit user requests do. Note versions still protect against simultaneous user edits.

The AI receives the current note, selected text and an on-demand extract of the first eight PDF pages (up to 30,000 characters, not the full paper). It must not treat document contents as instructions. Chat history is stored with the project. Protocol tests use the real SDK with a loopback provider, without calling a user's inference account.

## Import, migration and backup

PDF and BibTeX import reuse the existing metadata extraction. The old global library is imported only through an explicit action; its records are never removed. Duplicate citation keys and attachment hashes are skipped. The existing local demo collection has been migrated separately into its project library; this does not silently seed unrelated projects.

Export produces a JSON archive with metadata, attachments, note bodies/history, reading state and conversation transcripts. Import preserves paper IDs into an empty destination, skipping existing papers. Runtime Pi files are not embedded; imported conversations continue from the retained transcript. To retain every runtime artifact, close the application and copy the complete `.envoi/library` directory with the project. The data directory is private project data, excluded from ordinary Git merging by the standard project ignore rules.

Development requires Node.js 22.13+ for the built-in SQLite module; Electron supplies its own runtime. Tests: `node --test scripts/test-research-library.mjs`, `node scripts/test-research-library-ui.mjs`, and `node scripts/test-agent-native.mjs` from `app/`.

Reading-position updates resolve the research root without scanning Git status in each worktree. Root lookups have a short cache invalidated by registry changes. Library and Git worktree administrative events do not refresh manuscript snapshots; external manuscript edits still do. Rasterization waits for resize events to settle. UI regressions verify note autosaves do not allocate new PDF bitmaps.

Fast scrolling pauses the viewer render queue and PDF.js continuation callbacks. After 140 ms without scrolling, pending offscreen work is discarded and nearby pages are rendered one at a time, followed by text and annotations. The UI test crosses 29 pages continuously and checks that intermediate pages do not start bitmap rendering. `ENVOI_PDF_STRESS_FILE` can run the same scenario against a real local PDF of at least 30 pages.
