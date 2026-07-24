const fs = require('fs/promises');
const path = require('path');
const settingsService = require('../desktop/services/settings-service');
const ProviderStream = require('../src/core/generation/provider-stream');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const Rewrite = require('../desktop/services/workflow-rewrite-guided-service');
const Transfer = require('../desktop/services/workflow-transfer-service');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = process.env.WORKFLOW_REAL_PROJECT_ID || 'f093-real-provider-acceptance-20260715';
const CREATION_RUN = 'f093-real-creation';
const REWRITE_RUN = 'f093-real-rewrite';
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', 'f093-real-provider-acceptance-20260715.json');
const PRICES = {
  'deepseek-v4-flash': { hit: 0.0028, miss: 0.14, output: 0.28 },
  'deepseek-v4-pro': { hit: 0.003625, miss: 0.435, output: 0.87 }
};

function parseJson(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(value); } catch (_) {
    const start = value.indexOf('{'); const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw _;
  }
}
function usage(raw = {}, promptChars = 0, outputChars = 0) {
  const input = Number(raw.prompt_tokens || raw.input_tokens || Math.ceil(promptChars / 2));
  const output = Number(raw.completion_tokens || raw.output_tokens || Math.ceil(outputChars / 2));
  const hit = Number(raw.prompt_cache_hit_tokens || raw.prompt_tokens_details?.cached_tokens || 0);
  const miss = Number(raw.prompt_cache_miss_tokens || Math.max(0, input - hit));
  return { input, output, hit, miss, total: Number(raw.total_tokens || input + output) };
}
function cost(model, value) {
  const price = PRICES[model];
  return price ? (value.hit * price.hit + value.miss * price.miss + value.output * price.output) / 1_000_000 : 0;
}
function promptChars(prompt) { return JSON.stringify(prompt || {}).length; }
async function generate(label, prompt, config, calls) {
  const started = Date.now(); let output = ''; let reasoningCharacters = 0; let rawUsage = null;
  await ProviderStream.streamGeneration(prompt, (token, meta) => {
    if (meta?.type === 'usage') rawUsage = meta.usage;
    else if (meta?.type === 'reasoning') reasoningCharacters += String(token || '').length;
    else output += String(token || '');
  }, { ...config, includeUsage: true });
  const value = usage(rawUsage, promptChars(prompt), output.length);
  const record = { label, model: config.model, durationMs: Date.now() - started, outputCharacters: output.length, reasoningCharacters, usage: value, costUsd: cost(config.model, value) };
  calls.push(record);
  console.log(`[provider] ${label} | ${record.model} | ${(record.durationMs / 1000).toFixed(1)}s | ${record.outputCharacters} chars | ${value.total} tokens | $${record.costUsd.toFixed(6)}`);
  return output;
}
function aggregate(calls) {
  const models = {};
  for (const call of calls) {
    const item = models[call.model] || { calls: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    item.calls += 1; item.durationMs += call.durationMs; item.inputTokens += call.usage.input; item.outputTokens += call.usage.output; item.costUsd += call.costUsd; models[call.model] = item;
  }
  return models;
}
async function requireFreshProject() {
  try { await projectService.openProject(DATA_ROOT, PROJECT_ID); throw new Error(`acceptance project already exists: ${PROJECT_ID}`); }
  catch (error) { if (error.message?.includes('already exists')) throw error; }
}

(async () => {
  await requireFreshProject();
  const settings = await settingsService.readSettings(DATA_ROOT);
  const flashProfile = (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-flash');
  const pro = settingsService.runtimeProviderConfig(settings, { model: 'deepseek-v4-pro', temperature: 0.72, maxTokens: 5000, useProviderDefaults: false });
  const flash = settingsService.runtimeProviderConfig(settings, { profileId: flashProfile?.id, model: 'deepseek-v4-flash', temperature: 0.45, maxTokens: 3500, useProviderDefaults: false });
  if (!pro.apiKey || !flash.apiKey) throw new Error('DeepSeek V4 Pro/Flash provider is not configured');
  const metrics = { schemaVersion: 1, projectId: PROJECT_ID, startedAt: new Date().toISOString(), calls: [], creation: {}, rewrite: {}, quality: {} };
  await projectService.createProject(DATA_ROOT, { id: PROJECT_ID, title: 'F-09.3真实验收 · 雾港回声' });

  const brief = {
    title: '雾港回声', premise: '记忆修复师在封港前夜收到一段由未来的自己寄来的遇害记忆，她必须在潮位淹没旧城区前查明记忆为何被伪造。',
    genre: '近未来悬疑', targetWords: 180000, themes: ['身份', '记忆所有权', '信任'], tone: '冷峻、克制、持续压迫', pov: '第三人称限知',
    setting: '每逢大潮便淹没旧城区的近未来海港；记忆可被提取、修复和作为证据交易。', notes: '首批场景计划必须恰好两场，每场目标2500至3500中文字符；不得在两场内揭晓最终幕后者。'
  };
  await Creation.startGuidedCreation({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, title: '真实 Provider 从零创作', brief, constraints: [{ kind: 'exclusion', text: '不得用梦境或精神失常解释全部谜团', enforcement: 'hard', weight: 5 }] });
  async function creationJson(nodeId, config) {
    const prepared = await Creation.prepareCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId });
    const output = await generate(`creation-${nodeId}`, prepared.prompts[0].prompt, config, metrics.calls);
    let parsed = parseJson(output);
    if (nodeId === 'plan' && Array.isArray(parsed.scenes)) parsed = { ...parsed, scenes: parsed.scenes.slice(0, 2) };
    await Creation.completeCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId, outputs: [JSON.stringify(parsed)] });
    await Creation.approveCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId, selectedDirectionIds: nodeId === 'direction' ? [parsed.directions[0].id] : undefined });
    return parsed;
  }
  const directions = await creationJson('direction', { ...flash, maxTokens: 2800 });
  const blueprint = await creationJson('blueprint', { ...pro, maxTokens: 4200, enableThinking: true });
  const compendium = await creationJson('compendium', { ...flash, maxTokens: 3500 });
  const plan = await creationJson('plan', { ...pro, maxTokens: 4200, enableThinking: true });
  if (plan.scenes.length !== 2) throw new Error('creation acceptance requires two planned scenes');
  const preparedDraft = await Creation.prepareCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId: 'draft' });
  const creationDrafts = [];
  for (let index = 0; index < preparedDraft.prompts.length; index += 1) creationDrafts.push(await generate(`creation-draft-${index + 1}`, preparedDraft.prompts[index].prompt, { ...pro, maxTokens: 5000 }, metrics.calls));
  await Creation.completeCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId: 'draft', outputs: creationDrafts, outputTitles: preparedDraft.prompts.map((item) => item.title) });
  await Creation.approveCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId: 'draft' });
  const creationReviewPrepared = await Creation.prepareCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId: 'review' });
  const creationReviewOutput = await generate('creation-review', creationReviewPrepared.prompts[0].prompt, { ...flash, maxTokens: 2200 }, metrics.calls);
  let creationDetails = await Creation.completeCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, nodeId: 'review', outputs: [creationReviewOutput] });
  const creationArtifacts = creationDetails.run.artifacts.filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
  const chapterId = 'f093-created-chapter';
  const creationScenes = creationArtifacts.map((artifact, index) => ({ sceneId: `${chapterId}-scene-${index + 1}`, chapterId, chapterTitle: '第一章 · 未来寄来的死讯', title: artifact.title, source: { runId: CREATION_RUN, artifactId: artifact.id, revisionId: artifact.revision.id } }));
  await Transfer.applyWriterTransfer({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, applicationId: 'f093-creation-transfer', scenes: creationScenes });
  await Creation.completeCreationTransfer({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: CREATION_RUN, applicationId: 'f093-creation-transfer' });

  await Rewrite.startGuidedRewrite({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, title: '真实 Provider 大段重写', scope: 'chapter', chapterId, brief: { instruction: '保持所有关键事实和人物动机，将两场正文重写得更紧凑、更具感官压力；强化第一场结尾到第二场开头的因果衔接。', targetStyle: '冷峻克制', targetTone: '逼仄、紧张', targetLengthRatio: 0.9 } });
  const rewritePlanPrepared = await Rewrite.prepareRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'plan' });
  const rewritePlanOutput = await generate('rewrite-plan', rewritePlanPrepared.prompts[0].prompt, { ...flash, maxTokens: 3000 }, metrics.calls);
  const rewritePlan = parseJson(rewritePlanOutput);
  await Rewrite.completeRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'plan', outputs: [JSON.stringify(rewritePlan)] });
  await Rewrite.approveRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'plan' });
  const rewritePrepared = await Rewrite.prepareRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'rewrite' });
  const rewriteDrafts = [];
  for (let index = 0; index < rewritePrepared.prompts.length; index += 1) rewriteDrafts.push(await generate(`rewrite-draft-${index + 1}`, rewritePrepared.prompts[index].prompt, { ...pro, maxTokens: 5000 }, metrics.calls));
  await Rewrite.completeRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'rewrite', outputs: rewriteDrafts, outputTitles: rewritePrepared.prompts.map((item) => item.title) });
  await Rewrite.approveRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'rewrite' });
  const repairPrepared = await Rewrite.prepareRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'repair' });
  const repaired = [];
  for (let index = 0; index < repairPrepared.prompts.length; index += 1) repaired.push(await generate(`rewrite-repair-${index + 1}`, repairPrepared.prompts[index].prompt, { ...flash, maxTokens: 5000 }, metrics.calls));
  await Rewrite.completeRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'repair', outputs: repaired, outputTitles: repairPrepared.prompts.map((item) => item.title) });
  await Rewrite.approveRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'repair' });
  const rewriteReviewPrepared = await Rewrite.prepareRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'review' });
  const rewriteReviewOutput = await generate('rewrite-review', rewriteReviewPrepared.prompts[0].prompt, { ...flash, maxTokens: 2200 }, metrics.calls);
  const rewriteDetails = await Rewrite.completeRewriteNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: REWRITE_RUN, nodeId: 'review', outputs: [rewriteReviewOutput] });

  const judgePrompt = { messages: [
    { role: 'system', content: '你是苛刻的中文长篇编辑。对从零创作正文和其重写版做盲评，只返回合法 JSON。' },
    { role: 'user', content: JSON.stringify({ brief, blueprint, plan, original: creationDrafts, rewritten: repaired, rubric: '分别评价原创正文的设定兑现、人物动机、悬念、文风、可读性；再评价重写版的事实保留、节奏改善、衔接、语言质量。每项10分。返回 creationScores、rewriteScores、rewriteImproved(boolean)、criticalIssues、verdict。' }) }
  ] };
  const judge = parseJson(await generate('f093-quality-judge', judgePrompt, { ...pro, maxTokens: 3000, enableThinking: true }, metrics.calls));
  const comparison = rewriteDetails.run.artifacts.find((artifact) => artifact.artifactType === 'rewrite-comparison@1').content;
  const creationReview = creationDetails.run.artifacts.find((artifact) => artifact.nodeId === 'review').content;
  const rewriteReview = rewriteDetails.run.artifacts.find((artifact) => artifact.nodeId === 'review').content;
  metrics.finishedAt = new Date().toISOString(); metrics.models = aggregate(metrics.calls); metrics.totalCostUsd = Object.values(metrics.models).reduce((sum, item) => sum + item.costUsd, 0);
  metrics.creation = { directionCount: directions.directions.length, blueprintActs: blueprint.acts.length, compendiumCards: (compendium.cards || compendium.entries || []).length, plannedScenes: plan.scenes.length, generatedCharacters: creationDrafts.reduce((sum, text) => sum + text.length, 0), review: creationReview };
  metrics.rewrite = { units: rewritePlan.units.length, rewrittenCharacters: repaired.reduce((sum, text) => sum + text.length, 0), characterDeltas: comparison.comparisons.map((item) => item.diff.characterDelta), review: rewriteReview };
  metrics.quality = judge;
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true }); await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`F093_ACCEPTANCE_RESULT ${JSON.stringify({ metricsPath: METRICS_PATH, creation: metrics.creation, rewrite: metrics.rewrite, quality: judge, models: metrics.models, totalCostUsd: metrics.totalCostUsd })}`);
})().catch((error) => { console.error('F093_REAL_PROVIDER_FAILED', error && error.stack ? error.stack : error); process.exit(1); });
