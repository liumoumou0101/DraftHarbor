const PlanningSchema = require('../../src/core/workflow/workflow-planning-schema');
const artifactStore = require('../storage/workflow-artifact-store');
const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const AITaskContract = require('../../src/core/generation/ai-task-contract');

function clean(value, fallback = '') { return String(value || fallback || '').trim(); }

async function writePlanningArtifact(projectPath, runId, input = {}) {
  return artifactStore.writeArtifactRevision(projectPath, runId, {
    id: clean(input.artifactId), projectId: clean(input.projectId), runId, nodeId: clean(input.nodeId, 'planning'),
    artifactType: clean(input.artifactType), title: clean(input.title, '工作流策划稿')
  }, {
    id: clean(input.revisionId), parentRevisionId: clean(input.parentRevisionId),
    inputRevisionIds: input.inputRevisionIds, constraintSnapshotId: clean(input.constraintSnapshotId),
    summary: clean(input.summary), reviewState: input.reviewState, approvedAt: input.approvedAt,
    payload: { format: 'json' }
  }, input.content);
}

async function findApprovedScenePlan(projectPath, runId) {
  const families = await artifactStore.listArtifactFamilies(projectPath, runId);
  for (const family of families.filter((item) => item.artifactType.id === 'scene-plan')) {
    for (const revisionId of family.revisionIds.slice().reverse()) {
      const revision = await artifactStore.readArtifactRevision(projectPath, runId, family.id, revisionId);
      if (revision && revision.reviewState === 'approved') {
        return { family, revision, content: await artifactStore.readArtifactContent(projectPath, runId, family.id, revisionId) };
      }
    }
  }
  return null;
}

async function createOrReuseScenePlan(options = {}) {
  if (options.force !== true) {
    const approved = await findApprovedScenePlan(options.projectPath, options.runId);
    if (approved) return { ok: true, reused: true, ...approved };
  }
  const content = PlanningSchema.createScenePlan(options.plan);
  const artifact = await writePlanningArtifact(options.projectPath, options.runId, {
    ...options, artifactType: 'scene-plan@1', content
  });
  return { ok: true, reused: false, content, ...artifact };
}

async function generatePlanningArtifact(options = {}) {
  const runner = options.runner || AITaskRunner.createAITaskRunner({ streamGeneration: options.streamGeneration });
  const task = AITaskContract.createAITask({
    id: options.taskId, projectId: options.projectId, domain: 'workflow', action: 'generate', scope: 'project',
    target: { type: 'workflow-node', id: options.nodeId || 'planning' }, capabilityId: options.capabilityId || 'planning.generate',
    outputArtifactType: options.kind === 'scene-plan' ? 'scene-plan@1' : 'direction-set@1', outputContract: 'text'
  });
  const result = await runner.run(task, { prompt: options.prompt || { messages: [] }, providerConfig: options.providerConfig, streamGeneration: options.streamGeneration });
  if (!result.ok) return result;
  const raw = JSON.parse(String(result.output).trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
  const content = options.kind === 'scene-plan' ? PlanningSchema.createScenePlan(raw) : PlanningSchema.createDirectionSet(raw);
  const artifact = await writePlanningArtifact(options.projectPath, options.runId, {
    ...options, artifactType: options.kind === 'scene-plan' ? 'scene-plan@1' : 'direction-set@1', content
  });
  return { ok: true, task: result.task, content, artifact };
}

module.exports = { writePlanningArtifact, findApprovedScenePlan, createOrReuseScenePlan, generatePlanningArtifact };
