const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const compendiumAgentService = require('../desktop/services/compendium-agent-service');
const settingsService = require('../desktop/services/settings-service');
const { createCompendiumAgentRunnerService, resolveProviderConfig, localFindings, sanitizeModelAnalysis } = require('../desktop/services/compendium-agent-runner-service');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-agent-runner-'));
  try {
    await projectService.createProject(dataRoot, { id: 'agent-runner-project', title: 'Agent Runner Project' });
    const entry = (await compendiumService.saveEntry(dataRoot, 'agent-runner-project', {
      type: 'character', title: '林岚', summary: '调查员', body: '只在资料卡中出现的背景。'
    })).entry;
    const settings = await settingsService.updateProviderProfile(dataRoot, {
      id: 'agent-profile', name: 'Agent Cheap Model', provider: 'openai-compatible',
      endpoint: 'https://example.test/v1/chat/completions', apiKey: 'agent-secret', model: 'cheap-model'
    });
    await settingsService.updateSettings(dataRoot, {
      compendiumAgent: { enabled: true, providerProfileId: 'agent-profile', model: 'agent-small', maxCardsPerRun: 5 }
    });

    const resolved = resolveProviderConfig(await settingsService.readSettings(dataRoot));
    assert.strictEqual(resolved.config.model, 'agent-small');
    assert.strictEqual(resolved.config.apiKey, 'agent-secret');
    assert.strictEqual(resolved.config.temperature, 0.2);
    assert.throws(() => resolveProviderConfig({ compendiumAgent: { enabled: true } }), /provider profile is required/);
    const local = localFindings({ entries: [{ id: 'empty-card', type: 'character', summary: '', tags: [], characterProfile: {} }] });
    assert.strictEqual(local.length, 3, 'local checks should cover summary, tags and character profile');
    const sanitized = sanitizeModelAnalysis({
      findings: [{ id: 'bad-output', severity: 'low', reason: '仍应展示。', entryIds: [entry.id], operationIds: ['bad-operation'] }],
      operations: [{ id: 'bad-operation', entryId: entry.id, baseRevision: 'revision', patch: { body: 'forbidden' } }]
    }, 5);
    assert.strictEqual(sanitized.operations.length, 0, 'invalid model patches must be discarded');
    assert.deepStrictEqual(sanitized.findings[0].operationIds, [], 'discarded operations must not remain selectable');
    const deduplicated = sanitizeModelAnalysis({
      findings: [],
      operations: [
        { id: 'first', entryId: entry.id, baseRevision: 'revision', patch: { summary: '第一条' } },
        { id: 'second', entryId: entry.id, baseRevision: 'revision', patch: { tags: ['重复'] } }
      ]
    }, 5);
    assert.strictEqual(deduplicated.operations.length, 1, 'only one suggestion may target one card per run');
    assert.strictEqual(deduplicated.operations[0].id, 'first');

    let promptText = '';
    let privateConfig = null;
    const service = createCompendiumAgentRunnerService({
      settingsService,
      compendiumAgentService,
      streamGeneration: async (prompt, onToken, config) => {
        promptText = prompt.messages[1].content;
        privateConfig = config;
        const snapshot = JSON.parse(promptText.slice(promptText.indexOf('{')));
        onToken(JSON.stringify({
          findings: [{ id: 'finding-1', severity: 'low', reason: '摘要可以更明确。', entryIds: [entry.id], operationIds: ['op-1'] }],
          operations: [{ id: 'op-1', entryId: entry.id, baseRevision: snapshot.entries[0].revision, patch: { summary: '北城失踪案调查员。' } }]
        }));
      }
    });
    const result = await service.analyze(dataRoot, 'agent-runner-project', [entry.id]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.operations[0].patch.summary, '北城失踪案调查员。');
    assert.ok(result.findings.some((finding) => finding.id === `local-missing-tags-${entry.id}`), 'local findings should be returned with model findings');
    assert.strictEqual(result.provider.profileId, 'agent-profile');
    assert.strictEqual(result.provider.apiKey, undefined, 'public analysis result must not expose API key');
    assert.strictEqual(privateConfig.apiKey, 'agent-secret', 'only backend stream adapter receives the API key');
    assert.ok(promptText.includes('只在资料卡中出现的背景。'), 'read-only card body may be provided to the agent');
    assert.ok(!promptText.includes('agent-secret'), 'API key must not enter the prompt');
    assert.strictEqual(settings.providerProfiles.length, 1);
    console.log('Compendium agent runner service test passed.');
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Compendium agent runner service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
