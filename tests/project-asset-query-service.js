const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const assetQueryService = require('../desktop/services/project-asset-query-service');
const legacyWorkflowStore = require('../desktop/storage/workflow-run-store');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const paths = require('../desktop/storage/library-paths');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-project-assets-'));
  let servers = null;

  try {
    const created = await projectService.createProject(dataRoot, {
      id: 'asset-project',
      title: 'Asset Project'
    });
    const projectId = created.project.id;
    const projectPath = created.projectPath;
    const sceneId = created.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...created.project,
      scenes: created.project.scenes.map((scene) => scene.id === sceneId
        ? {
            ...scene,
            title: '雾港夜航',
            summary: '导航员在雾港发现失落的航线图。',
            content: '这段正式正文不应出现在资产搜索结果载荷中。'
          }
        : scene)
    });
    const entry = (await compendiumService.saveEntry(dataRoot, projectId, {
      id: 'navigator-card',
      type: 'character',
      title: '导航员阿岚',
      summary: '熟悉雾港与失落航线图的领航员。',
      body: '资料卡正文不应复制进资产搜索结果。',
      relatedSceneIds: [sceneId]
    })).entry;

    await legacyWorkflowStore.upsertWorkflowRun(projectPath, {
      id: 'legacy-assets',
      projectId,
      title: '旧版产物',
      artifacts: [{
        id: 'legacy-outline',
        type: 'chapter_outline',
        title: '雾港章节纲',
        content: '旧版完整大纲正文不应复制进资产结果。',
        data: { summary: '旧版雾港章节纲摘要。' }
      }]
    });
    await workflowV2Store.createWorkflowV2Run(projectPath, {
      id: 'v2-assets',
      projectId,
      title: '新版资产运行',
      definition: {
        id: 'asset-definition',
        templateId: 'continuation',
        templateVersion: 1,
        title: '资产测试模板',
        nodes: [{ id: 'outline', capabilityId: 'outline.extract' }]
      }
    });
    await artifactStore.writeArtifactRevision(projectPath, 'v2-assets', {
      id: 'v2-outline',
      projectId,
      runId: 'v2-assets',
      nodeId: 'outline',
      artifactType: 'story-outline@1',
      title: '新版雾港大纲'
    }, {
      id: 'v2-outline-r1',
      summary: '待确认的雾港续写大纲。',
      reviewState: 'draft',
      payload: { format: 'text' }
    }, '新版完整大纲正文不应复制进资产结果。');
    await artifactStore.writeArtifactRevision(projectPath, 'v2-assets', {
      id: 'v2-archived-draft',
      projectId,
      runId: 'v2-assets',
      nodeId: 'outline',
      artifactType: 'draft-batch@1',
      title: '已归档草稿'
    }, {
      id: 'v2-archived-r1',
      summary: '已归档的旧草稿。',
      archiveState: 'archived',
      payload: { format: 'text' }
    }, '已归档正文。');

    const trackedFiles = [
      paths.sceneMarkdownPath(projectPath, sceneId),
      path.join(projectPath, 'compendium', 'entries.json'),
      paths.workflowRunsPath(projectPath),
      paths.workflowV2RunsPath(projectPath),
      paths.workflowV2ArtifactRevisionPath(projectPath, 'v2-assets', 'v2-outline', 'v2-outline-r1')
    ];
    const beforeQuery = await Promise.all(trackedFiles.map((filePath) => fs.readFile(filePath, 'utf8')));

    const listed = await assetQueryService.listProjectAssets(dataRoot, projectId);
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(new Set(listed.assets.map((asset) => asset.id)).size, listed.assets.length, 'each source should appear once');
    assert.ok(listed.assets.some((asset) => asset.id === `writer:scene:${sceneId}` && asset.originModule === 'writer'));
    assert.ok(listed.assets.some((asset) => asset.id === `compendium:${entry.id}` && asset.originModule === 'compendium'));
    const v2Asset = listed.assets.find((asset) => asset.revisionId === 'v2-outline-r1');
    assert.ok(v2Asset, 'v2 revision should be searchable');
    assert.strictEqual(v2Asset.reviewState, 'draft');
    assert.strictEqual(v2Asset.isFormalFact, false, 'unconfirmed workflow draft must not become a formal fact');
    assert.ok(listed.assets.some((asset) => asset.id === 'workflow:legacy:legacy-assets:legacy-outline'));
    assert.ok(!listed.assets.some((asset) => asset.revisionId === 'v2-archived-r1'), 'archived assets should be hidden by default');
    assert.ok(listed.assets.every((asset) => !Object.prototype.hasOwnProperty.call(asset, 'content')));
    assert.ok(listed.assets.every((asset) => !Object.prototype.hasOwnProperty.call(asset, 'body')));
    assert.ok(!JSON.stringify(listed.assets).includes('正式正文不应出现在资产搜索结果载荷中'));
    assert.ok(!JSON.stringify(listed.assets).includes('资料卡正文不应复制进资产搜索结果'));
    assert.ok(!JSON.stringify(listed.assets).includes('新版完整大纲正文不应复制进资产结果'));

    const afterQuery = await Promise.all(trackedFiles.map((filePath) => fs.readFile(filePath, 'utf8')));
    assert.deepStrictEqual(afterQuery, beforeQuery, 'asset search must not write any source store');

    const queried = await assetQueryService.listProjectAssets(dataRoot, projectId, {
      query: '导航员',
      originModule: 'compendium'
    });
    assert.deepStrictEqual(queried.assets.map((asset) => asset.id), [`compendium:${entry.id}`]);
    const archived = await assetQueryService.listProjectAssets(dataRoot, projectId, { includeArchived: true });
    assert.ok(archived.assets.some((asset) => asset.revisionId === 'v2-archived-r1'));

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });
    const apiResponse = await fetch(`${servers.appUrl}/api/project-assets?${new URLSearchParams({
      projectId,
      originModule: 'workflow',
      reviewState: 'draft'
    }).toString()}`);
    const apiBody = await apiResponse.json();
    assert.ok(apiResponse.ok && apiBody.ok);
    assert.ok(apiBody.assets.some((asset) => asset.revisionId === 'v2-outline-r1'));
    assert.ok(apiBody.assets.every((asset) => asset.originModule === 'workflow'));

    await compendiumService.deleteEntry(dataRoot, projectId, entry.id);
    const afterDeletion = await assetQueryService.listProjectAssets(dataRoot, projectId);
    assert.ok(!afterDeletion.assets.some((asset) => asset.id === `compendium:${entry.id}`), 'deleted source should disappear from derived results');

    console.log('Project asset query service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Project asset query service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
