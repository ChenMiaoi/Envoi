# Third-party notices

This file records component provenance; it does not select a license for PaperDesk’s original code.

- JavaScript dependencies are declared in `app/package.json` and pinned by `app/package-lock.json`. Their individual package licenses remain applicable.
- PDF.js resources under `app/public/pdfjs/` come from `pdfjs-dist`; its Apache License 2.0 text is retained there as `LICENSE`. Additional resource/font notices included with those files are retained.
- The paper catalog uses installed, unmodified TeX classes. It does not redistribute or relicense those class files. The ACM example retains `examples/demo/TEMPLATE.md` with official source and license attribution. Catalog references and family-specific notices are documented in `docs/LOCAL_PROJECTS_AND_COMPILATION.md`.
- The bundled example’s bibliography identifies real public research records. Its charts are synthetic illustrations, not figures reproduced from those papers.

No top-level license has been granted for PaperDesk. Before publishing under an open-source license, the owner should select one and review the licenses of distributed dependencies/assets.

## Markdown continuous editor

CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `lang-markdown`) and `@lezer/markdown` use the MIT license. Package license files remain installed with the dependencies. Original Markdown is edited as text; display decorations do not serialize HTML back into the document.
