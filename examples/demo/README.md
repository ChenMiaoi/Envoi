# IO-Aware Attention — PaperDesk demonstration

This is an English illustrative manuscript using the official installed ACM `acmart` class (`sigconf,nonacm`). It is not a submitted paper, an ACM publication, or a report of measured GPU results. The author label explicitly identifies the demonstration. All numeric performance data are deterministic synthetic model outputs.

- `main.tex`, `chapters/`, `references.bib`: manuscript and four real bibliographic records.
- `../../app/scripts/generate-demo-figures.py`: deterministic model, figures, and table generator (Python 3, NumPy, Matplotlib).
- `data/model-data.csv`: all 21 modeled shape records.
- `assets/`: six 300-dpi PNG figures actually used by the paper, plus generated table source.
- `.paperdesk/figure-sources/`: retained vector PDF sources; hidden management artifacts, not duplicate manuscript inputs.
- `build/main.pdf`: compiled nine-page paper. `build/compile.log`: real compilation transcript. Build output is ignored by Git; it remains available on disk.
- `paperdesk.json`: root source, engine, build folder, and Git initialization state.

Reproduce figures with `python3 ../../app/scripts/generate-demo-figures.py` after installing NumPy and Matplotlib in your chosen Python environment. From the repository’s `app/` directory, `node scripts/build-demo.mjs` uses the same isolated local compiler as PaperDesk to produce `build/main.pdf`. This Mac has TeX Live 2026; ACM class version is recorded in the PDF metadata and compilation log. Figure generation was checked with Python 3.14, NumPy 2.5.2, Matplotlib 3.11.1.

The numeric model uses F=4N²d, materialized bytes=8N²+8Nd, tiled bytes=0.5N²+8Nd, P=120e12 FLOP/s, W=1.2e12 bytes/s, compute efficiency=0.60, bandwidth efficiency=0.65, launch overhead=30 microseconds. Times use overhead + max(compute time, transfer time). These are illustrative assumptions, not device specifications.

This example belongs to the repository-root Git project on branch `main`. Its former standalone Git metadata was backed up outside the repository during migration; no nested repository remains. No commit, configured project identity, remote, or push was created. The `.gitignore` excludes build outputs and TeX auxiliary files while allowing manuscript sources, input PNG/PDF figures, and CSV data to be tracked. A release PDF can be distributed separately if desired.

PaperDesk's initial view is a bundled snapshot of this directory, explicitly labelled as a snapshot. To edit and save the real files, use Open Project and select this `demo` folder in the native authorization picker. Browser automation has not bypassed that picker.
