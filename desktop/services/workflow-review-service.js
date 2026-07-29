const artifactStore = require('../storage/workflow-artifact-store');

function clean(value) { return String(value || '').trim(); }
function sentences(text) { return clean(text).split(/[。！？.!?]+/).map((item) => item.trim()).filter((item) => item.length >= 8); }

const SEVERITY_ALIASES = Object.freeze({
  pass: 'pass',
  passed: 'pass',
  通过: 'pass',
  info: 'info',
  informational: 'info',
  信息: 'info',
  suggestion: 'suggestion',
  minor: 'suggestion',
  建议: 'suggestion',
  轻微: 'suggestion',
  warning: 'warning',
  medium: 'warning',
  warn: 'warning',
  警告: 'warning',
  中等: 'warning',
  error: 'error',
  major: 'error',
  high: 'error',
  严重: 'error',
  错误: 'error',
  critical: 'critical',
  fatal: 'critical',
  致命: 'critical'
});

function normalizeReviewSeverity(value, fallback = 'warning') {
  return SEVERITY_ALIASES[clean(value).toLowerCase()] || fallback;
}

function normalizeFinding(finding = {}, fallback = 'warning') {
  return {
    ...finding,
    severity: normalizeReviewSeverity(finding.severity, fallback)
  };
}

function isBlockingFinding(finding = {}) {
  return ['error', 'critical'].includes(normalizeReviewSeverity(finding.severity));
}

function evidenceExcerpt(text, start, end) {
  const source = String(text || '');
  return source.slice(Math.max(0, start - 50), Math.min(source.length, end + 80)).trim();
}

function processLeakFindings(scene = {}) {
  const text = String(scene.text || scene.content || '');
  const patterns = [
    {
      type: 'process_label_leak',
      regex: /(?:场景|scene)\s*[0-9一二三四五六七八九十]+\s*[-—_.]\s*\d+/gi,
      suggestion: '删除创作过程编号，并把所指事件改写为故事内可理解的时间或因果关系。'
    },
    {
      type: 'process_label_leak',
      regex: /(?:上一批|下一批|本批次|第\s*\d+\s*批(?:次)?)/g,
      suggestion: '改用故事内的阶段、时间或事件名称，不要暴露生成批次。'
    },
    {
      type: 'prompt_metadata_leak',
      regex: /\b(?:fineOutline|targetWords|batchContext|currentScene|scenePlan)\b/gi,
      suggestion: '移除 Prompt 或 JSON 字段名，把必要信息改写为自然叙事。'
    },
    {
      type: 'prompt_instruction_leak',
      regex: /(?:计划要求|创作过程|生成要求|提示词要求|Prompt\s*(?:要求|字段|内容|上下文)|JSON\s*(?:字段|格式|输出|上下文|对象))/gi,
      suggestion: '删除面向模型或工作流的说明，只保留故事世界内能够成立的叙事。'
    }
  ];
  const findings = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(text);
    while (match) {
      findings.push(normalizeFinding({
        type: pattern.type,
        severity: 'error',
        source: 'deterministic-quality-gate',
        sceneId: clean(scene.sceneId || scene.id),
        revisionId: clean(scene.revisionId),
        sceneTitle: clean(scene.title),
        range: { start: match.index, end: match.index + match[0].length },
        evidence: evidenceExcerpt(text, match.index, match.index + match[0].length),
        suggestion: pattern.suggestion
      }));
      match = pattern.regex.exec(text);
    }
  }
  const heading = text.match(/^\s*#\s+.+$/m);
  if (heading && heading.index !== undefined) {
    findings.push(normalizeFinding({
      type: 'unexpected_markdown_title',
      severity: 'error',
      source: 'deterministic-quality-gate',
      sceneId: clean(scene.sceneId || scene.id),
      revisionId: clean(scene.revisionId),
      sceneTitle: clean(scene.title),
      range: { start: heading.index, end: heading.index + heading[0].length },
      evidence: heading[0].trim(),
      suggestion: '场景标题应保存在场景元数据中，正文只保留小说内容。'
    }));
  }
  return findings;
}

function normalizedSentence(value) {
  return clean(value).replace(/[\s“”「」『』"'，、；：—…（）()]/g, '').toLocaleLowerCase('zh-CN');
}

function boundaryFindings(scenesInput = []) {
  const scenesList = Array.isArray(scenesInput) ? scenesInput : [];
  const findings = [];
  for (let index = 1; index < scenesList.length; index += 1) {
    const previous = scenesList[index - 1] || {};
    const current = scenesList[index] || {};
    const previousSentences = sentences(previous.text || previous.content).slice(-20);
    const currentSentences = sentences(current.text || current.content).slice(0, 20);
    const previousMap = new Map(previousSentences.map((sentence) => [normalizedSentence(sentence), sentence]));
    const shared = currentSentences
      .map((sentence) => ({ normalized: normalizedSentence(sentence), sentence }))
      .filter((item) => item.normalized.length >= 8 && previousMap.has(item.normalized));
    const sharedCharacters = shared.reduce((sum, item) => sum + item.normalized.length, 0);
    if (shared.length < 2 && sharedCharacters < 80) continue;
    findings.push(normalizeFinding({
      type: 'scene_boundary_repetition',
      severity: 'error',
      source: 'deterministic-quality-gate',
      sceneId: clean(current.sceneId || current.id),
      revisionId: clean(current.revisionId),
      sceneTitle: clean(current.title),
      relatedSceneId: clean(previous.sceneId || previous.id),
      relatedRevisionId: clean(previous.revisionId),
      evidence: shared.slice(0, 3).map((item) => item.sentence).join(' / '),
      suggestion: '当前场景与前一场重复重演。保留前场已经发生的事实，从最新人物状态和动作结果继续推进。'
    }));
  }
  return findings;
}

function blockingFindings(report = {}) {
  return (Array.isArray(report.findings) ? report.findings : [])
    .map((finding) => normalizeFinding(finding))
    .filter(isBlockingFinding);
}

function reviewDraft(input = {}) {
  const text = clean(input.text);
  const findings = [];
  const seen = new Set();
  for (const sentence of sentences(text)) {
    if (seen.has(sentence)) findings.push(normalizeFinding({ type: 'duplicate_content', severity: 'warning', text: sentence }));
    seen.add(sentence);
  }
  for (const constraint of Array.isArray(input.constraints) ? input.constraints : []) {
    const value = clean(constraint.text);
    if (!value) continue;
    if (constraint.kind === 'exclusion' && text.includes(value)) findings.push(normalizeFinding({ type: 'constraint_violation', severity: constraint.enforcement === 'hard' ? 'error' : 'warning', constraintId: constraint.id, text: value }));
    if (constraint.kind === 'direction' && constraint.enforcement === 'hard' && !text.includes(value)) findings.push(normalizeFinding({ type: 'direction_missing', severity: 'warning', constraintId: constraint.id, text: value }));
  }
  const plan = input.scenePlan && Array.isArray(input.scenePlan.scenes) ? input.scenePlan.scenes : [];
  if (plan.length && !text) findings.push(normalizeFinding({ type: 'outline_mismatch', severity: 'error', text: '场景计划存在但正文为空' }));
  const scenesList = Array.isArray(input.scenes) ? input.scenes : [];
  scenesList.forEach((scene) => findings.push(...processLeakFindings(scene)));
  findings.push(...boundaryFindings(scenesList));
  const normalized = findings.map((finding) => normalizeFinding(finding));
  const blocked = normalized.filter(isBlockingFinding);
  return {
    schemaVersion: 1,
    kind: 'draft-review',
    findings: normalized,
    blockingFindingCount: blocked.length,
    qualityGate: blocked.length ? 'blocked' : 'passed',
    summary: normalized.length ? `发现 ${normalized.length} 项待处理问题，其中 ${blocked.length} 项阻断问题` : '未发现自动审查问题'
  };
}

function compareDrafts(left, right) {
  const a = clean(left); const b = clean(right);
  return { schemaVersion: 1, kind: 'draft-comparison', leftLength: a.length, rightLength: b.length, same: a === b, sharedSentences: sentences(a).filter((item) => sentences(b).includes(item)), changed: a !== b };
}

async function createVariant(projectPath, runId, artifactId, parentRevisionId, input = {}) {
  const family = await artifactStore.readArtifactFamily(projectPath, runId, artifactId);
  const parent = await artifactStore.readArtifactRevision(projectPath, runId, artifactId, parentRevisionId);
  if (!family || !parent) throw new Error('parent draft revision not found');
  return artifactStore.writeArtifactRevision(projectPath, runId, family, { id: input.revisionId, parentRevisionId, variantId: input.variantId || 'alternative', inputRevisionIds: parent.inputRevisionIds, constraintSnapshotId: parent.constraintSnapshotId, summary: input.summary || '替代正文版本', payload: { format: 'text' } }, input.text);
}

async function writeReviewArtifact(projectPath, runId, input = {}) {
  return artifactStore.writeArtifactRevision(projectPath, runId, { id: input.artifactId, projectId: input.projectId, runId, nodeId: input.nodeId || 'review', artifactType: 'draft-review@1', title: '草稿审查报告' }, { id: input.revisionId, inputRevisionIds: input.inputRevisionIds, summary: input.content.summary, payload: { format: 'json' } }, input.content);
}

function detectStaleness(revision, currentInputRevisionIds = []) {
  const expected = new Set(revision.inputRevisionIds || []);
  const current = new Set(currentInputRevisionIds);
  return expected.size !== current.size || [...expected].some((id) => !current.has(id))
    ? 'stale'
    : 'fresh';
}

module.exports = {
  SEVERITY_ALIASES,
  normalizeReviewSeverity,
  normalizeFinding,
  isBlockingFinding,
  blockingFindings,
  processLeakFindings,
  boundaryFindings,
  reviewDraft,
  compareDrafts,
  createVariant,
  writeReviewArtifact,
  detectStaleness
};
