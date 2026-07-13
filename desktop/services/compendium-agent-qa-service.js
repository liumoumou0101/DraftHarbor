const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const ProviderStream = require('../../src/core/generation/provider-stream');
const { resolveProviderConfig } = require('./compendium-agent-runner-service');

const MAX_SOURCES = 8;
const MAX_BODY_CHARS = 1200;
const CHINESE_STOP_CHARACTERS = new Set('的是了在和与及有我你他她它们这那请问关于什么怎么哪个谁为何吗呢吧啊'.split(''));

function termsFor(question) {
  const text = String(question || '').trim().toLowerCase();
  const chinese = text.match(/\p{Script=Han}/gu) || [];
  const phrases = text.match(/[\p{Script=Han}]{2,}/gu) || [];
  const words = [...phrases, ...chinese.filter((character) => !CHINESE_STOP_CHARACTERS.has(character)), ...(text.match(/[a-z0-9_-]{2,}/gu) || [])];
  return [...new Set(words)].slice(0, 20);
}

function occurrences(text, term) {
  let count = 0;
  let position = String(text || '').toLowerCase().indexOf(term);
  while (position >= 0 && count < 5) {
    count += 1;
    position = String(text || '').toLowerCase().indexOf(term, position + term.length);
  }
  return count;
}

function rankEntries(entries, question, limit = MAX_SOURCES) {
  const terms = termsFor(question);
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const fields = [[entry.title, 12], [(entry.aliases || []).join(' '), 10], [(entry.tags || []).join(' '), 8], [entry.summary, 5], [entry.body, 1]];
    const score = terms.reduce((total, term) => total + fields.reduce((sum, [value, weight]) => sum + occurrences(value, term) * weight, 0), 0);
    return { entry, score };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.entry.title || '').localeCompare(String(right.entry.title || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || MAX_SOURCES, MAX_SOURCES)));
}

function sourceSnapshot(ranked) {
  return ranked.map(({ entry }) => ({
    id: entry.id,
    title: entry.title,
    type: entry.type,
    summary: entry.summary || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    body: String(entry.body || '').slice(0, MAX_BODY_CHARS),
    characterProfile: entry.type === 'character' ? entry.characterProfile || {} : undefined
  }));
}

function questionPrompt(question, sources) {
  return {
    messages: [
      { role: 'system', content: '你是项目资料库问答助手。只能依据提供的资料卡回答，不能使用常识补全或编造。若资料不足，明确回答“资料库未提供足够信息”。只返回 JSON：{"answer":"","sourceIds":[""],"confidence":"grounded|partial|not-found"}。sourceIds 必须是实际支撑答案的资料卡 ID。' },
      { role: 'user', content: `问题：${question}\n\n可参考资料卡：\n${JSON.stringify(sources)}` }
    ],
    asString() { return this.messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'); }
  };
}

function sanitizeAnswer(output, sources) {
  const sourceIds = new Set(sources.map((source) => source.id));
  const raw = output && typeof output === 'object' ? output : {};
  const answer = String(raw.answer || '').trim().slice(0, 4000);
  const cited = [...new Set((Array.isArray(raw.sourceIds) ? raw.sourceIds : []).map((id) => String(id || '').trim()).filter((id) => sourceIds.has(id)))];
  const confidence = ['grounded', 'partial', 'not-found'].includes(raw.confidence) ? raw.confidence : (cited.length ? 'partial' : 'not-found');
  return { answer: answer || '资料库未提供足够信息。', sourceIds: cited, confidence };
}

function createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration } = {}) {
  if (!settingsService || !compendiumAgentService) throw new Error('settingsService and compendiumAgentService are required');
  const runner = AITaskRunner.createAITaskRunner({ streamGeneration: streamGeneration || ProviderStream.streamGeneration });

  async function ask(dataRoot, projectId, question) {
    const cleanQuestion = String(question || '').trim().slice(0, 1000);
    if (!cleanQuestion) throw new Error('question is required');
    const settings = await settingsService.readSettings(dataRoot);
    const { agentSettings, profile, config } = resolveProviderConfig(settings);
    const snapshotResult = await compendiumAgentService.readSnapshot(dataRoot, projectId, [], agentSettings);
    const ranked = rankEntries(snapshotResult.snapshot.entries, cleanQuestion);
    if (!ranked.length) return { ok: true, projectId, answer: '资料库中没有找到与此问题相关的资料。', sourceIds: [], confidence: 'not-found', sources: [], provider: { profileId: profile.id, provider: profile.provider, model: config.model } };
    const sources = sourceSnapshot(ranked);
    const task = { projectId, domain: 'compendium', action: 'update', scope: 'project', target: { type: 'compendium-agent-qa', projectId, id: `compendium-qa-${projectId}` }, instruction: '基于检索到的资料卡回答问题', providerProfileId: profile.id, model: config.model, outputContract: 'field-patch', beforeSnapshot: { sourceIds: sources.map((source) => source.id) } };
    const result = await runner.run(task, { prompt: questionPrompt(cleanQuestion, sources), providerConfig: { ...config, temperature: 0.1, maxTokens: 1200 } });
    if (!result.ok) throw new Error(result.error.message || 'compendium question failed');
    const answer = sanitizeAnswer(result.output, sources);
    return { ok: true, projectId, ...answer, sources: sources.map(({ id, title, type }) => ({ id, title, type })), provider: { profileId: profile.id, provider: profile.provider, model: config.model } };
  }
  return { ask };
}

module.exports = { createCompendiumAgentQaService, termsFor, rankEntries, sourceSnapshot, questionPrompt, sanitizeAnswer, MAX_SOURCES };
