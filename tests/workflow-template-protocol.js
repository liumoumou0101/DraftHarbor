const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const workflowService = require('../desktop/services/workflow-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const paths = require('../desktop/storage/library-paths');
const Definition = require('../src/core/workflow/workflow-definition-schema');
const Artifact = require('../src/core/workflow/workflow-artifact-schema');
const Continuation = require('../desktop/services/workflow-guided-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const Rewrite = require('../desktop/services/workflow-rewrite-guided-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-template-protocol-'));
  try {
    const created = await projectService.createProject(dataRoot, { id: 'template-protocol-project', title: '三模板协议验收' });
    const chapterId = created.project.chapters[0].id;
    const sceneId = created.project.scenes[0].id;
    await projectService.saveProject(dataRoot, {
      ...created.project,
      scenes: created.project.scenes.map((scene) => scene.id === sceneId ? { ...scene, title: '钟楼入口', content: '林岚带着停止的怀表进入钟楼。' } : scene)
    });
    const common = { dataRoot, projectId: created.project.id };
    await Continuation.startGuidedContinuation({ ...common, runId: 'continuation-protocol', scope: 'chapter', chapterId, brief: '续写钟楼谜案' });
    await Creation.startGuidedCreation({ ...common, runId: 'creation-protocol', brief: { title: '潮汐档案', premise: '潜水员寻找自己的死亡记录。' } });
    await Rewrite.startGuidedRewrite({ ...common, runId: 'rewrite-protocol', scope: 'scene', sceneId, brief: { instruction: '压缩铺垫并强化冲突' } });

    const specs = [
      { runId: 'continuation-protocol', templateId: 'continuation-guided', get: () => Continuation.getGuidedRun(dataRoot, created.project.id, 'continuation-protocol') },
      { runId: 'creation-protocol', templateId: 'creation-guided', get: () => Creation.getCreationRun(dataRoot, created.project.id, 'creation-protocol') },
      { runId: 'rewrite-protocol', templateId: 'rewrite-guided', get: () => Rewrite.getRewriteRun(dataRoot, created.project.id, 'rewrite-protocol') }
    ];
    const projectPath = created.projectPath;
    const normalizedRunKeySets = [];
    const layoutSets = [];
    for (const spec of specs) {
      const stored = await runStore.readWorkflowV2Run(projectPath, spec.runId);
      assert.strictEqual(stored.summary.templateId, spec.templateId);
      assert.strictEqual(stored.state.schemaVersion, 2);
      assert.strictEqual(stored.definitionSnapshot.schemaVersion, Definition.WORKFLOW_DEFINITION_SCHEMA_VERSION);
      const validation = Definition.validateWorkflowDefinition(stored.definitionSnapshot.definition);
      assert.strictEqual(validation.ok, true, validation.errors.join('; '));
      assert.strictEqual(validation.order.length, stored.definitionSnapshot.definition.nodes.length);
      assert.ok(stored.definitionSnapshot.definition.edges.every((edge) => edge.from.portId === 'next' && edge.to.portId === 'previous'));

      const families = await artifactStore.listArtifactFamilies(projectPath, spec.runId);
      assert.ok(families.length >= 1);
      families.forEach((family) => assert.strictEqual(Artifact.validateWorkflowArtifactFamily(family).ok, true));
      const revision = await artifactStore.readArtifactRevision(projectPath, spec.runId, families[0].id, families[0].revisionIds[0]);
      assert.strictEqual(Artifact.validateWorkflowArtifactRevision(revision).ok, true);

      const details = await spec.get();
      assert.strictEqual(details.run.storageVersion, 'v2');
      assert.strictEqual(details.run.compatibilityMode, 'v2_guided');
      assert.strictEqual(details.run.supportsV2Execution, true);
      assert.strictEqual(details.run.readOnly, false);
      normalizedRunKeySets.push(Object.keys(details.run).sort());

      const entries = (await fs.readdir(paths.workflowV2RunDir(projectPath, spec.runId), { withFileTypes: true })).map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`).sort();
      assert.deepStrictEqual(entries, ['dir:artifacts', 'dir:events', 'file:definition.json', 'file:state.json']);
      layoutSets.push(entries);
    }
    assert.deepStrictEqual(normalizedRunKeySets[1], normalizedRunKeySets[0], 'creation and continuation must expose the same guided run protocol');
    assert.deepStrictEqual(normalizedRunKeySets[2], normalizedRunKeySets[0], 'rewrite and continuation must expose the same guided run protocol');
    assert.deepStrictEqual(layoutSets[1], layoutSets[0]);
    assert.deepStrictEqual(layoutSets[2], layoutSets[0]);

    const index = await runStore.readRunsIndex(projectPath);
    assert.strictEqual(index.schemaVersion, 2);
    assert.deepStrictEqual(new Set(index.runs.map((run) => run.templateId)), new Set(specs.map((spec) => spec.templateId)));
    const listed = await workflowService.listRuns(dataRoot, created.project.id);
    specs.forEach((spec) => {
      const run = listed.runs.find((item) => item.id === spec.runId);
      assert.ok(run && run.supportsV2Execution && !run.readOnly, `${spec.templateId} must use the executable v2 adapter`);
    });
    console.log('Workflow three-template protocol test passed.');
  } finally { await fs.rm(dataRoot, { recursive: true, force: true }); }
})().catch((error) => { console.error('Workflow three-template protocol test failed:', error && error.stack ? error.stack : error); process.exit(1); });
