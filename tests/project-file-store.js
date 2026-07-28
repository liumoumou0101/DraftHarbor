const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const paths = require('../desktop/storage/library-paths');
const projectStore = require('../desktop/storage/project-file-store');
const projectService = require('../desktop/services/project-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-store-test-'));

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'project-a',
      title: 'Project A',
      tags: ['draft'],
      createdAt: '2026-06-26T00:00:00.000Z'
    });

    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.project.id, 'project-a');
    assert.strictEqual(created.project.title, 'Project A');

    const projectPath = paths.projectDir(dataRoot, 'project-a');
    assert.strictEqual(created.projectPath, projectPath);

    const manifestText = await fs.readFile(paths.manifestPath(projectPath), 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.strictEqual(manifest.id, 'project-a');
    assert.strictEqual(Array.isArray(manifest.chapters), false, 'manifest should not embed full chapters');
    assert.strictEqual(Array.isArray(manifest.scenes), false, 'manifest should not embed full scenes');

    const sceneId = created.project.scenes[0].id;
    await fs.access(paths.sceneMarkdownPath(projectPath, sceneId));
    await fs.access(paths.sceneMetaPath(projectPath, sceneId));

    const opened = await projectService.openProject(dataRoot, 'project-a');
    assert.strictEqual(opened.ok, true);
    assert.strictEqual(opened.project.title, 'Project A');
    assert.strictEqual(opened.project.scenes.length, 1);

    const updated = {
      ...opened.project,
      scenes: opened.project.scenes.map((scene) => (
        scene.id === sceneId
          ? { ...scene, content: 'Hello world\n\n\u5979\u8d70\u8fdb\u96e8\u91cc\u3002' }
          : scene
      ))
    };
    await projectService.saveProject(dataRoot, updated);

    const reopened = await projectStore.openProject(dataRoot, 'project-a');
    assert.ok(reopened.scenes[0].content.includes('Hello world'));
    assert.ok(reopened.scenes[0].content.includes('\u5979\u8d70\u8fdb\u96e8\u91cc'));

    await fs.mkdir(path.join(paths.projectsRoot(dataRoot), 'backups'), { recursive: true });
    await fs.mkdir(path.join(paths.projectsRoot(dataRoot), '.removed-projects'), { recursive: true });
    await fs.mkdir(path.join(paths.projectsRoot(dataRoot), '.internal-cache'), { recursive: true });

    const listed = await projectService.listProjects(dataRoot);
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(listed.projects.length, 1);
    assert.strictEqual(listed.projects[0].id, 'project-a');
    assert.strictEqual(listed.projects[0].health, 'ok');
    assert.strictEqual(listed.projects[0].chapterCount, 1);
    assert.strictEqual(listed.projects[0].sceneCount, 1);
    assert.strictEqual(listed.projects[0].wordCount, 7);

    await assert.rejects(
      () => projectService.createProject(dataRoot, { id: 'project-a', title: 'Duplicate' }),
      /already exists/
    );

    console.log('Project file store test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Project file store test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
