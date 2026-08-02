/* global settingsState, workflowGenerationLaunchConfig, workflowState */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const settingsService = require('../desktop/services/settings-service');

async function activeStage(page, title) {
  await page.waitForFunction((expected) => {
    const node = document.querySelector('.desktop-workflow-step-card.is-active strong');
    return node && node.textContent.includes(expected);
  }, title);
}

async function generateAndApprove(page, title) {
  await activeStage(page, title);
  await page.click('[data-workflow-guided-generate]');
  await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
  await page.click('[data-workflow-guided-approve]');
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-creation-guided-ui-'));
  let servers = null;
  let browser = null;
  try {
    await settingsService.updateSettings(dataRoot, {
      globalPrompt: { enabled: true, content: 'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL' }
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const browserErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => settingsState.settings?.globalPrompt?.content === 'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL');
    assert.strictEqual(
      await page.evaluate(() => workflowGenerationLaunchConfig().snapshot.globalPrompt),
      'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL',
      'workflow launch config should include the active global prompt'
    );
    await page.click('[data-view-target="workflow"]');

    await page.evaluate(() => {
      window.__creationThinkingSeen = false;
      window.__creationGlobalPromptSeen = false;
      window.__creationReviewCount = 0;
      window.__blueprintRepairSeen = false;
      window.__structuredMaxTokensSeen = 0;
      window.__draftHarborGenerationStub = async (prompt, onToken, settings) => {
        if (settings && settings.enableThinking) window.__creationThinkingSeen = true;
        if (settings && settings.globalPrompt === 'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL') window.__creationGlobalPromptSeen = true;
        window.__structuredMaxTokensSeen = Math.max(window.__structuredMaxTokensSeen, Number(settings && settings.maxTokens) || 0);
        const system = prompt.messages[0].content;
        let output = '';
        onToken('正在推演新作结构与人物关系…', { type: 'reasoning' });
        if (system.includes('长篇小说策划编辑')) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          output = JSON.stringify({
            workingTitle: '潮汐回声', premise: '失忆潜水员在沉没城市寻找自己的死亡记录。', genre: '科幻悬疑', targetLength: 180000,
            themes: ['身份', '记忆'], tone: '潮湿、冷峻', pov: '第三人称限知', setting: '周期性沉没的近未来海港城',
            endingPreference: '真相揭开但保留代价', mustInclude: ['死亡记录'], avoid: ['梦境解释一切'], notes: '主角必须主动做出选择。'
          });
        } else if (system.includes('创意方向')) {
          output = JSON.stringify({ directions: [
            { id: 'identity', title: '身份谜案', premise: '潜水员追查多个自己的来源。', plotFocus: '记忆与复制', emotionalArc: '迷惘到决断', risks: [] },
            { id: 'city', title: '城市阴谋', premise: '管理 AI 正在改写整座城市的记忆。', plotFocus: '集体真相', emotionalArc: '信任到背叛', risks: [] }
          ] });
        } else if (system.includes('严格的 JSON 修复器')) {
          const repair = JSON.parse(prompt.messages[1].content);
          window.__blueprintRepairSeen = repair.task.includes('故事蓝图');
          output = JSON.stringify({ title: '潮汐回声', logline: '失忆潜水员必须证明自己不是复制品。', themes: ['身份'], centralConflict: { protagonistGoal: '找回死亡记录', opposingForce: '管理 AI', stakes: '幸存者身份', dilemma: '真相会摧毁共同记忆' }, acts: [{ id: 'dive', title: '下潜', purpose: '进入沉城', turningPoint: '发现自己的墓碑', emotionalDirection: '疑惑转恐惧' }], characterArcs: [{ character: '苏晚', start: '逃避', change: '直面真相', end: '主动选择身份' }], worldRules: ['城市随潮汐沉没'], endingDirection: '开放式胜利' });
        } else if (system.includes('设计可编辑的长篇故事蓝图')) {
          output = '{"title":"潮汐回声","logline":"被截断的蓝图';
          onToken(output, { type: 'content' });
          onToken('', { type: 'finish', finishReason: 'length' });
          return;
        } else if (system.includes('只生成角色资料')) {
          output = JSON.stringify({ cards: [
            { id: 'su-wan', type: 'character', title: '苏晚', summary: '失忆潜水员', aliases: [], characterProfile: { role: '主角', goal: '找回记录', motivation: '证明存在', conflict: '害怕自己是复制品' } }
          ] });
        } else if (system.includes('只生成世界观资料')) {
          output = JSON.stringify({ cards: [
            { id: 'tide-city', type: 'location', title: '潮汐城', summary: '周期性被海水淹没的城市' }
          ] });
        } else if (system.includes('fineOutline 必须是字符串数组')) {
          output = JSON.stringify({ fineOutlineEnabled: true, scenes: [
            { id: 'dive', title: '第一次下潜', povCharacter: '苏晚', location: '潮汐城', goal: '进入城市', conflict: '氧气泄漏', outcome: '发现墓碑', participants: ['苏晚'], turningPoint: '墓碑上是自己的名字', hook: '墓碑日期来自明天', emotionalStart: '戒备', emotionalEnd: '恐惧', emotionalBeat: '身份动摇', pace: 'fast', conflictIntensity: 82, informationDensity: 55, targetWords: 3000, fineOutline: ['穿过闸门', '发现墓碑'] },
            { id: 'archive', title: '死亡档案', povCharacter: '苏晚', location: '档案馆', goal: '读取记录', conflict: 'AI 封锁', outcome: '取得副本', participants: ['苏晚'], turningPoint: '记录显示她已死', hook: '监控中出现另一个她', emotionalStart: '恐惧', emotionalEnd: '决绝', emotionalBeat: '接受真相', pace: 'medium', conflictIntensity: 68, informationDensity: 75, targetWords: 2800, fineOutline: ['潜入档案馆', '读取记录'] }
          ] });
        } else if (system.includes('连续性编辑')) {
          window.__creationReviewCount += 1;
          output = window.__creationReviewCount === 2
            ? JSON.stringify({
              summary: '发现过程标签',
              findings: [{
                type: 'process_label_leak',
                severity: 'error',
                sceneId: 'dive',
                sceneTitle: '第一次下潜',
                evidence: '场景 6-1',
                suggestion: '删除过程标签并保留故事事实。'
              }]
            })
            : JSON.stringify({ summary: '审查通过', findings: [] });
        } else {
          const payload = JSON.parse(prompt.messages[1].content);
          output = `${payload.currentScene.title}的验收正文。苏晚在潮水与警报声中继续寻找自己的记录。`;
        }
        onToken(output, { type: 'content' });
      };
    });

    await page.selectOption('[data-workflow-mode]', 'creation');
    assert.strictEqual(await page.locator('[data-workflow-thinking]').isChecked(), true, 'workflow thinking must be enabled by default for supported models');
    assert.ok(await page.locator('[data-workflow-model] option').count() >= 1, 'workflow launch must expose its effective model');
    await page.click('[data-workflow-creation-fields] > details > summary');
    await page.fill('[data-workflow-creation-title]', '潮汐档案');
    await page.fill('[data-workflow-creation-inspiration]', '失忆潜水员寻找自己的死亡记录。');
    await page.fill('[data-workflow-creation-genre]', '科幻悬疑');
    await page.fill('[data-workflow-creation-target-length]', '180000');
    await page.fill('[data-workflow-creation-themes]', '身份，记忆');
    await page.fill('[data-workflow-creation-setting]', '周期性沉没的近未来海港城');
    assert.strictEqual(await page.locator('[data-workflow-start-creation]').isDisabled(), true, 'creation must wait for an approved Brief');
    await page.click('[data-workflow-creation-complete]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-reasoning-content]')?.textContent.includes('正在推演新作结构'));
    await page.waitForSelector('[data-workflow-creation-brief]:not([hidden])');
    assert.strictEqual(await page.locator('[data-workflow-brief-thinking]').isChecked(), true, 'Brief rewrite must share the workflow thinking setting');
    assert.strictEqual(await page.locator('[data-workflow-brief-model]').inputValue(), await page.locator('[data-workflow-model]').inputValue(), 'Brief rewrite must share the workflow model');
    assert.strictEqual(await page.locator('[data-workflow-creation-brief-editor="workingTitle"]').inputValue(), '潮汐档案', 'user-provided title must remain locked during completion');
    await page.click('[data-workflow-creation-brief-close]');
    assert.strictEqual(await page.locator('[data-workflow-creation-brief]').isHidden(), true, 'Brief close button must hide the editor');
    await page.click('[data-workflow-creation-edit]');
    assert.strictEqual(await page.locator('[data-workflow-creation-brief]').isVisible(), true, 'Brief editor must reopen from the launcher');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('[data-workflow-creation-brief]').isHidden(), true, 'Escape must close the Brief editor');
    await page.click('[data-workflow-creation-edit]');
    await page.check('[data-workflow-creation-brief-field="tone"]');
    await page.fill('[data-workflow-creation-rewrite-instruction]', '更冷峻一些。');
    await page.click('[data-workflow-creation-rewrite]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-creation-brief-editor="tone"]')?.value === '潮湿、冷峻');
    await page.click('[data-workflow-creation-apply]');
    assert.strictEqual(await page.locator('[data-workflow-creation-brief]').isHidden(), true, 'saving the Brief must return to the launcher');
    assert.strictEqual(await page.locator('[data-workflow-start-creation]').isDisabled(), false, 'from-zero creation must be available after confirming the Brief');
    assert.strictEqual(
      await page.evaluate(() => workflowGenerationLaunchConfig().snapshot.globalPrompt),
      'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL',
      'global prompt must still be present when the creation run starts'
    );
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const url = String(args[0] || '');
        if (url.includes('/api/workflows/v2/create-project-and-start-creation')) {
          window.__creationStartPayload = JSON.parse(args[1]?.body || '{}');
        }
        return originalFetch(...args);
      };
    });
    await page.click('[data-workflow-start-creation]');

    await page.waitForFunction(() => document.querySelector('[data-native-project-title]')?.textContent.includes('潮汐档案'));
    const creationProjectId = await page.evaluate(async () => {
      const response = await fetch('/api/list-projects', { cache: 'no-store' });
      const result = await response.json();
      return (result.projects || []).find((project) => project.name === '潮汐档案')?.id || '';
    });
    assert.ok(creationProjectId, 'from-zero creation should create and open a project');
    assert.strictEqual(
      await page.evaluate(() => window.__creationStartPayload?.generationPolicy?.snapshot?.globalPrompt),
      'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL',
      'creation start request must include the frozen global prompt'
    );
    await page.waitForFunction(() =>
      workflowState.runs.find((item) => item.id === workflowState.selectedId)?.settings?.generationPolicy?.snapshot);
    const storedLaunchSnapshot = await page.evaluate(() =>
      workflowState.runs.find((item) => item.id === workflowState.selectedId)?.settings?.generationPolicy?.snapshot);
    assert.strictEqual(
      storedLaunchSnapshot?.globalPrompt,
      'UI-WORKFLOW-GLOBAL-PROMPT-SENTINEL',
      `workflow launch must freeze the active global prompt into the run snapshot: ${JSON.stringify(storedLaunchSnapshot)}`
    );

    await activeStage(page, '创意方向');
    await page.click('[data-workflow-guided-generate]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-reasoning-content]')?.textContent.includes('正在推演新作结构'));
    await page.waitForSelector('.desktop-workflow-direction-options input');
    assert.ok(await page.locator('.desktop-workflow-direction-options input').first().isChecked());
    await page.waitForSelector('[data-workflow-current-result]');
    assert.ok((await page.locator('[data-workflow-current-result]').innerText()).includes('身份谜案'));
    assert.strictEqual(await page.locator('[data-workflow-guided-regenerate]').isVisible(), true);
    assert.strictEqual(await page.locator('[data-workflow-reasoning-bubble]').isHidden(), true, 'completed reasoning must not cover the generated artifact');
    await page.click('[data-workflow-reasoning-show]');
    assert.strictEqual(await page.locator('[data-workflow-reasoning-bubble]').isVisible(), true, 'completed reasoning should remain available on demand');
    await page.click('[data-workflow-reasoning-close]');
    await page.click('[data-workflow-guided-approve]');

    await activeStage(page, '故事蓝图与冲突结构');
    assert.strictEqual(await page.locator('[data-workflow-guided-return="direction"]').isVisible(), true);
    await page.click('[data-workflow-launcher] > summary');
    await page.uncheck('[data-workflow-thinking]');
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      let dropCompletedBlueprintResponse = true;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = String(args[0] || '');
        if (dropCompletedBlueprintResponse && url.includes('/api/workflows/v2/complete-creation-node')) {
          dropCompletedBlueprintResponse = false;
          window.fetch = originalFetch;
          throw new TypeError('simulated lost response after server completion');
        }
        return response;
      };
    });
    await page.click('[data-workflow-guided-generate]');
    await page.waitForSelector('[data-artifact-view="json"]');
    await page.click('[data-artifact-view="json"]');
    await page.waitForSelector('[data-workflow-artifact-editor]:not([readonly])');
    assert.strictEqual(await page.locator('[data-artifact-view]').count(), 3, 'artifact result should support readable, form and raw JSON views');
    assert.strictEqual(await page.locator('[data-workflow-artifact-rewrite-thinking]').isChecked(), true, 'artifact AI rewrite thinking should default to enabled');
    assert.strictEqual(await page.locator('[data-workflow-artifact-rewrite-model]').count(), 1, 'artifact AI rewrite should expose model selection');
    assert.ok((await page.locator('[data-workflow-step-progress]').innerText()).includes('等待确认'));
    assert.ok((await page.locator('[data-workflow-status]').innerText()).includes('已从本地运行恢复'), 'a completed node must recover when the browser loses the completion response');
    assert.strictEqual(await page.evaluate(() => window.__blueprintRepairSeen), true, 'truncated JSON should be repaired automatically before completion');
    assert.strictEqual(await page.locator('[data-workflow-reasoning-bubble]').isHidden(), true, 'completed reasoning must stay out of the artifact editor');
    assert.strictEqual(await page.locator('[data-workflow-reasoning-show]').count(), 1, 'the run must retain its launch-time thinking setting after the form changes');
    await page.click('[data-workflow-guided-cancel]');
    await page.waitForSelector('[data-workflow-guided-resume]');
    assert.ok((await page.locator('[data-workflow-title]').innerText()).includes('已取消'), 'cancelled runs must not be labelled completed');
    await page.click('[data-workflow-guided-resume]');
    await page.waitForSelector('[data-workflow-guided-approve]:not([disabled])');
    await page.click('[data-workflow-guided-approve]');
    await activeStage(page, '人物与世界观资料草稿');
    await page.click('[data-workflow-guided-generate]');
    try {
      await page.waitForSelector('[data-artifact-view="json"]');
      await page.click('[data-artifact-view="json"]');
      await page.waitForSelector('[data-workflow-artifact-editor]:not([readonly])');
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        status: document.querySelector('[data-workflow-status]')?.textContent || '',
        active: document.querySelector('.desktop-workflow-step-card.is-active strong')?.textContent || '',
        artifact: document.querySelector('[data-workflow-artifact-editor]')?.value || ''
      }));
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
    }
    const cardEditor = page.locator('[data-workflow-artifact-editor]');
    const cards = JSON.parse(await cardEditor.inputValue());
    cards.entries.find((entry) => entry.title === '苏晚').aliases = ['小晚'];
    await cardEditor.fill(JSON.stringify(cards, null, 2));
    await page.click('[data-workflow-artifact-save]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]')?.textContent.includes('修改已保存'));
    await page.click('[data-workflow-artifact-history]');
    await page.waitForFunction(() => document.querySelectorAll('.desktop-workflow-artifact-history-item').length >= 2);
    await page.click('[data-workflow-guided-approve]');

    await generateAndApprove(page, '节奏与场景计划');
    await generateAndApprove(page, '分场正文');
    await activeStage(page, '自动审查');
    await page.click('[data-workflow-guided-generate]');
    await activeStage(page, '转到写作与资料库');
    assert.strictEqual(await page.locator('[data-workflow-creation-batch-progress]').isVisible(), true);
    assert.strictEqual(await page.locator('[data-workflow-creation-repair-batch]').isVisible(), true);
    assert.strictEqual(await page.locator('[data-workflow-creation-adjust-continue]').isVisible(), true);
    assert.strictEqual(await page.locator('[data-workflow-creation-continue]').isVisible(), true);
    assert.strictEqual(
      await page.locator('[data-workflow-creation-continue]').isDisabled(),
      false,
      `a clean review should allow continuation: ${await page.locator('[data-workflow-creation-batch-progress]').innerText()}`
    );
    await page.click('[data-workflow-creation-continue]');
    await activeStage(page, '节奏与场景计划');
    await generateAndApprove(page, '节奏与场景计划');
    await generateAndApprove(page, '分场正文');
    await activeStage(page, '自动审查');
    await page.click('[data-workflow-guided-generate]');
    await activeStage(page, '转到写作与资料库');
    assert.ok((await page.locator('[data-workflow-creation-batch-progress]').innerText()).includes('第 2 批'));
    assert.ok((await page.locator('[data-workflow-creation-batch-progress]').innerText()).includes('质量门禁未通过'));
    assert.strictEqual(await page.locator('[data-workflow-guided-transfer-writer]').isDisabled(), true);
    await page.locator('.desktop-workflow-artifact-tab').filter({ hasText: '自动审查报告' }).last().click();
    await page.click('[data-artifact-view="readable"]');
    await page.click('[data-workflow-repair-finding="dive"]');
    await activeStage(page, '分场正文');
    await generateAndApprove(page, '分场正文');
    await activeStage(page, '自动审查');
    await page.click('[data-workflow-guided-generate]');
    await activeStage(page, '转到写作与资料库');
    assert.strictEqual(await page.locator('[data-workflow-guided-transfer-writer]').isDisabled(), false);
    assert.strictEqual(await page.locator('[data-workflow-guided-transfer-writer]').innerText(), '结束并回流正文');
    await page.click('[data-workflow-guided-transfer-compendium]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('资料建议已写入资料库'));
    await page.click('[data-workflow-guided-transfer-writer]');
    await page.waitForSelector('dialog[data-workflow-assembly-dialog][open]', { timeout: 15000 });
    await page.waitForSelector('[data-workflow-assembly-chapter]', { timeout: 15000 });
    // Rename first chapter if input present (must not become 第 N 批).
    const titleInput = page.locator('[data-workflow-assembly-chapter] input[type="text"]').first();
    await titleInput.fill('潮水初临');
    await titleInput.blur();
    await page.click('[data-workflow-assembly-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('正文已转入写作区'), null, { timeout: 20000 });
    // Idempotent re-open assembly and confirm again.
    await page.click('[data-workflow-guided-transfer-writer]');
    await page.waitForSelector('dialog[data-workflow-assembly-dialog][open]', { timeout: 15000 });
    await page.waitForSelector('[data-workflow-assembly-chapter]', { timeout: 15000 });
    await page.click('[data-workflow-assembly-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('正文已转入写作区'), null, { timeout: 20000 });

    const opened = await projectService.openProject(dataRoot, creationProjectId);
    const generated = opened.project.scenes.filter((scene) => scene.sourceRunId);
    assert.strictEqual(generated.length, 4);
    assert.ok(generated.every((scene) => scene.sourceArtifactId && scene.sourceRevisionId));
    assert.ok(opened.project.chapters.every((chapter) => !/^第\s*\d+\s*批/.test(String(chapter.title || ''))));
    assert.strictEqual(await page.evaluate(() => window.__creationThinkingSeen), true);
    assert.strictEqual(await page.evaluate(() => window.__creationGlobalPromptSeen), true, 'workflow provider calls must receive the frozen global prompt');
    const compendiumResponse = await fetch(`${servers.appUrl}/api/compendium?projectId=${encodeURIComponent(creationProjectId)}`);
    const compendium = await compendiumResponse.json();
    assert.ok(compendium.entries.some((entry) => entry.title === '苏晚' && entry.aliases.includes('小晚')));
    assert.ok(compendium.entries.some((entry) => entry.title === '潮汐城'));
    assert.ok(await page.evaluate(() => window.__structuredMaxTokensSeen >= 16000), 'long structured workflow stages should receive an expanded output budget');
    assert.deepStrictEqual(browserErrors, []);
    console.log('Workflow creation guided UI test passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workflow creation guided UI test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
