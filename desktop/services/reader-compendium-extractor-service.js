const AITaskRunner = require('../../src/core/generation/ai-task-runner');
const ProviderStream = require('../../src/core/generation/provider-stream');
const { resolveProviderConfig } = require('./compendium-agent-runner-service');

function extractionPrompt(input) {
  const existing = Array.isArray(input.existingEntries) ? input.existingEntries : [];
  return {
    messages: [
      {
        role: 'system',
        content: [
          '你是小说资料编辑。只从给定来源分块提取明确有证据支持的资料卡，不得引用其他正文或路径。',
          '只返回 JSON，不要使用 Markdown。格式：{"cards":[{"type":"character|location|organization|item|lore|timeline|note","title":"","summary":"","body":"","tags":[""],"aliases":[""],"characterProfile":{"role":"","goal":"","motivation":"","conflict":"","voice":"","currentState":"","knowledge":"","relationshipNotes":""}}]}。',
          '只允许上述字段。不要返回 id、projectId、sourceReferences 或其他控制字段。没有可靠候选时返回 {"cards":[]}。',
          '同名或别名对象尽量使用与已有资料卡一致的主名称；不要为了避免重复而省略来源明确支持的新信息。'
        ].join('\n')
      },
      { role: 'user', content: `来源：${input.sourceTitle || 'Reader 快照'}\n分块：${input.chunk.index + 1}/${input.chunkCount}\n已有资料卡索引：${JSON.stringify(existing)}\n\n来源分块：\n${input.chunk.text}` }
    ],
    asString() { return this.messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'); }
  };
}

function createReaderCompendiumExtractorService({ settingsService, streamGeneration } = {}) {
  if (!settingsService) throw new Error('settingsService is required');
  const runner = AITaskRunner.createAITaskRunner({ streamGeneration: streamGeneration || ProviderStream.streamGeneration });
  async function extractChunk(dataRoot, input) {
    const settings = await settingsService.readSettings(dataRoot);
    const { profile, config } = resolveProviderConfig(settings);
    const result = await runner.run({
      id: `reader-compendium-${input.envelope.envelopeId}-${input.chunk.index}`,
      projectId: input.projectId, domain: 'compendium', action: 'extract', scope: 'selection',
      target: { type: 'reader-transfer-chunk', id: `${input.envelope.envelopeId}:${input.chunk.index}` },
      instruction: '从 Reader 冻结快照分块提取资料卡候选', providerProfileId: profile.id,
      model: config.model, outputContract: 'card-drafts',
      beforeSnapshot: { envelopeId: input.envelope.envelopeId, chunkIndex: input.chunk.index, start: input.chunk.start, end: input.chunk.end }
    }, { prompt: extractionPrompt(input), providerConfig: config });
    if (!result.ok) throw new Error(result.error.message || 'reader compendium extraction failed');
    return result.output;
  }
  return { extractChunk };
}

module.exports = { createReaderCompendiumExtractorService, extractionPrompt };
