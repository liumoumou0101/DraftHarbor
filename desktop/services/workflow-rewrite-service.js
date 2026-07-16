const RewriteSchema = require('../../src/core/workflow/workflow-rewrite-schema');

function clean(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function parseJson(value) {
  const parsed = JSON.parse(clean(value).replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('rewrite output must be a JSON object');
  return parsed;
}
function jsonPrompt(system, payload) { return { messages: [{ role: 'system', content: `${system}\n只返回合法 JSON，不要使用 Markdown 代码块。` }, { role: 'user', content: JSON.stringify(payload) }] }; }
function textPrompt(system, payload) { return { messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }] }; }

function sourceEntries(snapshot = {}, sceneIds = []) {
  const ids = new Set(sceneIds);
  return (Array.isArray(snapshot.content) ? snapshot.content : []).filter((entry) => ids.has(entry.sceneId));
}

function prepareRewriteStage(stage, context = {}) {
  const source = context.sourceSnapshot || {};
  const brief = RewriteSchema.createRewriteBrief(context.brief || {});
  const constraints = Array.isArray(context.constraints) ? context.constraints : [];
  if (stage === 'plan') {
    return { outputFormat: 'json', prompts: [{ id: 'rewrite-plan', title: '大段重写计划', prompt: jsonPrompt('你是长篇小说重写编辑。为每个来源场景设计可直接修改的重写单元。不得省略来源场景。返回 {strategy,units:[{id,title,sourceSceneIds,targetSceneId,objective,rules:[{kind:"preserve|delete|compress|expand|reorder|style|perspective|tone",instruction,weight}],preserveFacts,removeElements,targetWords,bridgeBefore,bridgeAfter,continuityRequirements}]}。', { brief, source, constraints }) }] };
  }
  const plan = RewriteSchema.createRewritePlan(context.plan || {}, { sourceSnapshot: source, sourceRevisionId: context.sourceRevisionId });
  const rewrites = Array.isArray(context.rewrites) ? context.rewrites : [];
  if (stage === 'rewrite') {
    return {
      outputFormat: 'text',
      prompts: plan.units.map((unit) => ({
        id: unit.id, title: unit.title,
        prompt: textPrompt('你是长篇小说作者。只输出重写后的完整正文，不解释，不输出标题。严格执行重写计划，同时保留指定事实，并与相邻场景自然衔接。', { brief, unit, source: sourceEntries(source, unit.sourceSceneIds), constraints })
      }))
    };
  }
  if (stage === 'repair') {
    return {
      outputFormat: 'text',
      prompts: plan.units.map((unit, index) => ({
        id: unit.id, title: `${unit.title} · 衔接修复`,
        prompt: textPrompt('你是长篇连续性编辑。只输出修复后的当前单元完整正文。修复与前后单元的人物状态、时间地点、因果、语气和信息衔接；不得改变已确认的核心事件。没有衔接问题时原样返回。', {
          brief, unit,
          current: rewrites[index] || null,
          previous: index > 0 ? rewrites[index - 1] : null,
          next: index + 1 < rewrites.length ? rewrites[index + 1] : null,
          constraints
        })
      }))
    };
  }
  throw new Error(`unsupported rewrite stage: ${stage}`);
}

function normalizeRewriteOutput(stage, output, options = {}) {
  if (stage === 'plan') return RewriteSchema.createRewritePlan(typeof output === 'string' ? parseJson(output) : output, options);
  if (['rewrite', 'repair'].includes(stage)) {
    const text = clean(output);
    if (!text) throw new Error('rewrite text output must not be empty');
    return text;
  }
  throw new Error(`unsupported rewrite stage: ${stage}`);
}

function buildRewriteResults(planInput, outputs, options = {}) {
  const plan = RewriteSchema.createRewritePlan(planInput, options);
  if (!Array.isArray(outputs) || outputs.length !== plan.units.length) throw new Error('rewrite outputs must match rewrite plan units');
  return plan.units.map((unit, index) => RewriteSchema.createRewriteUnitResult({ unitId: unit.id, targetSceneId: unit.targetSceneId, text: outputs[index], repairApplied: options.repairApplied === true }));
}

function buildComparison(sourceSnapshot, plan, outputs, options = {}) {
  return RewriteSchema.createRewriteBatchComparison(sourceSnapshot, buildRewriteResults(plan, outputs, options));
}

module.exports = { prepareRewriteStage, normalizeRewriteOutput, buildRewriteResults, buildComparison, parseJson };
