const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fixture(base, mode = 'append', start = base.length, end = start) {
    const editor = { value: base, selectionStart: start, selectionEnd: end, focus() {} };
    const scene = { id: 'scene-1' };
    const generation = { text: '', beat: '原指令', genTask: 'beat', reasoning: '' };
    const state = { activeSceneId: scene.id, generation, snapshot: { project: {}, scenes: [scene] }, context: { compendiumIds: [], compendiumTags: [] } };
    const requests = [];
    let saved = base;
    const context = vm.createContext({
        console, AbortController, window: { DraftHarborPromptBuilder: {
            buildFictionPrompt(input) { return { messages: [{ role: 'user', content: input.sceneContext }], asString: () => input.sceneContext }; }
        } }, nativeEditorState: state,
        nativeEditorElements: () => ({ editor, insertMode: { value: mode }, beatInput: { value: generation.beat } }),
        currentNativeScene: () => scene, currentNativeChapter: () => null,
        nativeSceneContent: () => saved,
        flushNativeEditorFields: () => { saved = editor.value; },
        selectedPromptTemplate: () => ({}), nativeAvoidanceInstruction: () => '',
        settingsState: { runtimeProvider: {} },
        resetNativeGenerationStreamFlags: () => { generation.reasoning = ''; },
        renderNativeGeneration() {}, renderNativeEditor() {}, setNativeSaveStatus() {}, markNativeDirty() {}, updateNativeStats() {},
        desktopGenerationAvailable: () => true,
        streamDesktopGeneration: async (prompt, receive) => {
            requests.push(prompt.messages[0].content);
            receive(`结果${requests.length}`, { type: 'content' });
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell/writer-generation.js'), 'utf8'), context);
    context.nativeGenerationConfig = () => ({});
    return { context, editor, generation, requests };
}

(async () => {
    for (const [base, mode, start, end] of [
        ['原正文', 'append', 3, 3], ['', 'append', 0, 0],
        ['前文后文', 'cursor', 2, 2], ['前文旧段后文', 'replace', 2, 4]
    ]) {
        const f = fixture(base, mode, start, end);
        assert.strictEqual((await f.context.startNativeGeneration()).ok, true);
        const first = f.editor.value;
        assert.strictEqual((await f.context.startNativeGeneration()).ok, true);
        assert.deepStrictEqual(f.requests, [base, base], 'retry must exclude the previous output from provider context');
        assert.strictEqual(f.editor.value, first.replace('结果1', '结果2'), 'retry must replace at the original insertion range');
        f.context.discardNativeGeneration();
        assert.strictEqual(f.editor.value, base, 'discard must also restore an empty scene');
    }
    const edited = fixture('原文');
    await edited.context.startNativeGeneration();
    edited.editor.value += '人工修改';
    const retained = edited.editor.value;
    assert.strictEqual((await edited.context.startNativeGeneration()).reason, 'editor-changed');
    assert.strictEqual(edited.editor.value, retained);
    assert.strictEqual(edited.requests.length, 1, 'retry must not silently overwrite manual edits');

    const history = fixture('前文旧段后文', 'replace', 2, 4);
    await history.context.startNativeGeneration();
    await history.context.retryNativeHistoryRecord({ beat: '新的指令' });
    assert.deepStrictEqual(history.requests, ['前文旧段后文', '前文旧段后文']);
    assert.strictEqual(history.editor.value, '前文\n\n结果2\n\n后文');

    for (const partial of ['', '部分结果']) {
        const failed = fixture('前文旧段后文', 'replace', 2, 4);
        const stream = failed.context.streamDesktopGeneration;
        failed.context.streamDesktopGeneration = async (_prompt, receive) => {
            if (partial) receive(partial, { type: 'content' });
            const error = new Error('cancelled');
            error.name = 'AbortError';
            throw error;
        };
        await failed.context.startNativeGeneration();
        failed.context.streamDesktopGeneration = stream;
        assert.strictEqual((await failed.context.startNativeGeneration()).ok, true);
        assert.deepStrictEqual(failed.requests, ['前文旧段后文'], 'retry after interruption must retain the original context');
    }

    const accepted = fixture('原文');
    await accepted.context.startNativeGeneration();
    accepted.context.acceptNativeGeneration();
    const acceptedText = accepted.editor.value;
    await accepted.context.startNativeGeneration();
    assert.strictEqual(accepted.requests[1], acceptedText, 'generation after acceptance should continue from accepted prose');
    console.log('Writer retry regression tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
