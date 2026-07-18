const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const compendiumAgentService = require('../desktop/services/compendium-agent-service');
const settingsService = require('../desktop/services/settings-service');
const { startDesktopServers } = require('../desktop/local-server');
const { createController: createKnowledgeController } = require('../desktop/controllers/knowledge-controller');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-compendium-agent-service-'));
  let servers = null;
  try {
    await projectService.createProject(dataRoot, { id: 'agent-project', title: 'Agent Project' });
    const entry = (await compendiumService.saveEntry(dataRoot, 'agent-project', {
      type: 'character', title: '林岚', summary: '旧摘要', body: '资料卡正文', tags: ['旧标签']
    })).entry;

    const snapshot = await compendiumAgentService.readSnapshot(dataRoot, 'agent-project', [entry.id], { maxCardsPerRun: 3 });
    assert.strictEqual(snapshot.snapshot.entries.length, 1);
    assert.strictEqual(snapshot.snapshot.entries[0].body, '资料卡正文');
    const revision = snapshot.snapshot.entries[0].revision;

    let backupCalls = 0;
    const applied = await compendiumAgentService.applyOperations(dataRoot, 'agent-project', [{
      id: 'op-1', entryId: entry.id, baseRevision: revision,
      patch: { summary: '新摘要', tags: ['主角'], aliases: ['阿岚'], characterProfile: { goal: '找到真相' } }
    }], {
      agentSettings: { maxCardsPerRun: 3 },
      beforeWrite: async () => { backupCalls += 1; return { backupId: 'agent-backup.json' }; }
    });
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(applied.appliedCount, 1);
    assert.strictEqual(backupCalls, 1, 'a valid apply must create a backup before writing');
    assert.strictEqual(applied.entries[0].summary, '新摘要');
    assert.strictEqual(applied.entries[0].body, '资料卡正文', 'agent may not change card body');

    const after = await compendiumService.listEntries(dataRoot, 'agent-project');
    assert.strictEqual(after.entries[0].aliases[0], '阿岚');
    await assert.rejects(
      () => compendiumAgentService.applyOperations(dataRoot, 'agent-project', [{
        entryId: entry.id, baseRevision: revision, patch: { body: '越权内容' }
      }], { agentSettings: { maxCardsPerRun: 3 } }),
      /field is not editable/
    );
    await assert.rejects(
      () => compendiumAgentService.readSnapshot(dataRoot, 'agent-project', ['missing-entry'], { maxCardsPerRun: 3 }),
      /do not exist/
    );

    const absentAgentController = createKnowledgeController({
      compendiumService,
      promptService: {},
      readJsonPayload: async () => ({}),
      jsonResponse: () => {},
      readSettings: async () => ({})
    });
    const handledWithoutAgent = await absentAgentController(
      { method: 'POST' }, {}, '', dataRoot,
      new URL('http://127.0.0.1/api/compendium-agent/analyze')
    );
    assert.strictEqual(handledWithoutAgent, false, 'core knowledge controller must not claim agent routes when the add-on is absent');
    const qaHandledWithoutAgent = await absentAgentController(
      { method: 'POST' }, {}, '', dataRoot,
      new URL('http://127.0.0.1/api/compendium-agent/ask')
    );
    assert.strictEqual(qaHandledWithoutAgent, false, 'core knowledge controller must not claim question routes when the add-on is absent');

    await settingsService.updateProviderProfile(dataRoot, {
      id: 'agent-test-profile', name: 'Agent Test Profile', provider: 'openai-compatible',
      endpoint: 'https://example.test/v1/chat/completions', apiKey: 'agent-test-secret', model: 'agent-test-model'
    });
    await settingsService.updateSettings(dataRoot, {
      compendiumAgent: { enabled: true, providerProfileId: 'agent-test-profile', maxCardsPerRun: 3 }
    });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    const apiSnapshotResponse = await fetch(`${servers.appUrl}/api/compendium-agent/snapshot?projectId=agent-project&entryIds=${encodeURIComponent(entry.id)}`);
    const apiSnapshot = await apiSnapshotResponse.json();
    assert.ok(apiSnapshotResponse.ok && apiSnapshot.ok, 'agent snapshot API should return a constrained snapshot');
    const apiEntry = apiSnapshot.snapshot.entries[0];
    assert.strictEqual(apiEntry.body, '资料卡正文');
    assert.strictEqual(apiEntry.projectId, undefined, 'API snapshot must not disclose project metadata to the model contract');

    const originalStub = globalThis.__draftHarborGenerationStub;
    globalThis.__draftHarborGenerationStub = async (prompt, onToken, config) => {
      assert.strictEqual(config.apiKey, 'agent-test-secret', 'only the backend provider call should receive the secret');
      const snapshotText = prompt.messages[1].content;
      const snapshot = JSON.parse(snapshotText.slice(snapshotText.indexOf('{')));
      onToken(JSON.stringify({
        findings: [{ id: 'api-finding', severity: 'low', reason: '摘要可更具体。', entryIds: [entry.id], operationIds: ['api-op'] }],
        operations: [{ id: 'api-op', entryId: entry.id, baseRevision: snapshot.entries[0].revision, patch: { summary: '经完整 API 链路验证的摘要。' } }]
      }));
    };
    try {
      const apiAnalyzeResponse = await fetch(`${servers.appUrl}/api/compendium-agent/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'agent-project', entryIds: [entry.id] })
      });
      const apiAnalyze = await apiAnalyzeResponse.json();
      assert.ok(apiAnalyzeResponse.ok && apiAnalyze.ok, 'agent analyze API should complete with the backend model stub');
      assert.strictEqual(apiAnalyze.provider.apiKey, undefined, 'analysis API must never expose the API key');
      assert.strictEqual(apiAnalyze.operations[0].patch.summary, '经完整 API 链路验证的摘要。');
    } finally {
      if (originalStub === undefined) delete globalThis.__draftHarborGenerationStub;
      else globalThis.__draftHarborGenerationStub = originalStub;
    }

    const apiApplyResponse = await fetch(`${servers.appUrl}/api/compendium-agent/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'agent-project',
        operations: [{ entryId: entry.id, baseRevision: apiEntry.revision, patch: { summary: '通过 API 更新的摘要' } }]
      })
    });
    const apiApply = await apiApplyResponse.json();
    assert.ok(apiApplyResponse.ok && apiApply.ok, 'agent apply API should accept a valid restricted patch');
    assert.strictEqual(apiApply.entries[0].summary, '通过 API 更新的摘要');
    assert.ok(apiApply.backup && apiApply.backup.backup, 'agent apply API should create a recoverable backup');

    const apiForbiddenResponse = await fetch(`${servers.appUrl}/api/compendium-agent/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'agent-project',
        operations: [{ entryId: entry.id, baseRevision: apiEntry.revision, patch: { body: '仍然越权' } }]
      })
    });
    const apiForbidden = await apiForbiddenResponse.json();
    assert.strictEqual(apiForbiddenResponse.status, 400, 'agent API must reject forbidden fields');
    assert.strictEqual(apiForbidden.ok, false);
    console.log('Compendium agent service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Compendium agent service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
