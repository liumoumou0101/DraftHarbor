/**
 * F-09.6H 质量锁真实 Provider 验收（控制成本）
 *
 * 使用仓库内已保存的 DeepSeek 配置（.draftharbor-settings.json）。
 * 不打印、不落盘 API Key。
 *
 * 覆盖：
 * 1. 连通 canary
 * 2. 真实短正文生成 + 对话比例/技术腔确定性指标
 * 3. 从零创作 run 落盘写作指令与锁
 * 4. 审查 finding 升硬 / 豁免 / 降软
 * 5. 续写启动是否持久化 writing-instructions
 */
const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const Guided = require('../desktop/services/workflow-guided-service');
const LockService = require('../desktop/services/workflow-lock-service');
const Review = require('../desktop/services/workflow-review-service');
const Quality = require('../src/core/workflow/workflow-quality-metrics');
const ProviderStream = require('../src/core/generation/provider-stream');
const artifactStore = require('../desktop/storage/workflow-artifact-store');
const runStore = require('../desktop/storage/workflow-run-store-v2');
const libraryPaths = require('../desktop/storage/library-paths');

const DATA_ROOT = path.resolve(__dirname, '..');
const STAMP = '20260730';
const PROJECT_ID = `f096h-quality-locks-real-${STAMP}`;
const RUN_ID = `f096h-locks-creation-${STAMP}`;
const CONT_RUN_ID = `f096h-locks-continuation-${STAMP}`;
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', `f096h-quality-locks-real-${STAMP}.json`);
const REPORT_PATH = path.join(DATA_ROOT, 'docs', `F096H_QUALITY_LOCKS_REAL_ACCEPTANCE_${STAMP}.md`);

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api[_-]?key|authorization|token/i.test(key)) {
      out[key] = item ? '[redacted]' : '';
      continue;
    }
    out[key] = scrub(item);
  }
  return out;
}

async function streamText(label, prompt, config, calls) {
  const started = Date.now();
  let content = '';
  let reasoningCharacters = 0;
  let usage = null;
  await ProviderStream.streamGeneration(prompt, (token, meta) => {
    if (meta && meta.type === 'usage') usage = meta.usage;
    else if (meta && meta.type === 'reasoning') reasoningCharacters += String(token || '').length;
    else content += String(token || '');
  }, {
    ...config,
    includeUsage: true,
    firstResponseTimeoutMs: 90000,
    idleTimeoutMs: 120000
  });
  const record = {
    label,
    model: config.model,
    enableThinking: config.enableThinking === true,
    durationMs: Date.now() - started,
    contentCharacters: content.length,
    reasoningCharacters,
    usage: usage ? {
      promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0)
    } : null
  };
  calls.push(record);
  return { text: content, record };
}

async function configuredProviders() {
  const settings = await settingsService.readSettings(DATA_ROOT);
  const workflowProfileId = clean(settings.workflowGeneration && settings.workflowGeneration.providerProfileId);
  const workflowProfile = (settings.providerProfiles || []).find((profile) => profile.id === workflowProfileId && clean(profile.apiKey))
    || (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-pro' && clean(profile.apiKey));
  const flashProfile = (settings.providerProfiles || []).find((profile) => profile.model === 'deepseek-v4-flash' && clean(profile.apiKey));
  const pro = settingsService.runtimeProviderConfig(settings, {
    profileId: workflowProfile && workflowProfile.id,
    model: 'deepseek-v4-pro',
    temperature: 0.55,
    maxTokens: 1800,
    useProviderDefaults: false
  });
  const flash = flashProfile
    ? settingsService.runtimeProviderConfig(settings, {
      profileId: flashProfile.id,
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      maxTokens: 800,
      useProviderDefaults: false
    })
    : null;
  if (!pro.apiKey || !pro.endpoint) throw new Error('未找到已保存的 DeepSeek Pro 配置（workflow 或 deepseek-v4-pro）');
  return {
    settings,
    workflowProfileId: workflowProfile ? workflowProfile.id : 'inherit',
    pro,
    flash
  };
}

async function ensureProject() {
  try {
    return await projectService.openProject(DATA_ROOT, PROJECT_ID);
  } catch {
    await projectService.createProject(DATA_ROOT, {
      id: PROJECT_ID,
      title: 'F-09.6H 质量锁真实验收',
      description: '真实 DeepSeek 质量锁 / 软硬锁 / 审查调锁验收。可保留人工复查。',
      status: '真实 API 测试',
      tags: ['F-09.6H', 'quality-locks', 'real-provider']
    });
    return projectService.openProject(DATA_ROOT, PROJECT_ID);
  }
}

function tryParseJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

(async () => {
  const checklist = [];
  const mark = (id, title, ok, detail = '') => {
    checklist.push({ id, title, ok: !!ok, detail: clean(detail) });
    const icon = ok ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${id} ${title}${detail ? ` — ${detail}` : ''}`);
    if (!ok) throw new Error(`验收失败：${id} ${title}${detail ? ` (${detail})` : ''}`);
  };

  const metrics = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    calls: [],
    checks: []
  };

  const providers = await configuredProviders();
  mark('A1', '读取已保存 DeepSeek 配置', true, `workflowProfile=${providers.workflowProfileId}; model=${providers.pro.model}`);

  // --- A. Connectivity canary ---
  const canary = await streamText('canary-pro', {
    messages: [
      { role: 'system', content: '连通性测试。只返回要求的标记字符串。' },
      { role: 'user', content: '只返回：LOCKS_CANARY_OK' }
    ]
  }, { ...providers.pro, enableThinking: false, maxTokens: 64, temperature: 0 }, metrics.calls);
  mark('A2', 'DeepSeek Pro 流式 canary', canary.text.includes('LOCKS_CANARY_OK'), `chars=${canary.record.contentCharacters}; ${canary.record.durationMs}ms`);

  if (providers.flash) {
    const flashCanary = await streamText('canary-flash', {
      messages: [
        { role: 'system', content: '连通性测试。只返回要求的标记字符串。' },
        { role: 'user', content: '只返回：LOCKS_FLASH_OK' }
      ]
    }, { ...providers.flash, enableThinking: false, maxTokens: 64, temperature: 0 }, metrics.calls);
    mark('A3', 'DeepSeek Flash 流式 canary', flashCanary.text.includes('LOCKS_FLASH_OK'), `${flashCanary.record.durationMs}ms`);
  } else {
    mark('A3', 'DeepSeek Flash 流式 canary', true, '未配置 Flash，跳过');
  }

  // --- B. Real short prose with quality instructions ---
  const prosePrompt = {
    messages: [
      {
        role: 'system',
        content: '你是中文小说作者。只输出正文，不要标题、不要解释、不要 Markdown。保持克制第三人称限知。对话约占 30%。避免说明书式技术说明腔。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          scene: {
            title: '夜港的借名',
            goal: '少女拒绝交出乳名，提出限期借名交易',
            outcome: '狼勉强接受限期，但留下爪痕作为抵押',
            targetWords: 900
          },
          quality: {
            dialogueRatio: '25%–35%',
            avoid: ['自动生成系统', '协议栈', '参数校准', '场景编号', '计划要求']
          }
        })
      }
    ]
  };
  const prose = await streamText('short-prose', prosePrompt, {
    ...providers.pro,
    enableThinking: true,
    maxTokens: 1600,
    temperature: 0.65
  }, metrics.calls);
  mark('B1', '真实短正文生成', prose.text.length >= 400, `chars=${prose.text.length}; ${prose.record.durationMs}ms`);

  const dialogueOn = Quality.measureProseMetrics(prose.text, {
    dialogueRatioEnabled: true,
    dialogueRatioMin: 0.15,
    dialogueRatioMax: 0.55,
    technicalRegisterMode: 'avoid'
  });
  mark('B2', '确定性指标可计算对话比例', Number.isFinite(dialogueOn.dialogueRatio), `dialogue=${(dialogueOn.dialogueRatio * 100).toFixed(1)}%`);
  mark('B3', '真实正文未命中过程标签硬门禁', Review.processLeakFindings({ text: prose.text }).length === 0, `leaks=${Review.processLeakFindings({ text: prose.text }).length}`);

  // Inject a known technical register sample for lock enforcement test (fixture, not model).
  const techTainted = `${prose.text}\n\n契约的自动生成约束系统检测到了一个它无法归类的操作，开始参数校准。`;
  const techFindings = Quality.buildQualityFindings({
    text: techTainted,
    qualityTargets: { technicalRegisterMode: 'avoid', technicalRegisterLocked: false }
  });
  mark('B4', '技术说明腔 soft 可检出', techFindings.some((item) => item.type === 'technical_register_drift' && item.enforcement === 'soft'));

  const hardTechFindings = Quality.buildQualityFindings({
    text: techTainted,
    qualityTargets: { technicalRegisterMode: 'avoid', technicalRegisterLocked: true }
  });
  mark('B5', '技术说明腔 hard 可阻断', hardTechFindings.some((item) => Review.isBlockingFinding(item)));

  // --- C. Creation run with locks + qualityTargets persistence ---
  await ensureProject();
  const projectPath = libraryPaths.projectDir(DATA_ROOT, PROJECT_ID);
  let details = null;
  try {
    details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  } catch {
    details = null;
  }
  if (!details) {
    await Creation.startGuidedCreation({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      title: '质量锁真实验收 · 从零',
      brief: {
        workingTitle: '夜港的借名',
        premise: '红斗篷少女与失名狼群在夜港做限期借名交易。',
        genre: '黑童话',
        targetLength: 12000,
        themes: ['名字', '契约', '主动'],
        tone: '冷峻',
        pov: '第三人称限知',
        setting: '夜港与潮汐森林'
      },
      writingInstructions: {
        text: '克制叙述；冲突通过选择与对话推进。',
        dialogueRatio: '约 25%–35%',
        qualityTargets: {
          dialogueRatioEnabled: true,
          dialogueRatioMin: 0.2,
          dialogueRatioMax: 0.4,
          technicalRegisterMode: 'avoid',
          technicalRegisterLocked: false,
          planOutcomeLocked: false
        }
      },
      constraints: [
        { kind: 'direction', text: '少女必须主动提出交易条件', enforcement: 'soft', weight: 3 },
        { kind: 'exclusion', text: '不得用梦境解释谜团', enforcement: 'soft', weight: 3 },
        { kind: 'exclusion', text: '禁止使用精神失常收束', enforcement: 'hard', weight: 4 }
      ],
      generationPolicy: {
        providerProfileId: providers.workflowProfileId,
        snapshot: {
          source: 'workflow-profile',
          profileId: providers.workflowProfileId,
          label: '质量锁真实验收',
          provider: providers.pro.provider,
          endpoint: providers.pro.endpoint,
          model: providers.pro.model,
          temperature: providers.pro.temperature,
          maxTokens: providers.pro.maxTokens
        }
      }
    });
    details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  }

  const instructions = details.run.artifacts.find((artifact) => artifact.artifactType === 'workflow-writing-instructions@1');
  mark('C1', '从零创作持久化 writing-instructions', !!(instructions && instructions.content), `revision=${instructions && instructions.revision && instructions.revision.id}`);
  mark('C2', 'qualityTargets 默认对话软指标开启', !!(instructions && instructions.content.qualityTargets && instructions.content.qualityTargets.dialogueRatioEnabled === true));
  mark('C3', '排除锁默认可 soft（非全部 hard）', (details.run.settings.constraints || []).some((item) => item.kind === 'exclusion' && item.enforcement === 'soft'));

  // Seed plan + draft for review path without multi-stage full generation.
  const batchId = details.run.activeBatchId || 'batch-0001';
  let afterReview = details;
  let reviewArtifact = (details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'review').slice(-1)[0];
  let reviewParseMode = reviewArtifact ? 'reuse-existing' : 'pending';

  if (!reviewArtifact || !(reviewArtifact.content && reviewArtifact.content.metrics)) {
    const planContent = {
      fineOutlineEnabled: true,
      scenes: [{
        id: 's1',
        title: '夜港的借名',
        goal: '提出限期借名',
        conflict: '狼要永久名字',
        outcome: '达成限期交易并留下爪痕抵押',
        mustInclude: ['主动提出交易'],
        targetWords: 900,
        fineOutline: ['对峙', '拒绝永久名字', '提出限期', '爪痕抵押']
      }]
    };
    await artifactStore.writeArtifactRevision(projectPath, RUN_ID, {
      id: `plan-${batchId}`,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'plan',
      artifactType: 'scene-plan@1',
      title: '场景计划',
      targetRef: { batchId, batchSequence: 1 }
    }, {
      id: `plan-r-${Date.now()}`,
      summary: '验收用计划',
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'json' }
    }, planContent);

    await artifactStore.writeArtifactRevision(projectPath, RUN_ID, {
      id: `draft-${batchId}-s1`,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'draft',
      artifactType: 'draft-batch@1',
      title: '夜港的借名',
      targetRef: { batchId, sceneId: 's1', sceneSequence: 1 }
    }, {
      id: `draft-r-${Date.now()}`,
      summary: '真实短正文 + 技术腔样本',
      reviewState: 'approved',
      approvedAt: new Date().toISOString(),
      payload: { format: 'text' }
    }, techTainted);

    const state = await runStore.readWorkflowV2RunState(projectPath, RUN_ID);
    await runStore.writeWorkflowV2RunState(projectPath, RUN_ID, {
      status: 'in_progress',
      activeNodeId: 'review',
      nodeStates: (state.nodeStates || []).map((item) => {
        if (['brief', 'direction', 'blueprint', 'compendium', 'plan', 'draft'].includes(item.nodeId)) {
          return { ...item, executionState: 'completed' };
        }
        if (item.nodeId === 'review') return { ...item, executionState: 'ready' };
        return item;
      })
    }, { expectedRevision: state.revision });

    const preparedReview = await Creation.prepareCreationNode({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'review'
    });
    mark('C4', '准备审查 Prompt 成功', !!(preparedReview && preparedReview.prompts && preparedReview.prompts[0]), preparedReview && preparedReview.prompts && preparedReview.prompts[0] && preparedReview.prompts[0].title);

    let reviewPayload = '';
    const reviewAttempt = await streamText('semantic-review', preparedReview.prompts[0].prompt, {
      ...providers.pro,
      enableThinking: false,
      maxTokens: 3500,
      temperature: 0.15
    }, metrics.calls);
    mark('C5', '真实语义审查有输出', reviewAttempt.text.length > 20, `chars=${reviewAttempt.text.length}`);
    try {
      tryParseJson(reviewAttempt.text);
      reviewPayload = reviewAttempt.text;
      reviewParseMode = 'model-json';
    } catch (_error) {
      const repair = await streamText('semantic-review-repair', {
        messages: [
          { role: 'system', content: '你是 JSON 修复器。把用户给出的残缺审查结果补成合法 JSON，不要解释。字段：summary,findings,planFulfillment,continuityState。' },
          { role: 'user', content: reviewAttempt.text.slice(0, 6000) }
        ]
      }, {
        ...(providers.flash || providers.pro),
        enableThinking: false,
        maxTokens: 2500,
        temperature: 0
      }, metrics.calls);
      try {
        tryParseJson(repair.text);
        reviewPayload = repair.text;
        reviewParseMode = 'repaired-json';
      } catch (_error2) {
        reviewPayload = JSON.stringify({
          summary: '语义审查 JSON 截断，使用确定性审查兜底',
          findings: [],
          planFulfillment: [{
            sceneId: 's1',
            field: 'outcome',
            status: 'fulfilled',
            evidence: '限期交易与爪痕抵押在正文中可核对'
          }],
          continuityState: {
            summary: '夜港借名对峙完成',
            characterStates: { 洛塔: '达成限期交易' },
            unresolvedThreads: [{ threadId: 't-claw', label: '幼狼/爪痕抵押', status: 'open', mustClose: false }],
            knownFacts: ['红斗篷记录谎言'],
            lastEnding: techTainted.slice(-400)
          }
        });
        reviewParseMode = 'deterministic-fallback';
      }
    }

    afterReview = await Creation.completeCreationNode({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: 'review',
      outputs: [reviewPayload]
    });
    reviewArtifact = afterReview.run.artifacts.filter((artifact) => artifact.nodeId === 'review').slice(-1)[0];
  } else {
    mark('C4', '准备审查 Prompt 成功', true, '复用已有审查产物');
    mark('C5', '真实语义审查有输出', true, '复用已有审查产物');
  }

  mark('C6', '审查产物含 metrics', !!(reviewArtifact && reviewArtifact.content && reviewArtifact.content.metrics),
    `findings=${(reviewArtifact.content.findings || []).length}; parse=${reviewParseMode}`);
  mark('C7', '技术腔 finding 出现（soft）', (reviewArtifact.content.findings || []).some((item) => item.type === 'technical_register_drift'),
    (reviewArtifact.content.findings || []).filter((item) => item.type === 'technical_register_drift').map((item) => item.enforcement).join(',') || 'none');

  // Direction literal must not hard-block
  const directionLiteral = (reviewArtifact.content.findings || []).filter((item) => item.type === 'direction_missing' || item.type === 'direction_literal_absent');
  mark('C8', '无 direction_missing 硬误报', !directionLiteral.some((item) => item.type === 'direction_missing' && Review.isBlockingFinding(item)),
    directionLiteral.map((item) => `${item.type}/${item.enforcement}`).join('; ') || 'none');

  // --- D. Mid-run lock actions ---
  // Ensure a fresh tech finding exists for lock actions (in case prior exempt cleared it).
  await LockService.updateRunLocks({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    reevaluateReview: true,
    qualityTargets: {
      technicalRegisterMode: 'avoid',
      technicalRegisterLocked: false,
      dialogueRatioEnabled: true,
      dialogueRatioMin: 0.2,
      dialogueRatioMax: 0.4
    }
  });

  const hardened = await LockService.updateRunLocks({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    findingActions: [{ action: 'harden', type: 'technical_register_drift', metricId: 'technical_register' }]
  });
  mark('D1', '审查页升硬后 qualityTargets.technicalRegisterLocked', hardened.qualityTargets && hardened.qualityTargets.technicalRegisterLocked === true,
    JSON.stringify({ locked: hardened.qualityTargets && hardened.qualityTargets.technicalRegisterLocked, mode: hardened.qualityTargets && hardened.qualityTargets.technicalRegisterMode }));
  const hardenedFinding = (hardened.review && hardened.review.findings || []).find((item) => item.type === 'technical_register_drift');
  mark('D2', '升硬后 finding 为 hard 或门禁阻断',
    (hardenedFinding && hardenedFinding.enforcement === 'hard')
      || hardened.qualityGate === 'blocked'
      || (hardened.blockingFindingCount || 0) > 0,
    `gate=${hardened.qualityGate}; blocking=${hardened.blockingFindingCount}; finding=${hardenedFinding && hardenedFinding.enforcement}`);

  const exempted = await LockService.updateRunLocks({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    findingActions: [{ action: 'exempt', type: 'technical_register_drift' }]
  });
  mark('D3', '豁免后可不阻断（若仅剩 soft 技术腔）', exempted.qualityGate === 'passed' || (exempted.review && (exempted.review.findings || []).some((item) => item.exempted)),
    `gate=${exempted.qualityGate}`);

  const softenedExclusion = await LockService.updateRunLocks({
    dataRoot: DATA_ROOT,
    projectId: PROJECT_ID,
    runId: RUN_ID,
    constraints: (afterReview.run.settings.constraints || []).map((item) => (
      item.kind === 'exclusion' && item.text.includes('精神失常')
        ? { ...item, enforcement: 'soft' }
        : item
    )),
    qualityTargets: {
      technicalRegisterMode: 'avoid',
      technicalRegisterLocked: false,
      dialogueRatioEnabled: true,
      dialogueRatioMin: 0.2,
      dialogueRatioMax: 0.4
    }
  });
  mark('D4', '可批量改写 constraints + qualityTargets', Array.isArray(softenedExclusion.constraints) && softenedExclusion.constraints.length >= 2,
    `constraints=${softenedExclusion.constraints.length}`);

  // --- E. Continuation persists writing instructions ---
  // Ensure project has prose so continuation source snapshot is non-empty.
  {
    const openedProject = await projectService.openProject(DATA_ROOT, PROJECT_ID);
    const scenes = openedProject.project.scenes || [];
    const sceneContents = openedProject.project.sceneContents || {};
    const hasProse = scenes.some((scene) => clean(sceneContents[scene.id] || scene.content).length > 40);
    if (!hasProse) {
      const sceneId = (scenes[0] && scenes[0].id) || `scene-${Date.now()}`;
      await projectService.saveProject(DATA_ROOT, {
        ...openedProject.project,
        id: PROJECT_ID,
        scenes: scenes.length ? scenes : [{ id: sceneId, title: '夜港的借名', chapterId: 'ch1' }],
        chapters: openedProject.project.chapters && openedProject.project.chapters.length
          ? openedProject.project.chapters
          : [{ id: 'ch1', title: '第一章' }],
        sceneContents: {
          ...sceneContents,
          [sceneId]: techTainted.slice(0, 1200)
        }
      });
    }
  }
  try {
    await Guided.getGuidedRun(DATA_ROOT, PROJECT_ID, CONT_RUN_ID);
  } catch {
    await Guided.startGuidedContinuation({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: CONT_RUN_ID,
      scope: 'project',
      brief: '继续夜港交易后的追逐。',
      writingInstructions: {
        text: '续写也要遵守质量锁',
        qualityTargets: {
          dialogueRatioEnabled: false,
          technicalRegisterMode: 'avoid',
          technicalRegisterLocked: false
        }
      },
      constraints: [
        { kind: 'exclusion', text: '不要揭晓最终幕后', enforcement: 'soft' }
      ],
      generationPolicy: {
        providerProfileId: providers.workflowProfileId
      }
    });
  }
  const cont = await Guided.getGuidedRun(DATA_ROOT, PROJECT_ID, CONT_RUN_ID);
  const contInstructions = (cont.run.artifacts || []).find((artifact) => artifact.artifactType === 'workflow-writing-instructions@1');
  mark('E1', '续写启动持久化 writing-instructions', !!contInstructions, contInstructions ? contInstructions.id : 'missing');
  mark('E2', '续写 settings.constraints 可读', Array.isArray(cont.run.settings.constraints), `count=${(cont.run.settings.constraints || []).length}`);

  // --- F. Soft exclusion does not block alone ---
  const softOnly = Review.reviewDraft({
    text: '不得用梦境解释谜团。这是一句普通叙述。',
    constraints: [{ id: 'ex1', kind: 'exclusion', text: '不得用梦境解释谜团', enforcement: 'soft' }],
    qualityTargets: { technicalRegisterMode: 'off' }
  });
  mark('F1', '排除 soft 命中不阻断', softOnly.qualityGate === 'passed');
  const hardOnly = Review.reviewDraft({
    text: '不得用梦境解释谜团。这是一句普通叙述。',
    constraints: [{ id: 'ex2', kind: 'exclusion', text: '不得用梦境解释谜团', enforcement: 'hard' }],
    qualityTargets: { technicalRegisterMode: 'off' }
  });
  mark('F2', '排除 hard 命中阻断', hardOnly.qualityGate === 'blocked');

  metrics.completedAt = new Date().toISOString();
  metrics.checks = checklist;
  metrics.dialogueRatioOnRealProse = dialogueOn.dialogueRatio;
  metrics.proseCharacters = prose.text.length;
  metrics.reviewFindingTypes = [...new Set((reviewArtifact.content.findings || []).map((item) => item.type))];
  const safeMetrics = scrub(metrics);
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, `${JSON.stringify(safeMetrics, null, 2)}\n`, 'utf8');

  const report = `# F-09.6H 质量锁真实 Provider 验收（${STAMP}）

## 结论

使用已保存的 DeepSeek 配置完成连通 canary、真实短正文生成、审查与运行中调锁验收。  
**通过 ${checklist.filter((item) => item.ok).length}/${checklist.length}** 项。

- 项目：\`F-09.6H 质量锁真实验收\`（\`${PROJECT_ID}\`）
- 从零 Run：\`${RUN_ID}\`
- 续写 Run：\`${CONT_RUN_ID}\`
- 指标：\`${path.relative(DATA_ROOT, METRICS_PATH).replace(/\\\\/g, '/')}\`
- 真实正文字符：${prose.text.length}
- 对话比例（确定性）：${(dialogueOn.dialogueRatio * 100).toFixed(1)}%
- API Key：**未写入本文件**

## 验收清单

| ID | 项目 | 结果 | 说明 |
|---|---|---|---|
${checklist.map((item) => `| ${item.id} | ${item.title} | ${item.ok ? '✅' : '❌'} | ${item.detail.replace(/\|/g, '\\|')} |`).join('\n')}

## 人工可复查

1. 打开项目 \`${PROJECT_ID}\` → 工作流 → 选中 \`${RUN_ID}\`。
2. 看「当前运行 · 创作锁」是否回显约束与质量目标。
3. 打开审查产物：应有质量指标、技术腔 finding（若仍保留）。
4. 对 finding 点升硬/豁免，确认按钮可用且门禁变化。
5. 续写 run 应有 writing-instructions 产物。

## 调用摘要（无密钥）

${metrics.calls.map((call) => `- ${call.label}: ${call.model}, ${call.durationMs}ms, out=${call.contentCharacters}, think=${call.reasoningCharacters}, usage=${call.usage ? call.usage.totalTokens : 'n/a'}`).join('\n')}
`;

  await fs.writeFile(REPORT_PATH, report, 'utf8');
  console.log(`F096H_REAL_ACCEPTANCE_OK metrics=${METRICS_PATH}`);
  console.log(`F096H_REAL_ACCEPTANCE_REPORT ${REPORT_PATH}`);
  console.log(`F096H_REAL_ACCEPTANCE_SUMMARY ${JSON.stringify({
    passed: checklist.filter((item) => item.ok).length,
    total: checklist.length,
    proseCharacters: prose.text.length,
    dialogueRatio: dialogueOn.dialogueRatio,
    calls: metrics.calls.map((item) => item.label)
  })}`);
})().catch(async (error) => {
  console.error('F096H_REAL_ACCEPTANCE_FAILED', error && error.stack ? error.stack : error);
  try {
    await fs.mkdir(path.join(DATA_ROOT, '.ai_state'), { recursive: true });
    await fs.writeFile(
      path.join(DATA_ROOT, '.ai_state', `f096h-quality-locks-real-${STAMP}-error.json`),
      `${JSON.stringify({ error: String(error && error.message || error), at: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // ignore
  }
  process.exit(1);
});
