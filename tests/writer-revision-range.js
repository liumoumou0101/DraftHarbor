const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const shell = path.join(__dirname, '../src/desktop/shell');
const revisionSource = path.join(shell, 'writer-revision-range.js');
assert.ok(fs.existsSync(revisionSource), 'persistent revision feedback must be implemented');

function node(tag = 'div') {
    const listeners = new Map();
    const attributes = new Map();
    return {
        tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], hidden: false, textContent: '',
        append(...children) { children.forEach(child => { child.parentNode = this; this.children.push(child); }); },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name); },
        addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); },
        fire(name, event = {}) { (listeners.get(name) || []).forEach(fn => fn({ type: name, target: this, ...event })); },
        getBoundingClientRect() { return { left: 40, top: 60, width: 700, height: 320 }; },
        querySelector(selector) { return this.children.find(child => child.getAttribute(selector.slice(1, -1)) !== undefined) || this.children.map(child => child.querySelector(selector)).find(Boolean) || null; },
        classList: { toggle() {} },
        focus() { this.focused = true; }
    };
}

function fixture(base = '甲段。乙段。丙段。', start = 3, end = 6) {
    const editor = Object.assign(node('textarea'), { value: base, selectionStart: start, selectionEnd: end, scrollTop: 0, scrollLeft: 0,
        clientWidth: 680, clientHeight: 300, scrollHeight: 900, clientTop: 1, clientLeft: 1,
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    });
    const body = Object.assign(node(), { scrollTop: 0, scrollLeft: 0, clientLeft: 0, clientTop: 0 });
    const host = node();
    body.append(editor);
    const scene = { id: 's1' };
    const state = { snapshot: { project: { id: 'p1' }, sceneContents: { s1: base } }, activeSceneId: scene.id,
        rewrite: { instruction: '', regenerateInstruction: '', regenerateUseContext: true }, generation: { text: '', task: 'fiction-prose' } };
    const elements = { editor, editorBody: body, rewriteInstruction: { value: '' }, regenerateInstruction: { value: '' }, regenerateUseContext: { checked: true } };
    const computed = { font: '24px serif', fontFamily: 'serif', fontSize: '24px', fontWeight: '400', fontStyle: 'normal',
        lineHeight: '48px', letterSpacing: '0.5px', wordSpacing: '0px', padding: '30px 60px', paddingTop: '30px', paddingRight: '60px', paddingBottom: '30px', paddingLeft: '60px',
        boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', textAlign: 'start', textIndent: '0px', tabSize: '8', direction: 'ltr' };
    const frames = [], observers = [], statuses = [], errors = [];
    const win = Object.assign(node(), { getComputedStyle: () => computed, requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
        ResizeObserver: class { constructor(cb) { this.callback = cb; observers.push(this); } observe() {} },
        DraftHarborAITaskContract: { taskTargetKey: () => 'selection' }, DraftHarborAITaskHistory: { toLegacyGenerationRecord: (record, extra) => ({ ...record, ...extra }) }
    });
    const document = { activeElement: editor, createElement: node, querySelector: selector => selector === '[data-native-desk-range-host]' ? host : null };
    const c = vm.createContext({ console: { error: (...args) => errors.push(args) }, AbortController, structuredClone, window: win, document, nativeEditorState: state,
        nativeEditorElements: () => elements, currentNativeScene: () => scene, currentProjectId: () => state.snapshot.project.id,
        settingsState: { runtimeProvider: {} }, writerModelOverride: { profileId: 'inherit' }, nativeAvoidanceInstruction: () => '',
        setNativeSaveStatus: text => statuses.push(text), flushNativeEditorFields: () => { state.snapshot.sceneContents[scene.id] = editor.value; }, markNativeDirty() {},
        resetNativeGenerationStreamFlags(g) { g.reasoning = ''; g.errorMessage = ''; g.interruptReason = ''; g.finishReason = ''; },
        renderNativeGeneration() {}, renderNativeEditor() {}
    });
    for (const file of ['writer-prompts.js', 'writer-generation.js']) vm.runInContext(fs.readFileSync(path.join(shell, file), 'utf8'), c);
    // Keep the real selection/generation operations; unrelated panel renders are outside this fixture.
    c.renderNativeRewrite = () => c.rememberNativeRewriteSelection();
    c.renderNativeEditor = () => { c.renderNativeRewrite(); c.renderNativeGeneration(); };
    c.nativeGenerationConfig = () => ({});
    c.writerEffectiveProfile = () => ({});
    c.writerSelectedModelId = () => 'test';
    const f = { c, state, scene, editor, body, host, computed, observers, statuses, errors, window: win, fail: false };
    c.getNativeAITaskRunner = () => ({ run: async (_task, options) => {
        options.onToken({ text: f.fail ? '' : '新乙段', reasoning: '', finishReason: f.fail ? 'length' : 'stop' });
        return f.fail ? { ok: false, status: 'failed', error: { message: 'truncated' }, record: { id: 'failed' } }
            : { ok: true, text: '新乙段', record: { id: 'completed' } };
    } });
    vm.runInContext(fs.readFileSync(revisionSource, 'utf8'), c);
    win.bindNativeWriterRevisionRange();
    f.sync = () => win.syncNativeWriterRevisionRange();
    f.flush = () => { while (frames.length) frames.shift()(); };
    f.part = name => body.querySelector(`[data-native-revision-${name}]`) || host.querySelector(`[data-native-revision-${name}]`);
    c.rememberNativeRewriteSelection();
    f.sync();
    return f;
}

(async () => {
    const f = fixture();
    assert.strictEqual(f.state.rewrite.selectionBaseText, '甲段。乙段。丙段。', 'selection must capture the entire original manuscript');
    assert.strictEqual(f.part('mark').textContent, '乙段。');
    assert.strictEqual(f.part('layer').hidden, false);
    assert.strictEqual(f.part('layer').getAttribute('aria-hidden'), 'true');
    f.editor.setSelectionRange(0, 0);
    f.sync();
    assert.strictEqual(f.part('mark').textContent, '乙段。', 'moving focus to the composer must preserve the exact original selection');
    const mark = f.part('mark');
    f.sync();
    assert.strictEqual(f.part('mark'), mark, 'rendering must reuse mirror nodes');
    f.editor.scrollTop = 150;
    f.editor.scrollLeft = 12;
    f.editor.fire('scroll');
    assert.strictEqual(f.part('content').style.transform, 'translate(-12px, -150px)');
    assert.strictEqual(f.part('content').style.width, '680px');
    assert.strictEqual(f.part('content').style.padding, '30px 60px');
    assert.strictEqual(f.part('content').style.lineHeight, '48px');
    f.computed.fontSize = '32px';
    f.computed.lineHeight = '64px';
    f.observers[0].callback(); f.flush();
    assert.strictEqual(f.part('content').style.fontSize, '32px');
    assert.strictEqual(f.part('content').style.lineHeight, '64px');
    f.editor.value += '末尾编辑';
    f.editor.fire('input');
    assert.strictEqual(f.part('layer').hidden, true, 'edits outside the selected excerpt invalidate the full snapshot');
    assert.strictEqual(f.part('locate').disabled, true);
    assert.match(f.part('status').textContent, /变化|修改|失效/);
    assert.strictEqual(f.c.restoreNativeRewriteSelection(), false, 'stale remembered offsets cannot be used to start a new rewrite');

    const editedSelection = fixture();
    editedSelection.editor.value += '末尾编辑';
    editedSelection.editor.fire('input');
    editedSelection.editor.fire('keyup', { key: 'a' });
    assert.strictEqual(editedSelection.part('layer').hidden, true, 'an unchanged DOM selection after typing is not a fresh user-selected range');
    assert.strictEqual(editedSelection.state.rewrite.selectionInvalidated, true);
    editedSelection.editor.fire('mouseup');
    assert.strictEqual(editedSelection.part('layer').hidden, false, 'an explicit re-selection can capture the updated manuscript');

    const ime = fixture();
    ime.editor.fire('compositionstart');
    assert.strictEqual(ime.part('layer').hidden, true);
    assert.strictEqual(ime.part('reselect').disabled, true);
    const imeBefore = [ime.editor.value, ime.editor.selectionStart, ime.editor.selectionEnd];
    ime.part('reselect').fire('click');
    assert.deepStrictEqual([ime.editor.value, ime.editor.selectionStart, ime.editor.selectionEnd], imeBefore, 'range controls cannot move the IME selection');
    ime.editor.value += '输入'; ime.editor.fire('input'); ime.editor.fire('compositionend');
    assert.strictEqual(ime.part('layer').hidden, true);

    for (const mutate of [
        x => { x.scene.id = 's2'; },
        x => { x.state.snapshot.project.id = 'p2'; },
        x => { x.state.rewrite.selectionStart = -1; },
        x => { x.state.rewrite.selectionEnd = 99; },
        x => { x.state.rewrite.originalText = '别的文本'; }
    ]) {
        const x = fixture(); mutate(x); x.sync();
        assert.strictEqual(x.part('layer').hidden, true, 'foreign targets and invalid ranges must not highlight any prose');
    }

    for (const action of ['rewrite', 'regenerate-selection']) {
        const x = fixture();
        await x.c.runNativeSelectionAITask({ action, scene: x.scene, prompt: { instruction: '重写', messages: [], selection: { start: 3, end: 6, selectedText: '乙段。' } } });
        Object.assign(x.state.rewrite, { selectionStart: 0, selectionEnd: 3, originalText: '甲段。' });
        x.editor.setSelectionRange(0, 3); x.sync();
        assert.strictEqual(x.part('mark').textContent, '乙段。', 'the real captured candidate must outrank any later mutable selection');
        assert.strictEqual(x.part('excerpt').textContent, '乙段。');
        x.part('locate').fire('click');
        assert.strictEqual(x.editor.selectionStart, 3);
        assert.strictEqual(x.editor.selectionEnd, 6);
        assert.strictEqual(x.part('reselect').disabled, true, 'reselect cannot redirect an unconfirmed candidate');
        x.editor.value += '外部编辑'; x.sync();
        assert.strictEqual(x.part('layer').hidden, true, 'an invalid candidate must never fall back to a fresh live selection');
        const before = x.editor.value;
        x.c.acceptNativeRewrite();
        assert.strictEqual(x.editor.value, before);
    }

    const accepted = fixture();
    await accepted.c.startNativeRegenerateSelection();
    accepted.c.acceptNativeRewrite();
    accepted.sync();
    assert.strictEqual(accepted.editor.value, '甲段。新乙段丙段。');
    assert.strictEqual(accepted.part('layer').hidden, true, 'accepted replacement text is not a pending original range');

    const switched = fixture();
    await switched.c.startNativeRegenerateSelection();
    switched.scene.id = 's2';
    Object.assign(switched.state.rewrite, { selectionSceneId: 's2', selectionStart: 0, selectionEnd: 3, originalText: '甲段。' });
    switched.sync();
    assert.strictEqual(switched.part('layer').hidden, true, 'switching scenes cannot display a candidate against another scene with identical text');
    switched.scene.id = 's1'; switched.sync();
    assert.strictEqual(switched.part('mark').textContent, '乙段。');
    assert.strictEqual(switched.part('layer').hidden, false, 'returning to the original unchanged scene restores the real candidate range');

    const discarded = fixture();
    await discarded.c.startNativeRegenerateSelection();
    discarded.c.discardNativeGeneration(); discarded.sync();
    assert.strictEqual(discarded.part('layer').hidden, true);
    assert.strictEqual(discarded.editor.value, '甲段。乙段。丙段。');

    const appended = fixture();
    Object.assign(appended.state.generation, { task: 'fiction-prose', text: '续写', pendingSceneId: 's1', selectionTarget: { start: 3, end: 6, baseText: appended.editor.value, projectId: 'p1', sceneId: 's1', selectedText: '乙段。' } });
    appended.sync();
    assert.strictEqual(appended.part('layer').hidden, true, 'append previews never show a replacement range');

    const failed = fixture(); failed.fail = true;
    await failed.c.startNativeRegenerateSelection(); failed.sync();
    assert.strictEqual(failed.part('mark').textContent, '乙段。', 'a failed selection request retains its original target for retry');
    assert.strictEqual(failed.editor.value, '甲段。乙段。丙段。');
    failed.editor.setSelectionRange(6, 9);
    failed.editor.fire('mouseup');
    assert.strictEqual(failed.part('mark').textContent, '丙段。', 'a new explicit selection releases an empty failed target so feedback matches the next request');
    assert.strictEqual(failed.part('excerpt').textContent, '丙段。');
    assert.strictEqual(failed.state.generation.selectionTarget, null);
    assert.strictEqual(failed.c.buildNativeRegenerateSelectionPrompt().selection.selectedText, '丙段。');
    assert.strictEqual(failed.state.snapshot.promptHistory.length, 1, 'releasing an empty failed target retains its failure history');

    const large = fixture('前言\n' + '选中段落😀\n'.repeat(2400) + '结尾', 3, 16803);
    assert.strictEqual(large.part('mark').textContent, '选中段落😀\n'.repeat(2400), 'large multiline selections use exact UTF-16 offsets without truncation');
    assert.strictEqual(large.part('excerpt').textContent, '选中段落😀\n'.repeat(2400));

    const reselect = fixture();
    reselect.part('reselect').fire('click');
    assert.strictEqual(reselect.part('layer').hidden, true);
    assert.strictEqual(reselect.editor.focused, true);
    reselect.editor.setSelectionRange(6, 9); reselect.editor.fire('mouseup');
    assert.strictEqual(reselect.part('mark').textContent, '丙段。');
    assert.strictEqual(reselect.part('layer').hidden, false);
    console.log('Writer revision range tests passed (snapshots, captured targets, stale guards, mirror lifecycle, no API requests).');
})().catch(error => { console.error(error); process.exitCode = 1; });
