const { projectDir } = require('../storage/library-paths');
const workflowStore = require('../storage/workflow-run-store');
const projectStore = require('../storage/project-file-store');
const WorkflowEngine = require('../../src/core/workflow/workflow-engine');
const GenerationHistory = require('../../src/core/generation/generation-history');

async function listRuns(dataRoot, projectId) {
  return {
    ok: true,
    runs: await workflowStore.listWorkflowRuns(projectDir(dataRoot, projectId))
  };
}

async function saveRun(dataRoot, projectId, run) {
  return {
    ok: true,
    run: await workflowStore.upsertWorkflowRun(projectDir(dataRoot, projectId), {
      ...run,
      projectId
    })
  };
}

async function startNovelWorkflow(dataRoot, projectId, input = {}) {
  const project = await projectStore.openProject(dataRoot, projectId);
  const run = WorkflowEngine.createNovelWorkflowRun({
    projectId,
    title: input.title || '半自动小说工作流',
    brief: input.brief || '',
    preRunSnapshot: input.preRunSnapshot || null
  });
  const projectPath = projectDir(dataRoot, projectId);
  const saved = await workflowStore.upsertWorkflowRun(projectPath, run);
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'run_created',
    payload: { title: saved.title, projectTitle: project.title }
  });
  if (saved.preRunSnapshot) {
    await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
      type: 'snapshot_created',
      payload: saved.preRunSnapshot
    });
  }
  return { ok: true, run: saved };
}

async function getRunOrThrow(dataRoot, projectId, runId) {
  const runs = await workflowStore.listWorkflowRuns(projectDir(dataRoot, projectId));
  const run = runs.find((item) => item.id === runId);
  if (!run) throw new Error('Workflow run not found');
  return run;
}

async function prepareStep(dataRoot, projectId, runId, stepId) {
  const project = await projectStore.openProject(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const targetStepId = stepId || run.activeStepId;
  const prompt = WorkflowEngine.buildStepPrompt(run, project, targetStepId);
  await workflowStore.appendWorkflowEvent(projectDir(dataRoot, projectId), run.id, {
    type: 'step_started',
    stepId: targetStepId,
    payload: { promptText: prompt.asString ? prompt.asString() : '' }
  });
  return {
    ok: true,
    run,
    prompt: {
      stepId: prompt.stepId,
      messages: prompt.messages || [],
      promptText: prompt.asString ? prompt.asString() : ''
    }
  };
}

async function completeGenerationStep(dataRoot, projectId, runId, stepId, result = {}) {
  const projectPath = projectDir(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const targetStepId = stepId || run.activeStepId;
  const prompt = result.prompt || { promptText: result.promptText || '', messages: result.messages || [] };
  const nextRun = WorkflowEngine.completeGenerationStep(run, targetStepId, result.text || '', prompt);
  const saved = await workflowStore.upsertWorkflowRun(projectPath, nextRun);
  try {
    const project = await projectStore.openProject(dataRoot, projectId);
    project.promptHistory = Array.isArray(project.promptHistory) ? project.promptHistory : [];
    project.promptHistory.push(GenerationHistory.createGenerationRecord({
      projectId,
      sceneId: project.currentSceneId || '',
      task: `workflow:${targetStepId}`,
      beat: `Workflow step: ${targetStepId}`,
      messages: prompt.messages || result.messages || [],
      promptText: prompt.promptText || result.promptText || '',
      resultText: result.text || ''
    }));
    await projectStore.saveProject(dataRoot, project);
  } catch {
    // Workflow artifacts remain the source of truth if history persistence fails.
  }
  const outputArtifact = WorkflowEngine.latestArtifact(saved, targetStepId === 'chapter-outline' ? 'chapter_outline' : 'draft_text');
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'artifact_created',
    stepId: targetStepId,
    artifactId: outputArtifact ? outputArtifact.id : '',
    payload: { artifactType: outputArtifact ? outputArtifact.type : '' }
  });
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'step_waiting_user',
    stepId: targetStepId,
    payload: {}
  });
  return { ok: true, run: saved };
}

async function approveStep(dataRoot, projectId, runId, stepId) {
  const projectPath = projectDir(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const targetStepId = stepId || run.activeStepId;
  let nextRun = WorkflowEngine.approveStep(run, targetStepId);
  let applyResult = null;

  if (targetStepId === 'user-confirmation') {
    const project = await projectStore.openProject(dataRoot, projectId);
    applyResult = WorkflowEngine.applyApprovedDraft(project, nextRun);
    if (applyResult.applied) {
      await projectStore.saveProject(dataRoot, applyResult.project);
    }
    nextRun = {
      ...nextRun,
      status: 'completed',
      activeStepId: '',
      updatedAt: new Date().toISOString()
    };
  }

  const saved = await workflowStore.upsertWorkflowRun(projectPath, nextRun);
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'user_approved',
    stepId: targetStepId,
    payload: applyResult || {}
  });
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: saved.status === 'completed' ? 'run_completed' : 'step_completed',
    stepId: targetStepId,
    payload: {}
  });
  return { ok: true, run: saved, applyResult };
}

async function rejectStep(dataRoot, projectId, runId, stepId, reason = '') {
  const projectPath = projectDir(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const targetStepId = stepId || run.activeStepId;
  const saved = await workflowStore.upsertWorkflowRun(projectPath, WorkflowEngine.rejectStep(run, targetStepId, reason));
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'user_rejected',
    stepId: targetStepId,
    payload: { reason }
  });
  return { ok: true, run: saved };
}

async function applyArtifact(dataRoot, projectId, runId, artifactId = '') {
  const projectPath = projectDir(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const project = await projectStore.openProject(dataRoot, projectId);
  const applyResult = WorkflowEngine.applyDraftArtifact(project, run, artifactId);
  if (!applyResult.applied) {
    return { ok: false, error: 'No draft artifact can be applied.', run, applyResult };
  }
  await projectStore.saveProject(dataRoot, applyResult.project);
  const now = new Date().toISOString();
  const nextRun = {
    ...run,
    artifacts: (run.artifacts || []).map((artifact) => artifact.id === applyResult.artifactId
      ? {
          ...artifact,
          data: {
            ...(artifact.data || {}),
            appliedAt: now,
            appliedSceneId: applyResult.sceneId
          },
          updatedAt: now
        }
      : artifact),
    updatedAt: now
  };
  const saved = await workflowStore.upsertWorkflowRun(projectPath, nextRun);
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'artifact_applied',
    stepId: '',
    artifactId: applyResult.artifactId,
    payload: { sceneId: applyResult.sceneId }
  });
  return { ok: true, run: saved, applyResult };
}

async function cancelRun(dataRoot, projectId, runId, reason = '') {
  const projectPath = projectDir(dataRoot, projectId);
  const run = await getRunOrThrow(dataRoot, projectId, runId);
  const saved = await workflowStore.upsertWorkflowRun(projectPath, WorkflowEngine.cancelRun(run, reason));
  await workflowStore.appendWorkflowEvent(projectPath, saved.id, {
    type: 'run_cancelled',
    payload: { reason }
  });
  return { ok: true, run: saved };
}

async function appendEvent(dataRoot, projectId, runId, event) {
  return {
    ok: true,
    event: await workflowStore.appendWorkflowEvent(projectDir(dataRoot, projectId), runId, event)
  };
}

async function listEvents(dataRoot, projectId, runId) {
  return {
    ok: true,
    events: await workflowStore.listWorkflowEvents(projectDir(dataRoot, projectId), runId)
  };
}

module.exports = {
  listRuns,
  saveRun,
  startNovelWorkflow,
  prepareStep,
  completeGenerationStep,
  approveStep,
  rejectStep,
  applyArtifact,
  cancelRun,
  appendEvent,
  listEvents
};
