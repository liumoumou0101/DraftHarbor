const assert = require('assert');
const Policy = require('../src/core/knowledge/compendium-agent-policy');
const SettingsSchema = require('../src/core/settings/settings-schema');

const entry = {
  id: 'agent-entry-1',
  projectId: 'project-1',
  type: 'character',
  title: '林岚',
  summary: '一位调查员。',
  body: '她在北城追查失踪案。',
  tags: ['主角'],
  aliases: ['阿岚'],
  characterProfile: { goal: '找到失踪者', voice: '克制' },
  updatedAt: '2026-07-13T00:00:00.000Z'
};

const settings = Policy.normalizeCompendiumAgentSettings({
  enabled: true,
  providerProfileId: 'cheap-profile',
  model: 'small-model',
  cardBodyAccess: 'read-only',
  maxCardsPerRun: 500
});
assert.strictEqual(settings.enabled, true);
assert.strictEqual(settings.providerProfileId, 'cheap-profile');
assert.strictEqual(settings.maxCardsPerRun, 50, 'card limit must be capped');

const normalizedSettings = SettingsSchema.normalizeDesktopSettings({
  compendiumAgent: { enabled: true, providerProfileId: 'agent-profile', maxCardsPerRun: 3 }
});
assert.strictEqual(normalizedSettings.compendiumAgent.providerProfileId, 'agent-profile');
assert.strictEqual(normalizedSettings.compendiumAgent.maxCardsPerRun, 3);

const snapshot = Policy.createAgentInputSnapshot([entry], settings);
assert.strictEqual(snapshot.entries.length, 1);
assert.strictEqual(snapshot.entries[0].body, entry.body, 'read-only card body may be sent as card context');
assert.strictEqual(snapshot.entries[0].projectId, undefined, 'projectId must not enter the model snapshot');
assert.strictEqual(snapshot.entries[0].sourceReferences, undefined, 'source references must not enter the model snapshot');
assert.ok(snapshot.entries[0].revision, 'snapshot must include a revision');

const noBody = Policy.createAgentEntrySnapshot(entry, { cardBodyAccess: 'none' });
assert.strictEqual(noBody.body, undefined, 'body access can be disabled');

const validOperation = {
  id: 'operation-1',
  entryId: entry.id,
  baseRevision: snapshot.entries[0].revision,
  patch: {
    summary: '北城失踪案调查员。',
    tags: ['主角', '调查员'],
    aliases: ['阿岚'],
    characterProfile: { goal: '找到失踪者' }
  }
};
assert.strictEqual(Policy.validateOperation(validOperation).ok, true);
assert.strictEqual(Policy.validateOperationsAgainstEntries([validOperation], [entry]).ok, true);

const forbiddenField = Policy.validateOperation({ ...validOperation, patch: { body: '越权修改' } });
assert.strictEqual(forbiddenField.ok, false);
assert.ok(forbiddenField.errors.some((error) => error.includes('not editable')));

const changedEntry = { ...entry, summary: '用户刚刚手动修改过。' };
const stale = Policy.validateOperationsAgainstEntries([validOperation], [changedEntry]);
assert.strictEqual(stale.ok, false);
assert.ok(stale.errors.some((error) => error.includes('entry has changed')));

const analysis = Policy.validateAnalysisResult({
  findings: [{ id: 'finding-1', severity: 'medium', reason: '摘要可以更明确。', entryIds: [entry.id], operationIds: ['operation-1'] }],
  operations: [validOperation]
});
assert.strictEqual(analysis.ok, true);

const invalidAnalysis = Policy.validateAnalysisResult({
  findings: [{ id: 'finding-1', severity: 'high', reason: '错误引用。', entryIds: [entry.id], operationIds: ['missing-operation'] }],
  operations: [validOperation]
});
assert.strictEqual(invalidAnalysis.ok, false);

const reportOnlyAnalysis = Policy.validateAnalysisResult({
  findings: [{ id: 'finding-duplicates', severity: 'low', reason: '两张卡可能重复。', entryIds: [entry.id] }],
  operations: []
});
assert.strictEqual(reportOnlyAnalysis.ok, true, 'report-only findings must not force a write operation');

assert.strictEqual(Policy.validateAnalysisResultAgainstEntries({
  findings: [{ id: 'finding-1', severity: 'low', reason: '卡片可优化。', entryIds: [entry.id], operationIds: ['operation-1'] }],
  operations: [validOperation]
}, [entry]).ok, true);
assert.strictEqual(Policy.validateAnalysisResultAgainstEntries({
  findings: [{ id: 'finding-1', severity: 'low', reason: '越权引用。', entryIds: ['missing-entry'] }],
  operations: []
}, [entry]).ok, false);

console.log('Compendium agent policy test passed.');
