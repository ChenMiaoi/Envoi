# GitHub release notes

Before tagging a release, add `docs/releases/v<major>.<minor>.<patch>.md` (or `v<major>.<minor>.<patch>-rc<number>.md` for a release candidate) and commit it with the version changes. The release workflow requires this file and uses its contents as the GitHub Release body. Rerunning the workflow updates the body from the same file; edit the source rather than maintaining a separate copy on GitHub.

For stable releases, describe changes since the previous **published stable release**. For release candidates, describe changes since the preceding stable release or candidate and identify the candidate status. Review the Git comparison and verify each claim against the application. Group changes under 新增功能, 体验改进 and 问题修复, omitting empty sections. Include compatibility changes or required user actions only when applicable. Write concise Chinese descriptions of the user-visible result; do not paste raw commit subjects or include changes already shipped in the previous release.

Use this structure, replacing the example descriptions and comparison URL before release:

```markdown
## 新增功能

- Describe a new capability users can now use.

## 体验改进

- Describe a concrete improvement to an existing workflow.

## 问题修复

- Describe the problem that has been fixed.

[完整变更](https://github.com/OWNER/REPO/compare/PREVIOUS_TAG...CURRENT_TAG)
```

For the first release, describe the initial capabilities and omit the previous-version comparison. Do not reuse a published version number for changes made after its tag.

Validate locally from the repository root:

```sh
node app/scripts/release-notes.mjs v<major>.<minor>.<patch>[-rc<number>]
```

This check validates the filename and presence of change entries. The author must still verify the content and comparison baseline. This process only changes the GitHub Release page; application update prompts are independent.
