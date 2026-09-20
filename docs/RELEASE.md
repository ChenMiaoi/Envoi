# Release process

The release workflow runs when a stable tag (`v<major>.<minor>.<patch>`) or release candidate tag (`v<major>.<minor>.<patch>-rc<number>`) is pushed. The tag version must match the `version` field in both the root `package.json` and `app/package.json`. Release candidates are published as GitHub prereleases and are not marked Latest.

Before tagging:

1. Update both package versions to the same value and keep the root package entry in `app/package-lock.json` in sync.
2. Write `docs/releases/v<version>.md` with user-facing changes and a link to the full comparison. Follow the [release notes guide](releases/README.md); omit empty categories. Validate with `node app/scripts/release-notes.mjs v<version>`.
3. Run `npm run ci:check` before sharing and `npm run check:local` before committing, as required by `AGENTS.md`. The local check may reuse successful results for unchanged inputs.
4. Commit and push the version change and release notes to `main`.
5. Wait for the CI workflow on that exact commit to pass on both macOS and Windows before pushing the release tag.

Create and push an annotated tag from the versioned commit:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

The workflow then builds:

- Windows NSIS installer (`.exe`) and `latest.yml` for in-app updates
- macOS DMG and ZIP installers
- `SHA256SUMS.txt`

The workflow creates or reuses the GitHub Release for the tag and uploads these files. Wait for all release jobs to finish successfully, then verify the published notes, installer assets and checksums. Confirm that `latest.yml` references the published Windows installer and matching version. macOS signing and notarization are not configured; add repository secrets and an explicit signing policy before distributing signed macOS builds.
