# Repository layout and migration

`app/` remains the application boundary: interface, local adapters, package lock, tests and developer utilities. Keeping that path avoids unnecessary import and running-service changes. `examples/demo/` is a complete paper-writing example, separate from application implementation. Cross-project documentation lives in `docs/`; root npm commands forward to the application.

The example’s TeX/Bib/PNG/CSV sources are eligible for tracking in the root repository. Its generated `build/` and local `.paperdesk/` state are ignored but retained on disk. There is no default application snapshot. `npm run demo:build` builds the explicit example; `npm run demo:snapshot` exports its inventory to `examples/demo/build/snapshot.json` without changing application startup. The old snapshot is archived under example build output; old public assets remain solely for manually recovered legacy drafts.

The former standalone example repository had no commits or remote at migration. Its complete `.git` metadata was moved intact to a timestamped directory under the sibling `pi-design-backups/`, outside this repository. A manifest of original example file hashes and restoration notes accompany the backup. No history was deleted and no nested `.git` remains inside the example. The unified root repository was initialized on `main`, without staging or committing files.

A previously granted browser directory handle may need to be reopened after a filesystem move. Use the project menu to open the new `examples/demo/` location if the old handle no longer resolves. A local connection hint in the ignored management directory points to the new verified location; tool operations still validate their directory proof. This does not bypass browser permission requirements.

The development server remains at `http://127.0.0.1:3000/` because its working directory did not change. Local TeX/Git/ChkTeX adapter requirements are unchanged. This reorganization is not a license grant; see the root README and third-party notices.
