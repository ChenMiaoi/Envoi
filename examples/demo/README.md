# IO-Aware Attention — Envoi demonstration

This is an English illustrative manuscript using the official installed ACM `acmart` class (`sigconf,nonacm`). It is not a submitted paper, an ACM publication, or a report of measured GPU results. The author label explicitly identifies the demonstration. All numeric performance data are deterministic synthetic model outputs.

- `main.tex`, `chapters/`, `references.bib`: manuscript and four real bibliographic records.
- `../../app/scripts/generate-demo-figures.py`: deterministic model, figures, and table generator (Python 3, NumPy, Matplotlib).
- `data/model-data.csv`: all 21 modeled shape records.
- `assets/`: six 300-dpi PNG figures actually used by the paper, plus generated table source.
- `.envoi/figure-sources/`: retained vector PDF sources; hidden management artifacts, not duplicate manuscript inputs.
- `build/main.pdf`: compiled nine-page paper. `build/compile.log`: real compilation transcript. Build output is ignored by Git; it remains available on disk.
- `paperdesk.json`: root source, engine, build folder, and Git initialization state.

Reproduce figures with `python3 ../../app/scripts/generate-demo-figures.py` after installing NumPy and Matplotlib in your chosen Python environment. From the repository’s `app/` directory, `node scripts/build-demo.mjs` uses the same isolated local compiler as Envoi to produce `build/main.pdf`. This Mac has TeX Live 2026; ACM class version is recorded in the PDF metadata and compilation log. Figure generation was checked with Python 3.14, NumPy 2.5.2, Matplotlib 3.11.1.

The numeric model uses F=4N²d, materialized bytes=8N²+8Nd, tiled bytes=0.5N²+8Nd, P=120e12 FLOP/s, W=1.2e12 bytes/s, compute efficiency=0.60, bandwidth efficiency=0.65, launch overhead=30 microseconds. Times use overhead + max(compute time, transfer time). These are illustrative assumptions, not device specifications.

For development, run `npm run demo:git` from the Envoi repository root. This creates a local nested `.git` in this folder with one clearly labelled baseline commit, so the desktop Git status and history panels show the demo independently. Re-running the command preserves existing history and edits. It does not configure a remote, push, or change your Git identity. The initial commit includes only example files already tracked by Envoi; build output and local untracked files remain outside the baseline.

The example sources are still ordinary tracked files in the outer Envoi repository, not a submodule. The nested `.git` is local metadata and is not distributed when cloning Envoi, so run the command once on each development checkout. Later source edits are visible to both repositories and can be committed independently.

Envoi's initial view is a bundled snapshot of this directory, explicitly labelled as a snapshot. To edit and save the real files, use Open Project and select this `demo` folder in the native authorization picker. Browser automation has not bypassed that picker.

## Showcase

Open [SHOWCASE.md](SHOWCASE.md) in the reader to see every styled markdown element (headings, callouts, tables, math, code) under the active theme.
