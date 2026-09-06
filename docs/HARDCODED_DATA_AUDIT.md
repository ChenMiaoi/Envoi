# Business-data audit

## Removed from active application behavior

- Default bundled project import and automatic demo-session restoration. Empty startup contains no documents, PDF, diagnostics or fictitious project. Real project restoration continues and preserves inaccessible-directory drafts.
- Seeded assistant greeting, fabricated document summaries/diagnostics, random streaming replies, pretend task dispatch, nonfunctional agent selection and green connected-state indicators. The assistant is explicitly unavailable and cannot send a request.
- Static workspace/file bodies and literature records; the workspace data module now contains types only. Files, outlines, assets and bibliography derive from the opened project; the personal library contains only user imports.
- Simulated PDF pages, fixed page counts and unused mock paper previews. The actual PDF component now requires an explicit file/URL and otherwise shows an empty state; it never falls back to a sample document.
- Fixed prototype version label and random sidebar skeleton widths. Configuration and layout constants remain ordinary UI defaults.

## Preserved user state

No browser databases, real files, bibliography entries or personal settings were cleared. A legacy built-in session is copied into a recovery archive and offered for explicit manual recovery instead of auto-loading. Its original draft values remain available. Old public example assets remain solely to serve links in those manually recovered drafts; they are not a default data source. The former source snapshot was moved under `examples/demo/build/legacy-app-snapshot.json`. Explicit example TeX, PNG, CSV and Bib files are unchanged.

## Real sources and unavailable capabilities

Project files come from granted directory handles and shared draft buffers. Saves report actual write/conflict outcomes. Compiles, editor diagnostics and Git status use existing local adapters. PDFs report the parsed page count. Library records and attachments come from the user's IndexedDB collection. Global preferences and shortcuts come from personal browser storage, while project overrides come from the hidden project configuration. AI and the experimental tracking action remain unavailable.

TeX, ChkTeX, TexLab and Git detection use service PATH plus conventional installation locations. `ENVOI_TEX_BIN` explicitly selects a TeX tool directory; the sandbox derives real executable, binary and library paths. Fixed system sandbox restrictions, supported-format lists, timeouts and route names are safety/configuration constants, not fabricated business records. The local compiler still requires macOS isolation; other platforms report unavailable.

## Intentionally retained

Official template skeletons, default typography/compiler preferences, UI labels, limits, supported commands, test fixtures and the explicitly opened `examples/demo` project remain. The example's synthetic research data is explicitly labeled and never added automatically to the workspace or personal library.

## Verification

Unit/integration tests cover empty startup, manual-only legacy recovery without loss, real-project restoration, existing document/library/settings behavior and save conflicts. Native local-tool tests exercise actual compilers, all eight official template families, Git state and ChkTeX. Build and related lint are checked separately. This audit does not claim a new browser validation or restoration of the user's moved directory handle.
