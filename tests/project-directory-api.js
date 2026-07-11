const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const { startDesktopServers } = require('../desktop/local-server');
const libraryPaths = require('../desktop/storage/library-paths');

function legacySnapshot(id, name, text, exportedAt) {
  return {
    version: '2.1-legacy-test',
    exportedAt,
    filesystemSavedAt: exportedAt,
    project: { id, name, created: exportedAt, modified: exportedAt },
    chapters: [{ id: `${id}-chapter`, projectId: id, title: 'Legacy Chapter', order: 0 }],
    scenes: [{ id: `${id}-scene`, projectId: id, chapterId: `${id}-chapter`, title: 'Legacy Scene', order: 0 }],
    sceneContents: { [`${id}-scene`]: text },
    compendium: [],
    prompts: [],
    codex: [],
    promptHistory: [],
    workshopSessions: []
  };
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-project-api-test-'));
  let servers = null;
  const revealedPaths = [];

  try {
    const legacyDir = path.join(dataRoot, 'projects');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'Legacy--legacy-1.json'),
      JSON.stringify(legacySnapshot('legacy-1', 'Legacy Project', 'old words here', '2026-06-25T00:00:00.000Z')),
      'utf8'
    );

    const created = await projectService.createProject(dataRoot, {
      id: 'dir-1',
      title: 'Directory Project',
      createdAt: '2026-06-26T00:00:00.000Z'
    });
    const sceneId = created.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...created.project,
      updatedAt: '2026-06-26T01:00:00.000Z',
      scenes: created.project.scenes.map((scene) => (
        scene.id === sceneId
          ? { ...scene, title: 'Directory Scene', content: 'new words\n\n\u5979\u8d70\u8fdb\u96e8\u91cc\u3002' }
          : scene
      ))
    });

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async (targetPath) => {
        revealedPaths.push(targetPath);
        return '';
      }
    });

    const listResponse = await fetch(servers.appUrl + '/api/list-projects');
    const listBody = await listResponse.json();
    assert.ok(listResponse.ok && listBody.ok, 'list-projects should return ok');
    assert.strictEqual(listBody.projects.length, 2, 'API should list legacy snapshots and directory projects');
    assert.ok(listBody.projects.some((project) => project.id === 'legacy-1' && project.filename), 'legacy project should keep filename');
    const directorySummary = listBody.projects.find((project) => project.id === 'dir-1');
    assert.ok(directorySummary, 'directory project should be listed');
    assert.strictEqual(directorySummary.name, 'Directory Project');
    assert.strictEqual(directorySummary.source, 'project-directory');
    assert.strictEqual(directorySummary.filename, '');
    assert.strictEqual(directorySummary.chapterCount, 1);
    assert.strictEqual(directorySummary.sceneCount, 1);
    assert.strictEqual(directorySummary.wordCount, 7);

    const getResponse = await fetch(servers.appUrl + '/api/get-project?projectId=dir-1');
    const getBody = await getResponse.json();
    assert.ok(getResponse.ok && getBody.ok, 'get-project should return ok for directory projects');
    assert.strictEqual(getBody.project.version, '3.0-project-directory');
    assert.strictEqual(getBody.project.project.id, 'dir-1');
    assert.strictEqual(getBody.project.project.name, 'Directory Project');
    assert.strictEqual(getBody.project.scenes[0].title, 'Directory Scene');
    assert.ok(getBody.project.sceneContents[sceneId].includes('new words'));
    assert.ok(getBody.summary.source === 'project-directory');

    const legacyResponse = await fetch(servers.appUrl + '/api/get-project?projectId=legacy-1');
    const legacyBody = await legacyResponse.json();
    assert.ok(legacyResponse.ok && legacyBody.ok, 'get-project should still return ok for legacy snapshots');
    assert.strictEqual(legacyBody.project.project.name, 'Legacy Project');

    const createResponse = await fetch(servers.appUrl + '/api/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: {
          name: 'Created Through API',
          status: 'draft',
          tags: ['api', 'directory'],
          description: 'Created as a project directory.'
        }
      })
    });
    const createBody = await createResponse.json();
    assert.ok(createResponse.ok && createBody.ok, 'create-project should return ok');
    assert.strictEqual(createBody.project.version, '3.0-project-directory');
    assert.strictEqual(createBody.project.project.name, 'Created Through API');
    assert.strictEqual(createBody.summary.source, 'project-directory');
    await fs.access(libraryPaths.manifestPath(libraryPaths.projectDir(dataRoot, createBody.project.project.id)));

    const legacyFiles = await fs.readdir(legacyDir);
    assert.strictEqual(
      legacyFiles.some((file) => file.includes('Created Through API')),
      false,
      'create-project should not write a legacy single-file snapshot'
    );

    const createdProjectId = createBody.project.project.id;
    const updateResponse = await fetch(servers.appUrl + '/api/update-project-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: createdProjectId,
        metadata: {
          name: 'Renamed Directory Project',
          status: 'revising',
          tags: ['renamed', 'directory'],
          description: 'Updated directory project metadata.',
          coverImage: 'data:image/png;base64,abc'
        }
      })
    });
    const updateBody = await updateResponse.json();
    assert.ok(updateResponse.ok && updateBody.ok, 'update-project-metadata should edit directory projects');
    assert.strictEqual(updateBody.project.project.name, 'Renamed Directory Project');
    assert.strictEqual(updateBody.project.project.status, 'revising');
    assert.deepStrictEqual(updateBody.project.project.tags, ['renamed', 'directory']);
    assert.strictEqual(updateBody.project.project.coverImage, 'data:image/png;base64,abc');

    const updatedManifest = JSON.parse(await fs.readFile(
      libraryPaths.manifestPath(libraryPaths.projectDir(dataRoot, createdProjectId)),
      'utf8'
    ));
    assert.strictEqual(updatedManifest.title, 'Renamed Directory Project');
    assert.strictEqual(updatedManifest.status, 'revising');
    assert.deepStrictEqual(updatedManifest.tags, ['renamed', 'directory']);

    const updatedGetResponse = await fetch(`${servers.appUrl}/api/get-project?projectId=${createdProjectId}`);
    const updatedGetBody = await updatedGetResponse.json();
    assert.ok(updatedGetResponse.ok && updatedGetBody.ok, 'renamed directory project should remain readable');
    assert.strictEqual(updatedGetBody.project.project.name, 'Renamed Directory Project');

    const revealResponse = await fetch(servers.appUrl + '/api/reveal-project-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: createdProjectId })
    });
    const revealBody = await revealResponse.json();
    assert.ok(revealResponse.ok && revealBody.ok, 'reveal-project-file should reveal directory projects');
    assert.strictEqual(revealedPaths.length, 1);
    assert.strictEqual(revealedPaths[0], libraryPaths.projectDir(dataRoot, createdProjectId));
    assert.strictEqual(revealBody.path, libraryPaths.projectDir(dataRoot, createdProjectId));

    const removeResponse = await fetch(servers.appUrl + '/api/remove-project-from-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: createdProjectId })
    });
    const removeBody = await removeResponse.json();
    assert.ok(removeResponse.ok && removeBody.ok, 'remove-project-from-library should remove directory projects');
    await fs.access(removeBody.removedPath);
    assert.ok(removeBody.removedPath.includes('.removed-projects'));

    const removedListResponse = await fetch(servers.appUrl + '/api/list-projects');
    const removedListBody = await removedListResponse.json();
    assert.ok(removedListResponse.ok && removedListBody.ok, 'list-projects should remain ok after removing directory project');
    assert.strictEqual(
      removedListBody.projects.some((project) => project.id === createdProjectId),
      false,
      'removed directory project should leave active library'
    );

    const saveProjectId = 'saved-dir-1';
    const saveResponse = await fetch(servers.appUrl + '/api/save-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacySnapshot(
        saveProjectId,
        'Saved Directory Project',
        'saved words\n\n\u5979\u8d70\u8fdb\u96e8\u91cc\u3002',
        '2026-06-26T02:00:00.000Z'
      ))
    });
    const saveBody = await saveResponse.json();
    assert.ok(saveResponse.ok && saveBody.ok, 'save-project should return ok');
    assert.strictEqual(saveBody.source, 'project-directory');
    assert.ok(saveBody.path.includes(saveProjectId), 'save-project should return a project directory path');
    await fs.access(libraryPaths.manifestPath(libraryPaths.projectDir(dataRoot, saveProjectId)));

    const savedLegacyFiles = await fs.readdir(legacyDir);
    assert.strictEqual(
      savedLegacyFiles.some((file) => file.endsWith(`--${saveProjectId}.json`)),
      false,
      'save-project should not leave a legacy single-file snapshot for the saved project'
    );

    const savedGetResponse = await fetch(`${servers.appUrl}/api/get-project?projectId=${saveProjectId}`);
    const savedGetBody = await savedGetResponse.json();
    assert.ok(savedGetResponse.ok && savedGetBody.ok, 'saved directory project should be readable through get-project');
    assert.strictEqual(savedGetBody.project.project.name, 'Saved Directory Project');
    assert.ok(Object.values(savedGetBody.project.sceneContents).some((text) => text.includes('saved words')));

    console.log('Project directory API test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Project directory API test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
