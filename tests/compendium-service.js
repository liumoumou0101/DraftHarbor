const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const compendiumStore = require('../desktop/storage/compendium-store');
const paths = require('../desktop/storage/library-paths');
const CompendiumSchema = require('../src/core/knowledge/compendium-schema');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-test-'));
  let servers = null;

  try {
    await projectService.createProject(dataRoot, {
      id: 'knowledge-project',
      title: 'Knowledge Project',
      createdAt: '2026-06-27T00:00:00.000Z'
    });

    const normalized = CompendiumSchema.createCompendiumEntry({
      projectId: 'knowledge-project',
      category: 'characters',
      title: 'Ada',
      body: 'A careful navigator.',
      tags: ['pilot', 'pilot', 'lead'],
      sourceReferences: [{ sceneId: 'scene-1', excerpt: 'Ada studies the broken compass.' }]
    });
    assert.strictEqual(normalized.type, 'character');
    assert.deepStrictEqual(normalized.tags, ['pilot', 'lead']);
    assert.deepStrictEqual(normalized.sourceReferences.map((source) => source.sceneId), ['scene-1']);

    const saved = await compendiumService.saveEntry(dataRoot, 'knowledge-project', normalized);
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.entry.title, 'Ada');
    assert.strictEqual(saved.entry.type, 'character');

    const listed = await compendiumService.listEntries(dataRoot, 'knowledge-project', { query: 'navigator' });
    assert.strictEqual(listed.entries.length, 1);
    assert.strictEqual(listed.counts.character, 1);

    const projectPath = paths.projectDir(dataRoot, 'knowledge-project');
    const stored = await compendiumStore.readEntries(projectPath, 'knowledge-project');
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].body, 'A careful navigator.');
    assert.strictEqual(stored[0].sourceReferences[0].excerpt, 'Ada studies the broken compass.');

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot
    });

    const apiList = await fetch(servers.appUrl + '/api/compendium?projectId=knowledge-project&type=character');
    const apiListBody = await apiList.json();
    assert.ok(apiList.ok && apiListBody.ok, 'compendium list API should return ok');
    assert.strictEqual(apiListBody.entries.length, 1);

    const apiSave = await fetch(servers.appUrl + '/api/compendium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'knowledge-project',
        entry: {
          type: 'location',
          title: 'North Gate',
          summary: 'A guarded entrance.',
          body: 'The first visible boundary of the city.'
        }
      })
    });
    const apiSaveBody = await apiSave.json();
    assert.ok(apiSave.ok && apiSaveBody.ok, 'compendium save API should return ok');
    assert.strictEqual(apiSaveBody.entry.type, 'location');

    const apiDelete = await fetch(servers.appUrl + '/api/delete-compendium-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'knowledge-project',
        entryId: apiSaveBody.entry.id
      })
    });
    const apiDeleteBody = await apiDelete.json();
    assert.ok(apiDelete.ok && apiDeleteBody.ok, 'compendium delete API should return ok');
    assert.strictEqual(apiDeleteBody.deleted, 1);

    console.log('Compendium service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Compendium service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
