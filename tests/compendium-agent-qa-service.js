const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const compendiumAgentService = require('../desktop/services/compendium-agent-service');
const settingsService = require('../desktop/services/settings-service');
const { createCompendiumAgentQaService, rankEntries, sanitizeAnswer } = require('../desktop/services/compendium-agent-qa-service');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-qa-'));
  try {
    await projectService.createProject(root, { id: 'qa-project', title: 'QA Project' });
    const linyan = (await compendiumService.saveEntry(root, 'qa-project', { type: 'character', title: '林岚', aliases: ['小林'], tags: ['调查员'], summary: '钟楼事件调查员', body: '林岚在钟楼调查失踪案。' })).entry;
    await compendiumService.saveEntry(root, 'qa-project', { type: 'lore', title: '旧港', tags: ['港口'], summary: '海边旧港', body: '与钟楼无关。' });
    await settingsService.updateProviderProfile(root, { id: 'qa-profile', name: 'QA', provider: 'openai-compatible', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'qa-secret', model: 'cheap-model' });
    await settingsService.updateSettings(root, { compendiumAgent: { enabled: true, providerProfileId: 'qa-profile', maxCardsPerRun: 30 } });

    assert.strictEqual(rankEntries([{ ...linyan }, { title: '其他', body: '无关' }], '钟楼的调查员是谁？')[0].entry.id, linyan.id);
    assert.deepStrictEqual(sanitizeAnswer({ answer: '答案', sourceIds: [linyan.id, 'forged'], confidence: 'grounded' }, [{ id: linyan.id }]).sourceIds, [linyan.id]);
    const unsupported = sanitizeAnswer({ answer: '无效引用的回答', sourceIds: ['forged'], confidence: 'grounded' }, [{ id: linyan.id }]);
    assert.deepStrictEqual(unsupported.sourceIds, []);
    assert.strictEqual(unsupported.confidence, 'not-found', 'removing every invalid citation must also remove grounded confidence');
    assert.strictEqual(sanitizeAnswer({ answer: '无引用', confidence: 'partial' }, []).confidence, 'not-found');

    let providerConfig = null;
    const service = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async (_prompt, onToken, config) => {
      providerConfig = config;
      onToken(JSON.stringify({ answer: '林岚负责调查钟楼失踪案。', sourceIds: [linyan.id, 'forged'], confidence: 'grounded' }));
    } });
    const result = await service.ask(root, 'qa-project', '钟楼的调查员是谁？');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.answer, '林岚负责调查钟楼失踪案。');
    assert.deepStrictEqual(result.sourceIds, [linyan.id]);
    assert.strictEqual(result.sources[0].id, linyan.id);
    assert.strictEqual(providerConfig.apiKey, 'qa-secret');
    assert.strictEqual(JSON.stringify(result).includes('qa-secret'), false);

    let called = false;
    const emptyService = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async () => { called = true; } });
    const empty = await emptyService.ask(root, 'qa-project', '完全不存在的星球名');
    assert.strictEqual(empty.confidence, 'not-found');
    assert.strictEqual(called, false);

    for (let index = 0; index < 30; index += 1) {
      await compendiumService.saveEntry(root, 'qa-project', { type: 'lore', title: `Unrelated card ${index}`, summary: 'Ordinary background.' });
    }
    const lastCard = (await compendiumService.saveEntry(root, 'qa-project', {
      type: 'lore', title: 'ONLY_MATCH_33', body: 'BODY_ONLY_SECRET', summary: 'Unique record.'
    })).entry;
    await settingsService.updateSettings(root, {
      compendiumAgent: { enabled: true, providerProfileId: 'qa-profile', maxCardsPerRun: 1 }
    });
    let sentSources;
    const allCardsService = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async (prompt, onToken) => {
      const text = prompt.messages[1].content;
      sentSources = JSON.parse(text.slice(text.indexOf('[{')));
      onToken(JSON.stringify({ answer: '找到了末尾资料。', sourceIds: [lastCard.id], confidence: 'grounded' }));
    } });
    const beyondLimit = await allCardsService.ask(root, 'qa-project', 'ONLY_MATCH_33');
    assert.deepStrictEqual(beyondLimit.sourceIds, [lastCard.id], 'retrieval must include cards beyond the model input limit');
    assert.strictEqual(sentSources.length, 1, 'the configured model card limit still applies after retrieval');
    assert.strictEqual(sentSources[0].body, 'BODY_ONLY_SECRET');
    assert.strictEqual(sentSources[0].projectId, undefined);

    await settingsService.updateSettings(root, {
      compendiumAgent: { enabled: true, providerProfileId: 'qa-profile', maxCardsPerRun: 1, cardBodyAccess: 'none' }
    });
    const noBodyService = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async () => { throw new Error('Disabled card bodies must not enter retrieval or prompts'); } });
    const noBodyMatch = await noBodyService.ask(root, 'qa-project', 'BODY_ONLY_SECRET');
    assert.strictEqual(noBodyMatch.confidence, 'not-found');
    console.log('compendium agent qa service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
