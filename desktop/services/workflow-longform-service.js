const crypto = require('crypto');
const LongformSchema = require('../../src/core/workflow/workflow-longform-schema');
const chunkStore = require('../storage/workflow-chunk-store');
const artifactStore = require('../storage/workflow-artifact-store');
const runStore = require('../storage/workflow-run-store-v2');

function clean(value, fallback = '') { return String(value || fallback || '').trim(); }
function hash(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`; }

async function setRunStatus(options, status, activeChunkId = '', error = null) {
  const current = await runStore.readWorkflowV2RunState(options.projectPath, options.runId);
  const nodeId = clean(options.nodeId, 'draft');
  const executionState = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'running';
  const otherStates = (current.nodeStates || []).filter((item) => item.nodeId !== nodeId);
  return runStore.writeWorkflowV2RunState(options.projectPath, options.runId, {
    status, activeNodeId: status === 'completed' ? '' : nodeId, error,
    nodeStates: [...otherStates, { nodeId, executionState, activeChunkId, error }]
  }, { expectedRevision: current.revision });
}

function rollingRevisionId(options, sequence, inputDigest) {
  return `${clean(options.rollingStateRevisionPrefix, 'rolling-state')}-${sequence + 1}-${clean(inputDigest).replace(/^sha256:/, '').slice(0, 12)}`;
}

async function persistRollingState(options, state, sequence, inputDigest, parentRevisionId = '') {
  const artifactId = clean(options.rollingStateArtifactId, 'rolling-state');
  const revisionId = rollingRevisionId(options, sequence, inputDigest);
  const result = await artifactStore.writeArtifactRevision(options.projectPath, options.runId, {
    id: artifactId, projectId: options.projectId, runId: options.runId, nodeId: options.nodeId, artifactType: 'rolling-state@1', title: '长篇滚动状态'
  }, { id: revisionId, parentRevisionId, payload: { format: 'json' }, summary: `完成 ${state.completedSceneIds.length} 个场景` }, state);
  const current = await runStore.readWorkflowV2RunState(options.projectPath, options.runId);
  await runStore.writeWorkflowV2RunState(options.projectPath, options.runId, { rollingStateRef: `${artifactId}@${revisionId}` }, { expectedRevision: current.revision });
  return result;
}

async function runLongformGeneration(options = {}) {
  if (typeof options.generateChunk !== 'function') throw new Error('long-form generateChunk adapter is required');
  const plan = LongformSchema.createChunkPlan(options.scenePlan, options);
  let rollingState = LongformSchema.createRollingState(options.initialRollingState);
  let generatedCount = 0;
  let reusedCount = 0;
  const outputs = [];
  let previousRollingRevisionId = '';
  await setRunStatus(options, 'running');

  for (const chunk of plan.chunks) {
    const inputDigest = hash({ chunk, rollingState, constraintSnapshotId: plan.constraintSnapshotId, scenePlanRevisionId: plan.scenePlanRevisionId });
    const existing = await chunkStore.readChunkCheckpoint(options.projectPath, options.runId, chunk.id);
    if (existing && existing.status === 'completed' && existing.inputDigest === inputDigest) {
      const content = await chunkStore.readChunkContent(options.projectPath, options.runId, chunk.id);
      outputs.push({ chunk, content, reused: true });
      const rollingArtifactId = clean(options.rollingStateArtifactId, 'rolling-state');
      const storedRevisionId = rollingRevisionId(options, chunk.sequence, inputDigest);
      const storedRollingState = await artifactStore.readArtifactContent(options.projectPath, options.runId, rollingArtifactId, storedRevisionId);
      rollingState = storedRollingState || LongformSchema.advanceRollingState(rollingState, chunk, content);
      previousRollingRevisionId = storedRollingState ? storedRevisionId : previousRollingRevisionId;
      reusedCount += 1;
      continue;
    }
    if (typeof options.shouldCancel === 'function' && await options.shouldCancel(chunk)) {
      const revision = existing ? existing.revision : 0;
      await chunkStore.writeChunkCheckpoint(options.projectPath, options.runId, { id: chunk.id, nodeId: options.nodeId, sequence: chunk.sequence, status: 'cancelled', inputDigest }, { expectedRevision: revision });
      await setRunStatus(options, 'cancelled', chunk.id);
      return { ok: false, status: 'cancelled', plan, rollingState, outputs, generatedCount, reusedCount };
    }
    const revision = existing ? existing.revision : 0;
    await chunkStore.writeChunkCheckpoint(options.projectPath, options.runId, { id: chunk.id, nodeId: options.nodeId, sequence: chunk.sequence, status: 'running', inputDigest, error: null }, { expectedRevision: revision });
    await setRunStatus(options, 'running', chunk.id);
    try {
      const generated = await options.generateChunk({ chunk, rollingState, constraintSnapshotId: plan.constraintSnapshotId });
      const content = clean(generated && generated.text !== undefined ? generated.text : generated);
      if (!content) throw new Error('long-form generator returned empty content');
      const current = await chunkStore.readChunkCheckpoint(options.projectPath, options.runId, chunk.id);
      await chunkStore.writeChunkCheckpoint(options.projectPath, options.runId, { id: chunk.id, nodeId: options.nodeId, sequence: chunk.sequence, status: 'completed', inputDigest, content }, { expectedRevision: current.revision });
      rollingState = LongformSchema.advanceRollingState(rollingState, chunk, content, generated && generated.rollingStatePatch);
      const rollingArtifact = await persistRollingState(options, rollingState, chunk.sequence, inputDigest, previousRollingRevisionId);
      previousRollingRevisionId = rollingArtifact.revision.id;
      outputs.push({ chunk, content, reused: false });
      generatedCount += 1;
    } catch (error) {
      const current = await chunkStore.readChunkCheckpoint(options.projectPath, options.runId, chunk.id);
      await chunkStore.writeChunkCheckpoint(options.projectPath, options.runId, { id: chunk.id, nodeId: options.nodeId, sequence: chunk.sequence, status: 'failed', inputDigest, error: { code: 'chunk_generation_failed', message: error.message || String(error) } }, { expectedRevision: current.revision });
      await setRunStatus(options, 'failed', chunk.id, { code: 'chunk_generation_failed', message: error.message || String(error) });
      return { ok: false, status: 'failed', error, plan, rollingState, outputs, generatedCount, reusedCount };
    }
  }
  await setRunStatus(options, 'completed');
  return { ok: true, status: 'completed', plan, rollingState, outputs, generatedCount, reusedCount };
}

module.exports = { runLongformGeneration };
