# Compendium integrity fixes and UI review

User authorization: fix the confirmed audit findings; inspect the current UI and research reference products. A visual redesign is a separate follow-up after concrete references are reviewed.

## Scope and ownership

1. Transfer integrity: freeze the reviewed target/version/patch, resolve explicit IDs before same-type names, reject ambiguous targets, and enforce the expected version at storage commit. Cover Reader and Workflow application/resume paths with regression tests.
2. Agent and editor integrity: protect unsaved Compendium edits on unload, validate a one-to-one visible operation selection, preserve extracted aliases, reject empty generation results without losing drafts, and reject the newest over-limit reference selection.
3. Context integrity: include summaries and character fields in Writer, Workshop and Workflow; supply scene character/POV inputs; preserve mandatory references and correctly account for actual content in the soft context budget.
4. Retrieval integrity: include character fields, select bounded evidence around a match, and avoid presenting an unsupported answer as grounded.
5. UI review: capture actual current UI with isolated sample data, identify layout and workflow friction, and compare official reference products. Do not alter production visual design in this patch.

## Verification

- Add failing behavior regressions before fixes, then run targeted existing tests.
- Use isolated test data under `.ai_state/compendium-20261022/tmp` and the installed Chrome for test execution where bundled Playwright Chromium is absent.
- Never use author projects or live paid provider calls as fixtures.
- Review the integrated diff and run lint plus affected regression tests. Report any remaining environment gates precisely.
- Do not commit, push or replace release executables as part of this request.

## Completion tracking

- [x] Transfer fixes and tests
- [x] Editor/agent fixes and tests
- [x] Context fixes and tests
- [x] Retrieval fixes and tests
- [x] Current UI captures and reference research
- [x] Integrated validation and handoff

Final evidence: 18 affected test scripts, repository ESLint and diff whitespace checks pass. The independent review's duplicate-target partial-write defect and live beat-reference preview gap are resolved. Full localhost HTTP integration remains blocked by the environment network policy; no claim of a full suite or packaged Electron pass. UI findings, screenshots, sources and verification details are in `docs/audits/compendium-2026-10-22/README.md`.
