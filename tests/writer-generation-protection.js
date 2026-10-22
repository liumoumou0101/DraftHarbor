const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AITaskRunner = require('../src/core/generation/ai-task-runner');
const AITaskContract = require('../src/core/generation/ai-task-contract');
const AITaskHistory = require('../src/core/generation/ai-task-history');
const GenerationHistory = require('../src/core/generation/generation-history');

// Run the real generation and view functions. The provider is the only async
// boundary; the editor and snapshot expose the same mutable values as the shell.
function fixture(base = '原文', mode = 'append') {
    const scene = { id: 's1' };
    const editor = { value: base, readOnly: false, selectionStart: base.length, selectionEnd: base.length, focus() {} };
    const generation = { text: '', beat: '', genTask: 'continue', reasoning: '' };
    const snapshot = { project: { id: 'p1' }, scenes: [scene], sceneContents: { s1: base } };
    const state = { snapshot, activeSceneId: 's1', generation, rewrite: {}, context: {} };
    const outputClasses = new Set();
    const elements = {
        editor, insertMode: { value: mode }, editorLockHint: { hidden: true, textContent: '' },
        generationResult: { hidden: true, textContent: '' }, generationOutputStatus: { textContent: '' },
        generationOutput: { hidden: true, dataset: {}, classList: {
            contains: name => outputClasses.has(name),
            toggle(name, enabled) { if (enabled) outputClasses.add(name); else outputClasses.delete(name); }
        } }
    };
    const statuses = [];
    const c = vm.createContext({
        console: { error() {} }, AbortController, structuredClone, nativeEditorState: state,
        window: { DraftHarborAITaskRunner: AITaskRunner, DraftHarborAITaskContract: AITaskContract, DraftHarborAITaskHistory: AITaskHistory },
        writerModelOverride: { profileId: 'inherit' }, writerEffectiveProfile: () => ({}), writerSelectedModelId: () => 'test',
        nativeEditorElements: () => elements, currentNativeScene: () => snapshot.scenes.find(item => item.id === state.activeSceneId),
        settingsState: { runtimeProvider: {} },
        flushNativeEditorFields: () => { snapshot.sceneContents[state.activeSceneId] = editor.value; },
        markNativeDirty() {}, updateNativeStats() {}, renderNativeEditor() {},
        setNativeSaveStatus: text => statuses.push(text),
        countNativeWords: text => text.length, formatNumber: String,
        document: { querySelector: () => null }, desktopGenerationAvailable: () => true,
        streamDesktopGeneration: async (_prompt, receive) => receive('生成结果', { type: 'content' })
    });
    for (const name of ['writer-generation-view.js', 'writer-generation.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell', name), 'utf8'), c);
    }
    c.nativeWriterThinkingActive = () => false;
    c.buildNativePrompt = () => ({ messages: [] });
    c.nativeGenerationConfig = () => ({});
    return { c, state, snapshot, scene, editor, generation, elements, statuses };
}

function persistenceFixture() {
    const f = fixture();
    const timers = new Map(), saved = [];
    let nextTimerId = 0;
    Object.assign(f.state, { dirty: false, isSaving: false, editorPrefs: { wordGoal: 0 } });
    Object.assign(f.c.window, {
        DraftHarborGenerationHistory: GenerationHistory,
        setTimeout(callback) { const id = ++nextTimerId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    f.c.fetch = async (_url, options) => {
        saved.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, writerRevision: 'saved-revision' }) };
    };
    f.c.loadReaderFromProjectSnapshot = async () => {};
    f.c.loadProjectLibrary = async () => {};
    // Keep real flush, dirty, autosave scheduling and save payload construction.
    // Only timers and the final disk-service request are controlled locally.
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell/writer-core.js'), 'utf8'), f.c);
    f.c.setNativeSaveStatus = text => f.statuses.push(text);
    return { ...f, timers, saved, async autosave() {
        assert.strictEqual(timers.size, 1, 'dirty generation changes must schedule autosave');
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        callback();
        await f.state.savePromise;
    } };
}

const cases = [
    ['prose is read only until a successful stream settles', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            assert.strictEqual(f.editor.readOnly, true);
            assert.strictEqual(f.elements.editorLockHint.hidden, false);
            assert.match(f.elements.editorLockHint.textContent, /停止.*编辑/);
            receive('生成结果', { type: 'content' });
        };
        assert.strictEqual((await f.c.startNativeGeneration()).ok, true);
        assert.strictEqual(f.editor.readOnly, false);
        assert.strictEqual(f.elements.editorLockHint.hidden, true);
        assert.strictEqual(f.editor.value, '原文\n\n生成结果');
    }],
    ['external edits survive later tokens and remain recoverable as a separate result', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('第一段', { type: 'content' });
            f.editor.value += '人工新增句';
            f.snapshot.sceneContents.s1 = f.editor.value;
            receive('第二段', { type: 'content' });
        };
        const result = await f.c.startNativeGeneration();
        assert.strictEqual(f.editor.value, '原文\n\n第一段人工新增句');
        assert.strictEqual(f.snapshot.sceneContents.s1, f.editor.value);
        assert.strictEqual(f.generation.text, '第一段第二段');
        assert.strictEqual(f.snapshot.promptHistory[0].resultText, '第一段第二段');
        assert.strictEqual(result.reason, 'editor-changed');
        assert.strictEqual(f.elements.generationResult.hidden, false);
        assert.strictEqual(f.elements.generationOutput.classList.contains('is-inline-confirmation'), false,
            'inline confirmation styling hides the separate result even when its hidden attribute is removed');
        assert.strictEqual(f.elements.generationResult.textContent, '第一段第二段');
        assert.match(f.elements.generationOutputStatus.textContent, /复制/);
        assert.strictEqual(f.editor.readOnly, false);
    }],
    ['history insertion and retry preserve edits made after a completed result', async () => {
        const f = fixture('');
        await f.c.startNativeGeneration();
        f.editor.value += '人工修改';
        const before = f.editor.value;
        f.c.insertNativeHistoryRecord({ resultText: '历史结果' });
        assert.strictEqual(f.editor.value, before);
        assert.strictEqual(f.generation.text, '生成结果');
        assert.strictEqual((await f.c.startNativeGeneration()).reason, 'editor-changed');
    }],
    ['closing a changed result preserves the manuscript and keeps the result in history', async () => {
        const f = fixture('');
        await f.c.startNativeGeneration();
        f.editor.value += '人工修改';
        f.c.discardNativeGeneration();
        assert.strictEqual(f.editor.value, '生成结果人工修改');
        assert.strictEqual(f.snapshot.promptHistory[0].resultText, '生成结果');
        assert.strictEqual(f.generation.text, '');
        assert.strictEqual((await f.c.startNativeGeneration()).ok, true, 'closing releases the pending result for future writing');
    }],
    ['snapshot changes from another entry point are not flushed over by stream completion', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('第一段', { type: 'content' });
            f.snapshot.sceneContents.s1 = '另一个入口修改的正文';
            receive('第二段', { type: 'content' });
        };
        assert.strictEqual((await f.c.startNativeGeneration()).reason, 'editor-changed');
        assert.strictEqual(f.snapshot.sceneContents.s1, '另一个入口修改的正文');
        assert.strictEqual(f.editor.value, '另一个入口修改的正文');
        assert.strictEqual(f.generation.text, '第一段第二段');
        f.c.flushNativeEditorFields();
        assert.strictEqual(f.snapshot.sceneContents.s1, '另一个入口修改的正文', 'a later autosave must not restore the older textarea');
    }],
    ['a failed stream also exposes external snapshot edits before future autosaves', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('部分结果', { type: 'content' });
            f.snapshot.sceneContents.s1 = '外部编辑';
            throw new Error('provider failed');
        };
        await f.c.startNativeGeneration();
        assert.strictEqual(f.editor.value, '外部编辑');
        assert.strictEqual(f.generation.text, '部分结果');
        assert.strictEqual(f.elements.generationResult.hidden, false);
    }],
    ['inline synchronization without a checkpoint validates its original manuscript', async () => {
        const f = fixture();
        Object.assign(f.generation, { task: 'fiction-prose', pendingSceneId: 's1', inlineBaseText: '原文',
            insertionStart: 2, insertionEnd: 2, text: '生成结果' });
        f.editor.value = '已经编辑过的正文';
        assert.strictEqual(f.c.syncInlineGenerationToEditor(), false);
        assert.strictEqual(f.editor.value, '已经编辑过的正文');
    }],
    ['edits after the final token are protected before a successful stream returns', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('生成结果', { type: 'content' });
            f.editor.value += '最后一刻编辑';
            f.snapshot.sceneContents.s1 = f.editor.value;
        };
        assert.strictEqual((await f.c.startNativeGeneration()).reason, 'editor-changed');
        assert.strictEqual(f.editor.value, '原文\n\n生成结果最后一刻编辑');
        assert.strictEqual(f.snapshot.sceneContents.s1, f.editor.value);
    }],
    ['history insertion and acceptance cannot interrupt an active stream', async () => {
        const f = fixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('第一段', { type: 'content' });
            f.c.insertNativeHistoryRecord({ resultText: '历史结果' });
            f.c.acceptNativeGeneration();
            assert.strictEqual(f.editor.value, '原文\n\n第一段');
            assert.strictEqual(f.generation.text, '第一段');
            receive('第二段', { type: 'content' });
        };
        await f.c.startNativeGeneration();
        assert.strictEqual(f.editor.value, '原文\n\n第一段第二段');
    }],
    ['abort and provider failure release the prose lock while retaining partial output', async () => {
        for (const name of ['AbortError', 'Error']) {
            const f = fixture();
            f.c.streamDesktopGeneration = async (_prompt, receive) => {
                assert.strictEqual(f.editor.readOnly, true);
                receive('部分结果', { type: 'content' });
                const error = new Error('failed');
                error.name = name;
                throw error;
            };
            await f.c.startNativeGeneration();
            assert.strictEqual(f.editor.readOnly, false);
            assert.strictEqual(f.generation.inProgress, false);
            assert.strictEqual(f.generation.text, '部分结果');
        }
    }],
    ['cancelled and failed partial prose is dirty and reaches the next autosave with its history', async () => {
        for (const errorName of ['AbortError', 'Error']) {
            const f = persistenceFixture();
            f.c.streamDesktopGeneration = async (_prompt, receive) => {
                receive('部分正文', { type: 'content' });
                throw Object.assign(new Error('stream interrupted'), { name: errorName });
            };
            await f.c.startNativeGeneration();
            assert.strictEqual(f.state.dirty, true);
            assert.strictEqual(f.snapshot.sceneContents.s1, '原文\n\n部分正文');
            assert.strictEqual(f.snapshot.promptHistory[0].resultText, '部分正文');
            f.editor.value = f.snapshot.sceneContents.s1;
            assert.strictEqual(f.editor.value, '原文\n\n部分正文', 'a later snapshot render must retain interrupted prose');
            await f.autosave();
            assert.strictEqual(f.saved[0].sceneContents.s1, '原文\n\n部分正文');
            assert.strictEqual(f.saved[0].promptHistory[0].resultText, '部分正文');
            assert.strictEqual(f.state.dirty, false);
        }
    }],
    ['failure history without prose also becomes dirty and is included in autosave', async () => {
        for (const errorName of ['AbortError', 'Error']) {
            const f = persistenceFixture();
            f.c.streamDesktopGeneration = async () => { throw Object.assign(new Error('no output'), { name: errorName }); };
            await f.c.startNativeGeneration();
            assert.strictEqual(f.snapshot.sceneContents.s1, '原文');
            assert.strictEqual(f.snapshot.promptHistory.length, 1);
            assert.strictEqual(f.state.dirty, true);
            await f.autosave();
            assert.strictEqual(f.saved[0].sceneContents.s1, '原文');
            assert.strictEqual(f.saved[0].promptHistory.length, 1);
            assert.ok(f.saved[0].promptHistory[0].error);
        }
    }],
    ...['success', 'Error', 'AbortError'].map(outcome => [`selection ${outcome} persists its history without changing the source prose`, async () => {
        const f = persistenceFixture();
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('选区生成结果', { type: 'content' });
            if (outcome !== 'success') throw Object.assign(new Error('selection interrupted'), { name: outcome });
        };
        await f.c.runNativeSelectionAITask({ action: 'regenerate-selection', scene: f.scene,
            prompt: { instruction: '重写', messages: [], selection: { start: 0, end: 2, selectedText: '原文' } } });
        assert.strictEqual(f.editor.value, '原文');
        assert.strictEqual(f.snapshot.promptHistory[0].resultText, '选区生成结果');
        assert.strictEqual(f.state.dirty, true);
        await f.autosave();
        assert.strictEqual(f.saved[0].sceneContents.s1, '原文');
        assert.strictEqual(f.saved[0].promptHistory[0].resultText, '选区生成结果');
    }]),
    ['a stale completed or failed request cannot dirty or autosave a newly opened project', async () => {
        for (const outcome of ['success', 'AbortError', 'Error']) {
            const f = persistenceFixture();
            const nextSnapshot = { project: { id: 'p2' }, scenes: [{ id: 's2' }], sceneContents: { s2: '新项目正文' } };
            f.c.streamDesktopGeneration = async (_prompt, receive) => {
                receive('旧项目部分正文', { type: 'content' });
                f.state.snapshot = nextSnapshot;
                f.state.activeSceneId = 's2';
                f.state.generation = { text: '', reasoning: '', beat: '', genTask: 'continue', inProgress: false };
                f.state.dirty = false;
                f.editor.value = '新项目正文';
                if (outcome !== 'success') throw Object.assign(new Error('old task stopped'), { name: outcome });
            };
            await f.c.startNativeGeneration();
            assert.strictEqual(f.state.dirty, false);
            assert.strictEqual(f.timers.size, 0);
            assert.strictEqual(f.saved.length, 0);
            assert.strictEqual(f.editor.value, '新项目正文');
            assert.strictEqual(nextSnapshot.sceneContents.s2, '新项目正文');
            assert.strictEqual(nextSnapshot.promptHistory, undefined);
        }
    }],
    ['configuration failures also release a lock acquired before provider setup', async () => {
        const f = fixture();
        f.c.nativeGenerationConfig = () => { throw new Error('bad config'); };
        const result = await f.c.startNativeGeneration();
        assert.strictEqual(result.ok, false);
        assert.strictEqual(f.generation.inProgress, false);
        assert.strictEqual(f.editor.readOnly, false);
    }],
    ['selection generation releases its lock after success, failure and cancellation', async () => {
        for (const action of ['rewrite', 'regenerate-selection']) {
            for (const errorName of ['', 'Error', 'AbortError']) {
                const f = fixture();
                f.c.streamDesktopGeneration = async (_prompt, receive) => {
                    assert.strictEqual(f.editor.readOnly, true);
                    receive('选区结果', { type: 'content' });
                    if (errorName) throw Object.assign(new Error('failed'), { name: errorName });
                };
                const result = await f.c.runNativeSelectionAITask({ action, scene: f.scene,
                    prompt: { instruction: '重写', messages: [], selection: { start: 0, end: 2, selectedText: '原文' } } });
                assert.strictEqual(result.ok, !errorName);
                assert.strictEqual(f.editor.value, '原文');
                assert.strictEqual(f.editor.readOnly, false);
                assert.strictEqual(f.generation.inProgress, false);
            }
        }
    }],
    ['selection setup failure releases the acquired lock', async () => {
        const f = fixture();
        f.c.writerEffectiveProfile = () => { throw new Error('bad profile'); };
        const result = await f.c.runNativeSelectionAITask({ action: 'rewrite', scene: f.scene,
            prompt: { instruction: '重写', messages: [], selection: { start: 0, end: 2, selectedText: '原文' } } });
        assert.strictEqual(result.ok, false);
        assert.strictEqual(f.editor.readOnly, false);
        assert.strictEqual(f.generation.inProgress, false);
    }],
    ['summary generation leaves the manuscript editable', async () => {
        const f = fixture();
        const chapter = { id: 'c1' };
        f.scene.chapterId = 'c1';
        f.snapshot.chapters = [chapter];
        f.c.currentNativeChapterByState = () => chapter;
        f.c.nativeSceneContent = () => f.snapshot.sceneContents.s1;
        f.c.nativeAvoidanceInstruction = () => '';
        f.c.markNativeChapterSummaryStale = () => {};
        f.c.openNativeSummaryDialog = () => {};
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            assert.strictEqual(f.editor.readOnly, false);
            receive('场景摘要', { type: 'content' });
        };
        await f.c.generateNativeSummary('scene');
        assert.strictEqual(f.scene.summary, '场景摘要');
        assert.strictEqual(f.editor.readOnly, false);
    }],
    ['switching the scene during a stream leaves the new manuscript untouched', async () => {
        const f = fixture();
        f.snapshot.scenes.push({ id: 's2' });
        f.snapshot.sceneContents.s2 = '另一个场景';
        f.c.streamDesktopGeneration = async (_prompt, receive) => {
            receive('第一段', { type: 'content' });
            f.state.activeSceneId = 's2';
            f.editor.value = '另一个场景';
            receive('第二段', { type: 'content' });
            f.c.renderNativeGeneration();
            assert.strictEqual(f.editor.readOnly, false);
        };
        await f.c.startNativeGeneration();
        assert.strictEqual(f.editor.value, '另一个场景');
        assert.strictEqual(f.snapshot.sceneContents.s2, '另一个场景');
        assert.strictEqual(f.snapshot.promptHistory[0].resultText, '第一段第二段');
    }],
    ['read only blocks local symbol and automatic replacement helpers', async () => {
        const f = fixture('原文--');
        f.editor.readOnly = true;
        f.c.insertNativeSpecialChar('！');
        f.c.applyNativeAutoReplace();
        assert.strictEqual(f.editor.value, '原文--');
    }]
];

(async () => {
    let failures = 0;
    for (const [name, run] of cases) {
        try { await run(); console.log(`PASS ${name}`); }
        catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.stack || error}`); }
    }
    assert.strictEqual(failures, 0, `${failures} generation protection regression(s) failed`);
    console.log(`Writer generation protection tests passed (${cases.length} cases, no API requests).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
