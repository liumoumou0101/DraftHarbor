const artifactStore = require('../storage/workflow-artifact-store');
const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const AITaskContract = require('../../src/core/generation/ai-task-contract');

function clean(value, fallback = '') { return String(value || fallback || '').trim(); }
function key(value) { return clean(value).toLocaleLowerCase('zh-CN'); }

function summarizeText(text, limit = 180) {
  const value = clean(text).replace(/\s+/g, ' ');
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function buildHierarchicalSummary(snapshot) {
  const scenes = (snapshot && snapshot.content || []).map((item) => ({
    sceneId: clean(item.sceneId), chapterId: clean(item.chapterId), title: clean(item.title), summary: summarizeText(item.content)
  }));
  const chapters = new Map();
  for (const scene of scenes) {
    if (!chapters.has(scene.chapterId)) chapters.set(scene.chapterId, { chapterId: scene.chapterId, sceneIds: [], summary: '' });
    const chapter = chapters.get(scene.chapterId);
    chapter.sceneIds.push(scene.sceneId);
    chapter.summary = summarizeText(`${chapter.summary} ${scene.title}：${scene.summary}`, 360);
  }
  return { schemaVersion: 1, kind: 'hierarchical-summary', scenes, chapters: [...chapters.values()], projectSummary: summarizeText(scenes.map((scene) => `${scene.title}：${scene.summary}`).join('\n'), 800) };
}

function classifyCardCandidates(drafts, existingEntries) {
  const existing = Array.isArray(existingEntries) ? existingEntries : [];
  return (Array.isArray(drafts) ? drafts : []).map((draft, index) => {
    const names = new Set([key(draft.title), ...(draft.aliases || []).map(key)].filter(Boolean));
    const match = existing.find((entry) => [entry.title, ...(entry.aliases || [])].map(key).some((name) => names.has(name)));
    return { id: clean(draft.id, `candidate-${index + 1}`), draft: { ...draft, title: clean(draft.title) }, disposition: match ? 'update_suggestion' : 'create_suggestion', matchedEntryId: match ? match.id : '' };
  }).filter((candidate) => candidate.draft.title);
}

async function writeAnalysisArtifact(projectPath, runId, input = {}) {
  const artifact = await artifactStore.writeArtifactRevision(projectPath, runId, {
    id: clean(input.artifactId), projectId: clean(input.projectId), runId, nodeId: clean(input.nodeId, 'analysis'), artifactType: clean(input.artifactType, 'workflow-analysis@1'), title: clean(input.title, '工作流分析草稿')
  }, { id: clean(input.revisionId), summary: clean(input.summary), payload: { format: 'json' } }, input.content);
  return artifact;
}

function parseAnalysisJson(text) {
  const raw = clean(text).replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('analysis result must be a JSON object');
  return value;
}

async function runAnalysisTask(options = {}) {
  const runner = options.runner || AITaskRunner.createAITaskRunner({ streamGeneration: options.streamGeneration });
  const task = AITaskContract.createAITask({
    id: options.taskId, projectId: options.projectId, domain: 'workflow', action: 'extract',
    target: { type: 'workflow-node', id: options.nodeId || 'analysis' }, scope: 'project',
    capabilityId: options.capabilityId || 'analysis.extract', outputArtifactType: options.artifactType || 'workflow-analysis@1', outputContract: 'text'
  });
  const result = await runner.run(task, { prompt: options.prompt || { messages: [] }, providerConfig: options.providerConfig, streamGeneration: options.streamGeneration });
  if (!result.ok) return result;
  const content = parseAnalysisJson(result.output);
  const artifact = await writeAnalysisArtifact(options.projectPath, options.runId, { ...options, content });
  return { ok: true, task: result.task, content, artifact };
}

module.exports = { buildHierarchicalSummary, classifyCardCandidates, writeAnalysisArtifact, parseAnalysisJson, runAnalysisTask };
