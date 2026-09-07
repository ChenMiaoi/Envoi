# Envoi

A local academic writing workspace with a LaTeX editor, automatic outline, paper PDF preview, bibliography and assets, a personal PDF/Bib library, native Git status, and compilation/editor diagnostics. The interface runs as an Electron desktop application.

## Quick start

Requires Node.js 22.12+ and npm. From this repository root:

```sh
npm run setup
npm run dev
```

The Envoi desktop window opens automatically. See [desktop setup and workspace trust](docs/DESKTOP.md). Page URLs are `/reader`, `/writer`, `/library`, and `/settings`; the root opens `/writer`. Startup restores a real saved project or shows an empty workspace. No example project, paper library or chat conversation is loaded automatically. To use the explicit example, open `examples/demo/` through the project menu. Settings use `/settings/{global|project}/{general|editor|compile|references}` with a separate `/settings/global/shortcuts` page.

Desktop compilation currently targets macOS with an installed TeX toolchain. Trust a workspace once to enable Git, LaTeX and AI together. TeX and Git executables are detected from the service environment; `ENVOI_TEX_BIN` can select a TeX binary directory. Git status uses the detected Git executable; editor checks auto-detect ChkTeX and support a validated custom executable path in settings. The application reports missing tools and does not install them automatically. Static hosting does not provide desktop capabilities.

Reader opens CSV/TSV as editable tables, Markdown as a continuous live preview editor, and images/PDFs in their native previews. Opening a `.tex` file goes to Writer without changing the compilation main file. Ctrl/Command+S immediately saves all project drafts; [settings](docs/SETTINGS.md) include customizable keyboard shortcuts layered by modifier: Mod+Shift switches pages, Mod+Alt acts inside the current page (reader tabs and panels, writer side panels). See [Reader and library](docs/READER_AND_LIBRARY.md) for persistence and format behavior.

The project menu also supports [closing projects, removing recent records and explicitly confirmed directory deletion](docs/PROJECT_MANAGEMENT.md). These are separate operations.

## Repository layout

```text
app/                     React interface, local adapters, tests and developer scripts
examples/demo/           English ACM example: TeX, bibliography, PNG figures and CSV
  build/                 Generated 9-page PDF, logs and diagnostics (ignored)
docs/                    Architecture, local workflow and original design notes
CONTRIBUTING.md          Development and verification workflow
THIRD_PARTY.md           Dependency and template attribution
```

The example uses explicit synthetic data; it is not a published paper or hardware benchmark. Its current PDF is `examples/demo/build/main.pdf`. The example is not application startup data. Older public example assets remain only for compatibility with manually recovered legacy drafts; no current component loads them by default.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build the app |
| `npm test` | Project, outline, diagnostic and parser tests |
| `npm run test:local` | Actual local TeX/Git/ChkTeX checks; requires installed tools |
| `npm run demo:build` | Compile the example and refresh the bundled snapshot |
| `npm run test:demo` | Verify PDF destinations, fingerprints and diagnostic recovery |
| `npm run demo:snapshot` | Refresh the snapshot from an already compiled example |

Figure regeneration is optional: `python3 app/scripts/generate-demo-figures.py` requires NumPy and Matplotlib. The generator remains in development tools, outside the example’s writing directory.

See [local projects and compilation](docs/LOCAL_PROJECTS_AND_COMPILATION.md), [development instructions](CONTRIBUTING.md), and [repository layout notes](docs/REPOSITORY_LAYOUT.md).

## License status

No project-wide license has been selected. Organizing this repository for public collaboration does **not** grant an open-source license. Existing third-party licenses and template attributions remain applicable; see [third-party notices](THIRD_PARTY.md).
