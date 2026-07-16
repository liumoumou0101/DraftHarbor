const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const ProviderStream = require('../src/core/generation/provider-stream');
const projectService = require('../desktop/services/project-service');
const Guided = require('../desktop/services/workflow-guided-service');
const Transfer = require('../desktop/services/workflow-transfer-service');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'f09-real-provider-acceptance-20260715';
const RUN_ID = 'real-provider-guided-run';
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', 'f09-real-provider-acceptance-20260715.json');
const PRICES = {
  'deepseek-v4-flash': { hit: 0.0028, miss: 0.14, output: 0.28 },
  'deepseek-v4-pro': { hit: 0.003625, miss: 0.435, output: 0.87 }
};

function parseJson(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(value); } catch (_) {
    return JSON.parse(value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1));
  }
}

function normalizeUsage(raw, promptChars, outputChars) {
  if (!raw) {
    const input = Math.ceil(promptChars / 2);
    const output = Math.ceil(outputChars / 2);
    return { input, output, hit: 0, miss: input, total: input + output, estimated: true };
  }
  const input = Number(raw.prompt_tokens || raw.input_tokens || 0);
  const output = Number(raw.completion_tokens || raw.output_tokens || 0);
  const hit = Number(raw.prompt_cache_hit_tokens || raw.prompt_tokens_details && raw.prompt_tokens_details.cached_tokens || 0);
  const miss = Number(raw.prompt_cache_miss_tokens || Math.max(0, input - hit));
  return { input, output, hit, miss, total: Number(raw.total_tokens || input + output) };
}

function cost(model, usage) {
  const price = PRICES[model];
  return price ? (usage.hit * price.hit + usage.miss * price.miss + usage.output * price.output) / 1_000_000 : 0;
}

function serializedPrompt(value) {
  if (value && typeof value.asString === 'function') return value.asString();
  return JSON.stringify(value || {});
}

async function callProvider(label, prompt, config, calls, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
  const started = Date.now();
  let output = '';
  let reasoningCharacters = 0;
  let rawUsage = null;
  try {
    await ProviderStream.streamGeneration(prompt, (token, meta) => {
      if (meta && meta.type === 'usage') rawUsage = meta.usage;
      else if (meta && meta.type === 'reasoning') reasoningCharacters += String(token || '').length;
      else output += String(token || '');
    }, { ...config, signal: controller.signal, includeUsage: true });
    const durationMs = Date.now() - started;
    const usage = normalizeUsage(rawUsage, serializedPrompt(prompt).length, output.length);
    calls.push({ label, model: config.model, ok: true, durationMs, outputCharacters: output.length, reasoningCharacters, usage, costUsd: cost(config.model, usage) });
    console.log(`[provider] ${label} | ${config.model} | ${(durationMs / 1000).toFixed(1)}s | ${output.length} chars | ${usage.total} tokens`);
    return output;
  } catch (error) {
    const durationMs = Date.now() - started;
    const usage = normalizeUsage(rawUsage, serializedPrompt(prompt).length, output.length);
    calls.push({ label, model: config.model, ok: false, durationMs, outputCharacters: output.length, reasoningCharacters, usage, costUsd: cost(config.model, usage), error: error.message || String(error) });
    console.log(`[provider-failed] ${label} | ${config.model} | ${(durationMs / 1000).toFixed(1)}s | ${error.message || error}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withFallback(label, prompt, primary, fallback, calls, options = {}) {
  try {
    return { output: await callProvider(label, prompt, primary, calls, options.primaryTimeoutMs || 300000), model: primary.model, fallback: false };
  } catch (_) {
    return { output: await callProvider(`${label}-fallback`, prompt, fallback, calls, options.fallbackTimeoutMs || 240000), model: fallback.model, fallback: true };
  }
}

function aggregate(calls) {
  const models = {};
  for (const call of calls) {
    const value = models[call.model] || { calls: 0, failedCalls: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0 };
    value.calls += 1;
    if (!call.ok) value.failedCalls += 1;
    value.durationMs += call.durationMs;
    value.inputTokens += call.usage.input;
    value.outputTokens += call.usage.output;
    value.cacheHitTokens += call.usage.hit;
    value.cacheMissTokens += call.usage.miss;
    value.costUsd += call.costUsd;
    models[call.model] = value;
  }
  return models;
}

(async () => {
  const settings = await settingsService.readSettings(DATA_ROOT);
  const flashProfile = (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-flash');
  const pro = settingsService.runtimeProviderConfig(settings, { model: 'deepseek-v4-pro', temperature: 0.7, maxTokens: 3200, useProviderDefaults: false });
  const flash = settingsService.runtimeProviderConfig(settings, { profileId: flashProfile.id, model: 'deepseek-v4-flash', temperature: 0.5, maxTokens: 3200, useProviderDefaults: false });
  const opened = await projectService.openProject(DATA_ROOT, PROJECT_ID);
  const sourceScenes = opened.project.scenes.filter((scene) => String(scene.content || '').trim());
  const sourceCharacters = sourceScenes.reduce((sum, scene) => sum + String(scene.content || '').length, 0);
  if (sourceScenes.length < 4 || sourceCharacters < 15000) throw new Error('acceptance source corpus is not large enough');
  const sourceChapterId = sourceScenes[0].chapterId;
  const metrics = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    source: { scenes: sourceScenes.length, characters: sourceCharacters, chapterId: sourceChapterId },
    preflightFailures: [
      { model: 'deepseek-v4-pro', mode: 'thinking', durationMs: 138300, totalTokens: 6001, result: 'JSON truncated at output limit' },
      { model: 'deepseek-v4-pro', mode: 'thinking', durationMs: 150000, totalTokens: 6144, result: 'JSON truncated at output limit' },
      { model: 'deepseek-v4-pro', mode: 'non-thinking', durationMs: 600000, totalTokens: null, result: 'long request stalled; manually cancelled after official queue window' }
    ],
    calls: []
  };

  await Guided.startGuidedContinuation({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    title: '真实 Provider 续写验收',
    scope: 'chapter',
    chapterId: sourceChapterId,
    brief: '续写两场海港悬疑正文，每场1800–2600中文字符。强化主人公对记录真实性的怀疑，推进潮汐档案线索，但不揭晓真正幕后者。场景计划必须恰好包含两场。',
    fineOutlineEnabled: true,
    constraints: [
      { id: 'direction-doubt', kind: 'direction', text: '强化主人公对记录真实性的怀疑', enforcement: 'soft', weight: 1.4 },
      { id: 'exclude-culprit', kind: 'exclusion', text: '真正幕后保管者是', enforcement: 'hard', weight: 2 }
    ]
  });

  async function jsonStage(nodeId, primary, fallback, selectedDirectionIds = []) {
    const prepared = await Guided.prepareGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId, selectedDirectionIds });
    const generated = await withFallback(`workflow-${nodeId}`, prepared.prompts[0].prompt, primary, fallback, metrics.calls);
    const parsed = parseJson(generated.output);
    await Guided.completeGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId, outputs: [generated.output] });
    await Guided.approveGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId });
    return { parsed, model: generated.model, fallback: generated.fallback };
  }

  const analysis = await jsonStage('analysis', { ...flash, maxTokens: 3500 }, { ...pro, maxTokens: 3500 });
  const direction = await jsonStage('direction', { ...pro, maxTokens: 2800, enableThinking: false }, { ...flash, maxTokens: 2800 });
  const selectedDirectionIds = (direction.parsed.directions || []).slice(0, 1).map((item) => item.id);
  const plan = await jsonStage('plan', { ...pro, maxTokens: 3000, enableThinking: false }, { ...flash, maxTokens: 3000 }, selectedDirectionIds);
  if (!Array.isArray(plan.parsed.scenes) || plan.parsed.scenes.length !== 2) throw new Error(`real provider plan expected 2 scenes, received ${(plan.parsed.scenes || []).length}`);

  const preparedDraft = await Guided.prepareGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId: 'draft' });
  const proDrafts = [];
  const draftModels = [];
  for (let index = 0; index < preparedDraft.prompts.length; index += 1) {
    const generated = await withFallback(`workflow-draft-${index + 1}`, preparedDraft.prompts[index].prompt, { ...pro, maxTokens: 3800, enableThinking: false }, { ...flash, maxTokens: 3800 }, metrics.calls);
    proDrafts.push(generated.output);
    draftModels.push(generated.model);
  }
  await Guided.completeGuidedNode({
    dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId: 'draft', outputs: proDrafts,
    outputTitles: preparedDraft.prompts.map((item) => item.title)
  });
  await Guided.approveGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId: 'draft' });
  let details = await Guided.completeGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId: 'review' });
  const review = details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content;

  const flashDraft = await callProvider('comparison-flash-draft', preparedDraft.prompts[0].prompt, { ...flash, maxTokens: 3800, enableThinking: false }, metrics.calls, 240000);
  const judgePrompt = { messages: [
    { role: 'system', content: '你是苛刻的中文长篇编辑。对匿名版本A和B进行盲评，只返回合法 JSON。' },
    { role: 'user', content: JSON.stringify({
      sourceExcerpt: sourceScenes.slice(-2).map((scene) => scene.content).join('\n\n'),
      plan: plan.parsed.scenes[0],
      versionA: proDrafts[0],
      versionB: flashDraft,
      rubric: '分别对连续性、人物一致性、情节推进、悬念控制、文风、可读性按10分制评分，返回 scoresA、scoresB、winner(A/B/tie)、criticalIssues、verdict。'
    }) }
  ] };
  const judgeGenerated = await withFallback('quality-judge', judgePrompt, { ...pro, maxTokens: 2200, enableThinking: true }, { ...flash, maxTokens: 2200, enableThinking: true }, metrics.calls);
  const judge = parseJson(judgeGenerated.output);

  const draftArtifacts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
  const targetChapterId = 'acceptance-generated-chapter';
  const transferScenes = draftArtifacts.map((artifact, index) => ({
    sceneId: `${targetChapterId}-scene-${index + 1}`,
    chapterId: targetChapterId,
    chapterTitle: '真实工作流续写章节',
    title: artifact.title,
    summary: artifact.revision.summary,
    source: { runId: RUN_ID, artifactId: artifact.id, revisionId: artifact.revision.id }
  }));
  const applied = await Transfer.applyWriterTransfer({
    dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, applicationId: 'real-provider-writer-transfer', scenes: transferScenes
  });
  if (!applied.ok) throw new Error('real provider writer transfer failed');
  details = await Guided.completeGuidedTransfer({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, applicationId: 'real-provider-writer-transfer' });

  const finalProject = await projectService.openProject(DATA_ROOT, PROJECT_ID);
  const generatedScenes = finalProject.project.scenes.filter((scene) => scene.chapterId === targetChapterId);
  metrics.finishedAt = new Date().toISOString();
  metrics.models = aggregate(metrics.calls);
  metrics.totalCostUsd = Object.values(metrics.models).reduce((sum, model) => sum + model.costUsd, 0);
  metrics.workflow = {
    status: details.run.status,
    analysisModel: analysis.model,
    directionModel: direction.model,
    planModel: plan.model,
    draftModels,
    selectedDirectionIds,
    plannedScenes: plan.parsed.scenes.length,
    generatedScenes: generatedScenes.length,
    generatedCharacters: generatedScenes.reduce((sum, scene) => sum + String(scene.content || '').length, 0),
    review
  };
  metrics.quality = {
    judgeModel: judgeGenerated.model,
    judge,
    versionACharacters: proDrafts[0].length,
    versionBCharacters: flashDraft.length
  };
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`ACCEPTANCE_RESULT ${JSON.stringify({ metricsPath: METRICS_PATH, source: metrics.source, workflow: metrics.workflow, quality: metrics.quality, models: metrics.models, totalCostUsd: metrics.totalCostUsd })}`);
})().catch((error) => {
  console.error('REAL_PROVIDER_RESUME_FAILED', error && error.stack ? error.stack : error);
  process.exit(1);
});
