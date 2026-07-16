const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const service = require('../desktop/services/workflow-template-service');
const guided = require('../desktop/services/workflow-guided-service');
const projectService = require('../desktop/services/project-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-template-service-'));
  try {
    await projectService.createProject(dataRoot, { id: 'template-project', title: '模板运行', chapters: [{ id: 'c1', title: '第一章', order: 0 }], scenes: [{ id: 's1', chapterId: 'c1', title: '起点', content: '风从海上来。', order: 0 }] });
    const first = await service.saveTemplate(dataRoot, { id: 'my-template', title: '我的模板', definition: guided.definition({ brief: '测试' }) });
    assert.strictEqual(first.template.version, 1);
    assert.strictEqual(first.template.executionCompatibility.executable, true);
    assert.strictEqual(first.template.definition.nodes[0].description, '冻结本次续写使用的原文范围。');
    const second = await service.saveTemplate(dataRoot, { id: 'my-template', title: '我的模板 2', definition: first.template.definition });
    assert.strictEqual(second.template.version, 2);
    const listed = await service.listTemplates(dataRoot);
    assert.strictEqual(listed.templates.length, 1);
    assert.deepStrictEqual(listed.templates[0].availableVersions, [2, 1]);
    assert.strictEqual((await service.getTemplate(dataRoot, 'my-template', 1)).template.title, '我的模板');
    assert.deepStrictEqual((await service.listTemplateVersions(dataRoot, 'my-template')).templates.map((item) => item.version), [2, 1]);
    const startedV1 = await service.startTemplate(dataRoot, { templateId: 'my-template', templateVersion: 1, projectId: 'template-project', scope: 'project', brief: '从旧版本启动' });
    const runV1 = await guided.getGuidedRun(dataRoot, 'template-project', startedV1.runId);
    assert.strictEqual(runV1.run.definition.settings.customTemplateVersion, 1);
    const started = await service.startTemplate(dataRoot, { templateId: 'my-template', projectId: 'template-project', scope: 'project', brief: '从模板启动' });
    const run = await guided.getGuidedRun(dataRoot, 'template-project', started.runId);
    assert.strictEqual(run.run.definition.settings.customTemplateId, 'my-template');
    assert.strictEqual(run.run.definition.settings.customTemplateVersion, 2);
    assert.strictEqual(run.run.templateId, 'continuation-guided');
    const invalid = guided.definition({}); invalid.edges[0].fromPortId = 'unknown';
    await assert.rejects(() => service.saveTemplate(dataRoot, { definition: invalid }), /output port not found/);
    const incompatible = guided.definition({}); incompatible.nodes.push({ id: 'extra-source', capabilityId: 'writer.snapshot', position: { x: 0, y: 200 } });
    const savedIncompatible = await service.saveTemplate(dataRoot, { id: 'not-executable', definition: incompatible });
    assert.strictEqual(savedIncompatible.template.executionCompatibility.executable, false);
    await assert.rejects(() => service.startTemplate(dataRoot, { templateId: 'not-executable', projectId: 'template-project' }), /not executable/);
    assert.strictEqual((await service.deleteTemplate(dataRoot, 'my-template')).deleted, 1);
    await assert.rejects(() => service.getTemplate(dataRoot, 'my-template', 1), /not found/);
    console.log('Workflow template service test passed.');
  } finally { await fs.rm(dataRoot, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exit(1); });
