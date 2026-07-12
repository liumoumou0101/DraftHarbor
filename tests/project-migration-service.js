const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const projectService = require('../desktop/services/project-service');
const migrationService = require('../desktop/services/project-migration-service');
const projectStore = require('../desktop/storage/project-file-store');
const libraryPaths = require('../desktop/storage/library-paths');
const { projectToLegacySnapshot } = require('../desktop/services/project-snapshot-adapter');
const { startDesktopServers } = require('../desktop/local-server');

function legacySnapshot(id, name, text) {
  return {
    version: '2.1-migration-test',
    exportedAt: '2026-06-27T00:00:00.000Z',
    project: { id, name, created: '2026-06-27T00:00:00.000Z', modified: '2026-06-27T00:00:00.000Z' },
    chapters: [{ id: `${id}-chapter`, projectId: id, title: 'Legacy Chapter', order: 0 }],
    scenes: [{ id: `${id}-scene`, projectId: id, chapterId: `${id}-chapter`, title: 'Legacy Scene', order: 0 }],
    sceneContents: { [`${id}-scene`]: text },
    compendium: [{ id: 'legacy-note', title: 'Legacy Note', type: 'note', content: 'old knowledge' }],
    prompts: [],
    promptHistory: [],
    workshopSessions: []
  };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-migration-test-'));
  let servers = null;

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'migration-source',
      title: 'Migration Source'
    });
    const sceneId = created.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...created.project,
      scenes: created.project.scenes.map((scene) => (
        scene.id === sceneId
          ? { ...scene, title: 'Opening', content: 'First line.\n\nSecond line.' }
          : scene
      ))
    });

    const markdown = await migrationService.exportProjectDocument(dataRoot, 'migration-source', 'markdown');
    assert.ok(markdown.filename.endsWith('.md'), 'markdown export should use .md filename');
    assert.ok(markdown.text.includes('# Migration Source') || markdown.text.includes('# 第 1 章'), 'markdown should include headings');
    assert.ok(markdown.text.includes('First line.'), 'markdown should include scene text');

    const text = await migrationService.exportProjectDocument(dataRoot, 'migration-source', 'text');
    assert.ok(text.filename.endsWith('.txt'), 'text export should use .txt filename');
    assert.ok(!text.text.includes('# '), 'text export should not include markdown heading markers');
    assert.ok(text.text.includes('Second line.'), 'text export should include scene text');

    const packageExport = await migrationService.exportProjectPackage(dataRoot, 'migration-source');
    assert.ok(packageExport.buffer.length > 100, 'project package should contain zip data');
    const zip = await JSZip.loadAsync(packageExport.buffer);
    assert.ok(zip.file('manifest.json'), 'project package should include manifest');
    assert.ok(zip.file('scenes/scene-1.md'), 'project package should include scene markdown');

    const importedPackage = await migrationService.importProjectPackage(dataRoot, packageExport.buffer);
    assert.ok(importedPackage.project.id !== 'migration-source', 'package import should avoid id collisions by default');
    assert.ok(importedPackage.project.title.includes('Imported'), 'package import should mark collision imports');
    assert.ok(importedPackage.project.scenes.some((scene) => scene.content.includes('First line.')), 'package import should keep scene content');

    const importedSnapshot = await migrationService.importLegacySnapshot(dataRoot, legacySnapshot('legacy-migration', 'Legacy Migration', 'legacy body'));
    assert.strictEqual(importedSnapshot.project.title, 'Legacy Migration');
    assert.ok(importedSnapshot.project.scenes.some((scene) => scene.content === 'legacy body'), 'legacy snapshot import should keep scene contents');
    await fs.access(libraryPaths.manifestPath(libraryPaths.projectDir(dataRoot, importedSnapshot.project.id)));

    const w1 = await migrationService.importWritingway1Files(dataRoot, [
      {
        path: 'W1Book/W1Book_structure.json',
        text: JSON.stringify({
          acts: [{
            name: 'Act 1',
            chapters: [{
              name: 'Chapter One',
              scenes: [{ name: 'Scene One', pov: 'Ada' }]
            }]
          }]
        })
      },
      { path: 'W1Book/W1Book-Act1-ChapterOne-SceneOne_999.html', text: '<p>Hello from W1.</p><p>Next paragraph.</p>' },
      {
        path: 'W1Book/compendium.json',
        text: JSON.stringify({ categories: [{ name: 'Characters', entries: [{ name: 'Ada', content: '<p>Pilot</p>' }] }] })
      }
    ]);
    assert.strictEqual(w1.chapterCount, 1);
    assert.strictEqual(w1.sceneCount, 1);
    assert.ok(w1.project.scenes[0].content.includes('Hello from W1.'), 'W1 import should read scene HTML');
    assert.strictEqual(w1.project.compendium[0].title, 'Ada', 'W1 import should convert compendium entries');

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });

    const exportResponse = await fetch(servers.appUrl + '/api/export-project-document?projectId=migration-source&format=markdown');
    assert.ok(exportResponse.ok, 'document export API should return ok');
    assert.ok((await exportResponse.text()).includes('First line.'), 'document export API should return manuscript text');

    const packageResponse = await fetch(servers.appUrl + '/api/export-project-package?projectId=migration-source');
    assert.ok(packageResponse.ok, 'package export API should return ok');
    assert.match(packageResponse.headers.get('content-type') || '', /application\/zip/, 'package export API should return zip');

    const importPackageResponse = await fetch(servers.appUrl + '/api/import-project-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: Buffer.from(await packageResponse.arrayBuffer())
    });
    const importPackageBody = await importPackageResponse.json();
    assert.ok(importPackageResponse.ok && importPackageBody.ok, 'package import API should return ok');
    assert.strictEqual(importPackageBody.summary.source, 'project-directory');

    const snapshotResponse = await fetch(servers.appUrl + '/api/import-project-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: projectToLegacySnapshot(await projectStore.openProject(dataRoot, 'migration-source')) })
    });
    const snapshotBody = await snapshotResponse.json();
    assert.ok(snapshotResponse.ok && snapshotBody.ok, 'snapshot import API should return ok');
    assert.strictEqual(snapshotBody.summary.source, 'project-directory');

    console.log('Project migration service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Project migration service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
