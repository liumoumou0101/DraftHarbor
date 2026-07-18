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
    console.log('compendium agent qa service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
