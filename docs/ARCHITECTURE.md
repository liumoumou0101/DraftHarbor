# DraftHarbor desktop architecture

The Electron main process registers `draftharbor://app`. Requests are routed through
`desktop/protocol/protocol-router.js`; the HTTP server in `desktop/local-server.js`
exists only as a dynamic-port test adapter.

Backend responsibilities are separated as follows:

- `controllers/generation-controller.js`: provider profiles and connectivity tests.
- `controllers/backup-controller.js`: backup listing, creation, comparison and recovery.
- `controllers/import-export-controller.js`: document, package and legacy imports/exports.
- `controllers/update-controller.js`: version information and update download state.
- `protocol/http-test-adapter.js`: Fetch/Node request adaptation used by protocol tests.
- `local-server.js`: composition root and compatibility utilities. Product API routes,
  runtime installation, static serving and HTTP test hosting live in dedicated modules;
  new feature routes must not be added to the composition root.

Production packages use ASAR. Runtime data, projects, backups, downloaded models and
updates live under the user data directory and must never be written into the ASAR.

`desktop.html` is a small composition shell. View markup lives in `desktop/fragments`,
desktop interaction is divided by responsibility under `src/desktop/shell`, and
ordered cascade layers live under `src/styles/desktop`. The release test prevents a
single shell module or stylesheet from silently growing into a replacement monolith.
Reusable domain behavior belongs in `src/core` rather than a view module.

## Reader Document ownership and recovery

External TXT/Markdown and saved pasted text use a Reader Store outside projects under
`DraftHarbor Library/reader-documents/`. The index and document metadata contain only
summaries; immutable Revision content is split by chapter. A Revision writes all chapter
files first and commits `revision.json` last, then the document metadata, and finally the
library index. Readers therefore never treat an interrupted chapter write as committed.

```text
DraftHarbor Library/reader-documents/
  index.json
  preferences.json
  project-states/
  <documentId-safe-segment>/
    document.json
    state.json
    source/
    revisions/<revisionId-safe-segment>/
      revision.json
      chapters/<chapterId-safe-segment>.json
```

Reader path segments combine a readable sanitized prefix with a digest of the original
ID, preventing traversal and sanitized-name collisions. Reader document, revision and
state writes use dedicated stores, atomic replacement and optimistic version checks.
Committed Revisions are immutable. If the active Revision fails its digest check, reads
may return the newest earlier readable Revision with an explicit recovery result. The
index can be rebuilt from document metadata; cleanup removes only uncommitted directories
and unreferenced Revision directories/source copies, while corrupt committed documents are
reported and preserved for recovery.

`desktop/services/reader-library-service.js` owns temporary import sessions. File and pasted
text previews remain in memory and do not enter the formal index. Confirming a local-text
draft first copies the original bytes to a Revision-keyed path under `source/`, then commits
the immutable Revision through the Reader Store; reimport appends a child Revision under an
optimistic document version check. A failed commit keeps the draft retryable, removes its
source copy and never changes the active Revision. Pasted drafts have no source file and are
stored only after explicit confirmation.

Reader product routes live in `desktop/controllers/reader-controller.js`; the local server
only composes the controller. Library lists and document metadata expose summaries only,
while `/api/reader/chapter` calls a digest-verified single-chapter Store read and never
loads the whole Revision. Import confirmation responses omit source paths and full prose.
The controller also owns preferences, state and migration endpoints; unknown Reader routes
fall through to the protocol router's 404 response.

`desktop/services/reader-migration-service.js` converts the old
`draftharbor:desktop:reader` value supplied by the compatibility UI. Project prose is
re-derived from Project Store and only an approximate locator is saved. Legacy external
prose remains pending until the user explicitly imports or abandons it. Migration records
contain summaries and target IDs, never legacy prose. Failed attempts remain retryable;
the service reports that the legacy key may be cleared only after the target state or
document has been reopened successfully. The compatibility UI delayed actual key removal
until the new Reader UI became authoritative; the immersive shell now performs that guarded cleanup.

The authoritative desktop Reader shell is split across
`src/desktop/shell/reader-library.js`, `reader-reading.js`, and `reader-workspace.js`, with the legacy
`reader.js` retained for project projection, old local file import, and migration
compatibility. `src/styles/desktop/reader.css` owns the immersive stage and drawer layout.
The library reads summaries first, `/api/reader/contents` returns chapter summaries without
blocks, and only the selected chapter is fetched into the DOM. A verified legacy migration
may clear the old localStorage key only after the Reader Store document and state can reopen.

`src/core/document/reader-layout.js` owns the pure, disposable layout model. It resolves
flow/single/double/auto modes, derives bounded flow windows, splits page fragments by block
and UTF-16 offset, and creates cache keys from revision, chapter, viewport, resolved font,
and typography inputs. Page indexes and cache entries are never authoritative. Before any
reflow the desktop captures a Reader Locator; after reflow it selects the page/spread or
flow window containing that locator. The DOM keeps only the bounded flow window or current
one/two pages, while adjacent page definitions may be prefetched in memory.

`src/desktop/shell/reader-settings.js` owns Reader presentation preferences. Global
defaults are normalized through `createReaderGlobalPreferences`; per-document overrides
remain in Reader State and are merged only for the active document. Stable font IDs are
resolved to local font stacks, while the actual resolved family participates in the
disposable layout cache key. Typography or font changes capture the current Reader Locator
before reflow. Themes use local CSS colors only. Page transitions are presentation-only:
`fade`, `slide`, or `none` never change locators, and system or explicit reduced-motion
preferences downgrade them without disabling keyboard paging. Curl remains gated and no
Canvas or screenshot representation is authoritative.

`src/core/document/reader-navigation.js` owns literal chapter matching and content-weight
navigation math. The desktop navigation module fetches one chapter at a time, emits bounded
Locator results, and uses cancellation plus monotonically increasing request ownership so
an older search cannot replace a newer one. Search text and whole-book content are not
persisted in Reader State or inserted into the long-lived DOM.

Bookmarks remain part of Reader Document State and keep stable locators. On a newer
revision they are resolved through the shared Locator core and displayed as exact,
approximate, or unresolved. Position, preference, and bookmark writes share a serialized,
per-document draft merge so independent debounce paths cannot overwrite one another or
write into a document opened later. The draggable progress control uses chapter character
weights and block offsets; it never persists a page number.

Reader drawers are modal interaction regions while open: closed drawers are `inert`,
focus wraps within the active drawer, tab selection uses a roving tab index, and closing
returns focus to the trigger. Position, percentage, and page labels are polite live
regions. At low effective viewport heights, paged presentation falls back to the bounded
flow renderer so zoom cannot create clipped or unreachable content; the Reader Locator
and saved automatic-layout preference remain unchanged.

Reader transfers live outside projects under `reader-transfers/<safe-envelope-id>/`.
The normalized text, structural snapshot, and lightweight envelope are committed in that
order; the envelope is the commit marker. Every read verifies text, structure, and bundle
digests. Source identity and consumer identity are immutable, while lifecycle metadata may
only move from active to consumed to archived. Consumed transfers require a materialized
consumer reference, and archived cleanup cannot delete text still required by an
unmaterialized, unreleased consumer. Lists and navigation carry only `envelopeId` and
envelope metadata; snapshot text is returned only by the single-transfer endpoint.

Transfer freshness is source-specific. External immutable revisions remain fresh when a
newer revision exists, with the newer-version condition reported separately. Pasted text
uses its verified snapshot as authority. Project transfers compare only their frozen
chapter/scene/block source units and return fresh, stale, or missing without replacing the
snapshot. Reader never writes the target module as part of this check.

Writer integration is owned by `reader-writer-transfer-service.js`, not by Reader. It
rebuilds a write preview from one verified Envelope, resolves project locators as exact,
approximate, or missing, and checks the target project version again before applying.
Project mutations create a pre-apply backup and go through Project Service. Scenes retain
`sourceReferences`; the project manifest retains a `readerApplications` ledger. Stable
application-derived scene IDs plus that ledger make retries idempotent even if lifecycle
registration fails after the project save. New-project import is constructed in memory and
committed once, so a failed create does not leave a partial project.

Project Reader Documents remain derived projections of project chapters and scenes. The
Reader Store rejects project content, and project-wide saves do not write into the Reader
library. Only project reading state is stored under `project-states/` using the stable
`project:<projectId>` document identity.

`src/core/document/reader-document.js` rebuilds a project Revision from ordered chapters
and scenes. Paragraph blocks retain `sourceSceneId` plus UTF-16 `sourceStart/sourceEnd`;
scene titles are separate blocks without source ranges. Block IDs are stable across unrelated
insertions, orphan historical scenes use a deterministic synthetic chapter, and the
Revision ID derives from normalized content and structure digests. The legacy desktop
projection remains an adapter over the same blocks. This projection is pure and is never
committed to the Reader Store, so deleting any transient cache loses no authoritative data.

## Workflow v2 ownership and recovery

Semi-automatic novel workflows use a v2 store that is separate from the legacy
`workflows/runs.json` placeholder. The legacy reader stays read-only; a user may
explicitly copy a legacy run into v2, but no code performs an in-place migration.

```text
projects/<projectId>/workflows/v2/
  runs.json                         # small run summaries only
  runs/<runId>/
    definition.json                 # versioned DAG snapshot
    state.json                      # execution state
    artifacts/<artifactId>/         # family, immutable revisions and content
    chunks/                          # resumable long-form checkpoints
    events/                          # v2 event records
    generation-history/              # metadata and artifact references only
    applications/<applicationId>.json
    applications/backups/<applicationId>.json
```

`workflow-*-store.js` files are the only writers for v2 workflow data. A project-wide
save must not overwrite either legacy workflow files or v2 data. Long-form content is
stored only in artifact content files; run indexes, generation history, application
records and Provider snapshots contain metadata only and never API keys.

Reusable workflow templates live outside projects under
`DraftHarbor Library/workflow-templates/`. The builtin capability catalog is the
single source for node types, versioned input/output ports and artifact compatibility.
Canvas edits always begin as a detached draft; saving creates or increments a template
version, while an existing run continues using its immutable `definition.json` snapshot.
The latest template remains at `<templateId>.json` for backward compatibility and each
immutable version is archived under `.versions/<templateId>/v<version>.json`. Reads and
new runs may request an exact version; deleting a template removes both its latest file
and version history.

Formal cross-module writes go through the application service. It validates the whole
batch, preallocates targets, writes an application backup, then records each result in
the application ledger. Scenes retain only `sourceRunId`, `sourceArtifactId` and
`sourceRevisionId`; full targets, backup and recovery data remain in the ledger.
Repeated `applicationId` calls are idempotent. A partial application can continue its
pending operations or restore its application backup. Project snapshot export/import
preserves the three scene source fields, while unadopted v2 artifacts remain outside
ordinary project backups and exports.

The workflow transfer service is the confirmation layer above the application ledger.
It prepares read-only writer and compendium previews, rejects stale or unapproved
source revisions, and applies only explicitly selected targets. A selected prose range
is first stored as an immutable derived artifact so writer scenes never point at an
ambiguous offset inside another revision. Workflow planning and draft artifacts remain
discoverable through the derived project-asset query without becoming formal facts.

Guided continuation runs use the `continuation-guided` v2 template. The desktop asks
the server for stage prompts, streams generation through the same Provider runtime as
the writer, and posts completed outputs back for validation and immutable storage.
All Provider generation requests are streaming by default. The shared stream runtime
uses activity-based timeouts: the initial response has a bounded wait, then every
reasoning, content, usage, or valid stream chunk renews the idle window. Active streams
have no total wall-clock timeout by default; callers may opt into a final safety limit.
Structured JSON consumers may delay applying fields until the complete payload passes
schema validation, but they still consume the Provider response incrementally.

Reader-to-compendium extraction is owned by the compendium target, not by Reader.
The target reads one immutable Envelope, splits only its frozen text into bounded
overlapping chunks, invokes the dedicated compendium Provider, merges candidates by
normalized title and alias, and stores a project-scoped review batch. Every candidate
must have an explicit approved, approved-modified, or abandoned decision before the
batch can apply. Application validates all cards and target revisions first, creates a
project backup, then performs one atomic compendium write. Entries retain bounded
Reader evidence in backward-compatible `sourceReferences`; deterministic IDs and the
batch reference make retries idempotent. The Envelope becomes consumed only after the
formal batch write succeeds.

Reader-to-workflow materialization is owned by a target-side transfer service. A
project scene Envelope becomes a `writer-source@1` revision that retains the complete
Reader locator set and frozen source-unit metadata. External and pasted sources become
`reader-source@1` revisions whose content entries deliberately have no project scene
identity. They may feed the continuation analysis chain but cannot enter the scene
rewrite template; aggregated project chapters likewise remain reference input unless a
single scene locator is explicit. Run and source revision identities are derived from
Envelope, target project, and template, so retry reopens one immutable v2 run instead
of duplicating it. Once materialized, Workflow Store owns the input content and remains
valid if Reader later deletes its copy; ordinary project saves never rewrite v2 runs.

F-10 release qualification is encoded in `tests/reader-release-acceptance.js`: the four
supported source kinds are crossed with all three target owners, and every combination
must prove explicit confirmation, target-only mutation, immutable consumer registration,
and idempotent retry. The same gate exercises a bounded multi-Envelope load and scans the
isolated library for provider-key and absolute-source-path leakage. Million-character
snapshot timing remains part of `reader-performance-acceptance.js`; visual gates run with
local assets only. `installed-smoke.js` installs the generated NSIS artifact into an
isolated directory and exercises persistence and backup APIs before uninstalling it.

The guided service owns stage transitions; the client cannot skip ahead by writing a
later artifact. User edits create child revisions, approvals create approved child
revisions, and the guided UI requests one generation batch per planned scene.
