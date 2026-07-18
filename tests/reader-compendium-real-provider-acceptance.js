const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const settingsService = require('../desktop/services/settings-service');
const projectService = require('../desktop/services/project-service');
const compendiumService = require('../desktop/services/compendium-service');
const { createReaderTransferService } = require('../desktop/services/reader-transfer-service');
const { startDesktopServers } = require('../desktop/local-server');

const DATA_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'f104b-real-provider-full2-acceptance-20260716';
const ENVELOPE_ID = 'f104b-real-provider-full2-envelope-20260716';
const METRICS_PATH = path.join(DATA_ROOT, '.ai_state', 'f104b-real-provider-full2-acceptance-20260716.json');
const PRICES = { 'deepseek-v4-flash': { hit: 0.0028, miss: 0.14, output: 0.28 }, 'deepseek-v4-pro': { hit: 0.003625, miss: 0.435, output: 0.87 } };

function segment(index) {
  const facts = [
    `第${index}卷档案明确记载：林岚，别名小林，是旧港潮汐档案馆的调查员。她说话克制，目标是查明失踪的第七码箱，当前状态是独自追查伪造的潮位记录。`,
    '旧港钟楼位于防波堤尽头，地下机房与废弃潮位站相连；钟楼每逢零点会提前三分钟敲响，声音是进入密室的时间线索。',
    '灰鲸会是经营打捞与旧航线情报的组织，公开负责人叫顾砚；组织用“潮签”确认成员身份，但林岚尚未确认顾砚是否知晓档案被替换。',
    '黑曜钥匙是一枚带七道刻痕的黑色金属钥匙，只能打开第七码箱；钥匙背面刻着“归潮之前”，目前由林岚封存在证物袋中。',
    '事件记录：7月16日23时57分，钟楼提前鸣响；零点整，第七码箱从档案馆消失；零点零五分，灰鲸会的无人艇出现在废弃潮位站外。',
    '“回声协议”是档案馆的校验规则：原始潮位记录必须由纸本、声纹和机械钟三方互证，任何单一数字副本都不能作为最终证据。'
  ].join('\n');
  return `## 第${index}卷：潮位档案节选\n${Array.from({ length: 12 }, (_, repeat) => `记录 ${index}-${repeat + 1}\n${facts}`).join('\n\n')}`;
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(`${pathname}: ${body.error || `HTTP ${response.status}`}`);
  return body;
}

function estimateCost(model, inputTokens, outputTokens) {
  const price = PRICES[model];
  return price ? (inputTokens * price.miss + outputTokens * price.output) / 1_000_000 : 0;
}

(async () => {
  let servers;
  const startedAt = new Date().toISOString();
  try {
    await assert.rejects(() => projectService.openProject(DATA_ROOT, PROJECT_ID), /ENOENT|not found/i, 'acceptance project id must be unused');
    const settings = await settingsService.readSettings(DATA_ROOT);
    const agent = settings.compendiumAgent || {};
    const profile = (settings.providerProfiles || []).find((item) => item.id === agent.providerProfileId);
    if (!agent.enabled || !profile || !profile.apiKey || !profile.endpoint) throw new Error('configured compendium DeepSeek Provider is required');
    if (profile.provider !== 'deepseek') throw new Error(`expected DeepSeek compendium Provider, received ${profile.provider}`);

    await projectService.createProject(DATA_ROOT, { id: PROJECT_ID, title: 'F-10.4B 真实验收 · 旧港潮汐档案' });
    const original = (await compendiumService.saveEntry(DATA_ROOT, PROJECT_ID, {
      id: 'acceptance-linyan', type: 'character', title: '林岚', aliases: ['小林'], summary: '旧摘要：档案馆调查员。', body: '验收前资料。', tags: ['验收前']
    })).entry;
    const suspectedOriginal = (await compendiumService.saveEntry(DATA_ROOT, PROJECT_ID, {
      id: 'acceptance-clock-alias', type: 'location', title: '旧港鸣钟塔', aliases: ['旧港钟楼', '钟楼'], summary: '验收前别名卡，不应被放弃候选修改。', body: '旧资料。', tags: ['验收前']
    })).entry;
    const text = [segment(1), segment(2), segment(3)].join('\n\n');
    const transferService = createReaderTransferService();
    await transferService.createTransfer(DATA_ROOT, {
      envelope: {
        envelopeId: ENVELOPE_ID, createdAt: startedAt, destination: 'compendium', sourceKind: 'pasted-text',
        documentId: 'f104b-pasted-document', revisionId: 'f104b-pasted-r1', sourceRevisionDigest: 'sha256:f104b-real-provider',
        format: 'plain', scope: 'document', sourceLocators: [{ documentId: 'f104b-pasted-document', revisionId: 'f104b-pasted-r1', chapterId: 'all', blockId: 'all' }]
      },
      snapshot: { sourceTitle: '旧港潮汐档案（三卷）', sections: [{ sectionId: 'volume-all', title: '三卷全文', textStart: 0, textEnd: text.length, characterCount: text.length }] },
      text
    });

    servers = await startDesktopServers({ appRoot: DATA_ROOT, dataRoot: DATA_ROOT, revealPath: async () => '' });
    const extractionStarted = Date.now();
    const extracted = await api(servers.appUrl, '/api/compendium/reader-transfer/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelopeId: ENVELOPE_ID, projectId: PROJECT_ID, chunking: { size: 6000, overlap: 800 }, maxCards: 30 })
    });
    const batch = extracted.batch;
    assert.ok(batch.chunkCount >= 3, 'real acceptance requires at least three Provider chunks');
    assert.ok(batch.candidates.length >= 5, 'real acceptance requires multiple extracted cards');
    const linyan = batch.candidates.find((candidate) => candidate.card.title === '林岚' || (candidate.card.aliases || []).includes('林岚') || (candidate.card.aliases || []).includes('小林'));
    assert.ok(linyan, 'real extraction must identify 林岚/小林');
    assert.strictEqual(linyan.classification, 'update', 'existing 林岚 card must be classified as an update');
    assert.strictEqual(linyan.existingEntryId, original.id);
    assert.ok(linyan.card.evidence.length >= 2, 'cross-chunk duplicate must merge while retaining evidence');
    const abandonedExisting = batch.candidates.find((candidate) => candidate.existingEntryId === suspectedOriginal.id);
    assert.ok(abandonedExisting, 'real extraction must match the existing aliased clock tower card');
    const decisions = batch.candidates.map((candidate) => {
      if (candidate.candidateId === linyan.candidateId) return { candidateId: candidate.candidateId, decision: 'approved-modified', card: { ...candidate.card, evidence: undefined, summary: '真实验收审核：林岚（小林）正在追查第七码箱与伪造潮位记录。' } };
      return { candidateId: candidate.candidateId, decision: candidate.candidateId === abandonedExisting.candidateId ? 'abandoned' : 'approved' };
    });
    const reviewed = await api(servers.appUrl, '/api/compendium/reader-transfer/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJECT_ID, batchId: batch.batchId, expectedUpdatedAt: batch.updatedAt, decisions })
    });
    assert.ok(reviewed.batch.candidates.every((candidate) => candidate.decision), 'every real candidate must have an explicit decision');
    const applied = await api(servers.appUrl, '/api/compendium/reader-transfer/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJECT_ID, batchId: batch.batchId, expectedProjectUpdatedAt: batch.projectUpdatedAt, confirmed: true })
    });
    assert.ok(applied.backup && applied.backup.backupId, 'real application must create a recoverable backup');
    const after = (await compendiumService.listEntries(DATA_ROOT, PROJECT_ID)).entries;
    const approvedCount = decisions.filter((item) => item.decision !== 'abandoned').length;
    const approvedNewCount = batch.candidates.filter((candidate) => candidate.classification === 'new' && decisions.find((item) => item.candidateId === candidate.candidateId).decision !== 'abandoned').length;
    assert.strictEqual(after.length, 2 + approvedNewCount, 'only approved new candidates should be added; updates retain their identity');
    const savedLinyan = after.find((entry) => entry.id === original.id);
    assert.ok(savedLinyan.summary.startsWith('真实验收审核'));
    assert.ok(after.filter((entry) => entry.id !== suspectedOriginal.id).every((entry) => (entry.sourceReferences || []).some((reference) => reference.batchId === batch.batchId)), 'every applied card must retain Reader batch evidence');
    const untouchedSuspected = after.find((entry) => entry.id === suspectedOriginal.id);
    assert.strictEqual(untouchedSuspected.summary, suspectedOriginal.summary, 'abandoned suspected duplicate must remain unchanged');
    assert.ok(!(untouchedSuspected.sourceReferences || []).some((reference) => reference.batchId === batch.batchId));
    const retry = await api(servers.appUrl, '/api/compendium/reader-transfer/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJECT_ID, batchId: batch.batchId, confirmed: true })
    });
    assert.strictEqual(retry.idempotent, true, 'real application retry must be idempotent');
    assert.strictEqual((await compendiumService.listEntries(DATA_ROOT, PROJECT_ID)).entries.length, after.length);
    const transferAfter = await transferService.readTransfer(DATA_ROOT, ENVELOPE_ID);
    assert.strictEqual(transferAfter.envelope.lifecycle, 'consumed');

    await api(servers.appUrl, '/api/restore-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJECT_ID, backupId: applied.backup.backupId, mode: 'replace' })
    });
    const restored = (await compendiumService.listEntries(DATA_ROOT, PROJECT_ID)).entries;
    assert.strictEqual(restored.length, 2, 'backup restore must return to both original cards');
    assert.strictEqual(restored.find((entry) => entry.id === original.id).summary, original.summary);
    assert.strictEqual(restored.find((entry) => entry.id === suspectedOriginal.id).summary, suspectedOriginal.summary);

    const outputCharacters = JSON.stringify(batch.candidates.map((candidate) => candidate.card)).length;
    const estimatedInputTokens = Math.ceil((text.length + batch.chunkCount * 1800) / 2);
    const estimatedOutputTokens = Math.ceil(outputCharacters / 2);
    const metrics = {
      schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), projectId: PROJECT_ID,
      provider: profile.provider, model: agent.model || profile.model, sourceCharacters: text.length,
      chunkCount: batch.chunkCount, candidateCount: batch.candidates.length, approvedCount,
      abandonedCount: decisions.filter((item) => item.decision === 'abandoned').length,
      updatedCount: batch.candidates.filter((candidate) => candidate.classification === 'update').length,
      suspectedDuplicateCount: batch.candidates.filter((candidate) => candidate.classification === 'suspected-duplicate').length,
      mergedEvidenceCount: batch.candidates.filter((candidate) => candidate.card.evidence.length > 1).length,
      extractionDurationMs: Date.now() - extractionStarted, estimatedInputTokens, estimatedOutputTokens,
      estimatedCostUsd: estimateCost(agent.model || profile.model, estimatedInputTokens, estimatedOutputTokens),
      backupId: applied.backup.backupId, idempotentRetry: retry.idempotent, restoredOriginalCard: true,
      security: { apiKeyRecorded: false, absolutePathRecorded: false, unrelatedProjectTextSent: false }
    };
    const serialized = JSON.stringify(metrics);
    assert.ok(!serialized.includes(profile.apiKey), 'metrics must never contain the API key');
    assert.ok(!serialized.includes(DATA_ROOT), 'metrics must never contain absolute workspace paths');
    await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
    await fs.writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    console.log(`F104B_REAL_PROVIDER_RESULT ${JSON.stringify(metrics)}`);
  } finally {
    if (servers) await servers.close();
  }
})().catch((error) => { console.error('F104B_REAL_PROVIDER_FAILED', error && error.stack ? error.stack : error); process.exit(1); });
