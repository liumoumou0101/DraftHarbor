const AITaskContract = require('../../src/core/generation/ai-task-contract');
const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const ArtifactSchema = require('../../src/core/workflow/workflow-artifact-schema');
const workflowV2Store = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const historyStore = require('../storage/workflow-generation-history-store');
const { resolveWorkflowProvider } = require('./workflow-provider-service');

function artifactTypeKey(type) {
  return ArtifactSchema.artifactTypeKey(type);
}

function capabilitySupportsOutput(capability, outputArtifactType) {
  const target = artifactTypeKey(outputArtifactType);
  return (capability.outputPorts || []).some((port) => (port.artifactTypes || [])
    .some((type) => artifactTypeKey(type) === target));
}

function createWorkflowAITask(input = {}, capabilityRegistry) {
  const task = AITaskContract.createAITask({ ...input, domain: 'workflow' });
  if (!capabilityRegistry || typeof capabilityRegistry.getCapability !== 'function') {
    throw new Error('workflow capability registry is required');
  }
  const capability = capabilityRegistry.getCapability(task.capabilityId, task.capabilityVersion);
  if (!capability) {
    throw new Error(`workflow capability is not registered: ${task.capabilityId}@${task.capabilityVersion}`);
  }
  const artifactType = capabilityRegistry.getArtifactType(task.outputArtifactType);
  if (!artifactType) {
    throw new Error(`workflow output artifact type is not registered: ${artifactTypeKey(task.outputArtifactType)}`);
  }
  if (!capabilitySupportsOutput(capability, task.outputArtifactType)) {
    throw new Error(`workflow capability ${task.capabilityId} does not declare ${artifactTypeKey(task.outputArtifactType)} as an output`);
  }
  return { task, capability, artifactType };
}

function historyInput(task, runId, nodeId, resolution, result, artifact = null) {
  return {
    id: `workflow-history-${task.id}`,
    runId,
    nodeId,
    taskId: task.id,
    capabilityId: task.capabilityId,
    capabilityVersion: task.capabilityVersion,
    outputArtifactType: task.outputArtifactType,
    status: result.status,
    providerSnapshot: resolution.snapshot,
    artifactRef: artifact
      ? { artifactId: artifact.family.id, revisionId: artifact.revision.id }
      : {},
    resultDigest: artifact ? artifact.revision.payload.digest : '',
    error: result.error || null,
    startedAt: result.record && result.record.startedAt ? result.record.startedAt : '',
    finishedAt: result.task && result.task.finishedAt ? result.task.finishedAt : ''
  };
}

async function runWorkflowTask(options = {}) {
  const projectPath = options.projectPath;
  const runId = String(options.runId || '').trim();
  const nodeId = String(options.nodeId || '').trim();
  if (!projectPath || !runId || !nodeId) throw new Error('workflow projectPath, runId and nodeId are required');
  if (!await workflowV2Store.readWorkflowV2RunState(projectPath, runId)) {
    throw new Error(`workflow v2 run state not found: ${runId}`);
  }
  const { task, artifactType } = createWorkflowAITask(options.task, options.capabilityRegistry);
  const resolution = resolveWorkflowProvider(options.settings || {}, options.workflow || {}, options.node || {});
  const runner = options.runner || AITaskRunner.createAITaskRunner({ streamGeneration: options.streamGeneration });
  const result = await runner.run(task, {
    prompt: options.prompt || { messages: [] },
    providerConfig: resolution.config,
    streamGeneration: options.streamGeneration,
    onToken: options.onToken
  });

  if (!result.ok) {
    const history = await historyStore.writeWorkflowGenerationHistoryRecord(
      projectPath,
      runId,
      historyInput(task, runId, nodeId, resolution, result)
    );
    return {
      ok: false,
      status: result.status,
      task: result.task,
      error: result.error,
      history
    };
  }

  if (artifactType.payloadFormat !== 'text') {
    throw new Error(`workflow task currently requires a text artifact type, received ${artifactType.payloadFormat}`);
  }
  const payloadValidation = options.capabilityRegistry.validateArtifactPayload(task.outputArtifactType, result.output);
  if (!payloadValidation.ok) {
    throw new Error(`workflow output failed artifact validation: ${payloadValidation.errors.join('; ')}`);
  }
  const artifactInput = options.artifact && typeof options.artifact === 'object' ? options.artifact : {};
  const revisionInput = options.revision && typeof options.revision === 'object' ? options.revision : {};
  const artifact = await artifactStore.writeArtifactRevision(projectPath, runId, {
    ...artifactInput,
    projectId: task.projectId,
    runId,
    nodeId,
    artifactType: task.outputArtifactType
  }, {
    ...revisionInput,
    providerSnapshot: resolution.snapshot,
    payload: { ...(revisionInput.payload || {}), format: 'text' }
  }, result.text);
  const history = await historyStore.writeWorkflowGenerationHistoryRecord(
    projectPath,
    runId,
    historyInput(task, runId, nodeId, resolution, result, artifact)
  );
  return {
    ok: true,
    status: result.status,
    task: result.task,
    output: result.output,
    artifact,
    history,
    provider: { source: resolution.source, snapshot: resolution.snapshot }
  };
}

module.exports = {
  createWorkflowAITask,
  runWorkflowTask,
  capabilitySupportsOutput
};
