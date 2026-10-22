const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const ProviderStream = require('../../src/core/generation/provider-stream');
const { resolveProviderConfig } = require('./compendium-agent-runner-service');
const compendiumStore = require('../storage/compendium-store');
const projectService = require('./project-service');
const CompendiumAgentPolicy = require('../../src/core/knowledge/compendium-agent-policy');
const CompendiumSchema = require('../../src/core/knowledge/compendium-schema');

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
    const fields = [[entry.title, 12], [(entry.aliases || []).join(' '), 10], [(entry.tags || []).join(' '), 8], [entry.summary, 5], [CompendiumSchema.characterProfileLines(entry).join('\n'), 5], [entry.body, 1]];
    const score = terms.reduce((total, term) => total + fields.reduce((sum, [value, weight]) => sum + occurrences(value, term) * weight, 0), 0);
    return { entry, score };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.entry.title || '').localeCompare(String(right.entry.title || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || MAX_SOURCES, MAX_SOURCES)));
}

function bodyExcerpt(value, question) {
  const body = String(value || '');
  const terms = termsFor(question);
  // Query terms contain Han and ASCII words. Fold only ASCII so original
  // offsets stay valid for Unicode letters whose lowercase form is longer.
  const normalizedBody = body.replace(/[A-Z]/g, character => character.toLowerCase());
  const starts = new Set([0]);
  if (body.length > MAX_BODY_CHARS) {
    for (const term of terms) {
      let position = normalizedBody.indexOf(term);
      for (let count = 0; position >= 0 && count < 5; count += 1) {
        starts.add(Math.max(0, Math.min(body.length - MAX_BODY_CHARS, position - Math.floor((MAX_BODY_CHARS - term.length) / 2))));
        position = normalizedBody.indexOf(term, position + term.length);
      }
    }
  }
  let bodyStart = 0;
  let bestScore = -1;
  for (const start of starts) {
    const excerpt = normalizedBody.slice(start, start + MAX_BODY_CHARS);
    const score = terms.reduce((sum, term) => sum + (excerpt.includes(term) ? term.length * term.length : 0), 0);
    if (score > bestScore) { bodyStart = start; bestScore = score; }
  }
  const bodyEnd = Math.min(body.length, bodyStart + MAX_BODY_CHARS);
  return { body: body.slice(bodyStart, bodyEnd), bodyStart, bodyEnd, bodyTruncated: bodyStart > 0 || bodyEnd < body.length };
}

function sourceSnapshot(ranked, question = '') {
  return ranked.map(({ entry }) => ({
    id: entry.id,
    title: entry.title,
    type: entry.type,
    summary: entry.summary || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    ...bodyExcerpt(entry.body, question),
    characterProfile: entry.type === 'character' ? entry.characterProfile || {} : undefined
  }));
}

function questionPrompt(question, sources) {
  return {
    messages: [
      { role: 'system', content: '你是项目资料库问答助手。只能依据提供的资料卡回答，不能使用常识补全或编造。body 是原文片段，bodyStart/bodyEnd 是其在原文中的位置；bodyTruncated 为 true 时不可推断未提供的正文。若资料不足，明确回答“资料库未提供足够信息”。只返回 JSON：{"answer":"","sourceIds":[""],"confidence":"grounded|partial|not-found"}。sourceIds 必须是实际支撑答案的资料卡 ID。' },
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
  const confidence = !cited.length ? 'not-found'
    : (['grounded', 'partial', 'not-found'].includes(raw.confidence) ? raw.confidence : 'partial');
  return { answer: cited.length && answer ? answer : '资料库未提供足够信息。', sourceIds: cited, confidence };
}

function createCompendiumAgentQaService({ settingsService, compendiumAgentService, streamGeneration } = {}) {
  if (!settingsService || !compendiumAgentService) throw new Error('settingsService and compendiumAgentService are required');
  const runner = AITaskRunner.createAITaskRunner({ streamGeneration: streamGeneration || ProviderStream.streamGeneration });

  async function ask(dataRoot, projectId, question) {
    const cleanQuestion = String(question || '').trim().slice(0, 1000);
    if (!cleanQuestion) throw new Error('question is required');
    const settings = await settingsService.readSettings(dataRoot);
    const { agentSettings, profile, config } = resolveProviderConfig(settings);
    await projectService.projectLocation(dataRoot, projectId);
    // The model input limit must not limit local retrieval. Snapshot every card
    // with the same body-access policy, then send only the best bounded matches.
    const entries = await compendiumStore.listEntries(dataRoot, projectId);
    const snapshots = entries.map(entry => CompendiumAgentPolicy.createAgentEntrySnapshot(entry, agentSettings));
    const ranked = rankEntries(snapshots, cleanQuestion, Math.min(MAX_SOURCES, agentSettings.maxCardsPerRun));
    if (!ranked.length) return { ok: true, projectId, answer: '资料库中没有找到与此问题相关的资料。', sourceIds: [], confidence: 'not-found', sources: [], provider: { profileId: profile.id, provider: profile.provider, model: config.model } };
    const sources = sourceSnapshot(ranked, cleanQuestion);
    const task = { projectId, domain: 'compendium', action: 'update', scope: 'project', target: { type: 'compendium-agent-qa', projectId, id: `compendium-qa-${projectId}` }, instruction: '基于检索到的资料卡回答问题', providerProfileId: profile.id, model: config.model, outputContract: 'field-patch', beforeSnapshot: { sourceIds: sources.map((source) => source.id) } };
    const result = await runner.run(task, { prompt: questionPrompt(cleanQuestion, sources), providerConfig: { ...config, temperature: 0.1, maxTokens: 1200 } });
    if (!result.ok) throw new Error(result.error.message || 'compendium question failed');
    const answer = sanitizeAnswer(result.output, sources);
    return { ok: true, projectId, ...answer, sources: sources.map(({ id, title, type, body, bodyStart, bodyEnd, bodyTruncated }) => ({ id, title, type, excerpt: body, bodyStart, bodyEnd, bodyTruncated })), provider: { profileId: profile.id, provider: profile.provider, model: config.model } };
  }
  return { ask };
}

module.exports = { createCompendiumAgentQaService, termsFor, rankEntries, sourceSnapshot, questionPrompt, sanitizeAnswer, MAX_SOURCES };
