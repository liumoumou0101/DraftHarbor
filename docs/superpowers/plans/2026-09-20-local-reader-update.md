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
- [ ] Review and commit only the reader implementation, its 10 regression files, package.json test wiring, and this plan. Verify the unrelated 17 files remain untracked and unchanged.
- [ ] Merge `origin/main`, retaining both reader and OpenCode test wiring. Run `npm test` and `npm run backup-test`; address actionable failures before building.
- [ ] Run `npm run dist`, `npm run packaged-smoke` and `npm run installed-smoke`. Verify archive source matches the merged checkout, retain the earlier official package, and report the new local runnable paths and commit.

## Evidence

- Before correction, a browser computed `display: none` for an explicitly visible status bar at 1100 and 960 pixels; 1280 pixels displayed it.
- Existing reader-core, reader-shell, writer-truncation, lint and startup smoke checks passed during the inspection preceding this plan.
- After correction, visible/auto/hidden preferences passed browser checks at all four widths; the footer remained 51px high without overlapping or overflowing controls. The complete reader-shell suite and lint passed again.
- The pre-merge unit run passed its behavioral suites and failed only the existing `tests/release-config.js` line-count assertion, which counted the final newline as an extra line. Upstream `e9eb177` already corrects that assertion without changing its 120-line limit. The integrated full suite remains the release gate.
