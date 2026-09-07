# IO-Aware Attention — Envoi demonstration

This is a complete local writing project with an illustrative English ACM manuscript. All performance data are deterministic synthetic model outputs, not hardware measurements or published results.

## Working with this project

- Edit `main.tex` and the files in `chapters/` in Writer, then save and compile with PDFLaTeX. TeX Live with the `acmart` class and its dependencies is required.
- Browse the five demonstration commits in Git History. Each commit adds an actual stage of the manuscript; these are teaching revisions created now, not recovered research history. No remote is configured and no personal author identity is used to create them.
- Explore citations in `references.bib`, figures in `assets/`, and the editable table in `data/model-data.csv`.
- Open `SHOWCASE.md` in Reader to explore Markdown rendering.
- Compiler output belongs in `build/` and is ignored by Git. The first compilation generates the PDF from this project's source.

Every use of **Open example project** creates a new independent directory under Envoi's global data directory (`~/.envoi/examples`, or `ENVOI_DATA_DIR/examples`). To continue this copy, open it from Recent Projects. Creating another example never resets this copy.

## Reproduce the figures

From this project directory, install the dependencies in `tools/requirements.txt` in your chosen Python environment, then run:

```sh
python tools/generate-figures.py
```

The generator lives inside this project and does not depend on the Envoi source checkout. It regenerates `data/model-data.csv` and the PNG/table assets; auxiliary vector files are stored in `.envoi/figure-sources/`.

The model uses F=4N²d, materialized bytes=8N²+8Nd, tiled bytes=0.5N²+8Nd, P=120e12 FLOP/s, W=1.2e12 bytes/s, compute efficiency=0.60, bandwidth efficiency=0.65 and launch overhead=30 microseconds. These are illustrative assumptions, not device specifications.
