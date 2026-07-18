const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const ProviderStream = require('../src/core/generation/provider-stream');
const projectService = require('../desktop/services/project-service');
const Guided = require('../desktop/services/workflow-guided-service');
const Transfer = require('../desktop/services/workflow-transfer-service');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'f09-real-provider-acceptance-20260715';
const PRICE_USD_PER_MILLION = {
  'deepseek-v4-flash': { hit: 0.0028, miss: 0.14, output: 0.28 },
  'deepseek-v4-pro': { hit: 0.003625, miss: 0.435, output: 0.87 }
};

function cleanJson(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(value); } catch (_) {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw _;
  }
}

function tokenUsage(raw = {}) {
  const input = Number(raw.prompt_tokens || raw.input_tokens || 0);
  const output = Number(raw.completion_tokens || raw.output_tokens || 0);
  const hit = Number(raw.prompt_cache_hit_tokens || raw.prompt_tokens_details && raw.prompt_tokens_details.cached_tokens || 0);
  const miss = Number(raw.prompt_cache_miss_tokens || Math.max(0, input - hit));
  return { input, output, hit, miss, total: Number(raw.total_tokens || input + output) };
}

function estimatedCost(model, usage) {
  const price = PRICE_USD_PER_MILLION[model];
  if (!price) return 0;
  return (usage.hit * price.hit + usage.miss * price.miss + usage.output * price.output) / 1_000_000;
}

function prompt(messages) {
  return { messages, asString() { return messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'); } };
}

async function generate(label, promptInput, config, metrics) {
  const started = Date.now();
  let text = '';
  let reasoningChars = 0;
  let usage = null;
  await ProviderStream.streamGeneration(promptInput, (token, meta) => {
    if (meta && meta.type === 'usage') usage = tokenUsage(meta.usage);
    else if (meta && meta.type === 'reasoning') reasoningChars += String(token || '').length;
    else text += String(token || '');
  }, { ...config, includeUsage: true });
  const durationMs = Date.now() - started;
  if (!usage) {
    const serialized = promptInput.asString ? promptInput.asString() : JSON.stringify(promptInput);
    usage = { input: Math.ceil(serialized.length / 2), output: Math.ceil(text.length / 2), hit: 0, miss: Math.ceil(serialized.length / 2), total: Math.ceil((serialized.length + text.length) / 2), estimated: true };
  }
  const record = {
    label,
    model: config.model,
    thinking: config.enableThinking === true,
    durationMs,
    outputCharacters: text.length,
    reasoningCharacters: reasoningChars,
    usage,
    estimatedCostUsd: estimatedCost(config.model, usage)
  };
  metrics.calls.push(record);
  console.log(`[provider] ${label} | ${config.model} | ${(durationMs / 1000).toFixed(1)}s | ${text.length} chars | ${usage.total} tokens`);
  return text;
}

function totals(calls) {
  const result = {};
  for (const call of calls) {
    const item = result[call.model] || { calls: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, costUsd: 0 };
    item.calls += 1;
    item.durationMs += call.durationMs;
    item.inputTokens += call.usage.input;
    item.outputTokens += call.usage.output;
    item.cacheHitTokens += call.usage.hit;
    item.cacheMissTokens += call.usage.miss;
    item.costUsd += call.estimatedCostUsd;
    result[call.model] = item;
  }
  return result;
}

async function acceptanceProjectState() {
  try {
    const opened = await projectService.openProject(DATA_ROOT, PROJECT_ID);
    const isOurEmptyShell = String(opened.project.title || '').startsWith('F-09真实验收')
      && (opened.project.scenes || []).every((scene) => !String(scene.content || '').trim());
    if (!isOurEmptyShell) throw new Error(`acceptance project already exists with content: ${PROJECT_ID}`);
    return opened.project;
  } catch (error) {
    if (error.message && error.message.includes('with content')) throw error;
    return null;
  }
}

(async () => {
  const existingAcceptanceProject = await acceptanceProjectState();
  const settings = await settingsService.readSettings(DATA_ROOT);
  const pro = settingsService.runtimeProviderConfig(settings, { model: 'deepseek-v4-pro', temperature: 0.75, maxTokens: 6000, useProviderDefaults: false });
  const flashProfile = (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-flash');
  if (!pro.apiKey || !pro.endpoint) throw new Error('DeepSeek V4 Pro provider is not configured');
  if (!flashProfile) throw new Error('DeepSeek V4 Flash provider profile is not configured');
  const flash = settingsService.runtimeProviderConfig(settings, { profileId: flashProfile.id, model: 'deepseek-v4-flash', temperature: 0.35, maxTokens: 2200, useProviderDefaults: false });
  const metrics = { schemaVersion: 1, startedAt: new Date().toISOString(), projectId: PROJECT_ID, calls: [], quality: {}, workflow: {} };

  const bibleText = await generate('corpus-bible', prompt([
    { role: 'system', content: '你是资深悬疑长篇策划。设计一部原创近未来海港悬疑小说，用于真实写作工作流压力测试。只返回合法 JSON，内容紧凑。' },
    { role: 'user', content: '返回 title、premise、style、characters（恰好5人，含 name/role/goal/secret/voice/currentState）、worldFacts（恰好8条）、mystery、forbiddenRevelation。不要返回场景计划。事实必须可追踪，核心谜底在两章内不得揭晓。' }
  ]), { ...pro, enableThinking: false, maxTokens: 3600 }, metrics);
  const bibleBase = cleanJson(bibleText);
  const plansText = await generate('corpus-scene-plans', prompt([
    { role: 'system', content: '你是长篇悬疑小说分场编辑。只返回合法 JSON：{"scenePlans":[]}，不要解释。' },
    { role: 'user', content: JSON.stringify({ bible: bibleBase, requirement: '生成恰好8个场景，两章各4场。每项只含 id、chapterIndex(0或1)、title、povCharacter、location、goal、conflict、outcome、emotionalBeat。伏笔跨场景延续，第二章结尾仍不揭晓真正幕后者。' }) }
  ]), { ...pro, enableThinking: false, maxTokens: 3600 }, metrics);
  const bible = { ...bibleBase, ...cleanJson(plansText) };
  if (!Array.isArray(bible.scenePlans) || bible.scenePlans.length !== 8) throw new Error('corpus bible did not contain 8 scene plans');

  const chapters = [
    { id: 'acceptance-chapter-1', title: '第一章 · 潮痕失踪案', summary: '海雾封港期间，调查员追查一宗与潮汐档案有关的失踪案。', order: 0 },
    { id: 'acceptance-chapter-2', title: '第二章 · 沉钟航线', summary: '调查深入废弃潮位站，旧线索开始互相冲突。', order: 1 }
  ];
  const sceneInputs = bible.scenePlans.map((scene, index) => ({
    id: cleanJson(JSON.stringify({ id: scene.id })).id || `acceptance-scene-${index + 1}`,
    chapterId: chapters[Math.min(1, Math.max(0, Number(scene.chapterIndex) || 0))].id,
    title: scene.title || `场景 ${index + 1}`,
    summary: '', content: '', order: index % 4
  }));
  const baseProject = existingAcceptanceProject || (await projectService.createProject(DATA_ROOT, {
    id: PROJECT_ID, title: `F-09真实验收 · ${bible.title || '潮汐档案'}`
  })).project;
  await projectService.saveProject(DATA_ROOT, {
    ...baseProject,
    title: `F-09真实验收 · ${bible.title || '潮汐档案'}`,
    description: '由 DeepSeek V4 Pro/Flash 生成并用于半自动长篇工作流真实 Provider 验收的隔离项目。',
    tags: ['F-09', 'real-provider-acceptance', 'deepseek-v4'],
    chapters,
    scenes: sceneInputs,
    currentSceneId: sceneInputs[0].id,
    compendium: (bible.characters || []).map((character, index) => ({
      id: `acceptance-character-${index + 1}`, type: 'character', title: character.name,
      summary: `${character.role || ''}；目标：${character.goal || ''}`,
      body: `秘密：${character.secret || ''}\n说话风格：${character.voice || ''}`,
      characterProfile: { role: character.role || '', goal: character.goal || '', voice: character.voice || '', currentState: character.currentState || '' }
    }))
  });

  const summaries = [];
  for (let index = 0; index < bible.scenePlans.length; index += 1) {
    const planItem = bible.scenePlans[index];
    const sceneText = await generate(`corpus-scene-${index + 1}`, prompt([
      { role: 'system', content: '你是中文悬疑长篇作者。只输出小说正文，不输出标题、解释或大纲。目标 2200–3000 个中文字符，细节充分，人物声音稳定，结尾留下自然推进力。' },
      { role: 'user', content: JSON.stringify({ bible, completedSceneSummaries: summaries, currentScene: planItem, hardConstraints: ['不得揭晓真正幕后者', '不得改变已建立人物姓名、职业和核心动机', '新事实必须能由现场观察、对话或记录支持'] }) }
    ]), { ...flash, enableThinking: false, temperature: 0.75, maxTokens: 4200 }, metrics);
    const summaryText = await generate(`corpus-summary-${index + 1}`, prompt([
      { role: 'system', content: '你是长篇连续性编辑。只返回合法 JSON：summary、newFacts、characterStates、unresolvedClues。摘要控制在300字内。' },
      { role: 'user', content: sceneText }
    ]), { ...flash, enableThinking: false, maxTokens: 1000 }, metrics);
    const summary = cleanJson(summaryText);
    summaries.push(summary);
    const opened = await projectService.openProject(DATA_ROOT, PROJECT_ID);
    await projectService.saveProject(DATA_ROOT, {
      ...opened.project,
      scenes: opened.project.scenes.map((scene) => scene.id === sceneInputs[index].id
        ? { ...scene, content: sceneText, summary: String(summary.summary || '').slice(0, 500) }
        : scene)
    });
  }

  const runId = 'real-provider-guided-run';
  await Guided.startGuidedContinuation({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId,
    title: '真实 Provider 续写验收',
    scope: 'chapter',
    chapterId: 'acceptance-chapter-2',
    brief: '续写一章海港悬疑故事，强化主人公对记录真实性的怀疑；推进潮汐档案线索，但不揭晓真正幕后保管者。每场约1800–2600中文字符。',
    fineOutlineEnabled: true,
    constraints: [
      { id: 'direction-doubt', kind: 'direction', text: '强化主人公对记录真实性的怀疑', enforcement: 'soft', weight: 1.4 },
      { id: 'exclude-culprit', kind: 'exclusion', text: '真正幕后保管者是', enforcement: 'hard', weight: 2 }
    ]
  });

  async function runJsonStage(nodeId, config, thinking, selectedDirectionIds = []) {
    const prepared = await Guided.prepareGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId, selectedDirectionIds });
    const output = await generate(`workflow-${nodeId}`, prepared.prompts[0].prompt, { ...config, enableThinking: thinking }, metrics);
    await Guided.completeGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId, outputs: [output] });
    await Guided.approveGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId });
    return cleanJson(output);
  }

  const analysis = await runJsonStage('analysis', { ...flash, maxTokens: 3500 }, false);
  const directions = await runJsonStage('direction', { ...pro, maxTokens: 5000 }, true);
  const selectedDirectionIds = (directions.directions || []).slice(0, 1).map((direction) => direction.id);
  const plan = await runJsonStage('plan', { ...pro, maxTokens: 5500 }, true, selectedDirectionIds);
  const preparedDraft = await Guided.prepareGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId: 'draft' });
  const draftOutputs = [];
  for (let index = 0; index < preparedDraft.prompts.length; index += 1) {
    draftOutputs.push(await generate(`workflow-draft-${index + 1}`, preparedDraft.prompts[index].prompt, { ...pro, enableThinking: false, maxTokens: 4800 }, metrics));
  }
  await Guided.completeGuidedNode({
    dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId: 'draft', outputs: draftOutputs,
    outputTitles: preparedDraft.prompts.map((item) => item.title)
  });
  await Guided.approveGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId: 'draft' });
  let details = await Guided.completeGuidedNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, nodeId: 'review' });
  const review = details.run.artifacts.find((artifact) => artifact.nodeId === 'review').content;

  const flashComparison = await generate('comparison-flash-draft', preparedDraft.prompts[0].prompt, { ...flash, enableThinking: false, maxTokens: 4800 }, metrics);
  const judgeText = await generate('quality-judge', prompt([
    { role: 'system', content: '你是苛刻的中文长篇编辑。对两个匿名续写版本进行盲评，只返回合法 JSON。' },
    { role: 'user', content: JSON.stringify({
      sourceProject: { bible, recentSummaries: summaries.slice(-4) },
      scenePlan: plan.scenes && plan.scenes[0],
      versionA: draftOutputs[0],
      versionB: flashComparison,
      rubric: '分别对连续性、人物一致性、情节推进、悬念控制、文风、可读性按10分制评分；给出 winner(A/B/tie)、criticalIssues、verdict。不得因篇幅长自动给高分。'
    }) }
  ]), { ...pro, enableThinking: true, maxTokens: 3500 }, metrics);
  const judge = cleanJson(judgeText);

  const draftArtifacts = details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft' && artifact.revision.reviewState === 'approved');
  const targetChapterId = 'acceptance-generated-chapter';
  const transferScenes = draftArtifacts.map((artifact, index) => ({
    sceneId: `${targetChapterId}-scene-${index + 1}`,
    chapterId: targetChapterId,
    chapterTitle: '第三章 · 真实工作流续写',
    title: artifact.title,
    summary: artifact.revision.summary,
    source: { runId, artifactId: artifact.id, revisionId: artifact.revision.id }
  }));
  const applied = await Transfer.applyWriterTransfer({
    dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, applicationId: 'real-provider-writer-transfer', scenes: transferScenes
  });
  if (!applied.ok) throw new Error(`writer transfer failed: ${applied.error && applied.error.message}`);

  const analysisArtifact = details.run.artifacts.find((artifact) => artifact.nodeId === 'analysis' && artifact.revision.reviewState === 'approved');
  const candidates = Array.isArray(analysis.characterCandidates) ? analysis.characterCandidates.map((draft, index) => ({
    id: `real-provider-card-${index + 1}`, draft,
    source: { runId, artifactId: analysisArtifact.id, revisionId: analysisArtifact.revision.id }
  })) : [];
  let suggestionCount = 0;
  if (candidates.length) {
    const preview = await Transfer.previewCompendiumSuggestions({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, candidates });
    suggestionCount = preview.suggestions.length;
    if (suggestionCount) await Transfer.applyConfirmedCompendiumSuggestions({
      dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, applicationId: 'real-provider-compendium-transfer', candidates,
      confirmedSuggestionIds: preview.suggestions.map((suggestion) => suggestion.id)
    });
  }

  details = await Guided.completeGuidedTransfer({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId, applicationId: 'real-provider-writer-transfer' });
  const finalProject = await projectService.openProject(DATA_ROOT, PROJECT_ID);
  const originalScenes = finalProject.project.scenes.filter((scene) => scene.chapterId !== targetChapterId);
  const generatedScenes = finalProject.project.scenes.filter((scene) => scene.chapterId === targetChapterId);
  metrics.finishedAt = new Date().toISOString();
  metrics.models = totals(metrics.calls);
  metrics.totalCostUsd = Object.values(metrics.models).reduce((sum, item) => sum + item.costUsd, 0);
  metrics.corpus = {
    title: finalProject.project.title,
    originalScenes: originalScenes.length,
    originalCharacters: originalScenes.reduce((sum, scene) => sum + String(scene.content || '').length, 0)
  };
  metrics.workflow = {
    runId,
    directionCount: Array.isArray(directions.directions) ? directions.directions.length : 0,
    plannedScenes: Array.isArray(plan.scenes) ? plan.scenes.length : 0,
    generatedScenes: generatedScenes.length,
    generatedCharacters: generatedScenes.reduce((sum, scene) => sum + String(scene.content || '').length, 0),
    review,
    suggestionCount,
    finalStatus: details.run.status
  };
  metrics.quality = { judge, flashComparisonCharacters: flashComparison.length, proComparisonCharacters: draftOutputs[0].length };
  const metricsPath = path.join(DATA_ROOT, '.ai_state', 'f09-real-provider-acceptance-20260715.json');
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });
  await fs.writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`ACCEPTANCE_RESULT ${JSON.stringify({ projectId: PROJECT_ID, metricsPath, corpus: metrics.corpus, workflow: metrics.workflow, quality: metrics.quality, models: metrics.models, totalCostUsd: metrics.totalCostUsd })}`);
})().catch((error) => {
  console.error('REAL_PROVIDER_ACCEPTANCE_FAILED', error && error.stack ? error.stack : error);
  process.exit(1);
});
