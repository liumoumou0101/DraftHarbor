const crypto = require('crypto');
const paths = require('../storage/library-paths');
const runStore = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const eventStore = require('../storage/workflow-event-store-v2');

function clean(value, fallback = '') { return String(value === undefined || value === null ? fallback : value).trim(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function parseJson(value) {
  const parsed = JSON.parse(clean(value).replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('guided output must be a JSON object');
  return parsed;
}

function createGuidedRuntime(spec = {}) {
  const stages = Array.isArray(spec.stages) ? spec.stages : [];
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  if (!clean(spec.templateId) || !stages.length) throw new Error('guided runtime requires templateId and stages');
  const projectPath = (dataRoot, projectId) => paths.projectDir(dataRoot, projectId);

  async function appendEvent(targetPath, runId, type, nodeId, payload = {}) {
    return eventStore.appendWorkflowV2Event(targetPath, runId, { id: id('event'), type, nodeId, payload });
  }

  async function artifactRecords(targetPath, runId) {
    const families = await artifactStore.listArtifactFamilies(targetPath, runId);
    const records = [];
    for (const family of families) {
      const revisionId = family.revisionIds[family.revisionIds.length - 1];
      const revision = revisionId ? await artifactStore.readArtifactRevision(targetPath, runId, family.id, revisionId) : null;
      if (!revision) continue;
      records.push({
        id: family.id, title: family.title, nodeId: family.nodeId,
        artifactType: `${family.artifactType.id}@${family.artifactType.version}`,
        revision,
        content: await artifactStore.readArtifactContent(targetPath, runId, family.id, revision.id)
      });
    }
    return records;
  }

  async function getRun(dataRoot, projectId, runId) {
    const targetPath = projectPath(dataRoot, projectId);
    const stored = await runStore.readWorkflowV2Run(targetPath, runId);
    if (!stored || stored.summary.templateId !== spec.templateId) throw new Error(`${spec.templateId} guided run not found`);
    const storedArtifacts = await artifactRecords(targetPath, runId);
    const states = new Map((stored.state.nodeStates || []).map((state) => [state.nodeId, state]));
    const definition = stored.definitionSnapshot && stored.definitionSnapshot.definition;
    const definitionNodes = new Map(((definition && definition.nodes) || []).map((node) => [node.id, node]));
    const artifacts = storedArtifacts.map((artifact) => {
      const state = states.get(artifact.nodeId) || {};
      const effectiveFreshness = ['ready', 'pending', 'interrupted', 'failed'].includes(state.executionState) ? 'stale' : (artifact.revision.freshness || 'fresh');
      return { ...artifact, effectiveFreshness };
    });
    return {
      ok: true,
      run: {
        ...stored.summary,
        activeStepId: stored.summary.activeNodeId,
        storageVersion: 'v2', compatibilityMode: 'v2_guided', readOnly: false, supportsV2Execution: true,
        definition: definition || null,
        settings: definition ? definition.settings : {},
        steps: stages.map((stage) => ({ ...stage, ...(definitionNodes.get(stage.id) || {}), status: (states.get(stage.id) || {}).executionState || 'pending', artifactCount: artifacts.filter((artifact) => artifact.nodeId === stage.id).length, staleArtifactCount: artifacts.filter((artifact) => artifact.nodeId === stage.id && artifact.effectiveFreshness === 'stale').length })),
        artifacts
      }
    };
  }

  async function setNodeState(targetPath, runId, nodeId, executionState, advance = false) {
    const current = await runStore.readWorkflowV2RunState(targetPath, runId);
    const index = stages.findIndex((stage) => stage.id === nodeId);
    if (index < 0) throw new Error(`unknown guided node: ${nodeId}`);
    const next = advance ? stages[index + 1] : null;
    const states = (current.nodeStates || []).map((state) => state.nodeId === nodeId
      ? { ...state, executionState }
      : next && state.nodeId === next.id ? { ...state, executionState: 'ready' } : state);
    return runStore.writeWorkflowV2RunState(targetPath, runId, {
      status: next ? 'in_progress' : advance ? 'completed' : current.status,
      activeNodeId: next ? next.id : advance ? '' : nodeId,
      nodeStates: states,
      finishedAt: advance && !next ? new Date().toISOString() : current.finishedAt
    }, { expectedRevision: current.revision });
  }

  async function writeArtifact(targetPath, options = {}) {
    const stage = stageMap.get(options.nodeId);
    if (!stage) throw new Error(`unknown guided node: ${options.nodeId}`);
    return artifactStore.writeArtifactRevision(targetPath, options.runId, {
      id: options.artifactId,
      projectId: options.projectId,
      runId: options.runId,
      nodeId: options.nodeId,
      artifactType: options.artifactType,
      title: options.title || stage.title
    }, {
      id: options.revisionId || id(`${options.nodeId}-r`),
      parentRevisionId: options.parentRevisionId,
      inputRevisionIds: options.inputRevisionIds || [],
      summary: options.summary || `${stage.title}生成结果`,
      reviewState: options.reviewState || 'waiting_review',
      approvedAt: options.approvedAt,
      payload: { format: options.format || 'json' }
    }, options.content);
  }

  async function completeOutputs(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    const details = await getRun(options.dataRoot, options.projectId, options.runId);
    const nodeId = clean(options.nodeId, details.run.activeNodeId);
    if (nodeId !== details.run.activeNodeId) throw new Error(`guided node is not active: ${nodeId}`);
    const outputs = Array.isArray(options.outputs) ? options.outputs : [options.output];
    if (!outputs.length || outputs.some((output) => !clean(output))) throw new Error('guided node outputs are required');
    const stageIndex = stages.findIndex((stage) => stage.id === nodeId);
    const refs = details.run.artifacts.filter((artifact) => stages.findIndex((stage) => stage.id === artifact.nodeId) < stageIndex).map((artifact) => artifact.revision.id);
    for (let index = 0; index < outputs.length; index += 1) {
      const normalized = spec.normalizeOutput(nodeId, outputs[index], { ...options, index });
      const format = typeof normalized === 'string' ? 'text' : 'json';
      const artifactId = `${nodeId}-result${outputs.length > 1 ? `-${index + 1}` : ''}`;
      const previous = details.run.artifacts.find((artifact) => artifact.id === artifactId);
      await writeArtifact(targetPath, {
        ...options, nodeId, inputRevisionIds: refs, content: normalized, format,
        artifactId,
        parentRevisionId: previous && previous.revision.id,
        artifactType: spec.outputTypes[nodeId],
        title: outputs.length > 1 ? clean(options.outputTitles && options.outputTitles[index], `${stageMap.get(nodeId).title} ${index + 1}`) : stageMap.get(nodeId).title,
        summary: outputs.length > 1 ? `${stageMap.get(nodeId).title} ${index + 1}` : `${stageMap.get(nodeId).title}生成结果`
      });
    }
    await setNodeState(targetPath, options.runId, nodeId, 'waiting_user');
    await appendEvent(targetPath, options.runId, 'guided_node_generated', nodeId, { outputCount: outputs.length, usage: options.usage || [] });
    return getRun(options.dataRoot, options.projectId, options.runId);
  }

  async function reviseArtifact(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    const family = await artifactStore.readArtifactFamily(targetPath, options.runId, options.artifactId);
    const parent = await artifactStore.readArtifactRevision(targetPath, options.runId, options.artifactId, options.parentRevisionId);
    if (!family || !parent) throw new Error('guided artifact revision not found');
    const contentInput = parent.payload.format === 'json' && typeof options.content === 'string' ? parseJson(options.content) : options.content;
    const content = spec.normalizeOutput(family.nodeId, contentInput, options);
    const result = await writeArtifact(targetPath, {
      ...options, nodeId: family.nodeId, artifactId: family.id, artifactType: `${family.artifactType.id}@${family.artifactType.version}`,
      title: family.title, parentRevisionId: parent.id, inputRevisionIds: parent.inputRevisionIds,
      content, format: parent.payload.format, summary: clean(options.summary, '用户修改版本')
    });
    await appendEvent(targetPath, options.runId, 'guided_artifact_revised', family.nodeId, { artifactId: family.id, revisionId: result.revision.id });
    return { ok: true, artifact: result };
  }

  async function approveNode(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    const details = await getRun(options.dataRoot, options.projectId, options.runId);
    const nodeId = clean(options.nodeId, details.run.activeNodeId);
    const artifacts = details.run.artifacts.filter((artifact) => artifact.nodeId === nodeId);
    if (!artifacts.length) throw new Error(`guided node has no artifact to approve: ${nodeId}`);
    const requestedDirectionIds = Array.isArray(options.selectedDirectionIds)
      ? [...new Set(options.selectedDirectionIds.map(clean).filter(Boolean))] : [];
    for (const artifact of artifacts) {
      if (artifact.revision.reviewState === 'approved') continue;
      let content = artifact.content;
      if (nodeId === 'direction' && content && Array.isArray(content.directions)) {
        const available = new Set(content.directions.map((direction) => clean(direction.id)).filter(Boolean));
        const selectedDirectionIds = requestedDirectionIds.filter((directionId) => available.has(directionId));
        if (!selectedDirectionIds.length) throw new Error('guided direction approval requires at least one valid selected direction');
        content = { ...content, selectedDirectionIds };
      }
      await writeArtifact(targetPath, {
        ...options, nodeId, artifactId: artifact.id, artifactType: artifact.artifactType, title: artifact.title,
        parentRevisionId: artifact.revision.id, inputRevisionIds: artifact.revision.inputRevisionIds,
        content, format: artifact.revision.payload.format, summary: artifact.revision.summary,
        reviewState: 'approved', approvedAt: new Date().toISOString()
      });
    }
    await setNodeState(targetPath, options.runId, nodeId, 'completed', true);
    await appendEvent(targetPath, options.runId, 'guided_node_approved', nodeId, { artifactCount: artifacts.length, selectedDirectionIds: nodeId === 'direction' ? requestedDirectionIds : undefined });
    return getRun(options.dataRoot, options.projectId, options.runId);
  }

  async function completeTransfer(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    const details = await getRun(options.dataRoot, options.projectId, options.runId);
    if (details.run.activeNodeId !== spec.transferNodeId) return details;
    await setNodeState(targetPath, options.runId, spec.transferNodeId, 'completed', true);
    await appendEvent(targetPath, options.runId, 'guided_transfer_completed', spec.transferNodeId, { applicationId: clean(options.applicationId) });
    return getRun(options.dataRoot, options.projectId, options.runId);
  }

  async function cancelRun(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    const current = await runStore.readWorkflowV2RunState(targetPath, options.runId);
    if (!current) throw new Error(`${spec.templateId} guided run not found`);
    const states = (current.nodeStates || []).map((state) => ['completed', 'skipped'].includes(state.executionState) ? state : { ...state, executionState: 'cancelled' });
    await runStore.writeWorkflowV2RunState(targetPath, options.runId, { status: 'cancelled', activeNodeId: '', nodeStates: states, finishedAt: new Date().toISOString() }, { expectedRevision: current.revision });
    await appendEvent(targetPath, options.runId, 'guided_run_cancelled', current.activeNodeId, { reason: clean(options.reason) });
    return getRun(options.dataRoot, options.projectId, options.runId);
  }

  async function restartFromNode(options = {}) {
    const targetPath = projectPath(options.dataRoot, options.projectId);
    await getRun(options.dataRoot, options.projectId, options.runId);
    const nodeId = clean(options.nodeId);
    const index = stages.findIndex((stage) => stage.id === nodeId);
    if (index < 0) throw new Error(`unknown guided node: ${nodeId}`);
    const stage = stages[index];
    if (index === 0 || nodeId === spec.transferNodeId || ['writer.snapshot', 'creation.brief'].includes(stage.capabilityId)) throw new Error(`guided node cannot be restarted: ${nodeId}`);
    const current = await runStore.readWorkflowV2RunState(targetPath, options.runId);
    const nodeStates = (current.nodeStates || []).map((state) => {
      const stateIndex = stages.findIndex((item) => item.id === state.nodeId);
      if (stateIndex < index) return state;
      return { ...state, executionState: stateIndex === index ? 'ready' : 'pending', error: null, activeChunkId: '', finishedAt: '' };
    });
    await runStore.writeWorkflowV2RunState(targetPath, options.runId, { status: 'in_progress', activeNodeId: nodeId, nodeStates, finishedAt: '' }, { expectedRevision: current.revision });
    await appendEvent(targetPath, options.runId, 'guided_nodes_invalidated', nodeId, { reason: clean(options.reason, '用户请求重新运行'), invalidatedNodeIds: stages.slice(index).map((item) => item.id) });
    return getRun(options.dataRoot, options.projectId, options.runId);
  }

  return { projectPath, appendEvent, artifactRecords, getRun, setNodeState, writeArtifact, completeOutputs, reviseArtifact, approveNode, completeTransfer, cancelRun, restartFromNode, parseJson };
}

module.exports = { createGuidedRuntime, parseJson };
