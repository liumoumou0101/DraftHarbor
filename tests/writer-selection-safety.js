const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fixture(base = '甲段。乙段。丙段。', start = 3, end = 6) {
    const scene = { id: 's1' };
    const editor = { value: base, selectionStart: start, selectionEnd: end, focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
    const state = { snapshot: { project: { id: 'p1' } }, activeSceneId: scene.id, rewrite: { instruction: '压缩成一句话', regenerateInstruction: '', regenerateUseContext: true }, generation: { text: '', task: 'fiction-prose' } };
    const elements = { editor, rewriteInstruction: { value: '压缩成一句话' }, regenerateInstruction: { value: '' }, regenerateUseContext: { checked: true } };
    const statuses = [], requests = [];
    const c = vm.createContext({
        console: { error() {} }, AbortController, structuredClone, nativeEditorState: state,
        nativeEditorElements: () => elements, currentNativeScene: () => scene, currentProjectId: () => state.snapshot.project.id,
        settingsState: { runtimeProvider: {} }, writerModelOverride: { profileId: 'inherit' },
        nativeAvoidanceInstruction: () => '避免模板化微表情',
        setNativeSaveStatus: text => statuses.push(text), flushNativeEditorFields() {}, markNativeDirty() {},
        resetNativeGenerationStreamFlags(g) { g.reasoning = ''; g.errorMessage = ''; g.interruptReason = ''; g.finishReason = ''; },
        renderNativeGeneration() {}, renderNativeEditor() {},
        window: { DraftHarborAITaskContract: { taskTargetKey: () => 'selection' }, DraftHarborAITaskHistory: { toLegacyGenerationRecord: (record, extra) => ({ ...record, ...extra }) } }
    });
    for (const file of ['writer-prompts.js', 'writer-generation.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell', file), 'utf8'), c);
    c.nativeGenerationConfig = () => ({});
    c.nativeRegenerateContextChars = () => 8000;
    c.writerEffectiveProfile = () => ({});
    c.writerSelectedModelId = () => 'test';
    const f = { c, state, scene, editor, elements, statuses, requests, failure: false, throwFailure: false };
    c.getNativeAITaskRunner = () => ({ run: async (_task, options) => {
        requests.push(options.prompt.messages);
        if (f.throwFailure) throw new Error('provider unavailable');
        const text = f.failure ? '本次不完整内容' : '新乙段';
        options.onToken({ text, reasoning: '', finishReason: f.failure ? 'length' : 'stop', usage: {} });
        return f.failure ? { ok: false, status: 'failed', error: { message: 'truncated' }, record: { id: 'failed' } }
            : { ok: true, text, reasoning: '', record: { id: 'completed' } };
    } });
    return f;
}
(async () => {
    const f = fixture();
    assert.strictEqual((await f.c.startNativeRegenerateSelection()).ok, true);
    assert.ok(!f.requests[0][1].content.includes('压缩成一句话'), 'regeneration must not inherit polish instructions');
    assert.ok(f.requests[0][1].content.includes('完整重写'));
    assert.ok(f.requests[0][0].content.includes('避免模板化微表情'));
    assert.strictEqual(f.editor.value, '甲段。乙段。丙段。', 'streaming must preserve the original prose');
    f.editor.setSelectionRange(0, 3);
    assert.strictEqual((await f.c.startNativeRegenerateSelection()).reason, 'pending-result');
    assert.strictEqual(f.requests.length, 1, 'new selections must not implicitly replace a pending result');
    f.state.rewrite.selectionStart = 0;
    f.state.rewrite.selectionEnd = 3;
    f.state.rewrite.originalText = '甲段。';
    f.state.generation.prompt = { messages: [{ role: 'user', content: 'unrelated preview' }] };
    f.elements.regenerateInstruction.value = '后来编辑的要求';
    f.failure = true;
    assert.strictEqual((await f.c.startNativeRegenerateSelection({ retry: true })).ok, false);
    assert.strictEqual(JSON.stringify(f.requests[1]), JSON.stringify(f.requests[0]), 'retry must reuse its captured request despite changed fields and selection');
    assert.strictEqual(f.state.generation.text, '新乙段', 'failed retry must retain the previous complete result');
    assert.strictEqual(f.state.snapshot.promptHistory.length, 2, 'failed attempt remains in history');
    f.throwFailure = true;
    await f.c.startNativeRegenerateSelection({ retry: true });
    assert.strictEqual(f.state.generation.text, '新乙段');
    assert.strictEqual(f.state.generation.inProgress, false);
    f.c.acceptNativeRewrite();
    assert.strictEqual(f.editor.value, '甲段。新乙段丙段。', 'acceptance uses the captured range, not mutable selection state');

    const pending = fixture();
    Object.assign(pending.state.generation, { task: 'fiction-prose', text: '待确认续写', inlineBaseText: '原文', pendingSceneId: 's1' });
    pending.editor.value = '原文\n\n待确认续写';
    assert.strictEqual((await pending.c.startNativeRegenerateSelection()).reason, 'pending-result');
    assert.strictEqual((await pending.c.startNativeRewrite()).reason, 'pending-result');
    assert.strictEqual(pending.editor.value, '原文\n\n待确认续写');
    assert.strictEqual(pending.state.generation.text, '待确认续写');
    assert.strictEqual(pending.requests.length, 0);

    for (const change of [f => { f.editor.value = '插入了新内容' + f.editor.value; }, f => { f.scene.id = 's2'; }, f => { f.state.snapshot.project.id = 'p2'; }]) {
        const altered = fixture();
        await altered.c.startNativeRegenerateSelection();
        change(altered);
        const before = altered.editor.value;
        altered.c.acceptNativeRewrite();
        assert.strictEqual(altered.editor.value, before, 'changed prose or target must block replacement');
        assert.strictEqual((await altered.c.startNativeRegenerateSelection({ retry: true })).reason, 'stale-selection');
    }
    const long = fixture('前'.repeat(9000) + '选'.repeat(12000) + '后'.repeat(9000), 9000, 21000);
    long.elements.regenerateInstruction.value = '保留关键事实，重写冲突推进';
    await long.c.startNativeRegenerateSelection();
    const request = long.requests[0][1].content;
    assert.strictEqual((request.match(/选/g) || []).length >= 12000, true, 'large original selection must not be silently shortened');
    assert.strictEqual((request.match(/前/g) || []).length >= 8000, true);
    assert.ok(request.includes('保留关键事实，重写冲突推进'));
    const noContext = fixture();
    noContext.elements.regenerateUseContext.checked = false;
    await noContext.c.startNativeRegenerateSelection();
    assert.ok(noContext.requests[0][1].content.includes('用户选择不发送上下文'));
    assert.ok(!noContext.requests[0][1].content.includes('甲段。'));
    console.log('Selection regeneration safety tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
