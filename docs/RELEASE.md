# Release process

The release workflow runs when a stable tag (`v<major>.<minor>.<patch>`) or release candidate tag (`v<major>.<minor>.<patch>-rc<number>`) is pushed. The tag version must match the `version` field in both the root `package.json` and `app/package.json`. Release candidates are published as GitHub prereleases and are not marked Latest.

Before tagging:

1. Update both package versions to the same value.
2. Write `docs/releases/v<version>.md` with user-facing changes and a link to the full comparison. Follow the [release notes guide](releases/README.md); omit empty categories. Validate with `node app/scripts/release-notes.mjs v<version>`.
3. Run `npm run format:check`, `npm run lint`, `npm run build`, `npm test`, and `npm run test:ai`.
4. Commit and push the version change and release notes to `main`.

Create and push an annotated tag from the versioned commit:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

The workflow then builds:

- Windows NSIS installer (`.exe`)
- macOS DMG and ZIP installers
- `SHA256SUMS.txt`

The workflow creates or reuses the GitHub Release for the tag and uploads these files. macOS signing and notarization are not configured; add repository secrets and an explicit signing policy before distributing signed macOS builds.
