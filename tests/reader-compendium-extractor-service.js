const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const settingsService = require('../desktop/services/settings-service');
const { createReaderCompendiumExtractorService } = require('../desktop/services/reader-compendium-extractor-service');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-extractor-'));
  try {
    await settingsService.updateProviderProfile(root, { id: 'reader-extract-profile', name: 'Reader Extract', provider: 'openai-compatible', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'READER_API_SECRET', model: 'reader-model' });
    await settingsService.updateSettings(root, { compendiumAgent: { enabled: true, providerProfileId: 'reader-extract-profile', maxCardsPerRun: 30 } });
    let promptText = '';
    const valid = createReaderCompendiumExtractorService({ settingsService, streamGeneration: async (prompt, onToken) => {
      promptText = prompt.asString(); onToken('{"cards":[]}');
    } });
    const empty = await valid.extractChunk(root, { projectId: 'project-1', envelope: { envelopeId: 'envelope-1' }, sourceTitle: '来源', chunk: { index: 0, start: 0, end: 15, text: 'SELECTED_SOURCE_ONLY' }, chunkCount: 1, existingEntries: [] });
    assert.deepStrictEqual(empty, [], 'a chunk with no supported cards should be valid');
    assert.ok(promptText.includes('SELECTED_SOURCE_ONLY'));
    assert.ok(!promptText.includes('READER_API_SECRET'), 'API keys must not enter prompts');
    assert.ok(!promptText.includes(root), 'absolute data paths must not enter prompts');
    assert.ok(!promptText.includes('UNRELATED_FULL_TEXT'), 'unrelated project text must not enter prompts');
    const invalid = createReaderCompendiumExtractorService({ settingsService, streamGeneration: async (_, onToken) => onToken('{invalid json') });
    await assert.rejects(() => invalid.extractChunk(root, { projectId: 'project-1', envelope: { envelopeId: 'envelope-2' }, sourceTitle: '来源', chunk: { index: 0, start: 0, end: 1, text: '甲' }, chunkCount: 1, existingEntries: [] }), /Unexpected|JSON|field patch/i);
    console.log('reader compendium extractor service tests passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
