const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectService = require('../desktop/services/project-service');
const guided = require('../desktop/services/workflow-guided-service');
const templateService = require('../desktop/services/workflow-template-service');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const eventStore = require('../desktop/storage/workflow-event-store-v2');

function elapsed(started) { return Date.now() - started; }
function under(name, value, limit) {
  assert.ok(value < limit, `${name} exceeded ${limit} ms: ${value} ms`);
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-release-'));
  const metrics = {};
  try {
    const chapters = Array.from({ length: 6 }, (_, index) => ({ id: `chapter-${index + 1}`, title: `第 ${index + 1} 章`, order: index }));
    const sceneBody = `${'潮声越过防波堤，人物状态与线索继续推进。'.repeat(1400)}\n`;
    const scenes = Array.from({ length: 36 }, (_, index) => ({
      id: `scene-${index + 1}`,
      chapterId: chapters[Math.floor(index / 6)].id,
      title: `压力场景 ${index + 1}`,
      content: `${sceneBody}唯一标记-${index + 1}`,
      order: index % 6
    }));

    let started = Date.now();
    const shell = await projectService.createProject(dataRoot, { id: 'release-project', title: '工作流发布验收' });
    const created = await projectService.saveProject(dataRoot, { ...shell.project, chapters, scenes });
    metrics.createLargeProjectMs = elapsed(started);
    under('create large project', metrics.createLargeProjectMs, 15000);

    started = Date.now();
    const opened = await projectService.openProject(dataRoot, created.project.id);
    metrics.openLargeProjectMs = elapsed(started);
    assert.strictEqual(opened.project.scenes.length, 36);
    assert.ok(opened.project.scenes.every((scene) => scene.content.includes('唯一标记-')));
    under('open large project', metrics.openLargeProjectMs, 10000);

    const definition = guided.definition({ brief: '发布验收' });
    await runStore.createWorkflowV2Run(created.projectPath, {
      id: 'release-run', projectId: created.project.id, title: '大规模运行', definition
    });

    started = Date.now();
    for (let index = 0; index < 500; index += 1) {
      await eventStore.appendWorkflowV2Event(created.projectPath, 'release-run', {
        id: `event-${String(index).padStart(4, '0')}`,
        type: index % 5 === 0 ? 'generation_activity' : 'workflow_progress',
        nodeId: definition.nodes[index % definition.nodes.length].id,
        payload: { sequence: index, summary: `事件 ${index}` },
        createdAt: new Date(Date.UTC(2026, 6, 15, 0, 0, 0, index)).toISOString()
      });
    }
    metrics.write500EventsMs = elapsed(started);
    under('write 500 events', metrics.write500EventsMs, 30000);

    started = Date.now();
    const events = await eventStore.listWorkflowV2Events(created.projectPath, 'release-run');
    metrics.list500EventsMs = elapsed(started);
    assert.strictEqual(events.length, 500);
    assert.strictEqual(events[0].payload.sequence, 0);
    assert.strictEqual(events[499].payload.sequence, 499);
    under('list 500 events', metrics.list500EventsMs, 10000);

    started = Date.now();
    for (let familyIndex = 0; familyIndex < 5; familyIndex += 1) {
      for (let revisionIndex = 0; revisionIndex < 10; revisionIndex += 1) {
        await artifactStore.writeArtifactRevision(created.projectPath, 'release-run', {
          id: `artifact-${familyIndex}`,
          projectId: created.project.id,
          runId: 'release-run',
          nodeId: 'draft',
          artifactType: 'draft-batch@1',
          title: `正文家族 ${familyIndex}`
        }, {
          id: `artifact-${familyIndex}-r${revisionIndex + 1}`,
          parentRevisionId: revisionIndex ? `artifact-${familyIndex}-r${revisionIndex}` : '',
          variantId: revisionIndex % 2 ? 'alternative' : 'main',
          payload: { format: 'text' }
        }, `${sceneBody}版本-${familyIndex}-${revisionIndex}`);
      }
    }
    metrics.write50RevisionsMs = elapsed(started);
    under('write 50 revisions', metrics.write50RevisionsMs, 20000);

    started = Date.now();
    const families = await artifactStore.listArtifactFamilies(created.projectPath, 'release-run');
    metrics.listArtifactFamiliesMs = elapsed(started);
    assert.strictEqual(families.length, 5);
    assert.ok(families.every((family) => family.revisionIds.length === 10));
    under('list artifact families', metrics.listArtifactFamiliesMs, 5000);

    started = Date.now();
    let saved = await templateService.saveTemplate(dataRoot, { id: 'release-template', title: '发布模板 v1', definition });
    for (let version = 2; version <= 8; version += 1) {
      saved = await templateService.saveTemplate(dataRoot, { id: 'release-template', title: `发布模板 v${version}`, definition: saved.template.definition });
    }
    const versions = await templateService.listTemplateVersions(dataRoot, 'release-template');
    metrics.saveAndList8TemplateVersionsMs = elapsed(started);
    assert.deepStrictEqual(versions.templates.map((template) => template.version), [8, 7, 6, 5, 4, 3, 2, 1]);
    assert.strictEqual((await templateService.getTemplate(dataRoot, 'release-template', 1)).template.title, '发布模板 v1');
    under('save and list template history', metrics.saveAndList8TemplateVersionsMs, 10000);

    const runIndexText = await fs.readFile(path.join(created.projectPath, 'workflows', 'v2', 'runs.json'), 'utf8');
    assert.ok(!runIndexText.includes(sceneBody.slice(0, 80)), 'run index must not duplicate long project or artifact content');
    assert.ok(runIndexText.length < 10000, 'run index must stay metadata-sized');

    metrics.totalMs = Object.values(metrics).reduce((sum, value) => sum + value, 0);
    metrics.sceneCharacters = scenes.reduce((sum, scene) => sum + scene.content.length, 0);
    metrics.eventCount = events.length;
    metrics.artifactRevisions = families.reduce((sum, family) => sum + family.revisionIds.length, 0);
    metrics.templateVersions = versions.templates.length;
    console.log(`Workflow release acceptance passed: ${JSON.stringify(metrics)}`);
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow release acceptance failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
