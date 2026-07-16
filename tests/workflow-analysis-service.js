const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Analysis = require('../desktop/services/workflow-analysis-service');
const projectService = require('../desktop/services/project-service');
const workflowV2Store = require('../desktop/storage/workflow-run-store-v2');
const summary = Analysis.buildHierarchicalSummary({ content: [{ sceneId: 's1', chapterId: 'c1', title: '开端', content: '港口的钟声在雨中响起。' }, { sceneId: 's2', chapterId: 'c1', title: '相遇', content: '林岚遇见了船长。' }] });
assert.strictEqual(summary.scenes.length, 2);
assert.strictEqual(summary.chapters.length, 1);
const candidates = Analysis.classifyCardCandidates([{ title: '林岚', aliases: ['阿岚'], type: 'character' }, { title: '钟楼', type: 'location' }], [{ id: 'entry-1', title: '林岚', aliases: ['调查员'] }]);
assert.strictEqual(candidates[0].disposition, 'update_suggestion');
assert.strictEqual(candidates[0].matchedEntryId, 'entry-1');
assert.strictEqual(candidates[1].disposition, 'create_suggestion');
(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workflow-analysis-'));
  try {
    const created = await projectService.createProject(dataRoot, { id: 'analysis-project', title: 'Analysis' });
    await workflowV2Store.createWorkflowV2Run(created.projectPath, { id: 'analysis-run', projectId: created.project.id, definition: { id: 'analysis-definition', templateId: 'continuation', templateVersion: 1, title: '分析', nodes: [{ id: 'analysis', capabilityId: 'analysis.extract' }] } });
    const result = await Analysis.runAnalysisTask({ dataRoot, projectPath: created.projectPath, projectId: created.project.id, runId: 'analysis-run', artifactId: 'outline', revisionId: 'outline-r1', taskId: 'analysis-task', streamGeneration: async (_prompt, onToken) => onToken('{"outline":[{"title":"第一章"}],"cards":[{"title":"林岚"}]}') });
    assert.ok(result.ok);
    assert.strictEqual(result.content.outline[0].title, '第一章');
    assert.deepStrictEqual(Analysis.classifyCardCandidates(result.content.cards, [] )[0].disposition, 'create_suggestion');
  } finally { await fs.rm(dataRoot, { recursive: true, force: true }); }
  console.log('Workflow analysis service test passed.');
})().catch((error) => { console.error(error); process.exit(1); });
