const assert = require('assert');

const PromptBuilder = require('../src/core/generation/prompt-builder');
const GenerationResult = require('../src/core/generation/generation-result');
const ProviderClient = require('../src/core/generation/ai-provider-client');
const GenerationHistory = require('../src/core/generation/generation-history');

const prompt = PromptBuilder.buildFictionPrompt({
    beat: 'She grabs her coat @[Alice] #[Old Scene] and steps into the rain.',
    sceneContext: 'Alice sat by the window.',
    options: {
        povCharacter: 'Alice',
        pov: '1st person',
        tense: 'present',
        prosePrompt: 'Use close sensory detail.',
        compendiumEntries: [{ id: 'alice', title: 'Alice', content: 'A tired detective.' }],
        sceneSummaries: [{ title: 'Old Scene', summary: 'A clue was found.' }]
    }
});

assert.strictEqual(prompt.messages.length, 2);
assert.ok(prompt.messages[0].content.includes('Alice'));
assert.ok(prompt.messages[0].content.includes('present tense'));
assert.ok(prompt.messages[1].content.includes('CURRENT SCENE SO FAR'));
assert.ok(prompt.messages[1].content.includes('COMPENDIUM REFERENCES'));
assert.ok(prompt.messages[1].content.includes('PREVIOUS SCENES'));
assert.ok(prompt.messages[1].content.includes('BEAT TO EXPAND'));
assert.ok(prompt.messages[1].content.includes('只完成本拍'));
assert.ok(prompt.messages[1].content.includes('写完即停'));
assert.ok(prompt.messages[1].content.includes('不要提前写下一拍或后续情节'));
assert.ok(!prompt.messages[1].content.includes('2-3 paragraphs'));
assert.ok(!prompt.messages[1].content.includes('写下一段'));
assert.ok(!prompt.messages[1].content.includes('@[Alice]'));
assert.ok(!prompt.messages[1].content.includes('#[Old Scene]'));
assert.ok(prompt.asString().includes('<|im_start|>system'));

const withHint = PromptBuilder.buildFictionPrompt({
    beat: 'She steps into the rain.',
    options: { lengthHint: 'brief' }
});
assert.ok(withHint.messages[1].content.includes('写紧一点'));
assert.ok(!withHint.messages[1].content.includes('400'));
assert.ok(!withHint.messages[1].content.includes('800'));
assert.strictEqual(PromptBuilder.normalizeLengthHint({ minChars: 400, maxChars: 800 }), 'natural');

const withExpanded = PromptBuilder.buildFictionPrompt({
    beat: 'She steps into the rain.',
    options: { lengthHint: '展开' }
});
assert.ok(withExpanded.messages[1].content.includes('稍展开'));

const withCustomCloser = PromptBuilder.buildFictionPrompt({
    beat: 'She steps into the rain.',
    options: { outputCloser: '只写这一拍，然后停下。' }
});
assert.ok(withCustomCloser.messages[1].content.includes('只写这一拍，然后停下。'));
assert.ok(!withCustomCloser.messages[1].content.includes('只完成本拍'));

const request = ProviderClient.createProviderRequest({
    task: 'draft-scene',
    prompt,
    provider: {
        aiMode: 'local',
        aiProvider: 'lmstudio',
        aiModel: 'local-model',
        aiEndpoint: 'http://localhost:1234'
    }
});
assert.strictEqual(request.task, 'draft-scene');
assert.strictEqual(request.provider.mode, 'local');
assert.strictEqual(request.provider.provider, 'lmstudio');
assert.ok(request.promptText.includes('<|im_start|>user'));

(async () => {
    const ok = await ProviderClient.runProviderRequest(request, {
        run: async () => ({ text: 'Generated prose.', usage: { tokens: 12 } })
    });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.text, 'Generated prose.');
    assert.strictEqual(ok.usage.tokens, 12);

    const failed = await ProviderClient.runProviderRequest(request, {
        run: async () => { throw new Error('API returned 429: rate limit'); }
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.error.code, 'rate_limited');

    const record = GenerationHistory.createGenerationRecord({
        projectId: 'p1',
        sceneId: 's1',
        messages: prompt.messages,
        resultText: ok.text
    });
    assert.strictEqual(record.projectId, 'p1');
    assert.strictEqual(record.sceneId, 's1');
    assert.strictEqual(record.resultText, 'Generated prose.');

    const normalized = GenerationResult.normalizeGenerationError(new Error('DeepSeek authentication failed (401)'), {
        provider: 'deepseek',
        model: 'deepseek-v4'
    });
    assert.strictEqual(normalized.code, 'auth_error');
    assert.strictEqual(normalized.provider, 'deepseek');

    const abortedError = new Error('The operation was aborted');
    abortedError.name = 'AbortError';
    assert.strictEqual(
        GenerationResult.normalizeGenerationError(abortedError).code,
        'aborted',
        'AbortError should keep a stable cancellation code'
    );
    assert.strictEqual(
        GenerationResult.normalizeGenerationError(new Error('API returned 402: insufficient balance')).code,
        'quota_error'
    );
    assert.strictEqual(
        GenerationResult.normalizeGenerationError(new Error('Failed to fetch provider response')).code,
        'network_error'
    );
    assert.strictEqual(
        GenerationResult.normalizeGenerationError(new Error('Requested model is unavailable')).code,
        'model_error'
    );

    const abortedRequest = await ProviderClient.runProviderRequest(request, {
        run: async () => { throw abortedError; }
    });
    assert.strictEqual(abortedRequest.ok, false);
    assert.strictEqual(abortedRequest.error.code, 'aborted');
    assert.strictEqual(abortedRequest.task, 'draft-scene');

    console.log('Core generation tests passed.');
})().catch((error) => {
    console.error('Core generation tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
