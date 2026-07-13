const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const ProviderStream = require('../../src/core/generation/provider-stream');
const SettingsSchema = require('../../src/core/settings/settings-schema');
const CompendiumAgentPolicy = require('../../src/core/knowledge/compendium-agent-policy');

function resolveProviderConfig(settingsInput = {}) {
  const settings = SettingsSchema.normalizeDesktopSettings(settingsInput);
  const agentSettings = CompendiumAgentPolicy.normalizeCompendiumAgentSettings(settings.compendiumAgent);
  if (!agentSettings.enabled) throw new Error('compendium agent is not enabled');
  if (!agentSettings.providerProfileId) throw new Error('compendium agent provider profile is required');
  const profile = (settings.providerProfiles || []).find((item) => item.id === agentSettings.providerProfileId);
  if (!profile) throw new Error('compendium agent provider profile was not found');
  if (!SettingsSchema.isApiCompatibleProvider(profile.provider)) {
    throw new Error('compendium agent provider must be API-compatible');
  }
  if (!profile.apiKey) throw new Error('compendium agent provider API key is required');
  if (!profile.endpoint) throw new Error('compendium agent provider endpoint is required');
  const config = SettingsSchema.providerRuntimeConfig(settings, {
    profileId: profile.id,
    model: agentSettings.model || profile.model,
    temperature: 0.2,
    maxTokens: 2400,
    useProviderDefaults: false
  });
  return { agentSettings, profile, config };
}

function analysisPrompt(snapshot) {
  return {
    messages: [
      {
        role: 'system',
        content: [
          '你是小说项目的资料库管家。你只能分析给定的资料卡快照，不得推测或引用未提供的小说正文。',
          '只返回 JSON，不要使用 Markdown。格式：',
          '{"findings":[{"id":"","severity":"low|medium|high","reason":"","entryIds":[""],"operationIds":[""]}],"operations":[{"id":"","entryId":"","baseRevision":"","patch":{"summary":"","tags":[""],"aliases":[""],"characterProfile":{"role":"","goal":"","motivation":"","conflict":"","voice":"","currentState":"","knowledge":"","relationshipNotes":""}}}]}',
          'operations 可以为空。只可修改 summary、tags、aliases、characterProfile；禁止 title、type、category、body、sourceReferences、id、projectId 和任何未列字段。',
          '每个 operation 的 baseRevision 必须原样使用输入资料卡的 revision。仅在资料明确支持时提出建议；不确定时只报告问题，不创建 operation。'
        ].join('\n')
      },
      { role: 'user', content: `资料卡快照：\n${JSON.stringify(snapshot)}` }
    ],
    asString() { return this.messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'); }
  };
}

function localFindings(snapshot) {
  const findings = [];
  (snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : []).forEach((entry) => {
    const entryId = entry.id;
    if (!String(entry.summary || '').trim()) {
      findings.push({
        id: `local-missing-summary-${entryId}`,
        severity: 'medium',
        reason: '资料卡缺少摘要，难以在资料库中快速识别。',
        entryIds: [entryId],
        operationIds: []
      });
    }
    if (!Array.isArray(entry.tags) || !entry.tags.length) {
      findings.push({
        id: `local-missing-tags-${entryId}`,
        severity: 'low',
        reason: '资料卡没有标签，后续筛选和上下文选择会较困难。',
        entryIds: [entryId],
        operationIds: []
      });
    }
    if (entry.type === 'character') {
      const profile = entry.characterProfile || {};
      const missing = ['role', 'goal', 'motivation', 'conflict', 'voice', 'currentState', 'knowledge', 'relationshipNotes'].filter((field) => !String(profile[field] || '').trim());
      if (missing.length) {
        findings.push({
          id: `local-character-profile-${entryId}`,
          severity: 'low',
          reason: `人物约束缺少：${missing.join('、')}。`,
          entryIds: [entryId],
          operationIds: []
        });
      }
    }
  });
  return findings;
}

function sanitizeModelAnalysis(input, maxOperations) {
  const raw = input && typeof input === 'object' ? input : {};
  const operations = [];
  const seenEntryIds = new Set();
  (Array.isArray(raw.operations) ? raw.operations : []).slice(0, maxOperations).forEach((operation) => {
    const validation = CompendiumAgentPolicy.validateOperation(operation);
    if (validation.ok && !seenEntryIds.has(validation.operation.entryId)) {
      seenEntryIds.add(validation.operation.entryId);
      operations.push(validation.operation);
    }
  });
  const operationIds = new Set(operations.map((operation) => operation.id).filter(Boolean));
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).map((finding) => ({
    ...finding,
    operationIds: (Array.isArray(finding && finding.operationIds) ? finding.operationIds : []).filter((id) => operationIds.has(String(id || '').trim()))
  }));
  return { findings, operations };
}

function createCompendiumAgentRunnerService({ settingsService, compendiumAgentService, streamGeneration } = {}) {
  if (!settingsService || !compendiumAgentService) throw new Error('settingsService and compendiumAgentService are required');
  const runner = AITaskRunner.createAITaskRunner({ streamGeneration: streamGeneration || ProviderStream.streamGeneration });

  async function analyze(dataRoot, projectId, entryIds = [], options = {}) {
    const settings = await settingsService.readSettings(dataRoot);
    const { agentSettings, profile, config } = resolveProviderConfig(settings);
    const snapshotResult = await compendiumAgentService.readSnapshot(dataRoot, projectId, entryIds, agentSettings);
    const snapshot = snapshotResult.snapshot;
    const task = {
      projectId,
      domain: 'compendium',
      action: 'update',
      scope: 'project',
      target: { type: 'compendium-agent-analysis', projectId, id: `compendium-agent-${projectId}` },
      instruction: '检查资料卡并返回受限维护建议',
      providerProfileId: profile.id,
      model: config.model,
      outputContract: 'field-patch',
      beforeSnapshot: { entryRevisions: snapshot.entries.map((entry) => ({ id: entry.id, revision: entry.revision })) }
    };
    const result = await runner.run(task, {
      prompt: analysisPrompt(snapshot),
      providerConfig: config,
      onToken: options.onToken
    });
    if (!result.ok) throw new Error(result.error.message || 'compendium agent analysis failed');
    const sanitized = sanitizeModelAnalysis(result.output, agentSettings.maxCardsPerRun);
    const validation = CompendiumAgentPolicy.validateAnalysisResultAgainstEntries(sanitized, snapshot.entries, {
      maxOperations: agentSettings.maxCardsPerRun
    });
    if (!validation.ok) throw new Error(`invalid compendium agent response: ${validation.errors.join('; ')}`);
    return {
      ok: true,
      projectId,
      findings: [...localFindings(snapshot), ...validation.result.findings],
      operations: validation.result.operations,
      provider: { profileId: profile.id, provider: profile.provider, model: config.model }
    };
  }

  return { analyze };
}

module.exports = { createCompendiumAgentRunnerService, resolveProviderConfig, analysisPrompt, localFindings, sanitizeModelAnalysis };
