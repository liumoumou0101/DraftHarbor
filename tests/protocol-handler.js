const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createDesktopProtocolHandler } = require('../desktop/local-server');

function legacySnapshot(id, name, text, exportedAt) {
  return {
    version: '2.1-protocol-test',
    exportedAt,
    filesystemSavedAt: exportedAt,
    project: { id, name, created: exportedAt, modified: exportedAt },
    chapters: [{ id: `${id}-chapter`, projectId: id, title: 'Protocol Chapter', order: 0 }],
    scenes: [{ id: `${id}-scene`, projectId: id, chapterId: `${id}-chapter`, title: 'Protocol Scene', order: 0 }],
    sceneContents: { [`${id}-scene`]: text },
    compendium: [],
    prompts: [],
    codex: [],
    promptHistory: [],
    workshopSessions: []
  };
}

(async () => {
  const appRoot = path.resolve(__dirname, '..');
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-protocol-'));
  let handler = null;

  try {
    handler = await createDesktopProtocolHandler({
      appRoot,
      dataRoot,
      chooseBackupFolder: null,
      chooseProjectSaveFolder: null,
      openPath: null,
      revealPath: null
    });

    // Test 1: GET /version returns JSON version metadata
    {
      const req = new Request('draftharbor://app/version');
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/version should return 200');
      const data = await res.json();
      assert.ok(data && typeof data === 'object', '/version should return JSON object');
    }

    // Test 2: GET /health returns OK JSON
    {
      const req = new Request('draftharbor://app/health');
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/health should return 200');
      const data = await res.json();
      assert.strictEqual(data.ok, true, '/health should return ok: true');
      assert.ok(data.service, '/health should return service name');
    }

    // Test 3: GET /api/list-projects returns an array
    {
      const req = new Request('draftharbor://app/api/list-projects');
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/api/list-projects should return 200');
      const data = await res.json();
      assert.ok(data.ok, '/api/list-projects should return ok');
      assert.ok(Array.isArray(data.projects), '/api/list-projects should return projects array');
    }

    // Test 4: Simple create/get and save/get API flow through Request objects
    let createdProjectId = '';

    // Create a project
    {
      const req = new Request('draftharbor://app/api/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            name: 'Protocol Handler Test Project',
            description: 'Created via protocol handler test',
            status: 'draft',
            tags: ['test', 'protocol']
          }
        })
      });
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/api/create-project should return 200');
      const data = await res.json();
      assert.ok(data.ok, '/api/create-project should succeed');
      assert.ok(data.project && data.project.project && data.project.project.id, 'created project should have an id');
      createdProjectId = data.project.project.id;
    }

    // Get the created project
    {
      const req = new Request(`draftharbor://app/api/get-project?projectId=${encodeURIComponent(createdProjectId)}`);
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/api/get-project should return 200');
      const data = await res.json();
      assert.ok(data.ok, '/api/get-project should succeed');
      assert.strictEqual(data.project.project.name, 'Protocol Handler Test Project', 'project name should match');
    }

    // Verify the project appears in list-projects
    {
      const req = new Request('draftharbor://app/api/list-projects');
      const res = await handler(req);
      const data = await res.json();
      const found = data.projects.some(p => p.id === createdProjectId);
      assert.ok(found, 'created project should appear in list-projects');
    }

    // Save a snapshot through the protocol handler and read it back
    const savedProjectId = `protocol-saved-${Date.now()}`;
    {
      const req = new Request('draftharbor://app/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacySnapshot(
          savedProjectId,
          'Protocol Saved Project',
          'saved through protocol handler',
          '2026-07-03T00:00:00.000Z'
        ))
      });
      const res = await handler(req);
      assert.strictEqual(res.status, 200, '/api/save-project should return 200');
      const data = await res.json();
      assert.ok(data.ok, '/api/save-project should succeed');
    }

    {
      const req = new Request(`draftharbor://app/api/get-project?projectId=${encodeURIComponent(savedProjectId)}`);
      const res = await handler(req);
      assert.strictEqual(res.status, 200, 'saved project /api/get-project should return 200');
      const data = await res.json();
      assert.ok(data.ok, 'saved project /api/get-project should succeed');
      assert.strictEqual(data.project.project.name, 'Protocol Saved Project', 'saved project name should match');
      assert.ok(
        Object.values(data.project.sceneContents || {}).some((text) => String(text).includes('saved through protocol handler')),
        'saved project scene text should be readable'
      );
    }

    console.log('Protocol handler test passed.');
  } finally {
    if (handler && typeof handler === 'function') {
      // The handler does not bind ports, so no explicit close is needed.
    }
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('Protocol handler test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
