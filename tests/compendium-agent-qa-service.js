const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const compendiumAgentService = require('../desktop/services/compendium-agent-service');
const settingsService = require('../desktop/services/settings-service');
const { createCompendiumAgentQaService, rankEntries, sourceSnapshot, sanitizeAnswer } = require('../desktop/services/compendium-agent-qa-service');

function testRetrievalAndEvidence() {
  const cases = [
    ['retrieval searches all eight character profile fields', () => {
      const fields = ['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'];
      for (const field of fields) {
        const entry = { id: field, type: 'character', title: '林岚', characterProfile: { [field]: `PROFILE_${field}_FACT` } };
        assert.deepStrictEqual(rankEntries([entry], `PROFILE_${field}_FACT`).map(item => item.entry.id), [field], `${field} must be searchable without repeating it in the body`);
      }
    }],
    ['long-card evidence contains the match and its exact original location', () => {
      const body = '普通背景。'.repeat(400) + '月影钥匙藏在北塔密室。' + '其他记录。'.repeat(400);
      const question = '月影钥匙藏在哪里？';
      const ranked = rankEntries([{ id: 'long-card', title: '档案', body }], question);
      const source = sourceSnapshot(ranked, question)[0];
      assert.ok(source.body.includes('月影钥匙藏在北塔密室。'), 'the selected evidence must retain the matching fact beyond the first 1200 characters');
      assert.ok(source.body.length <= 1200, 'retrieving a late match must not expand the body budget');
      assert.strictEqual(body.slice(source.bodyStart, source.bodyEnd), source.body, 'source offsets must identify the exact unmodified excerpt');
      assert.strictEqual(source.bodyTruncated, true);
    }],
    ['short-card evidence preserves the complete body', () => {
      const body = '月影钥匙藏在北塔密室。';
      const source = sourceSnapshot(rankEntries([{ id: 'short-card', title: '档案', body }], '月影钥匙'), '月影钥匙')[0];
      assert.strictEqual(source.body, body);
      assert.strictEqual(source.bodyStart, 0);
      assert.strictEqual(source.bodyEnd, body.length);
      assert.strictEqual(source.bodyTruncated, false);
    }],
    ['original offsets remain accurate when preceding Unicode letters expand under lowercasing', () => {
      const body = 'İ'.repeat(1600) + 'LATE_NEEDLE is in the north tower.' + '普通背景。'.repeat(600);
      const source = sourceSnapshot(rankEntries([{ id: 'unicode-card', body }], 'late_needle'), 'late_needle')[0];
      assert.ok(source.body.includes('LATE_NEEDLE is in the north tower.'));
      assert.strictEqual(body.slice(source.bodyStart, source.bodyEnd), source.body);
    }],
    ['answers without a valid citation do not expose an unsupported claim', () => {
      for (const sourceIds of [[], ['forged']]) {
        const result = sanitizeAnswer({ answer: '凶手是林岚。', sourceIds, confidence: 'grounded' }, [{ id: 'real' }]);
        assert.strictEqual(result.answer, '资料库未提供足够信息。');
        assert.deepStrictEqual(result.sourceIds, []);
        assert.strictEqual(result.confidence, 'not-found');
      }
      const supported = sanitizeAnswer({ answer: '北塔密室。', sourceIds: ['real', 'forged'], confidence: 'grounded' }, [{ id: 'real' }]);
      assert.strictEqual(supported.answer, '北塔密室。');
      assert.deepStrictEqual(supported.sourceIds, ['real']);
      assert.strictEqual(supported.confidence, 'grounded');
    }]
  ];
  const failures = [];
  for (const [name, run] of cases) {
    try { run(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  assert.deepStrictEqual(failures, [], failures.join('\n'));
}

(async () => {
  testRetrievalAndEvidence();
  if (process.argv.includes('--unit-only')) return;
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
    assert.strictEqual(result.sources[0].excerpt, linyan.body);
    assert.strictEqual(linyan.body.slice(result.sources[0].bodyStart, result.sources[0].bodyEnd), result.sources[0].excerpt);
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

    const longCard = (await compendiumService.saveEntry(root, 'qa-project', {
      type: 'note', title: 'Long archive', body: 'Background. '.repeat(200) + 'LATE_NEEDLE is in the north tower.' + ' Later records.'.repeat(200)
    })).entry;
    const lateEvidenceService = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async (prompt, onToken) => {
      const text = prompt.messages[1].content;
      const sources = JSON.parse(text.slice(text.indexOf('[{')));
      assert.strictEqual(sources.length, 1);
      assert.ok(sources[0].body.includes('LATE_NEEDLE is in the north tower.'), 'ask must pass the question through to evidence selection');
      onToken(JSON.stringify({ answer: 'In the north tower.', sourceIds: [longCard.id], confidence: 'grounded' }));
    } });
    const lateAnswer = await lateEvidenceService.ask(root, 'qa-project', 'LATE_NEEDLE');
    assert.strictEqual(lateAnswer.answer, 'In the north tower.');
    assert.ok(lateAnswer.sources[0].excerpt.includes('LATE_NEEDLE'));
    assert.strictEqual(longCard.body.slice(lateAnswer.sources[0].bodyStart, lateAnswer.sources[0].bodyEnd), lateAnswer.sources[0].excerpt);

    await settingsService.updateSettings(root, {
      compendiumAgent: { enabled: true, providerProfileId: 'qa-profile', maxCardsPerRun: 1, cardBodyAccess: 'none' }
    });
    const noBodyService = createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration: async () => { throw new Error('Disabled card bodies must not enter retrieval or prompts'); } });
    const noBodyMatch = await noBodyService.ask(root, 'qa-project', 'BODY_ONLY_SECRET');
    assert.strictEqual(noBodyMatch.confidence, 'not-found');
    console.log('compendium agent qa service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
