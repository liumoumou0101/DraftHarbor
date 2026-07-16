const crypto = require('crypto');

const WorkflowDefinition = require('../../src/core/workflow/workflow-definition-schema');
const legacyWorkflowStore = require('../storage/workflow-run-store');
const workflowV2Store = require('../storage/workflow-run-store-v2');
const artifactStore = require('../storage/workflow-artifact-store');
const eventStore = require('../storage/workflow-event-store-v2');
const paths = require('../storage/library-paths');

function cleanString(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text.trim();
}

function nowIso(value = '') {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function toNodeExecutionState(status) {
  const map = {
    pending: 'pending',
    ready: 'ready',
    running: 'running',
    in_progress: 'running',
    waiting_user: 'waiting_user',
    completed: 'completed',
    failed: 'failed',
    skipped: 'skipped',
    cancelled: 'cancelled'
  };
  return map[cleanString(status)] || 'pending';
}

function safeToken(value, fallback) {
  const normalized = cleanString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function legacyRunAdapter(run) {
  return {
    ...run,
    storageVersion: 'legacy-0.1',
    compatibilityMode: 'legacy',
    readOnly: false,
    supportsLegacyExecution: true,
    supportsV2Execution: false,
    copyToV2Available: true
  };
}

function v2RunAdapter(summary) {
  const guided = ['continuation-guided', 'creation-guided', 'rewrite-guided'].includes(summary.templateId);
  return {
    id: summary.id,
    projectId: summary.projectId,
    title: summary.title,
    status: summary.status,
    activeStepId: summary.activeNodeId,
    activeNodeId: summary.activeNodeId,
    templateId: summary.templateId,
    templateVersion: summary.templateVersion,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    steps: [],
    artifacts: [],
    storageVersion: 'v2',
    compatibilityMode: guided ? 'v2_guided' : 'v2_read_only',
    readOnly: !guided,
    supportsLegacyExecution: false,
    supportsV2Execution: guided,
    copyToV2Available: false
  };
}

function legacyDefinition(run) {
  const legacySteps = Array.isArray(run.steps) && run.steps.length
    ? run.steps
    : [{ id: 'legacy-placeholder', title: '旧工作流占位步骤', status: run.status }];
  const nodes = legacySteps.map((step, index) => ({
    id: `legacy-step-${safeToken(step.id, String(index + 1))}`,
    capabilityId: 'legacy.placeholder-step',
    capabilityVersion: 1,
    title: cleanString(step.title, `旧步骤 ${index + 1}`),
    config: {
      legacyStepId: cleanString(step.id),
      legacyKind: cleanString(step.kind),
      requiresUserApproval: step.requiresUserApproval !== false
    }
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `legacy-edge-${index + 1}`,
    fromNodeId: nodes[index].id,
    fromPortId: 'next',
    toNodeId: node.id,
    toPortId: 'previous'
  }));
  return WorkflowDefinition.createWorkflowDefinition({
    id: `legacy-template-${safeToken(run.id, 'run')}`,
    templateId: 'legacy-0.1-placeholder-copy',
    templateVersion: 1,
    title: cleanString(run.title, '旧工作流副本'),
    description: '从 0.1 占位工作流复制的只读快照。',
    nodes,
    edges,
    settings: { sourceRunId: cleanString(run.id), sourceStorageVersion: 'legacy-0.1' },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  });
}

function legacyNodeStates(run, definition) {
  const stepsById = new Map((run.steps || []).map((step) => [cleanString(step.id), step]));
  return definition.nodes.map((node) => {
    const legacyStepId = node.config && node.config.legacyStepId;
    const step = stepsById.get(legacyStepId);
    return WorkflowDefinition.createWorkflowNodeState({
      nodeId: node.id,
      executionState: toNodeExecutionState(step ? step.status : run.status),
      updatedAt: step && step.updatedAt ? step.updatedAt : run.updatedAt
    });
  });
}

function legacyArtifactState(artifact, run) {
  const appliedAt = artifact && artifact.data && artifact.data.appliedAt;
  const sourceStep = (run.steps || []).find((step) => step.id === artifact.stepId);
  const approved = !!appliedAt || (sourceStep && sourceStep.status === 'completed');
  return {
    reviewState: approved ? 'approved' : 'draft',
    approvedAt: approved ? nowIso(appliedAt || run.updatedAt || run.createdAt) : '',
    applicationState: appliedAt ? 'applied' : 'unapplied'
  };
}

async function listCompatibleRuns(projectPath) {
  const [legacyRuns, v2Runs] = await Promise.all([
    legacyWorkflowStore.listWorkflowRuns(projectPath),
    workflowV2Store.listWorkflowV2Runs(projectPath)
  ]);
  return [...legacyRuns.map(legacyRunAdapter), ...v2Runs.map(v2RunAdapter)]
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

async function listCompatibleEvents(projectPath, runId) {
  const v2Run = await workflowV2Store.getWorkflowV2RunSummary(projectPath, runId);
  if (!v2Run) return legacyWorkflowStore.listWorkflowEvents(projectPath, runId);
  const events = await eventStore.listWorkflowV2Events(projectPath, runId);
  return events.map((event) => ({ ...event, stepId: event.nodeId }));
}

async function copyLegacyRunToV2(projectPath, projectId, legacyRunId, input = {}) {
  const legacyRuns = await legacyWorkflowStore.listWorkflowRuns(projectPath);
  const legacyRun = legacyRuns.find((run) => run.id === cleanString(legacyRunId));
  if (!legacyRun) throw new Error('Legacy workflow run not found');

  const runId = cleanString(input.targetRunId || input.id)
    || `legacy-copy-${safeToken(legacyRun.id, 'run')}-${crypto.randomUUID().slice(0, 8)}`;
  if (await workflowV2Store.getWorkflowV2RunSummary(projectPath, runId)) {
    throw new Error(`workflow v2 run already exists: ${runId}`);
  }
  const definition = legacyDefinition(legacyRun);
  const created = await workflowV2Store.createWorkflowV2Run(projectPath, {
    id: runId,
    projectId,
    title: cleanString(input.title, `${legacyRun.title || '旧工作流'}（新版副本）`),
    status: legacyRun.status,
    activeNodeId: legacyRun.activeStepId
      ? `legacy-step-${safeToken(legacyRun.activeStepId, 'active')}`
      : '',
    definition,
    state: {
      status: legacyRun.status,
      activeNodeId: legacyRun.activeStepId
        ? `legacy-step-${safeToken(legacyRun.activeStepId, 'active')}`
        : '',
      nodeStates: legacyNodeStates(legacyRun, definition)
    },
    createdAt: input.createdAt || new Date().toISOString()
  });

  for (const [index, artifact] of (legacyRun.artifacts || []).entries()) {
    const artifactToken = safeToken(artifact.id, `artifact-${index + 1}`);
    const artifactId = `legacy-artifact-${artifactToken}`;
    const revisionId = `legacy-revision-${artifactToken}`;
    const type = `legacy-${safeToken(artifact.type, 'artifact')}`;
    const state = legacyArtifactState(artifact, legacyRun);
    await artifactStore.writeArtifactRevision(projectPath, runId, {
      id: artifactId,
      projectId,
      runId,
      nodeId: artifact.stepId ? `legacy-step-${safeToken(artifact.stepId, 'step')}` : 'legacy-step-1',
      artifactType: `${type}@1`,
      title: cleanString(artifact.title, '旧工作流产物'),
      targetRef: {
        legacyRunId: legacyRun.id,
        legacyArtifactId: cleanString(artifact.id)
      }
    }, {
      id: revisionId,
      variantId: 'legacy-copy',
      summary: `来自旧工作流 ${legacyRun.id} 的复制产物。`,
      ...state,
      payload: { format: 'text' },
      createdAt: artifact.createdAt || legacyRun.createdAt,
      updatedAt: artifact.updatedAt || legacyRun.updatedAt
    }, artifact.content === undefined ? '' : String(artifact.content || ''));
  }

  await eventStore.appendWorkflowV2Event(projectPath, runId, {
    id: `legacy-copy-${safeToken(legacyRun.id, 'run')}`,
    type: 'legacy_run_copied',
    payload: { legacyRunId: legacyRun.id, legacyStorageVersion: '0.1-placeholder' },
    createdAt: new Date().toISOString()
  });
  return { ...created, legacyRun: legacyRunAdapter(legacyRun) };
}

function projectPathFor(dataRoot, projectId) {
  return paths.projectDir(dataRoot, projectId);
}

module.exports = {
  legacyRunAdapter,
  v2RunAdapter,
  legacyDefinition,
  listCompatibleRuns,
  listCompatibleEvents,
  copyLegacyRunToV2,
  projectPathFor
};
