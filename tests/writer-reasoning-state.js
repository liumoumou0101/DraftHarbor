/* global bindNativeReasoningControls nativeEditorState renderNativeGeneration
          nativeReasoningPhase nativeReasoningDisplayText resetNativeGenerationStreamFlags
          generateNativeSummary currentNativeScene syncInlineGenerationToEditor */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

// Exercise the real renderer functions against native DOM/Range behavior. Only
// unrelated editor services and the provider boundary are replaced with fakes.
const fixture = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px sans-serif; }
  [data-native-writer] { display: flex; width: 900px; gap: 24px; }
  [data-native-generation-output], .desktop-native-assistant { width: 400px; }
  [data-native-reasoning-text] { box-sizing: border-box; margin: 0; width: 360px;
    height: 140px; overflow: auto; white-space: pre-wrap; font: 14px/20px monospace; }
  [hidden] { display: none !important; }
</style></head><body>
  <section data-native-writer class="is-assistant-open">
    <div data-native-generation-output>
      <span data-native-generation-output-status></span>
      <button type="button" data-native-reasoning-toggle aria-controls="native-reasoning-details" aria-expanded="false" hidden>查看思考</button>
      <button type="button" data-native-stop-generation hidden>停止生成</button>
      <div data-native-reasoning-inline-host>
        <details id="native-reasoning-details" data-native-reasoning hidden>
          <summary data-native-reasoning-summary></summary>
          <pre data-native-reasoning-text tabindex="0" aria-label="思考过程"></pre>
          <button type="button" data-native-reasoning-copy>复制</button>
          <button type="button" data-native-reasoning-latest>最新</button>
          <span data-native-reasoning-feedback role="status"></span>
        </details>
      </div>
      <div data-native-generation-confirm-actions></div>
    </div>
    <aside class="desktop-native-assistant"><div data-native-reasoning-dock hidden></div></aside>
  </section>
  <textarea data-test-summary></textarea>
</body></html>`;

async function prepare(page, sources) {
    await page.setContent(fixture);
    await page.evaluate(() => {
        const scene = { id: 'scene-1', chapterId: 'chapter-1', title: 'Scene', summary: '' };
        const chapter = { id: 'chapter-1', title: 'Chapter', summary: '' };
        window.nativeEditorState = {
            snapshot: { project: { id: 'project-1' }, scenes: [scene], chapters: [chapter] },
            activeSceneId: scene.id, activeChapterId: chapter.id, rewrite: {}, context: {},
            generation: {
                inProgress: false, text: '', reasoning: '', beat: '', genTask: 'continue', task: 'continue',
                interruptReason: '', finishReason: '', errorMessage: '', reasoningExpanded: false,
                reasoningUserCollapsed: true, reasoningFollowLatest: true, reasoningRenderVersion: 0
            }
        };
        window.nativeEditorElements = () => ({
            reasoning: document.querySelector('[data-native-reasoning]'),
            reasoningSummary: document.querySelector('[data-native-reasoning-summary]'),
            reasoningText: document.querySelector('[data-native-reasoning-text]'),
            generationOutput: document.querySelector('[data-native-generation-output]'),
            generationOutputStatus: document.querySelector('[data-native-generation-output-status]'),
            summary: document.querySelector('[data-test-summary]')
        });
        window.currentNativeScene = () => scene;
        window.currentNativeChapterByState = () => chapter;
        window.currentProjectId = () => 'project-1';
        window.nativeSceneContent = () => 'The captain returns to the harbor.';
        window.countNativeWords = text => String(text || '').length;
        window.formatNumber = value => String(value);
        window.flushNativeEditorFields = () => {};
        window.nativeAvoidanceInstruction = () => '';
        window.settingsState = { loading: false, runtimeProvider: { provider: 'test' } };
        window.loadSettings = async () => {};
        window.setNativeSaveStatus = (text, kind) => { window.lastStatus = { text, kind }; };
        window.markNativeDirty = () => {};
        window.markNativeChapterSummaryStale = () => {};
        window.renderNativeEditor = () => {};
        window.openNativeSummaryDialog = scope => { window.lastSummaryScope = scope; };
        window.queueNativeGenerationLayer = () => {};
        window.writerModelOverride = { model: 'test', thinking: true };
        window.streamDesktopGeneration = async () => { throw new Error('Set an explicit fake stream before generating.'); };
        window.fetch = async () => { throw new Error('Unexpected network request in reasoning regression test.'); };
    });
    for (const source of sources) await page.addScriptTag({ content: source });
    await page.evaluate(() => {
        // These services belong to other modules and do not participate in the
        // reasoning state transitions under test.
        window.nativeWriterThinkingActive = () => true;
        window.nativeGenerationConfig = () => ({ provider: 'test' });
        window.queueNativeGenerationOutputPosition = () => {};
        window.queueNativeGenerationLayer = () => {};
        bindNativeReasoningControls();
    });
}

async function renderState(page, changes) {
    await page.evaluate(patch => {
        Object.assign(nativeEditorState.generation, patch);
        renderNativeGeneration();
    }, changes);
}

async function openReasoning(page) {
    await page.locator('[data-native-reasoning-toggle]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-reasoning]').open);
}

const cases = [
    ['history reuse retains the selected result after stream state reset', async page => {
        await page.evaluate(() => {
            const history = document.createElement('div');
            history.dataset.testHistory = '';
            const result = document.createElement('div');
            result.dataset.testResult = '';
            document.body.append(history, result);
            const previousElements = window.nativeEditorElements;
            window.nativeEditorElements = () => ({ ...previousElements(), generationHistory: history, generationResult: result });
            nativeEditorState.snapshot.promptHistory = Array.from({ length: 6 }, (_value, index) => ({
                id: `history-${index}`, sceneId: 'scene-1', task: 'fiction-prose',
                beat: `Stored prompt ${index}`, resultText: `Stored result ${index}.`,
                reasoning: `Stored reasoning ${index}.`, promptText: `Full prompt ${index}.`,
                createdAt: '2026-09-13T00:00:00.000Z'
            }));
            window.nativeGenerationHistory = () => nativeEditorState.snapshot.promptHistory;
            Object.assign(nativeEditorState.generation, {
                text: 'Previous discarded answer.', reasoning: 'Previous discarded reasoning.',
                interruptReason: 'cancelled', finishReason: 'length', errorMessage: 'Previous failure.'
            });
            resetNativeGenerationStreamFlags(nativeEditorState.generation);
            renderNativeGeneration();
        });
        const history = page.locator('[data-test-history]');
        assert.strictEqual(await history.locator('.desktop-native-history-item').count(), 5);
        assert.strictEqual(await history.getByText('Stored prompt 0', { exact: true }).count(), 0,
            'history controls operate on the latest five records, independently of earlier audit cases');
        await history.locator('.desktop-native-history-item').filter({ hasText: 'Stored prompt 5' })
            .locator('[data-native-history-reuse]').click();
        const result = await page.evaluate(() => {
            renderNativeGeneration();
            const generation = nativeEditorState.generation;
            return {
                beat: generation.beat, text: generation.text, reasoning: generation.reasoning,
                prompt: generation.prompt.asString(), displayed: document.querySelector('[data-test-result]').textContent,
                interruptReason: generation.interruptReason,
                records: nativeEditorState.snapshot.promptHistory.length
            };
        });
        assert.deepStrictEqual(result, {
            beat: 'Stored prompt 5', text: 'Stored result 5.', reasoning: 'Stored reasoning 5.',
            prompt: 'Full prompt 5.', displayed: 'Stored result 5.', interruptReason: '', records: 6
        });
    }],
    ['answer-only streams never report waiting for reasoning', async page => {
        await renderState(page, { inProgress: true, text: 'Visible answer', reasoning: '' });
        const state = await page.evaluate(() => ({
            phase: nativeReasoningPhase(nativeEditorState.generation, true),
            displayed: nativeReasoningDisplayText(nativeEditorState.generation,
                nativeReasoningPhase(nativeEditorState.generation, true), true),
            text: document.querySelector('[data-native-reasoning-text]').textContent,
            label: document.querySelector('[data-native-reasoning-summary]').textContent
        }));
        assert.strictEqual(state.phase, 'answer');
        assert.ok(!/等待思考流/.test(state.displayed + state.text + state.label), JSON.stringify(state));
    }],
    ['unchanged reasoning retains its text node and selection through answer renders', async page => {
        await renderState(page, { inProgress: true, reasoning: 'A retained reasoning paragraph.' });
        await openReasoning(page);
        const result = await page.evaluate(() => {
            const pre = document.querySelector('[data-native-reasoning-text]');
            const node = pre.firstChild;
            const range = document.createRange();
            range.setStart(node, 2);
            range.setEnd(node, 10);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const before = selection.toString();
            const records = [];
            const observer = new MutationObserver(changes => records.push(...changes));
            observer.observe(pre, { childList: true, characterData: true, subtree: true });
            for (let index = 0; index < 4; index += 1) {
                nativeEditorState.generation.text += ' answer';
                renderNativeGeneration();
            }
            records.push(...observer.takeRecords());
            observer.disconnect();
            return { sameNode: pre.firstChild === node, before, after: selection.toString(), mutations: records.length };
        });
        assert.strictEqual(result.sameNode, true);
        assert.strictEqual(result.after, result.before);
        assert.strictEqual(result.mutations, 0, 'answer tokens should not mutate unchanged reasoning DOM');
    }],
    ['real inline answer synchronization preserves reasoning focus and range until explicit editing', async page => {
        await page.evaluate(() => {
            const editor = document.createElement('textarea');
            editor.dataset.testEditor = '';
            editor.value = 'Existing manuscript.';
            document.body.appendChild(editor);
            const previousElements = window.nativeEditorElements;
            window.nativeEditorElements = () => ({ ...previousElements(), editor });
            window.updateNativeStats = () => {};
            Object.assign(nativeEditorState.generation, {
                inProgress: true, task: 'fiction-prose', text: '', reasoning: 'A reasoning passage to inspect.',
                inlineBaseText: editor.value, pendingSceneId: nativeEditorState.activeSceneId,
                insertionStart: editor.value.length, insertionEnd: editor.value.length
            });
            renderNativeGeneration();
        });
        await openReasoning(page);
        const result = await page.evaluate(() => {
            const pre = document.querySelector('[data-native-reasoning-text]');
            const editor = document.querySelector('[data-test-editor]');
            pre.focus();
            const node = pre.firstChild;
            const range = document.createRange();
            range.setStart(node, 2);
            range.setEnd(node, 11);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const before = selection.toString();
            nativeEditorState.generation.text = 'A new paragraph.';
            syncInlineGenerationToEditor({ preserveFocus: true });
            renderNativeGeneration();
            const streamed = {
                editorValue: editor.value, sameNode: pre.firstChild === node,
                focusPreserved: document.activeElement === pre,
                selection: selection.toString()
            };
            // Explicit editing/acceptance calls retain the original focus behavior.
            syncInlineGenerationToEditor();
            return {
                before, streamed, explicitEditFocus: document.activeElement === editor,
                caret: editor.selectionStart, end: editor.selectionEnd, length: editor.value.length
            };
        });
        assert.strictEqual(result.streamed.editorValue, 'Existing manuscript.\n\nA new paragraph.');
        assert.strictEqual(result.streamed.sameNode, true);
        assert.strictEqual(result.streamed.focusPreserved, true);
        assert.strictEqual(result.streamed.selection, result.before);
        assert.strictEqual(result.explicitEditFocus, true);
        assert.strictEqual(result.caret, result.length);
        assert.strictEqual(result.end, result.length);
    }],
    ['reasoning append retains selection and a manually scrolled reading position', async page => {
        await renderState(page, { inProgress: true, reasoning: Array.from({ length: 90 }, (_, i) => `reasoning line ${i}`).join('\n') });
        await openReasoning(page);
        const result = await page.evaluate(() => {
            const pre = document.querySelector('[data-native-reasoning-text]');
            const node = pre.firstChild;
            pre.scrollTop = 80;
            pre.dispatchEvent(new Event('scroll'));
            const range = document.createRange();
            range.setStart(node, 2);
            range.setEnd(node, 10);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const before = { text: selection.toString(), top: pre.scrollTop };
            nativeEditorState.generation.reasoning += '\nNEW REASONING TAIL';
            renderNativeGeneration();
            return {
                sameNode: pre.firstChild === node, before, after: { text: selection.toString(), top: pre.scrollTop },
                text: pre.textContent, scrollable: pre.scrollHeight > pre.clientHeight
            };
        });
        assert.strictEqual(result.scrollable, true, 'fixture must represent long, scrollable reasoning');
        assert.strictEqual(result.sameNode, true);
        assert.deepStrictEqual(result.after, result.before);
        assert.ok(result.text.endsWith('NEW REASONING TAIL'));
    }],
    ['a user who scrolls up stays there even without a text selection', async page => {
        await renderState(page, { inProgress: true, reasoning: 'A long reasoning line.\n'.repeat(90) });
        await openReasoning(page);
        const position = await page.evaluate(() => {
            const pre = document.querySelector('[data-native-reasoning-text]');
            window.getSelection().removeAllRanges();
            pre.scrollTop = 60;
            pre.dispatchEvent(new Event('scroll'));
            nativeEditorState.generation.reasoning += '\nA new thought';
            renderNativeGeneration();
            return pre.scrollTop;
        });
        assert.strictEqual(position, 60);
        await page.locator('[data-native-reasoning-latest]').click();
        const latest = await page.evaluate(() => {
            const pre = document.querySelector('[data-native-reasoning-text]');
            nativeEditorState.generation.reasoning += '\nA thought after choosing latest';
            renderNativeGeneration();
            return pre.scrollHeight - pre.scrollTop - pre.clientHeight;
        });
        assert.ok(latest <= 1, 'choosing latest should resume following subsequent reasoning tokens');
    }],
    ['moving between the assistant dock and inline host preserves the reading range', async page => {
        await renderState(page, { inProgress: true, reasoning: 'A long reasoning line.\n'.repeat(90) });
        await openReasoning(page);
        const result = await page.evaluate(() => {
            const details = document.querySelector('[data-native-reasoning]');
            const pre = document.querySelector('[data-native-reasoning-text]');
            const node = pre.firstChild;
            const dock = document.querySelector('[data-native-reasoning-dock]');
            const inline = document.querySelector('[data-native-reasoning-inline-host]');
            const writer = document.querySelector('[data-native-writer]');
            const startedInDock = dock.contains(details);
            const range = document.createRange();
            range.setStart(node, 3);
            range.setEnd(node, 12);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            pre.scrollTop = 80;
            pre.dispatchEvent(new Event('scroll'));
            const before = { selection: selection.toString(), top: pre.scrollTop };
            writer.classList.add('is-assistant-collapsed');
            renderNativeGeneration();
            const fallback = { selection: selection.toString(), top: pre.scrollTop, inInline: inline.contains(details) };
            writer.classList.remove('is-assistant-collapsed');
            renderNativeGeneration();
            return {
                startedInDock, before, fallback,
                after: { selection: selection.toString(), top: pre.scrollTop, inDock: dock.contains(details) },
                sameNode: pre.firstChild === node, count: document.querySelectorAll('[data-native-reasoning]').length
            };
        });
        assert.strictEqual(result.startedInDock, true);
        assert.strictEqual(result.fallback.inInline, true);
        assert.strictEqual(result.after.inDock, true);
        assert.strictEqual(result.sameNode, true);
        assert.strictEqual(result.count, 1);
        assert.strictEqual(result.fallback.selection, result.before.selection);
        assert.strictEqual(result.after.selection, result.before.selection);
        assert.strictEqual(result.fallback.top, result.before.top);
        assert.strictEqual(result.after.top, result.before.top);
    }],
    ['manual collapse survives interruption and repeated renders', async page => {
        await renderState(page, { inProgress: true, reasoning: 'Existing reasoning.' });
        await openReasoning(page);
        await page.locator('[data-native-reasoning] > summary').click();
        await page.waitForFunction(() => !document.querySelector('[data-native-reasoning]').open);
        await renderState(page, { inProgress: false, interruptReason: 'cancelled', errorMessage: 'Cancelled by user.' });
        await page.evaluate(() => { for (let i = 0; i < 5; i += 1) renderNativeGeneration(); });
        const result = await page.evaluate(() => ({
            open: document.querySelector('[data-native-reasoning]').open,
            text: document.querySelector('[data-native-reasoning-text]').textContent,
            label: document.querySelector('[data-native-reasoning-summary]').textContent
        }));
        assert.strictEqual(result.open, false);
        assert.ok(result.text.includes('Existing reasoning.'));
        assert.ok(/中断|取消/.test(result.label + result.text));
    }],
    ['each new task starts folded and clears old stream/error state', async page => {
        await renderState(page, { inProgress: true, reasoning: 'OLD TASK REASONING' });
        await openReasoning(page);
        const result = await page.evaluate(() => {
            const generation = nativeEditorState.generation;
            Object.assign(generation, { text: 'OLD ANSWER', finishReason: 'length', interruptReason: 'failed', errorMessage: 'OLD ERROR', usage: { total_tokens: 99 } });
            resetNativeGenerationStreamFlags(generation);
            generation.inProgress = true;
            renderNativeGeneration();
            const cleared = {
                reasoning: generation.reasoning, answer: generation.text, finish: generation.finishReason,
                interrupt: generation.interruptReason, error: generation.errorMessage, usage: generation.usage,
                open: document.querySelector('[data-native-reasoning]').open,
                text: document.querySelector('[data-native-reasoning-text]').textContent
            };
            generation.reasoning = 'NEW TASK REASONING';
            renderNativeGeneration();
            return { cleared, after: {
                open: document.querySelector('[data-native-reasoning]').open,
                text: document.querySelector('[data-native-reasoning-text]').textContent
            } };
        });
        assert.strictEqual(result.cleared.reasoning, '');
        assert.strictEqual(result.cleared.answer, '');
        assert.strictEqual(result.cleared.finish, '');
        assert.strictEqual(result.cleared.interrupt, '');
        assert.strictEqual(result.cleared.error, '');
        assert.strictEqual(result.cleared.usage, null);
        assert.strictEqual(result.cleared.open, false);
        assert.ok(!/OLD TASK|OLD ERROR/.test(result.cleared.text));
        assert.strictEqual(result.after.open, false);
        assert.strictEqual(result.after.text, 'NEW TASK REASONING');
    }],
    ['summary resets the previous task and receives its own reasoning stream', async page => {
        // A previous reasoning-only failure has no manuscript result awaiting a
        // keep/discard decision, so a new summary may start immediately.
        await renderState(page, { inProgress: false, text: '', reasoning: 'OLD REASONING', errorMessage: 'OLD ERROR', interruptReason: 'failed', finishReason: 'length' });
        await page.evaluate(() => {
            window.streamDesktopGeneration = async (_prompt, onToken) => {
                window.summaryStateAtStart = {
                    ...nativeEditorState.generation,
                    rendered: document.querySelector('[data-native-reasoning-text]').textContent,
                    open: document.querySelector('[data-native-reasoning]').open
                };
                onToken('CURRENT SUMMARY REASONING', { type: 'reasoning' });
                window.reasoningDuringSummary = {
                    value: nativeEditorState.generation.reasoning,
                    rendered: document.querySelector('[data-native-reasoning-text]').textContent
                };
                onToken('Current scene summary.', { type: 'content' });
                onToken('', { type: 'usage', usage: { total_tokens: 12 } });
                onToken('', { type: 'finish', finishReason: 'stop' });
                return { text: 'Current scene summary.', reasoning: 'CURRENT SUMMARY REASONING', finishReason: 'stop' };
            };
            return generateNativeSummary('scene');
        });
        const result = await page.evaluate(() => ({
            before: window.summaryStateAtStart, during: window.reasoningDuringSummary,
            sceneSummary: currentNativeScene().summary, input: document.querySelector('[data-test-summary]').value,
            reasoning: nativeEditorState.generation.reasoning, error: nativeEditorState.generation.errorMessage,
            usage: nativeEditorState.generation.usage, finish: nativeEditorState.generation.finishReason,
            inProgress: nativeEditorState.generation.inProgress, dialog: window.lastSummaryScope,
            output: document.querySelector('[data-native-reasoning-text]').textContent
        }));
        assert.strictEqual(result.before.reasoning, '');
        assert.strictEqual(result.before.text, '');
        assert.strictEqual(result.before.errorMessage, '');
        assert.strictEqual(result.before.interruptReason, '');
        assert.strictEqual(result.before.finishReason, '');
        assert.strictEqual(result.before.open, false);
        assert.ok(!/OLD REASONING|OLD ERROR/.test(result.before.rendered));
        assert.strictEqual(result.during.value, 'CURRENT SUMMARY REASONING');
        assert.ok(result.during.rendered.includes('CURRENT SUMMARY REASONING'));
        assert.strictEqual(result.sceneSummary, 'Current scene summary.');
        assert.strictEqual(result.input, 'Current scene summary.');
        assert.strictEqual(result.reasoning, 'CURRENT SUMMARY REASONING');
        assert.strictEqual(result.error, '');
        assert.deepStrictEqual(result.usage, { total_tokens: 12 });
        assert.strictEqual(result.finish, 'stop');
        assert.strictEqual(result.inProgress, false);
        assert.strictEqual(result.dialog, 'scene');
        assert.ok(!/OLD REASONING|OLD ERROR/.test(result.output));
    }],
    ['summary does not implicitly accept or discard an unconfirmed writing result', async page => {
        await renderState(page, { inProgress: false, task: 'continue', text: 'UNCONFIRMED ANSWER', reasoning: 'Prior reasoning.' });
        const result = await page.evaluate(async () => {
            let requests = 0;
            window.streamDesktopGeneration = async () => { requests += 1; };
            await generateNativeSummary('scene');
            return {
                requests, answer: nativeEditorState.generation.text,
                reasoning: nativeEditorState.generation.reasoning, status: window.lastStatus.text
            };
        });
        assert.strictEqual(result.requests, 0);
        assert.strictEqual(result.answer, 'UNCONFIRMED ANSWER');
        assert.strictEqual(result.reasoning, 'Prior reasoning.');
        assert.ok(/保留|撤回/.test(result.status));
    }],
    ['a summary that finishes after switching scenes updates only its captured source', async page => {
        await page.evaluate(() => {
            const snapshot = nativeEditorState.snapshot;
            snapshot.scenes.push({ id: 'scene-2', chapterId: 'chapter-2', title: 'Scene B', summary: 'B summary stays.' });
            snapshot.chapters.push({ id: 'chapter-2', title: 'Chapter B', summary: 'B chapter summary stays.' });
            snapshot.sceneContents = {
                'scene-1': 'A manuscript stays.', 'scene-2': 'B manuscript stays.'
            };
            window.currentNativeScene = () => snapshot.scenes.find(scene => scene.id === nativeEditorState.activeSceneId);
            window.currentNativeChapterByState = () => snapshot.chapters.find(chapter => chapter.id === nativeEditorState.activeChapterId);
            window.nativeSceneContent = sceneId => snapshot.sceneContents[sceneId];
            const editor = document.createElement('textarea');
            editor.dataset.testEditor = '';
            editor.value = snapshot.sceneContents['scene-1'];
            document.body.appendChild(editor);
            const previousElements = window.nativeEditorElements;
            window.nativeEditorElements = () => ({ ...previousElements(), editor });
            window.streamDesktopGeneration = async (_prompt, onToken) => {
                window.pendingSummaryToken = onToken;
                await new Promise(resolve => { window.finishPendingSummary = resolve; });
            };
            window.pendingSummaryTask = generateNativeSummary('scene');
        });
        await page.waitForFunction(() => typeof window.finishPendingSummary === 'function');
        const result = await page.evaluate(async () => {
            const snapshot = nativeEditorState.snapshot;
            nativeEditorState.activeSceneId = 'scene-2';
            nativeEditorState.activeChapterId = 'chapter-2';
            document.querySelector('[data-test-editor]').value = snapshot.sceneContents['scene-2'];
            document.querySelector('[data-test-summary]').value = snapshot.scenes[1].summary;
            window.pendingSummaryToken('A summary reasoning.', { type: 'reasoning' });
            window.pendingSummaryToken('New summary for A.', { type: 'content' });
            window.pendingSummaryToken('', { type: 'finish', finishReason: 'stop' });
            window.finishPendingSummary();
            await window.pendingSummaryTask;
            return {
                activeScene: nativeEditorState.activeSceneId, activeChapter: nativeEditorState.activeChapterId,
                summaryA: snapshot.scenes[0].summary, summaryB: snapshot.scenes[1].summary,
                chapterB: snapshot.chapters[1].summary, contents: snapshot.sceneContents,
                editor: document.querySelector('[data-test-editor]').value,
                summaryInput: document.querySelector('[data-test-summary]').value,
                openedDialog: window.lastSummaryScope || '', inProgress: nativeEditorState.generation.inProgress
            };
        });
        assert.strictEqual(result.activeScene, 'scene-2');
        assert.strictEqual(result.activeChapter, 'chapter-2');
        assert.strictEqual(result.summaryA, 'New summary for A.');
        assert.strictEqual(result.summaryB, 'B summary stays.');
        assert.strictEqual(result.chapterB, 'B chapter summary stays.');
        assert.deepStrictEqual(result.contents, { 'scene-1': 'A manuscript stays.', 'scene-2': 'B manuscript stays.' });
        assert.strictEqual(result.editor, 'B manuscript stays.');
        assert.strictEqual(result.summaryInput, 'B summary stays.');
        assert.strictEqual(result.openedDialog, '');
        assert.strictEqual(result.inProgress, false);
    }]
];

(async () => {
    const root = path.resolve(__dirname, '..');
    const files = ['writer-generation-position.js', 'writer-generation-view.js', 'writer-generation.js'];
    const sources = await Promise.all(files.map(file => fs.readFile(path.join(root, 'src/desktop/shell', file), 'utf8')));
    const browser = await chromium.launch({ headless: true });
    let failures = 0;
    try {
        for (const [name, run] of cases) {
            const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
            await context.route('**/*', route => route.abort());
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            page.setDefaultTimeout(5000);
            try {
                await prepare(page, sources);
                await run(page);
                assert.deepStrictEqual(pageErrors, [], 'renderer should not emit unexpected script errors');
                console.log(`PASS ${name}`);
            } catch (error) {
                failures += 1;
                console.error(`FAIL ${name}: ${error.stack || error}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    assert.strictEqual(failures, 0, `${failures} writer reasoning regression case(s) failed`);
    console.log(`Writer reasoning state regression tests passed (${cases.length} cases, no API requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
