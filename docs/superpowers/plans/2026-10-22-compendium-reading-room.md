# Compendium Reading Room Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent tasks and root integration. User has authorized autonomous implementation of the preceding experience design.

**Goal:** Deliver a readable, responsive compendium workspace with direct editing, grounded references, and a safe writer quick peek.

**Architecture:** Preserve existing compendium CRUD/session state and add focused presentation, insights and peek helpers. Reuse actual snapshot data and existing writer navigation/reference APIs; no schema migration or UI framework.

**Tech Stack:** Vanilla JavaScript classic scripts/UMD, HTML/CSS, Electron, Node assert/node:test, Playwright with installed Chrome.

**Spec:** `docs/superpowers/specs/2026-10-22-compendium-reading-room-design.md`

## Global Constraints

- Preserve prior uncommitted integrity fixes and user `.denova/`; no git mutations or live author data.
- No new runtime dependencies or real paid provider calls.
- Paper/ink visual preferences affect only this module; clear reduced-motion behavior.
- Existing form field selectors and CAS/draft identity remain supported.
- Work in place because this continuation depends on the uncommitted preceding repair; source checkpoint in `.ai_state/compendium-redesign-20261022/baseline`.

## Review Focus

- Rapid entry/project switches during saving keep the correct draft and baseline.
- Search/filter/inspector UI cannot overwrite hidden unsaved fields.
- Latin substrings, single-character CJK aliases and unavailable source scenes do not fabricate references.
- Quick peek cannot steal writing state or mutate another project's reference list.
- Narrow screens, large text, disabled animations and long content retain actionable controls.

## Tasks

### 1. Pure grounded insights — reference_design_probe

Files: create `src/core/knowledge/compendium-insights.js`, `tests/compendium-insights.js`.

Interface: `DraftHarborCompendiumInsights.analyzeEntry(entry,snapshot,entries)` returns `{mentions,related,sources,totals,truncated}`. Mentions carry scene/chapter IDs/titles, excerpt and matchKind; related entries carry ID/title/type/excerpt/reason; sources preserve stored fields plus label and availability. Caps 50/12/40. Also export `excerpt(text,{terms,maxLength})`, `isSummaryEntry(entry)`.

- [x] Add failing cases for boundaries, project isolation, stale sources and caps.
- [x] Implement deterministic nonmutating helpers.
- [x] Run pure tests and scoped lint; review contracts.

### 2. Reading workspace controller — workspace_controller

Files: create `src/desktop/shell/compendium-workspace.js`, `tests/compendium-workspace.js`; modify `src/desktop/shell/compendium.js` only via small presentation hooks.

Interface: `bindCompendiumWorkspace()`, `renderCompendiumWorkspace({identityChanged})`, `renderCompendiumWorkspaceList(entries)` boolean handled, `compendiumWorkspaceDraftChanged()`. Existing compendium.js invokes optional hooks, remains independently usable. DOM contracts supplied by root and stored in the implementation handoff.

- [x] Test new real-DOM interaction requirements before implementation.
- [x] Add grouping, preferences, favorites, keyboard control, autoheight and inspector rendering.
- [x] Preserve save session semantics, hidden field drafts and all old safety tests.
- [x] Use insight data and safe navigation; test missing APIs/empty/no-project states.

### 3. Shared quick peek — writer_quickpeek

Files: create `src/desktop/shell/compendium-peek.js`, `src/styles/desktop/desktop-compendium-peek.css`, `tests/compendium-peek.js`; modify `src/desktop/shell/writer-prompts.js` and the generation status refresh hook.

Interface: `window.openCompendiumPeek(entryId,{trigger,source})`, `closeCompendiumPeek()`, `refreshCompendiumPeek()`, `setNativeCompendiumReference(entryId,included)`. Peek is modeless and never rerenders the manuscript.

- [x] Pin focus/selection/scroll, project switch and true reference behavior with failing tests.
- [x] Implement safe plaintext preview, explicit full-open and actual manual reference action.
- [x] Update writer reference item controls; test rapid close/open, unavailable entries and generation locks.

### 4. Visual shell and integration — root

Files: redesign `desktop/fragments/compendium.html` middle workspace; add `src/styles/desktop/compendium-reading-room.css` after the existing shared dialog styles; register scripts/styles in `desktop.html`; update test scripts in package.json.

- [x] Implement two-column reading layout, warm paper/ink tokens, inline fields, toolbar, one auxiliary drawer and accessible controls.
- [x] Preserve reader-import and AI dialogs and existing selectors.
- [x] Apply responsive layout, subtle motion and reduced-motion alternatives.
- [x] Integrate agent changes and verify existing behavior tests.

### 5. Visual verification, review and runnable delivery — root plus independent reviewer

- [x] Capture real current components with representative fixture data at 1280/1440/1920, paper/ink, inspector and quick peek states.
- [x] Check long text, hundreds of entries, empty/no-result states, controls in small windows and keyboard-only interactions.
- [x] Fix concrete screenshot and review findings; rerun affected tests and repository lint.
- [x] Build to a separate preview output directory if local packaging is available; document environment blocks.
- [x] Record final evidence and handoff with screenshots and launch instructions.

## Decisions and progress

- Initial implementation uses explicit save plus Ctrl/Cmd+S. It preserves proven conflict safety while redesigning the editing surface.
- No mandatory portrait/image generation: typographic hierarchy must carry the text-only case.
- Existing author snapshots are never fixtures; all verification uses isolated example data.
- Preserve existing chrome stylesheet because it also supplies working AI dialog styles. The new reading-room stylesheet overrides only the workspace and its module-scoped shell tokens.
- The on-demand inspector reserves room at desktop widths and overlays at narrow widths. Long titles wrap in a textarea while retaining single-line logical title semantics.
