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
