const fs = require('fs/promises');
const path = require('path');
const settingsService = require('../desktop/services/settings-service');
const ProviderStream = require('../src/core/generation/provider-stream');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const Transfer = require('../desktop/services/workflow-transfer-service');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = process.env.WORKFLOW_200K_PROJECT_ID || 'f096-real-200k-redhood-20260729';
const RUN_ID = 'f096-real-200k-creation';
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', `${PROJECT_ID}-metrics.json`);
const TARGET_CHARACTERS = 200000;
const MINIMUM_ACCEPTABLE_CHARACTERS = 190000;
const MAXIMUM_BATCHES = 9;
const ADJUSTMENTS = [
  '首批建立黑童话规则、主动目标和核心危险。小红帽必须主动做出选择，不要只是被事件推着走。',
  '增加人物之间有目的的对话，降低连续高密度比喻；让每次选择产生无法撤销的代价。',
  '放慢关键情绪转折，强化母女、外婆与狼之间相互矛盾的记忆，同时保持第三人称限知。',
  '推进红斗篷契约与森林饥饿的真相；回收早期线索，但至少保留一个更深层误导。',
  '区分小红帽、猎人、外婆和狼的语言声音；减少解释性旁白，让冲突通过行动和对话显现。',
  '进入后段：让主角利用已经建立的规则主动反制，兑现必须包含项，并开始收束主要未解线索。',
  '进入终局：解决中央冲突和人物弧，回收关键伏笔；结局可以苦涩开放，但不能像中途截断。',
  '补足结局余波与人物选择的代价，避免重复高潮或重新引入无法收束的新主线。'
];

function clean(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value).trim() || String(fallback).trim();
}

function parseJson(text) {
  const value = clean(text).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON root must be an object');
    return parsed;
  } catch (originalError) {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(value.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
    throw originalError;
  }
}

function emptyMetrics() {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    targetCharacters: TARGET_CHARACTERS,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    calls: [],
    batchAdjustments: [],
    checkpoints: [],
    quality: {}
  };
}

async function readMetrics() {
  try {
    return { ...emptyMetrics(), ...JSON.parse(await fs.readFile(METRICS_PATH, 'utf8')) };
  } catch {
    return emptyMetrics();
  }
}

async function saveMetrics(metrics) {
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
}

function usageRecord(raw = {}) {
  return {
    input: Number(raw.prompt_tokens || raw.input_tokens || 0),
    output: Number(raw.completion_tokens || raw.output_tokens || 0),
    total: Number(raw.total_tokens || 0),
    cacheHit: Number(raw.prompt_cache_hit_tokens || raw.prompt_tokens_details?.cached_tokens || 0)
  };
}

async function generate(label, prompt, config, metrics) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    let output = '';
    let reasoningCharacters = 0;
    let rawUsage = {};
    let finishReason = '';
    try {
      await ProviderStream.streamGeneration(prompt, (token, meta) => {
        if (meta?.type === 'usage') rawUsage = meta.usage || {};
        else if (meta?.type === 'reasoning') reasoningCharacters += String(token || '').length;
        else if (meta?.type === 'finish') finishReason = clean(meta.finishReason);
        else output += String(token || '');
      }, {
        ...config,
        includeUsage: true,
        firstResponseTimeoutMs: 120000,
        idleTimeoutMs: 180000
      });
      const record = {
        label,
        attempt,
        model: config.model,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        outputCharacters: output.length,
        reasoningCharacters,
        finishReason,
        usage: usageRecord(rawUsage)
      };
      metrics.calls.push(record);
      await saveMetrics(metrics);
      console.log(`[provider] ${label} | attempt ${attempt} | ${(record.durationMs / 1000).toFixed(1)}s | ${record.outputCharacters} chars | ${record.usage.total} tokens | ${finishReason || 'done'}`);
      if (!clean(output)) throw new Error('Provider returned empty output');
      return output;
    } catch (error) {
      lastError = error;
      metrics.calls.push({
        label,
        attempt,
        model: config.model,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        error: error.message || String(error)
      });
      await saveMetrics(metrics);
      console.warn(`[provider-retry] ${label} | attempt ${attempt} | ${error.message || error}`);
    }
  }
  throw lastError || new Error(`Provider generation failed: ${label}`);
}

async function generateJson(label, prompt, config, metrics) {
  const output = await generate(label, prompt, config, metrics);
  try {
    return parseJson(output);
  } catch (error) {
    const repairPrompt = {
      messages: [
        {
          role: 'system',
          content: '你是严格的 JSON 修复器。把输入重建为完整合法的 JSON 对象，保留已有信息并补齐被截断的结构。只输出 JSON，不要解释。'
        },
        { role: 'user', content: output }
      ]
    };
    return parseJson(await generate(`${label}-repair`, repairPrompt, {
      ...config,
      enableThinking: false,
      temperature: 0.1,
      maxTokens: Math.max(12000, Number(config.maxTokens) || 0)
    }, metrics));
  }
}

async function openProjectIfPresent() {
  try {
    return await projectService.openProject(DATA_ROOT, PROJECT_ID);
  } catch {
    return null;
  }
}

function activeBatch(details) {
  return (details.run.batches || []).find((batch) => batch.batchId === details.run.activeBatchId)
    || details.run.batches?.[details.run.batches.length - 1]
    || null;
}

function selectedDirectionIds(details) {
  const direction = (details.run.artifacts || []).find((artifact) => artifact.nodeId === 'direction');
  return direction?.content?.selectedDirectionIds || [];
}

function reviewAdjustment(details) {
  const batch = activeBatch(details);
  const review = (details.run.artifacts || []).filter((artifact) =>
    artifact.nodeId === 'review'
    && (!batch || artifact.targetRef?.batchId === batch.batchId)
  ).slice(-1)[0]?.content;
  const findings = Array.isArray(review?.findings) ? review.findings : [];
  const actionable = findings
    .filter((finding) => clean(finding.severity).toLowerCase() !== 'pass')
    .slice(0, 4)
    .map((finding) => clean(finding.suggestion || finding.evidence))
    .filter(Boolean);
  return actionable.length ? `落实本批审查：${actionable.join('；')}` : '';
}

function normalizePlan(plan, batchSequence, remainingCharacters) {
  const sourceScenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const expectedSceneCharacters = 6500;
  const desiredCount = Math.max(2, Math.min(6, Math.ceil(Math.max(1, remainingCharacters) / expectedSceneCharacters)));
  const scenes = sourceScenes.slice(0, desiredCount);
  while (scenes.length < Math.min(4, desiredCount) && sourceScenes.length) {
    const source = sourceScenes[scenes.length % sourceScenes.length];
    scenes.push({ ...source, id: `${clean(source.id, 'scene')}-extension-${scenes.length + 1}`, title: `${clean(source.title, '推进')}（续）` });
  }
  return {
    ...plan,
    scenes: scenes.map((scene, index) => ({
      ...scene,
      id: clean(scene.id, `batch-${batchSequence}-scene-${index + 1}`),
      title: clean(scene.title, `第 ${batchSequence} 批场景 ${index + 1}`),
      targetWords: Math.max(5500, Number(scene.targetWords) || expectedSceneCharacters),
      fineOutline: Array.isArray(scene.fineOutline)
        ? scene.fineOutline.map(clean).filter(Boolean)
        : [clean(scene.goal), clean(scene.conflict), clean(scene.outcome)].filter(Boolean)
    }))
  };
}

async function ensureStarted(metrics, providerConfig) {
  let project = await openProjectIfPresent();
  if (!project) {
    project = await projectService.createProject(DATA_ROOT, {
      id: PROJECT_ID,
      title: '二十万字真实验收 · 猩红斗篷与饥饿之月',
      description: 'F-09.6 多批次、滚动上下文、修改意见与长篇质量真实 DeepSeek 验收。',
      status: '测试中'
    });
  }
  try {
    return await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  } catch {
    const brief = {
      title: '猩红斗篷与饥饿之月',
      premise: '在一座每逢红月便向森林献祭名字的村庄，十六岁的小红帽发现外婆不是受害者，而是维系人狼停战契约的最后一位守门人。母亲失踪后，她必须主动穿越会吞食记忆的森林，在猎人教团、饥饿狼群与外婆隐瞒的旧罪之间选择：继承红斗篷、撕毁契约，或创造一种代价更高的新规则。',
      genre: '黑童话、成长、悬疑奇幻',
      targetWords: TARGET_CHARACTERS,
      themes: ['代际创伤', '自由与契约', '名字与身份', '饥饿与文明', '主动选择的代价'],
      tone: '阴郁、克制、危险中保留少量温情；恐怖来自规则和选择，不依赖无休止的血腥描写',
      pov: '以小红帽为主的第三人称限知；必要时少量猎人或外婆视角，但声音必须可区分',
      setting: '红月周期支配的边境村庄与会吞食名字和记忆的活森林。红斗篷是契约器官，不是普通衣物；狼保留语言、家族和政治，不是纯粹怪物。',
      endingPreference: '完成中央冲突和人物弧；允许苦涩、开放的余韵，但必须兑现主角最终主动选择及其代价。',
      mustInclude: [
        '小红帽主动与狼达成一次危险交易，而不是被动接受',
        '红斗篷契约的规则至少经过三次可验证的运用或反转',
        '母亲失踪、外婆旧罪和猎人教团之间形成同一因果链',
        '终局由小红帽利用已经建立的规则主动改变局势'
      ],
      avoid: [
        '用梦境、精神失常或一切都是幻觉解释核心谜团',
        '连续堆砌身体恐怖和比喻',
        '让主角长期只被猎人、狼或外婆引导',
        '不同 POV 使用完全相同的抒情腔调',
        '在结局突然引入未铺垫的终极反派'
      ],
      notes: '每批规划 4–6 个可生成场景，每场目标约 5500–7000 中文字符。完整作品目标约二十万中文字符。'
    };
    await Creation.startGuidedCreation({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      title: 'F-09.6 真实 DeepSeek 二十万字验收',
      brief,
      writingInstructions: {
        text: '保持黑童话的规则感和因果压力。优先具体行动、对话和可验证的规则，不要用解释性旁白替代戏剧。关键情绪转折必须有铺垫。每个场景都应改变人物关系、信息或风险，避免同义重复。',
        styleAndDistance: '克制的第三人称限知；意象精准但不过饱和；不同 POV 保持不同观察词汇和句式。',
        dialogueRatio: '约 25%–35%，根据场景需要浮动',
        pacingPreference: '高低强度交替；高潮之间保留调查、关系和后果场景',
        mustAvoid: ['连续三段以上高密度比喻', '无因果的救场', '重复说明已经展示的规则'],
        applicableStages: ['plan', 'draft', 'review']
      },
      constraints: [
        { kind: 'fact', text: '红斗篷是契约器官，森林会吞食名字和记忆', enforcement: 'hard', weight: 5 },
        { kind: 'direction', text: '小红帽必须逐步取得主动权并在终局主动改变规则', enforcement: 'hard', weight: 5 },
        { kind: 'exclusion', text: '不得用梦境、精神失常或幻觉解释核心谜团', enforcement: 'hard', weight: 5 }
      ],
      generationPolicy: {
        providerProfileId: 'inherit',
        snapshot: {
          mode: providerConfig.mode,
          provider: providerConfig.provider,
          endpoint: providerConfig.endpoint,
          model: providerConfig.model,
          temperature: providerConfig.temperature,
          maxTokens: providerConfig.maxTokens,
          enableThinking: true,
          useProviderDefaults: false
        }
      }
    });
    metrics.checkpoints.push({ at: new Date().toISOString(), action: 'run-started' });
    await saveMetrics(metrics);
    return Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  }
}

async function runPlanningStage(nodeId, details, config, metrics) {
  const prepared = await Creation.prepareCreationNode({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    nodeId,
    selectedDirectionIds: selectedDirectionIds(details)
  });
  const parsedOutputs = [];
  for (let index = 0; index < prepared.prompts.length; index += 1) {
    parsedOutputs.push(await generateJson(
      `${nodeId}-${prepared.prompts[index].id}`,
      prepared.prompts[index].prompt,
      config,
      metrics
    ));
  }
  let output;
  if (nodeId === 'compendium') {
    output = {
      cards: parsedOutputs.flatMap((item) => Array.isArray(item.cards) ? item.cards : Array.isArray(item.entries) ? item.entries : [])
    };
  } else if (nodeId === 'plan') {
    const batch = activeBatch(details);
    output = normalizePlan(parsedOutputs[0], batch?.sequence || 1, details.run.generationProgress.remainingCharacters);
  } else {
    output = parsedOutputs[0];
  }
  await Creation.completeCreationNode({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    nodeId,
    outputs: [JSON.stringify(output)]
  });
  await Creation.approveCreationNode({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    nodeId,
    selectedDirectionIds: nodeId === 'direction'
      ? (output.directions || []).slice(0, 2).map((direction) => direction.id)
      : undefined
  });
}

async function runDraftStage(details, config, metrics) {
  while (details.run.activeNodeId === 'draft' && details.run.steps.find((step) => step.id === 'draft')?.status === 'ready') {
    const prepared = await Creation.prepareCreationNode({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'draft',
      selectedDirectionIds: selectedDirectionIds(details)
    });
    const prompt = prepared.prompts[0];
    const output = await generate(
      `batch-${prepared.batchSequence}-draft-${prepared.completedCount + 1}-${prompt.id}`,
      prompt.prompt,
      config,
      metrics
    );
    await Creation.completeCreationNode({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'draft',
      outputs: [output],
      outputIndexes: [prompt.outputIndex],
      outputTitles: [prompt.title],
      partial: prepared.remainingCount > 1
    });
    details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
    metrics.checkpoints.push({
      at: new Date().toISOString(),
      action: 'scene-saved',
      batchSequence: prepared.batchSequence,
      scene: prepared.completedCount + 1,
      title: prompt.title,
      outputCharacters: output.length,
      cumulativeCharacters: details.run.generationProgress.completedCharacters
    });
    await saveMetrics(metrics);
  }
  if (details.run.activeNodeId === 'draft' && details.run.steps.find((step) => step.id === 'draft')?.status === 'waiting_user') {
    await Creation.approveCreationNode({ dataRoot: DATA_ROOT, projectId: PROJECT_ID, runId: RUN_ID, nodeId: 'draft' });
  }
}

async function runReviewStage(details, config, metrics) {
  const prepared = await Creation.prepareCreationNode({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    nodeId: 'review'
  });
  const output = await generateJson(`batch-${activeBatch(details)?.sequence || 1}-review`, prepared.prompts[0].prompt, config, metrics);
  await Creation.completeCreationNode({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    nodeId: 'review',
    outputs: [JSON.stringify(output)]
  });
}

async function transferCompletedNovel(details) {
  const drafts = (details.run.artifacts || []).filter((artifact) =>
    artifact.nodeId === 'draft'
    && artifact.revision.reviewState === 'approved'
  );
  const scenes = drafts.map((artifact, index) => {
    const batchSequence = Number(artifact.targetRef?.batchSequence) || 1;
    return {
      sceneId: `f096-scene-${String(index + 1).padStart(4, '0')}`,
      chapterId: `f096-batch-${String(batchSequence).padStart(2, '0')}`,
      chapterTitle: `第 ${batchSequence} 批`,
      title: artifact.title,
      source: {
        runId: RUN_ID,
        artifactId: artifact.id,
        revisionId: artifact.revision.id
      }
    };
  });
  await Transfer.applyWriterTransfer({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    applicationId: 'f096-real-200k-writer-transfer',
    scenes
  });
  return Creation.completeCreationTransfer({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    applicationId: 'f096-real-200k-writer-transfer',
    terminationReason: 'target_reached'
  });
}

function objectiveQuality(drafts) {
  const text = drafts.map((artifact) => artifact.content).join('\n');
  const dialogueCharacters = (text.match(/[“”「」『』][^“”「」『』]{1,300}[“”「」『』]/g) || [])
    .reduce((sum, item) => sum + item.length, 0);
  const phraseCounts = new Map();
  for (let index = 0; index + 24 <= text.length; index += 12) {
    const phrase = text.slice(index, index + 24).replace(/\s+/g, '');
    if (phrase.length === 24) phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
  }
  return {
    totalCharacters: text.length,
    sceneCount: drafts.length,
    averageSceneCharacters: drafts.length ? Math.round(text.length / drafts.length) : 0,
    dialogueCharacterRatio: text.length ? dialogueCharacters / text.length : 0,
    repeatedSamplePhrases: Array.from(phraseCounts.entries()).filter(([, count]) => count > 1).length,
    motifOccurrences: {
      redCloak: (text.match(/红斗篷|猩红斗篷/g) || []).length,
      name: (text.match(/名字|姓名/g) || []).length,
      contract: (text.match(/契约|约定/g) || []).length,
      activeChoice: (text.match(/选择|决定|主动|拒绝|答应/g) || []).length
    }
  };
}

async function judgeNovel(details, config, metrics) {
  const drafts = (details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft');
  const reviews = (details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'review').map((artifact) => artifact.content);
  const sampleIndexes = [...new Set([
    0,
    1,
    Math.floor(drafts.length / 3),
    Math.floor(drafts.length / 2),
    Math.floor(drafts.length * 2 / 3),
    drafts.length - 2,
    drafts.length - 1
  ].filter((index) => index >= 0 && index < drafts.length))];
  const samples = sampleIndexes.map((index) => ({
    index,
    title: drafts[index].title,
    text: drafts[index].content
  }));
  const judgePrompt = {
    messages: [
      {
        role: 'system',
        content: '你是苛刻的中文长篇小说总编。根据代表性正文、各批审查和连续性状态评价整部长篇。不要因为篇幅长而宽容。只返回合法 JSON。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          novel: '黑童话小红帽《猩红斗篷与饥饿之月》',
          targetCharacters: TARGET_CHARACTERS,
          actualCharacters: details.run.generationProgress.completedCharacters,
          samples,
          batchReviews: reviews,
          rubric: {
            scores: ['plotCompleteness', 'characterAgency', 'continuity', 'worldRulePayoff', 'povVoice', 'dialogue', 'pacing', 'proseControl', 'endingSatisfaction', 'overall'],
            scale: '每项 1–10 分',
            required: ['给出 scores 对象', 'strengths 数组', 'criticalIssues 数组', 'continuityRisks 数组', 'revisionPriorities 数组', 'verdict 字符串']
          }
        })
      }
    ]
  };
  const editorial = await generateJson('final-editorial-judge', judgePrompt, config, metrics);
  return {
    objective: objectiveQuality(drafts),
    editorial,
    reviewFindingCount: reviews.reduce((sum, review) => sum + (Array.isArray(review?.findings) ? review.findings.length : 0), 0),
    majorReviewFindingCount: reviews.reduce((sum, review) => sum + (Array.isArray(review?.findings)
      ? review.findings.filter((finding) => ['major', 'high', 'critical', 'error', '严重', '错误'].includes(clean(finding.severity).toLowerCase())).length
      : 0), 0)
  };
}

(async () => {
  const metrics = await readMetrics();
  const settings = await settingsService.readSettings(DATA_ROOT);
  const pro = settingsService.runtimeProviderConfig(settings, {
    model: 'deepseek-v4-pro',
    temperature: 0.72,
    maxTokens: 12000,
    useProviderDefaults: false,
    enableThinking: true
  });
  if (pro.provider !== 'deepseek' || !pro.apiKey || !pro.endpoint) {
    throw new Error('Configured DeepSeek Provider with API key and endpoint is required');
  }
  await ensureStarted(metrics, pro);
  let safety = 0;
  while (safety < 200) {
    safety += 1;
    let details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
    if (details.run.status === 'completed') break;
    const step = details.run.activeNodeId;
    const stepState = details.run.steps.find((item) => item.id === step)?.status;
    console.log(`[workflow] step=${step || 'none'} state=${stepState || details.run.status} batches=${details.run.batches.length} chars=${details.run.generationProgress.completedCharacters}/${TARGET_CHARACTERS}`);
    if (['direction', 'blueprint', 'compendium', 'plan'].includes(step)) {
      await runPlanningStage(step, details, {
        ...pro,
        maxTokens: step === 'direction' ? 7000 : step === 'plan' ? 10000 : 12000,
        temperature: step === 'direction' ? 0.82 : 0.68,
        enableThinking: step !== 'plan'
      }, metrics);
      continue;
    }
    if (step === 'draft') {
      await runDraftStage(details, { ...pro, maxTokens: 12000, temperature: 0.78 }, metrics);
      continue;
    }
    if (step === 'review') {
      await runReviewStage(details, { ...pro, maxTokens: 7000, temperature: 0.25 }, metrics);
      continue;
    }
    if (step === 'transfer') {
      details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
      const completedCharacters = details.run.generationProgress.completedCharacters;
      const batch = activeBatch(details);
      if (completedCharacters >= MINIMUM_ACCEPTABLE_CHARACTERS || (batch?.sequence || 1) >= MAXIMUM_BATCHES) {
        await transferCompletedNovel(details);
        break;
      }
      const baseAdjustment = ADJUSTMENTS[Math.min((batch?.sequence || 1), ADJUSTMENTS.length - 1)];
      const reviewDriven = reviewAdjustment(details);
      const userInstruction = [baseAdjustment, reviewDriven].filter(Boolean).join('\n');
      metrics.batchAdjustments.push({
        at: new Date().toISOString(),
        afterBatch: batch?.sequence || 1,
        completedCharacters,
        userInstruction
      });
      await saveMetrics(metrics);
      await Creation.continueCreationBatch({
        dataRoot: DATA_ROOT,
        projectId: PROJECT_ID,
        runId: RUN_ID,
        userInstruction,
        acknowledgeMajor: true
      });
      continue;
    }
    throw new Error(`Unexpected workflow state: ${step || details.run.status}`);
  }
  let details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  if (details.run.status !== 'completed') throw new Error('200k acceptance did not reach a completed state');
  metrics.quality = await judgeNovel(details, { ...pro, maxTokens: 8000, temperature: 0.2 }, metrics);
  metrics.finishedAt = new Date().toISOString();
  metrics.final = {
    status: details.run.status,
    batches: details.run.batches.length,
    generatedCharacters: details.run.generationProgress.completedCharacters,
    sceneCount: details.run.artifacts.filter((artifact) => artifact.nodeId === 'draft').length,
    projectId: PROJECT_ID,
    runId: RUN_ID
  };
  await saveMetrics(metrics);
  console.log(`F096_200K_ACCEPTANCE_RESULT ${JSON.stringify({ metricsPath: METRICS_PATH, final: metrics.final, quality: metrics.quality })}`);
})().catch(async (error) => {
  console.error('F096_200K_ACCEPTANCE_FAILED', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
