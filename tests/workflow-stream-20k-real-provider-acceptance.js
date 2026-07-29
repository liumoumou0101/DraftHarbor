const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const settingsService = require('../desktop/services/settings-service');
const projectService = require('../desktop/services/project-service');
const Creation = require('../desktop/services/workflow-creation-guided-service');
const Review = require('../desktop/services/workflow-review-service');
const eventStore = require('../desktop/storage/workflow-event-store-v2');
const { startDesktopServers } = require('../desktop/local-server');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = process.env.WORKFLOW_STREAM_20K_PROJECT_ID || 'f096e-real-stream-20k-redhood-20260730';
const PROJECT_TITLE = '真实流式验收 · 小红帽与失名狼群';
const RUN_ID = 'f096e-real-stream-20k-creation';
const RUN_TITLE = 'F-09.6E 真实流式正文两万字验收';
const TARGET_CHARACTERS = 20000;
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', `${PROJECT_ID}-metrics.json`);
const SCREENSHOT_PATH = path.join(DATA_ROOT, '.ai_state', `${PROJECT_ID}-streaming.png`);

const brief = {
  title: '小红帽与失名狼群',
  premise: '红月前夜，十六岁的小红帽发现村庄献给森林的不是食物，而是孩子们被抹去的名字。母亲失踪后，她必须带着会记录谎言的红斗篷穿过活森林，在外婆、猎人教团和正在失去语言的狼群之间追出同一桩旧罪。',
  genre: '黑童话、悬疑奇幻、成长',
  targetWords: TARGET_CHARACTERS,
  themes: ['名字与身份', '代际隐瞒', '自由与代价', '怪物与文明'],
  tone: '阴郁、克制、危险；恐怖来自规则、选择和关系，不依赖连续血腥描写',
  pov: '小红帽第三人称限知',
  setting: '红月支配的边境村庄与会吞食名字、记忆和谎言的活森林。红斗篷能记录穿戴者亲口说出的谎言。',
  endingPreference: '本次只生成一个完整的开篇单元，在第四场形成阶段性高潮和明确的新问题。',
  mustInclude: [
    '小红帽主动提出并完成一次与狼的危险交易',
    '红斗篷记录谎言的规则至少被验证两次',
    '母亲失踪、外婆隐瞒和猎人教团之间出现可追查的因果线索'
  ],
  avoid: [
    '用梦境、精神失常或幻觉解释核心谜团',
    '泄露场景计划、Prompt、JSON、targetWords 或批次编号',
    '让小红帽长期被动跟随他人的命令',
    '连续堆砌高密度比喻'
  ]
};

const directions = {
  directions: [
    {
      id: 'trade-with-wolf',
      title: '以名字为饵',
      premise: '小红帽主动用自己名字的一部分换取狼群带路。',
      plotFocus: '规则交易、母亲线索与猎人追捕',
      emotionalArc: '戒备到共谋，再到发现交易代价',
      risks: ['交易不能显得轻易', '狼必须拥有自己的政治与目的']
    },
    {
      id: 'grandmother-door',
      title: '外婆的第二扇门',
      premise: '外婆家存在一扇只对说谎者开启的门。',
      plotFocus: '家庭旧罪和红斗篷规则',
      emotionalArc: '思念到怀疑',
      risks: ['不能过早解释全部真相']
    }
  ]
};

const blueprint = {
  title: '小红帽与失名狼群',
  logline: '为了找回母亲，小红帽拿自己的名字与狼交易，却发现红斗篷记录的每个谎言都在替村庄续写一份吃人的契约。',
  themes: brief.themes,
  centralConflict: {
    protagonistGoal: '穿过森林找到母亲失踪的真实路径',
    opposingForce: '猎人教团维护的献名规则与森林的记忆饥饿',
    stakes: '她会失去名字、语言以及辨认母亲的能力',
    dilemma: '保住自己的完整身份，或牺牲一部分名字换取改变规则的机会'
  },
  acts: [
    { title: '谎言落墨', purpose: '验证红斗篷规则并迫使小红帽主动入林', turningPoint: '她发现母亲留下的假脚印' },
    { title: '名字交易', purpose: '建立狼群政治和危险同盟', turningPoint: '交易让她暂时忘记自己的乳名' },
    { title: '第二扇门', purpose: '把外婆旧罪与猎人教团连接', turningPoint: '红斗篷写出母亲仍活着的证据' }
  ],
  endingDirection: '第四场完成开篇阶段性高潮：小红帽主动试写契约并付出可见代价，同时留下可继续成长篇的新问题。'
};

const compendium = {
  cards: [
    {
      type: 'character',
      title: '小红帽·洛塔',
      summary: '十六岁的送信人，擅长记路和分辨口音，害怕被别人替她做决定。',
      characterProfile: {
        role: '主角',
        goal: '找回母亲并查清献名规则',
        motivation: '拒绝继承家族沉默',
        conflict: '每次利用红斗篷都必须先说出一个谎言',
        arc: '从证明自己没有撒谎，到学会主动承担谎言的代价'
      }
    },
    {
      type: 'character',
      title: '缺耳狼·乌恩',
      summary: '正在失去语言的年轻狼使者，既需要人类名字维持族群记忆，也憎恨献名契约。',
      characterProfile: {
        role: '危险盟友',
        goal: '带回被猎人封存的狼群真名',
        motivation: '阻止幼狼失去语言',
        conflict: '与小红帽的交易会伤害双方',
        arc: '从利用人类到承认共同责任'
      }
    },
    { type: 'character', title: '外婆·伊妲', summary: '上一代红斗篷守门人，爱小红帽，但参与过献名契约。' },
    { type: 'faction', title: '白角猎人教团', summary: '以保护村庄为名维护献名仪式，成员割去自己童年的乳名。' },
    { type: 'location', title: '活森林', summary: '会重排道路、吞食名字和记忆；无法吞下被红斗篷记录并见证的谎言。' }
  ]
};

const plan = {
  fineOutlineEnabled: true,
  scenes: [
    {
      id: 'ink-under-the-cloak',
      title: '斗篷内侧的黑字',
      povCharacter: '洛塔',
      location: '村庄边缘与母亲废弃的缝纫间',
      goal: '确认母亲留下的入林路线',
      conflict: '猎人要求她走官方小径，而红斗篷在她撒谎后写出相反证据',
      outcome: '洛塔主动制造第二个谎言，验证斗篷规则并摆脱猎人',
      emotionalBeat: '不安转为决意',
      targetWords: 4000,
      fineOutline: ['送食物任务被临时改道', '猎人盘问母亲去向', '第一个谎言在斗篷内侧落墨', '洛塔用第二个可控谎言验证规则', '发现母亲留下的假脚印并主动入林']
    },
    {
      id: 'bridge-of-wolf-teeth',
      title: '狼牙桥上的名字交易',
      povCharacter: '洛塔',
      location: '由巨大狼牙组成的断桥',
      goal: '让失名狼群带她穿过会重排道路的森林',
      conflict: '乌恩要求她交出乳名的一部分，猎人追踪声逼近',
      outcome: '洛塔主动提出更危险但有限期的交易，并失去一段童年称呼',
      emotionalBeat: '敌意转为脆弱共谋',
      targetWords: 4000,
      fineOutline: ['乌恩用人类句子试探洛塔', '双方交换可验证情报', '猎人逼近迫使谈判加速', '洛塔拒绝被动接受狼的条件并提出反约', '交易完成后她发现自己忘记乳名']
    },
    {
      id: 'grandmothers-second-door',
      title: '外婆屋里的第二扇门',
      povCharacter: '洛塔',
      location: '森林深处的外婆木屋',
      goal: '追问母亲和献名契约的关系',
      conflict: '外婆用保护之名拒绝开门，红斗篷不断记录她的谎言',
      outcome: '洛塔利用已经验证的规则打开隐藏门，看到母亲仍活着的证据',
      emotionalBeat: '重逢希望转为背叛感',
      targetWords: 4000,
      fineOutline: ['木屋出现两套不一致的生活痕迹', '外婆回避乌恩和母亲的话题', '斗篷记录外婆自相矛盾的谎言', '洛塔让乌恩见证谎言以迫使第二扇门显形', '门后保存着母亲最近留下的血温指印']
    },
    {
      id: 'first-draft-of-the-covenant',
      title: '红月下的契约试写',
      povCharacter: '洛塔',
      location: '木屋地下的旧献名室',
      goal: '在猎人闯入前试写一条能保护狼群幼崽和村庄孩子的新规则',
      conflict: '旧契约要求书写者交出最珍贵的称呼，外婆和乌恩对代价意见相反',
      outcome: '洛塔主动完成试写并救下第一批名字，但代价是母亲再也无法用旧称呼唤醒她',
      emotionalBeat: '恐惧转为承担代价后的清醒',
      targetWords: 4000,
      fineOutline: ['猎人包围木屋并启动旧仪式', '外婆承认自己当年的选择但不求原谅', '洛塔从前两次斗篷落墨推导契约漏洞', '她主动写下临时新规则并要求乌恩共同见证', '孩子和幼狼取回语言，洛塔却失去母亲呼唤她的旧名字']
    }
  ]
};

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

async function configuredProvider() {
  const settings = await settingsService.readSettings(DATA_ROOT);
  const configuredProfileId = clean(settings.workflowGeneration?.providerProfileId);
  const preferredProfile = (settings.providerProfiles || []).find((profile) =>
    profile.id === configuredProfileId && clean(profile.apiKey)
  ) || (settings.providerProfiles || []).find((profile) =>
    profile.model === 'deepseek-v4-pro' && clean(profile.apiKey)
  );
  const extras = {
    ...(preferredProfile ? { profileId: preferredProfile.id } : {}),
    model: 'deepseek-v4-pro',
    temperature: 0.72,
    maxTokens: 12000,
    useProviderDefaults: false
  };
  const config = settingsService.runtimeProviderConfig(settings, extras);
  if (!config.apiKey || !config.endpoint) throw new Error('没有找到已保存的 DeepSeek API 配置');
  return {
    settings,
    profileId: preferredProfile?.id || 'inherit',
    config
  };
}

async function openProjectIfPresent() {
  try {
    return await projectService.openProject(DATA_ROOT, PROJECT_ID);
  } catch {
    return null;
  }
}

async function getRunIfPresent() {
  try {
    return await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  } catch {
    return null;
  }
}

async function ensureSeeded(provider) {
  let opened = await openProjectIfPresent();
  if (!opened) {
    await projectService.createProject(DATA_ROOT, {
      id: PROJECT_ID,
      title: PROJECT_TITLE,
      description: '真实 DeepSeek 两万字正文流与实时创作舞台验收项目。保留用于人工质量检查。',
      status: '真实 API 测试',
      tags: ['F-09.6E', '真实流式', '两万字']
    });
    opened = await projectService.openProject(DATA_ROOT, PROJECT_ID);
  }
  let details = await getRunIfPresent();
  if (!details) {
    await Creation.startGuidedCreation({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      title: RUN_TITLE,
      brief,
      writingInstructions: {
        text: '保持克制的第三人称限知。让冲突通过动作、选择和有目的的对话发生；每场都必须改变关系、事实或风险。四场组成完整开篇单元，不要输出场景标题、计划说明、Markdown 标题或任何创作过程标签。',
        styleAndDistance: '贴近洛塔感官但不滥用比喻；自然段清晰，适合长篇阅读。',
        dialogueRatio: '约 25%–35%，根据独处或追逐场景合理浮动',
        pacingPreference: '调查、谈判、揭示、行动高潮逐级推进',
        mustAvoid: ['解释已经通过行动展示的规则', '连续三段高密度比喻', '技术说明腔', '同义重复场景结尾'],
        applicableStages: ['draft', 'review']
      },
      constraints: [
        { kind: 'fact', text: '红斗篷记录穿戴者亲口说出的谎言', enforcement: 'hard', weight: 5 },
        { kind: 'direction', text: '小红帽必须主动提出并完成一次与狼的危险交易', enforcement: 'hard', weight: 5 },
        { kind: 'exclusion', text: '不得用梦境、精神失常或幻觉解释核心谜团', enforcement: 'hard', weight: 5 }
      ],
      generationPolicy: {
        providerProfileId: provider.profileId,
        snapshot: {
          source: provider.profileId === 'inherit' ? 'default-writing' : 'workflow-profile',
          profileId: provider.profileId === 'inherit' ? '' : provider.profileId,
          label: '真实 DeepSeek 流式验收',
          mode: provider.config.mode,
          provider: provider.config.provider,
          endpoint: provider.config.endpoint,
          baseUrl: provider.config.baseUrl || '',
          organization: provider.config.organization || '',
          model: provider.config.model,
          temperature: provider.config.temperature,
          maxTokens: 12000,
          globalPrompt: provider.config.globalPrompt || '',
          enableThinking: true,
          useProviderDefaults: false
        }
      }
    });
    details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  }

  const stages = [
    { id: 'direction', output: directions, approve: { selectedDirectionIds: ['trade-with-wolf', 'grandmother-door'] } },
    { id: 'blueprint', output: blueprint },
    { id: 'compendium', output: compendium },
    { id: 'plan', output: plan }
  ];
  for (const stage of stages) {
    details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
    if (details.run.activeNodeId !== stage.id) continue;
    const step = details.run.steps.find((item) => item.id === stage.id);
    if (step?.status === 'ready' || step?.status === 'failed') {
      await Creation.completeCreationNode({
        dataRoot: DATA_ROOT,
        projectId: PROJECT_ID,
        runId: RUN_ID,
        nodeId: stage.id,
        outputs: [JSON.stringify(stage.output)]
      });
    }
    await Creation.approveCreationNode({
      dataRoot: DATA_ROOT,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      nodeId: stage.id,
      ...(stage.approve || {})
    });
  }
  details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  assert.strictEqual(details.run.activeNodeId, 'draft', `测试运行没有到达正文阶段，而是 ${details.run.activeNodeId}`);
  return { opened, details };
}

function summarizeUsage(events) {
  const draftEvents = events.filter((event) => event.type === 'guided_node_generated' && event.nodeId === 'draft');
  const records = new Map();
  draftEvents.forEach((event) => {
    (event.payload.usage || []).forEach((item) => {
      const id = clean(item.promptId) || `${records.size + 1}`;
      records.set(id, item);
    });
  });
  return Array.from(records.values()).map((item) => ({
    promptId: item.promptId,
    model: item.model,
    promptTokens: Number(item.prompt_tokens || item.input_tokens || 0),
    completionTokens: Number(item.completion_tokens || item.output_tokens || 0),
    totalTokens: Number(item.total_tokens || 0),
    cacheHitTokens: Number(item.prompt_cache_hit_tokens || item.prompt_tokens_details?.cached_tokens || 0)
  }));
}

function objectiveQuality(drafts) {
  const text = drafts.map((artifact) => artifact.content).join('\n\n');
  const dialogueCharacters = (text.match(/[“「『][^”」』]{1,400}[”」』]/g) || [])
    .reduce((sum, item) => sum + item.length, 0);
  const forbiddenPatterns = [
    /场景\s*\d+(?:[-—]\d+)?/g,
    /\b(?:fineOutline|targetWords|batchContext|currentScene|scenePlan|Prompt|JSON)\b/gi,
    /第\s*\d+\s*批/g,
    /^#{1,3}\s+/gm
  ];
  return {
    totalCharacters: text.length,
    sceneCount: drafts.length,
    averageSceneCharacters: drafts.length ? Math.round(text.length / drafts.length) : 0,
    dialogueCharacterRatio: text.length ? dialogueCharacters / text.length : 0,
    forbiddenPatternHits: forbiddenPatterns.reduce((sum, pattern) => sum + (text.match(pattern) || []).length, 0),
    paragraphCount: text.split(/\n\s*\n/).map(clean).filter(Boolean).length,
    motifOccurrences: {
      redCloak: (text.match(/红斗篷/g) || []).length,
      name: (text.match(/名字|乳名|称呼/g) || []).length,
      lie: (text.match(/谎言|撒谎/g) || []).length,
      activeChoice: (text.match(/主动|选择|决定|拒绝|提出|答应/g) || []).length
    }
  };
}

async function runRealUiGeneration() {
  let servers = null;
  let browser = null;
  const browserErrors = [];
  try {
    servers = await startDesktopServers({
      appRoot: DATA_ROOT,
      dataRoot: DATA_ROOT,
      revealPath: async () => ''
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    const projectCard = page.locator(`.desktop-project-card[data-project-id="${PROJECT_ID}"]`);
    await projectCard.waitFor({ timeout: 30000 });
    await projectCard.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((title) =>
      document.querySelector('[data-native-project-title]')?.textContent.includes(title), PROJECT_TITLE
    );
    await page.click('[data-view-target="workflow"]');
    await page.waitForSelector('[data-view-panel="workflow"].is-active');
    const runButton = page.locator('[data-workflow-run-list] .desktop-workflow-run').filter({ hasText: RUN_TITLE }).first();
    if (await runButton.count()) await runButton.click();
    await page.waitForFunction(() =>
      document.querySelector('.desktop-workflow-step-card.is-active strong')?.textContent.includes('分场正文')
    );
    assert.ok((await page.locator('[data-workflow-ai-config]').innerText()).includes('deepseek-v4-pro'));

    await page.evaluate(() => {
      const stage = document.querySelector('[data-workflow-stream-stage]');
      const titleNode = document.querySelector('[data-workflow-stream-title]');
      const textNode = document.querySelector('[data-workflow-stream-text]');
      window.__realWorkflowStreamProbe = {
        requestStartedAt: Date.now(),
        scenes: {},
        phaseEvents: []
      };
      let lastPhaseKey = '';
      const sample = () => {
        const probe = window.__realWorkflowStreamProbe;
        const title = titleNode?.textContent?.trim() || '';
        const textLength = textNode?.textContent?.length || 0;
        const phase = stage?.dataset.phase || '';
        if (!title || title === '正在准备稿纸') return;
        const scene = probe.scenes[title] || {
          title,
          waitingAt: 0,
          firstTextAt: 0,
          lastTextAt: 0,
          completedAt: 0,
          updates: 0,
          peakCharacters: 0,
          samples: []
        };
        const now = Date.now();
        if (phase === 'waiting' && !scene.waitingAt) scene.waitingAt = now;
        if (textLength > scene.peakCharacters) {
          if (!scene.firstTextAt) scene.firstTextAt = now;
          scene.lastTextAt = now;
          scene.updates += 1;
          scene.peakCharacters = textLength;
          if (scene.samples.length < 16) scene.samples.push({ at: now, characters: textLength });
        }
        if (phase === 'complete') scene.completedAt = now;
        probe.scenes[title] = scene;
        const phaseKey = `${title}:${phase}`;
        if (phase && phaseKey !== lastPhaseKey) {
          probe.phaseEvents.push({ at: now, title, phase });
          lastPhaseKey = phaseKey;
        }
      };
      new MutationObserver(sample).observe(stage, {
        attributes: true,
        attributeFilter: ['data-phase'],
        childList: true,
        characterData: true,
        subtree: true
      });
      sample();
    });

    const startedAt = Date.now();
    await page.click('[data-workflow-guided-generate]');
    await page.waitForFunction(() =>
      document.querySelector('[data-workflow-stream-stage]')?.dataset.phase === 'streaming'
      && (document.querySelector('[data-workflow-stream-text]')?.textContent.length || 0) >= 200,
    null, { timeout: 8 * 60 * 1000 });
    const partialSnapshot = await page.evaluate(() => ({
      phase: document.querySelector('[data-workflow-stream-stage]')?.dataset.phase,
      title: document.querySelector('[data-workflow-stream-title]')?.textContent,
      characters: document.querySelector('[data-workflow-stream-text]')?.textContent.length || 0,
      follow: document.querySelector('[data-workflow-stream-follow]')?.getAttribute('aria-pressed')
    }));
    assert.strictEqual(partialSnapshot.phase, 'streaming');
    assert.strictEqual(partialSnapshot.follow, 'true');
    assert.ok(partialSnapshot.characters >= 200);
    await fs.mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    await page.waitForFunction(() => {
      const error = document.querySelector('[data-workflow-generation-error]');
      const approve = document.querySelector('[data-workflow-guided-approve]:not([disabled])');
      return !!error || !!approve;
    }, null, { timeout: 35 * 60 * 1000 });
    const visibleError = await page.locator('[data-workflow-generation-error]').count()
      ? await page.locator('[data-workflow-generation-error]').innerText()
      : '';
    if (visibleError) throw new Error(`真实界面生成失败：${visibleError}`);
    await page.waitForTimeout(250);
    const probe = await page.evaluate(() => window.__realWorkflowStreamProbe);
    const stageState = await page.evaluate(() => ({
      phase: document.querySelector('[data-workflow-stream-stage]')?.dataset.phase,
      title: document.querySelector('[data-workflow-stream-title]')?.textContent,
      characters: document.querySelector('[data-workflow-stream-text]')?.textContent.length || 0,
      status: document.querySelector('[data-workflow-stream-status]')?.textContent
    }));
    assert.strictEqual(stageState.phase, 'complete');
    assert.ok(Object.keys(probe.scenes).length >= plan.scenes.length);
    assert.ok(Object.values(probe.scenes).every((scene) => scene.updates > 1), '真实正文必须分多次抵达界面');
    return {
      startedAt,
      finishedAt: Date.now(),
      partialSnapshot,
      stageState,
      probe,
      browserErrors
    };
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
  }
}

(async () => {
  const provider = await configuredProvider();
  const seeded = await ensureSeeded(provider);
  const existingDrafts = (seeded.details.run.artifacts || []).filter((artifact) => artifact.nodeId === 'draft');
  let ui = null;
  if (existingDrafts.length < plan.scenes.length
    || seeded.details.run.steps.find((step) => step.id === 'draft')?.status !== 'waiting_user') {
    ui = await runRealUiGeneration();
  }

  const details = await Creation.getCreationRun(DATA_ROOT, PROJECT_ID, RUN_ID);
  const drafts = (details.run.artifacts || [])
    .filter((artifact) => artifact.nodeId === 'draft' && artifact.targetRef?.batchId === 'batch-0001')
    .sort((left, right) => Number(left.targetRef?.sceneSequence || 0) - Number(right.targetRef?.sceneSequence || 0));
  assert.strictEqual(drafts.length, plan.scenes.length);
  const deterministicReview = Review.reviewDraft({
    text: drafts.map((artifact) => artifact.content).join('\n\n'),
    scenes: drafts.map((artifact) => ({
      sceneId: artifact.targetRef?.sceneId,
      revisionId: artifact.revision.id,
      title: artifact.title,
      text: artifact.content
    })),
    scenePlan: plan,
    constraints: details.run.settings.constraints || []
  });
  const events = await eventStore.listWorkflowV2Events(seeded.opened.projectPath, RUN_ID);
  const usage = summarizeUsage(events);
  let existingMetrics = {};
  if (!ui) {
    try {
      existingMetrics = JSON.parse(await fs.readFile(METRICS_PATH, 'utf8'));
    } catch {
      existingMetrics = {};
    }
  }
  const metrics = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    projectTitle: PROJECT_TITLE,
    runId: RUN_ID,
    runTitle: RUN_TITLE,
    model: provider.config.model,
    targetCharacters: TARGET_CHARACTERS,
    completedAt: ui ? new Date().toISOString() : existingMetrics.completedAt || new Date().toISOString(),
    totalDurationMs: ui ? ui.finishedAt - ui.startedAt : Number(existingMetrics.totalDurationMs || 0),
    screenshotPath: SCREENSHOT_PATH,
    stream: ui ? {
      partialSnapshot: ui.partialSnapshot,
      finalStage: ui.stageState,
      phaseEvents: ui.probe.phaseEvents,
      scenes: Object.values(ui.probe.scenes).map((scene) => ({
        ...scene,
        firstContentLatencyMs: scene.firstTextAt && scene.waitingAt ? scene.firstTextAt - scene.waitingAt : 0,
        visibleStreamingDurationMs: scene.lastTextAt && scene.firstTextAt ? scene.lastTextAt - scene.firstTextAt : 0
      })),
      browserErrors: ui.browserErrors
    } : existingMetrics.stream || { resumedExistingResult: true },
    drafts: drafts.map((artifact) => ({
      sceneId: artifact.targetRef?.sceneId,
      title: artifact.title,
      revisionId: artifact.revision.id,
      reviewState: artifact.revision.reviewState,
      characters: artifact.content.length,
      opening: artifact.content.slice(0, 180),
      ending: artifact.content.slice(-180)
    })),
    usage,
    usageTotals: usage.reduce((totals, item) => ({
      promptTokens: totals.promptTokens + item.promptTokens,
      completionTokens: totals.completionTokens + item.completionTokens,
      totalTokens: totals.totalTokens + item.totalTokens,
      cacheHitTokens: totals.cacheHitTokens + item.cacheHitTokens
    }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0 }),
    quality: objectiveQuality(drafts),
    deterministicReview
  };
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`WORKFLOW_STREAM_20K_REAL_RESULT ${JSON.stringify({
    projectId: PROJECT_ID,
    runId: RUN_ID,
    metricsPath: METRICS_PATH,
    screenshotPath: SCREENSHOT_PATH,
    durationMinutes: Number((metrics.totalDurationMs / 60000).toFixed(2)),
    quality: metrics.quality,
    usageTotals: metrics.usageTotals,
    streamScenes: metrics.stream.scenes?.map((scene) => ({
      title: scene.title,
      firstContentLatencyMs: scene.firstContentLatencyMs,
      updates: scene.updates,
      peakCharacters: scene.peakCharacters,
      visibleStreamingDurationMs: scene.visibleStreamingDurationMs
    })),
    deterministicReview: {
      qualityGate: deterministicReview.qualityGate,
      blockingFindingCount: deterministicReview.blockingFindingCount,
      findings: deterministicReview.findings.map((finding) => ({
        type: finding.type,
        severity: finding.severity,
        sceneTitle: finding.sceneTitle,
        evidence: finding.evidence
      }))
    }
  })}`);
})().catch((error) => {
  console.error('WORKFLOW_STREAM_20K_REAL_FAILED', error && error.stack ? error.stack : error);
  process.exit(1);
});
