# Local reader update implementation plan

> **For agentic workers:** Use the existing checkout and the approved task sequence below. The user has approved fixing the reader status bar, committing the local reader changes separately, then integrating upstream and updating the runnable application.

**Goal:** Preserve the local reader work, honor the explicit status-bar preference at narrow widths, and produce a verified local build containing the current upstream changes.

**Architecture:** Keep the reader's existing preference model and responsive layout. Limit the new correction to the narrow-width CSS. Commit the reader implementation and its existing regression tests before merging upstream.

**Tech stack:** Electron, JavaScript, CSS, Playwright, electron-builder, Git.

**Spec:** The user-approved inspection outcome in this task: fix the confirmed status-bar issue, commit the reader changes independently, then integrate the upstream update.

## Constraints

- Preserve all existing work and user data. Keep the 17 unrelated prompt experiment files untracked and out of commits and application packages.
- Work in the current checkout because the task is to consolidate its existing uncommitted changes; do not copy or discard those changes in a new checkout.
- Preserve version 1.2.6: upstream has not published a newer numbered release. Identify the local build by its commit and build date.
- Keep the default narrow-screen behavior for the automatic status bar, while honoring explicit visible and hidden preferences.
- Build locally without publishing or pushing to the remote repository.

## Review focus

- Explicit visible/hidden status-bar preferences at 1280, 1100, 960 and 560 pixels.
- Status text, progress and page controls must not overlap or extend beyond the footer.
- Preserve reader tests in package.json while integrating upstream's OpenCode test entry.
- Preserve experimental files byte for byte and keep project data outside build inputs.
- Verify that the runnable archive contains the merged source and that startup, save, reload and backup work with isolated test data.

## Execution

- [x] Back up the 43 existing working-tree files and record the initial commit and hashes under ignored `.ai_state/update-20260920/`.
- [x] Correct `src/styles/desktop/reader.css`. Verify the reproduced failure becomes a pass for explicit visibility across the listed widths, including footer bounds. Reuse the existing reader regression suite.
- [x] Review and commit only the reader implementation, its 10 regression files, package.json test wiring, and this plan. Verify the unrelated 17 files remain untracked and unchanged.
- [x] Merge `origin/main`, retaining both reader and OpenCode test wiring. Run `npm test` and `npm run backup-test`; address actionable failures before delivery.
- [x] Run `npm run dist`, `npm run packaged-smoke` and `npm run installed-smoke`. Verify archive source matches the merged checkout and retain the earlier official package.

## Evidence

- Before correction, a browser computed `display: none` for an explicitly visible status bar at 1100 and 960 pixels; 1280 pixels displayed it.
- Existing reader-core, reader-shell, writer-truncation, lint and startup smoke checks passed during the inspection preceding this plan.
- After correction, visible/auto/hidden preferences passed browser checks at all four widths; the footer remained 51px high without overlapping or overflowing controls. The complete reader-shell suite and lint passed again.
- The pre-merge unit run passed its behavioral suites and failed only the existing `tests/release-config.js` line-count assertion, which counted the final newline as an extra line. Upstream `e9eb177` already corrects that assertion without changing its 120-line limit. The integrated full suite remains the release gate.
- Independent reader review found no additional release blocker. A separate touch probe confirmed that removing `touchstart` had delayed HUD reveal in continuous reading; restoring the passive listener passed a new failing-then-passing regression and a real touch-event comparison with the original commit.
- The integrated release gate also found the pre-existing foundation stylesheet above its 2200-line limit. Its final workflow guide/timeline rules were moved to the start of the immediately following workflow stylesheet; the concatenated stylesheet content and cascade order were verified unchanged. The release configuration test then passed.
- The existing desktop library test used an obsolete hidden bulk-rule input path and save message. It now opens the disclosure, imports the rules, checks the resulting entries and retains its settings-persistence assertion. The corrected desktop library test passed.
- Local NSIS/portable builds, packaged smoke, and temporary installation/startup/save/reload/backup/uninstall smoke passed. The archive's 265 application source/assets files matched the checkout and contained none of the local project, experiment, test, or settings directories.
- Final `npm test` passed, including all lint, startup, core/storage/provider, writer, reader, compendium, workshop and workflow desktop suites. `npm run backup-test` passed. The packaged desktop entry and runtime package metadata matched the checkout; electron-builder intentionally omits development scripts from the packaged metadata.
- Build work ran in parallel with the final UI-test corrections after application sources were stable; the full suite and packaged/installed tests all passed before the merge was committed or the build delivered. The final upstream reference was rechecked as `e9eb1774dd5fa83f6d6d59af7e4f8f171500f38a`.
- All 17 excluded experiment files retained their original SHA-256 values. The original official installers remain in `release/github-v1.2.6/`; local build checksums are recorded in `release/SHA256SUMS-local-20260920.txt`.
