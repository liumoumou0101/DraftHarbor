const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function projectSnapshot(id, text) {
    return { project: { id }, chapters: [], scenes: [{ id: `${id}-scene` }], sceneContents: { [`${id}-scene`]: text } };
}

function fixture() {
    const snapshot = projectSnapshot('a', '已保存正文');
    const editor = { value: '已保存正文' };
    const state = { snapshot, activeSceneId: 'a-scene', dirty: false, isSaving: false, generation: { inProgress: false }, editorPrefs: {} };
    const saves = [], fetches = [], loaded = [], statuses = [], views = [], timers = new Map();
    let timerId = 0;
    const c = vm.createContext({
        console: { error() {} }, nativeEditorState: state, nativeEditorElements: () => ({ editor }),
        window: { setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } },
        setView: view => views.push(view), setProjectLibraryStatus: text => statuses.push(text),
        fetchProjectSnapshot: project => new Promise(resolve => fetches.push({ id: project.id, finish: () => resolve(projectSnapshot(project.id, `${project.id}正文`)) })),
        fetch: async (_url, options) => new Promise(resolve => saves.push({
            payload: JSON.parse(options.body),
            finish(ok = true) { resolve({ ok, status: ok ? 200 : 500, json: async () => ({ ok, writerRevision: 'saved-revision' }) }); }
        })),
        loadReaderFromProjectSnapshot: async () => {}, loadProjectLibrary: async () => {},
        loadCompendium: async () => {}, loadPrompts: async () => {}, loadRewritePrompts: async () => {},
        loadSummaryPrompts: async () => {}, loadWorkshopSessions: async () => {}, loadWorkflowRuns: async () => {}
    });
    for (const name of ['writer-core.js', 'writer-generation.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell', name), 'utf8'), c);
    }
    c.setNativeSaveStatus = text => statuses.push(text);
    // The project-load boundary is observed without constructing unrelated UI.
    // All queue draining, dirty detection, flushes and save requests remain real.
    c.loadNativeProjectEditor = next => {
        loaded.push(next.project.id);
        state.snapshot = next;
        state.activeSceneId = next.scenes[0].id;
        editor.value = next.sceneContents[state.activeSceneId];
        state.dirty = false;
    };
    return { c, state, snapshot, editor, saves, fetches, loaded, statuses, views };
}

async function settle() {
    await new Promise(resolve => setImmediate(resolve));
}

const cases = [
    ['reopening the active project drains later input and preserves its fresh snapshot without refetching', async () => {
        const f = fixture();
        f.editor.value = '第一次提交';
        const saving = f.c.saveNativeScene();
        f.editor.value = '同项目重开前新增输入';
        f.c.markNativeDirty();
        const opening = f.c.openDesktopProject({ id: 'a', name: 'A' }, { view: 'reader' });
        f.saves[0].finish();
        await saving;
        await settle();
        assert.strictEqual(f.saves.length, 2);
        assert.strictEqual(f.saves[1].payload.sceneContents['a-scene'], '同项目重开前新增输入');
        f.saves[1].finish();
        await settle();
        assert.strictEqual(f.fetches.length, 0, 'the disk copy obtained before a later edit can become stale');
        await opening;
        assert.strictEqual(f.state.snapshot, f.snapshot);
        assert.strictEqual(f.editor.value, '同项目重开前新增输入');
        assert.deepStrictEqual(f.loaded, []);
        assert.deepStrictEqual(f.views, ['reader']);
        assert.strictEqual(f.state.dirty, false);
    }],
    ['opening another project drains input made during an existing save before fetching or loading', async () => {
        const f = fixture();
        f.editor.value = '第一次提交';
        const saving = f.c.saveNativeScene();
        f.editor.value = '保存期间新增输入';
        f.c.markNativeDirty();
        const opening = f.c.openDesktopProject({ id: 'b', name: 'B' });
        await settle();
        assert.strictEqual(f.fetches.length, 0);
        assert.deepStrictEqual(f.loaded, []);
        f.saves[0].finish();
        await saving;
        await settle();
        assert.strictEqual(f.saves.length, 2);
        assert.strictEqual(f.saves[1].payload.sceneContents['a-scene'], '保存期间新增输入');
        assert.strictEqual(f.fetches.length, 0);
        f.saves[1].finish();
        await settle();
        assert.strictEqual(f.fetches.length, 1);
        f.fetches[0].finish();
        await opening;
        assert.deepStrictEqual(f.loaded, ['b']);
        assert.strictEqual(f.snapshot.sceneContents['a-scene'], '保存期间新增输入');
    }],
    ['a failed save leaves the current manuscript open and prevents the project fetch', async () => {
        const f = fixture();
        f.editor.value = '尚未保存输入';
        f.c.markNativeDirty();
        const opening = f.c.openDesktopProject({ id: 'b' });
        await settle();
        assert.strictEqual(f.saves.length, 1);
        f.saves[0].finish(false);
        await opening;
        assert.strictEqual(f.state.snapshot, f.snapshot);
        assert.strictEqual(f.editor.value, '尚未保存输入');
        assert.strictEqual(f.state.dirty, true);
        assert.strictEqual(f.fetches.length, 0);
        assert.deepStrictEqual(f.loaded, []);
    }],
    ['input made while fetching the next project is saved before that project loads', async () => {
        const f = fixture();
        const opening = f.c.openDesktopProject({ id: 'b' });
        await settle();
        assert.strictEqual(f.fetches.length, 1);
        f.editor.value = '获取项目期间新增输入';
        f.c.markNativeDirty();
        f.fetches[0].finish();
        await settle();
        assert.deepStrictEqual(f.loaded, []);
        assert.strictEqual(f.saves.length, 1);
        assert.strictEqual(f.saves[0].payload.sceneContents['a-scene'], '获取项目期间新增输入');
        f.saves[0].finish();
        await opening;
        assert.deepStrictEqual(f.loaded, ['b']);
    }],
    ['a failed second save preserves input made during project fetching', async () => {
        const f = fixture();
        const opening = f.c.openDesktopProject({ id: 'b' });
        await settle();
        f.editor.value = '获取期间未保存输入';
        f.c.markNativeDirty();
        f.fetches[0].finish();
        await settle();
        assert.strictEqual(f.saves.length, 1);
        f.saves[0].finish(false);
        await opening;
        assert.strictEqual(f.state.snapshot, f.snapshot);
        assert.strictEqual(f.editor.value, '获取期间未保存输入');
        assert.deepStrictEqual(f.loaded, []);
    }],
    ['active generation blocks switching before the fetch and again before loading', async () => {
        const first = fixture();
        first.state.generation.inProgress = true;
        const blocked = first.c.openDesktopProject({ id: 'b' });
        await settle();
        assert.strictEqual(first.fetches.length, 0);
        await blocked;
        const later = fixture();
        const opening = later.c.openDesktopProject({ id: 'b' });
        await settle();
        later.state.generation.inProgress = true;
        later.fetches[0].finish();
        await opening;
        assert.deepStrictEqual(later.loaded, []);
        assert.strictEqual(later.state.snapshot, later.snapshot);
    }],
    ['a slower older open request cannot replace the latest requested project', async () => {
        const f = fixture();
        const oldOpening = f.c.openDesktopProject({ id: 'b' });
        await settle();
        const latestOpening = f.c.openDesktopProject({ id: 'c' });
        await settle();
        f.fetches.find(request => request.id === 'c').finish();
        await latestOpening;
        f.fetches.find(request => request.id === 'b').finish();
        await oldOpening;
        assert.deepStrictEqual(f.loaded, ['c']);
        assert.strictEqual(f.state.snapshot.project.id, 'c');
    }]
];

(async () => {
    let failures = 0;
    for (const [name, run] of cases) {
        try { await run(); console.log(`PASS ${name}`); }
        catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.stack || error}`); }
    }
    assert.strictEqual(failures, 0, `${failures} project switch regression(s) failed`);
    console.log(`Writer project switch protection tests passed (${cases.length} cases, no API requests).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
