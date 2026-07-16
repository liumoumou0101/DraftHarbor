const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const inputService = require('../desktop/services/workflow-input-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-input-service-'));
  try {
    const created = await projectService.createProject(dataRoot, { id: 'workflow-input-project', title: 'Workflow Input Project' });
    const { projectPath } = created;
    const projectId = created.project.id;
    const runId = 'workflow-input-run';
    const firstScene = created.project.scenes[0];
    const secondScene = { id: 'scene-2', chapterId: firstScene.chapterId, title: '第二场', summary: '', content: '第二场正文。', order: 1, tags: [], createdAt: firstScene.createdAt, updatedAt: firstScene.updatedAt };
    await projectService.saveProject(dataRoot, { ...created.project, scenes: [{ ...firstScene, content: '第一场正文，含有可选片段。' }, secondScene], chapters: [{ ...created.project.chapters[0], sceneIds: [firstScene.id, secondScene.id] }], sceneOrder: [firstScene.id, secondScene.id] });
    await workflowV2Store.createWorkflowV2Run(projectPath, { id: runId, projectId, title: '来源快照运行', definition: { id: 'input-definition', templateId: 'continuation', templateVersion: 1, title: '来源快照', nodes: [{ id: 'source', capabilityId: 'source.provide' }] } });

    const selection = await inputService.createWriterSourceSnapshot({ dataRoot, projectPath, projectId, runId, artifactId: 'selection-input', revisionId: 'selection-revision', scope: 'selection', sceneId: firstScene.id, selection: { start: 3, end: 7 }, intent: 'rewrite', label: '选区重写' });
    assert.strictEqual(selection.snapshot.content[0].content, '正文，含');
    assert.strictEqual(selection.snapshot.intent, 'rewrite');
    assert.strictEqual(selection.artifact.revision.payload.format, 'json');
    assert.deepStrictEqual(await artifactStore.readArtifactContent(projectPath, runId, 'selection-input', 'selection-revision'), selection.snapshot);
    assert.strictEqual((await inputService.checkWriterSourceSnapshotFreshness({ dataRoot, projectPath, projectId, runId, artifactId: 'selection-input', revisionId: 'selection-revision' })).freshness, 'fresh');

    const chapter = await inputService.createWriterSourceSnapshot({ dataRoot, projectPath, projectId, runId, artifactId: 'chapter-input', revisionId: 'chapter-revision', scope: 'chapter', chapterId: firstScene.chapterId, intent: 'extract-outline' });
    assert.strictEqual(chapter.snapshot.content.length, 2);
    const all = await inputService.createWriterSourceSnapshot({ dataRoot, projectPath, projectId, runId, artifactId: 'project-input', revisionId: 'project-revision', scope: 'project', intent: 'style-reference' });
    assert.strictEqual(all.snapshot.sourceReferences.length, 2);

    const before = await projectService.openProject(dataRoot, projectId);
    await projectService.saveProject(dataRoot, { ...before.project, scenes: before.project.scenes.map((scene) => scene.id === firstScene.id ? { ...scene, content: '第一场正文已经改写。', updatedAt: new Date().toISOString() } : scene) });
    const stale = await inputService.checkWriterSourceSnapshotFreshness({ dataRoot, projectPath, projectId, runId, artifactId: 'selection-input', revisionId: 'selection-revision' });
    assert.strictEqual(stale.freshness, 'stale');
    assert.strictEqual((await artifactStore.readArtifactContent(projectPath, runId, 'selection-input', 'selection-revision')).content[0].content, '正文，含', 'old input revision must remain immutable');
    const replacement = await inputService.createWriterSourceSnapshot({ dataRoot, projectPath, projectId, runId, artifactId: 'selection-input', revisionId: 'selection-revision-2', parentRevisionId: 'selection-revision', scope: 'selection', sceneId: firstScene.id, selection: { start: 0, end: 4 }, intent: 'rewrite' });
    assert.strictEqual(replacement.artifact.revision.parentRevisionId, 'selection-revision');
    assert.throws(() => inputService.createSnapshot(before.project, { scope: 'selection', sceneId: firstScene.id, selection: { start: 1, end: 1 } }), /selection must not be empty/);
    console.log('Workflow input service test passed.');
  } finally { await fs.rm(dataRoot, { recursive: true, force: true }); }
})().catch((error) => { console.error('Workflow input service test failed:', error && error.stack ? error.stack : error); process.exit(1); });
