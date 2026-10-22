/* global nativeEditorState */
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const settingsService = require('../desktop/services/settings-service');

// Real renderer -> local generation bridge -> loopback SSE provider. Only the
// model response is replaced; prompts, stream state, history and saves are real.
async function fakeProvider() {
    const plans = [], requests = [];
    const server = http.createServer(async (request, response) => {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404); response.end(); return;
        }
        const plan = plans.shift();
        if (!plan) { response.writeHead(500); response.end('Unexpected generation request'); return; }
        const body = JSON.parse(raw);
        requests.push(body);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        response.flushHeaders();
        const send = (content, finishReason = null) => response.write(`data: ${JSON.stringify({
            id: `desk-test-${requests.length}`, object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }]
        })}\n\n`);
        const split = Math.max(1, Math.floor(plan.text.length / 2));
        send(plan.text.slice(0, split));
        plan.finish = () => {
            if (response.writableEnded) return;
            send(plan.text.slice(split));
            send('', 'stop');
            response.end('data: [DONE]\n\n');
        };
        plan.begin(body);
        if (!plan.hold) plan.finish();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, requests,
        enqueue(text, hold = false) {
            const plan = { text, hold, finish: () => {} };
            plan.started = new Promise(resolve => { plan.begin = resolve; });
            plans.push(plan);
            return plan;
        },
        async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    };
}

async function selectRange(page, start, end) {
    await page.locator('[data-native-scene-editor]').evaluate((editor, range) => {
        editor.focus();
        editor.setSelectionRange(range.start, range.end);
        editor.dispatchEvent(new Event('select', { bubbles: true }));
        editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, { start, end });
}

async function waitProviderRequest(plan) {
    let timer;
    try {
        return await Promise.race([plan.started, new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('The writer did not reach the loopback provider within 10 seconds')), 10000);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitCandidate(page, text) {
    await page.waitForFunction(expected => nativeEditorState.generation.text === expected
        && !nativeEditorState.generation.inProgress, text);
    assert.strictEqual(await page.locator('[data-native-generation-output]').isVisible(), true);
}

async function assertCandidateActions(page) {
    for (const selector of ['[data-native-accept-generation]', '[data-native-retry-generation]', '[data-native-discard-generation]']) {
        const action = page.locator(selector);
        await action.scrollIntoViewIfNeeded();
        assert.strictEqual(await action.isEnabled(), true, `${selector} is enabled after a complete candidate`);
        const rect = await action.boundingBox();
        assert.ok(rect && rect.width >= 44 && rect.height >= 44, `${selector} has a minimum 44px target; got ${JSON.stringify(rect)}`);
        await action.click({ trial: true });
    }
}

async function assertManuscriptViewport(page) {
    const geometry = await page.evaluate(() => {
        const editor = document.querySelector('[data-native-scene-editor]');
        const rectOf = element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const viewport = rectOf(editor);
        const contentTop = viewport.top + editor.clientTop;
        viewport.top = Math.max(contentTop, 0);
        viewport.bottom = Math.min(contentTop + editor.clientHeight, innerHeight);
        for (let ancestor = editor.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (!['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(ancestor).overflowY)) continue;
            const rect = ancestor.getBoundingClientRect();
            viewport.top = Math.max(viewport.top, rect.top + ancestor.clientTop);
            viewport.bottom = Math.min(viewport.bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
        }
        viewport.height = Math.max(0, viewport.bottom - viewport.top);
        return { viewport, editor: rectOf(editor), candidate: rectOf(document.querySelector('[data-native-generation-output]')),
            dock: rectOf(document.querySelector('[data-native-desk-dock]')),
            footer: rectOf(document.querySelector('[data-native-paper-footer]')), window: [innerWidth, innerHeight] };
    });
    assert.ok(geometry.viewport.height >= 120, `candidate must leave at least 120px of visible manuscript: ${JSON.stringify(geometry)}`);
    const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
        && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
    assert.strictEqual(overlaps(geometry.viewport, geometry.candidate), false, `candidate cannot cover the manuscript: ${JSON.stringify(geometry)}`);
    assert.strictEqual(overlaps(geometry.viewport, geometry.footer), false, `footer cannot cover the manuscript: ${JSON.stringify(geometry)}`);
}

async function assertCandidateLayout(page, inputSelector, expandDetails = false) {
    const toggle = page.locator('[data-native-desk-composer-toggle]');
    assert.strictEqual(await toggle.isVisible(), true, 'a pending result exposes the composer adjustment control');
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'false', 'candidate results initially collapse the composer');
    assert.strictEqual(await page.locator(inputSelector).isVisible(), false, 'collapsed composer reserves space for manuscript and candidate');
    await assertManuscriptViewport(page);
    await toggle.click();
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'true');
    const input = page.locator(inputSelector);
    assert.strictEqual(await input.isVisible(), true, 'adjustment restores the actual composer input');
    assert.strictEqual(await input.isEditable(), true);
    const edited = `${await input.inputValue()} 下次生成保留这个要求。`;
    await input.fill(edited);
    assert.strictEqual(await input.inputValue(), edited);
    if (expandDetails) {
        const regenerate = page.locator('[data-native-rewrite-regenerate]');
        const presets = page.locator('.writer-desk-rewrite-details');
        await regenerate.locator(':scope > summary').click();
        await presets.locator(':scope > summary').click();
        assert.strictEqual(await regenerate.evaluate(el => el.open), true);
        assert.strictEqual(await presets.evaluate(el => el.open), true);
        await assertManuscriptViewport(page);
        await assertCandidateActions(page);
        assert.strictEqual(await input.isEditable(), true);
        await input.fill(`${edited} 展开高级设置后仍可编辑。`);
        assert.strictEqual(await input.inputValue(), `${edited} 展开高级设置后仍可编辑。`);
        const resultScrolls = await page.locator('[data-native-generation-result]').evaluate(el => el.scrollHeight > el.clientHeight);
        assert.strictEqual(resultScrolls, true, 'the long candidate scrolls within its bounded preview');
        await regenerate.locator(':scope > summary').click();
        await presets.locator(':scope > summary').click();
    }
    await toggle.click();
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await input.isVisible(), false);
}

async function assertComposerRestored(page, inputSelector) {
    assert.strictEqual(await page.locator('[data-native-desk-composer-toggle]').isVisible(), false, 'resolving a candidate removes its adjustment toggle');
    assert.strictEqual(await page.locator(inputSelector).isVisible(), true, 'resolving a candidate restores the composer');
    assert.strictEqual(await page.locator(inputSelector).isEditable(), true);
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-desk-generation-'));
    let servers, browser, provider, page;
    const errors = [], unexpectedHosts = [];
    const original = '门外的脚步声停了。她把信放在桌上。\n\n雨水漫过石阶。';
    const otherScene = '远处的灯塔亮了。船仍停在港湾。';
    try {
        provider = await fakeProvider();
        await settingsService.writeSettings(dataRoot, {
            providerSettings: { mode: 'api', provider: 'openai-compatible', endpoint: provider.endpoint, model: 'desk-local-fixture', apiKey: 'local-test-only' },
            generationDefaults: { maxTokens: 8000, temperature: 0.7 }
        });
        await projectService.createProject(dataRoot, {
            id: 'desk-generation', title: '书桌生成联动测试',
            chapters: [{ id: 'chapter-1', title: '雨夜', order: 0 }],
            scenes: [
                { id: 'scene-1', chapterId: 'chapter-1', title: '门前', content: original, order: 0 },
                { id: 'scene-2', chapterId: 'chapter-1', title: '灯塔', content: otherScene, order: 1 }
            ]
        });
        servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot, revealPath: async () => '' });
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const host = new URL(route.request().url()).hostname;
            if (host === '127.0.0.1' || host === 'localhost') return route.continue();
            unexpectedHosts.push(host);
            return route.abort();
        });
        await page.goto(`${servers.appUrl}/desktop.html`, { waitUntil: 'domcontentloaded' });
        await page.locator('.desktop-project-card').first().click();
        await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('书桌生成联动测试'));
        assert.strictEqual(await page.locator('[data-native-writer]').evaluate(el => el.classList.contains('is-literary-desk')), true);
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), original);

        const continuation = '门被缓缓推开。';
        const first = provider.enqueue(continuation, true);
        await page.locator('[data-native-desk-mode="write"]').click();
        await page.fill('[data-native-beat-input]', '继续写门后的来客。');
        await page.click('[data-native-generate]');
        await page.waitForFunction(() => nativeEditorState.generation.inProgress && nativeEditorState.generation.text.length > 0);
        await waitProviderRequest(first);
        assert.strictEqual(await page.locator('[data-native-scene-editor]').evaluate(el => el.readOnly), true, 'streaming locks manuscript edits');
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), false, 'continuation has no original replacement highlight');
        first.finish();
        await waitCandidate(page, continuation);
        const continued = `${original}\n\n${continuation}`;
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), continued, 'real continuation streams into the manuscript');
        await assertCandidateActions(page);
        await assertCandidateLayout(page, '[data-native-beat-input]');
        await page.setViewportSize({ width: 1280, height: 720 });
        await assertCandidateActions(page);
        await assertCandidateLayout(page, '[data-native-beat-input]');
        await page.click('[data-native-accept-generation]');
        await page.waitForFunction(() => !nativeEditorState.generation.text);
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), continued, 'keep commits the inline continuation');
        await assertComposerRestored(page, '[data-native-beat-input]');
        await page.click('[data-native-save-scene]');
        await page.waitForFunction(() => !nativeEditorState.dirty && !nativeEditorState.isSaving);
        const saved = await fetch(`${servers.appUrl}/api/get-project?projectId=desk-generation`).then(response => response.json());
        assert.strictEqual(saved.project.sceneContents['scene-1'], continued, 'accepted continuation persists through the real project save service');
        assert.ok(saved.project.promptHistory.some(record => record.resultText === continuation));

        const second = provider.enqueue('这段续写随后撤回。');
        await page.click('[data-native-generate]'); await waitProviderRequest(second);
        await waitCandidate(page, '这段续写随后撤回。');
        await page.click('[data-native-discard-generation]');
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), continued, 'undo restores the pre-generation manuscript');
        await assertComposerRestored(page, '[data-native-beat-input]');

        const selected = '她把信放在桌上。';
        const start = continued.indexOf(selected), end = start + selected.length;
        await selectRange(page, start, end);
        await page.locator('[data-native-desk-mode="revise"]').click();
        await page.fill('[data-native-rewrite-instruction]', '保留动作，使语气更克制。');
        assert.strictEqual(await page.locator('[data-native-revision-excerpt]').textContent(), selected);
        assert.strictEqual(await page.locator('[data-native-revision-mark]').textContent(), selected);
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), true, 'highlight persists while the revision composer has focus');
        const rewriteText = '她将信压在杯底。门外的人迟迟没有开口，只有雨声填满了空荡的走廊。'.repeat(30);
        assert.ok(rewriteText.length >= 800, 'exercise a long revision candidate');
        const rewrite = provider.enqueue(rewriteText, true);
        await page.click('[data-native-start-rewrite]');
        await page.waitForFunction(() => nativeEditorState.generation.inProgress && nativeEditorState.generation.text.length > 0);
        await waitProviderRequest(rewrite);
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), continued, 'revision streams remain a candidate without changing original prose');
        assert.strictEqual(await page.locator('[data-native-revision-mark]').textContent(), selected);
        rewrite.finish(); await waitCandidate(page, rewriteText);
        await selectRange(page, 0, 3);
        assert.strictEqual(await page.locator('[data-native-revision-mark]').textContent(), selected, 'pending captured target outranks a later user selection');
        await page.click('[data-native-revision-locate]');
        assert.deepStrictEqual(await page.locator('[data-native-scene-editor]').evaluate(el => [el.selectionStart, el.selectionEnd]), [start, end]);
        assert.strictEqual(await page.locator('[data-native-revision-reselect]').isDisabled(), true);
        await assertCandidateActions(page);
        await assertCandidateLayout(page, '[data-native-rewrite-instruction]', true);
        await page.setViewportSize({ width: 1440, height: 900 });
        await assertCandidateLayout(page, '[data-native-rewrite-instruction]');
        await page.click('[data-native-accept-generation]');
        const rewritten = continued.slice(0, start) + rewriteText + continued.slice(end);
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), rewritten);
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), false, 'accepted replacement is not left marked as original text');
        await assertComposerRestored(page, '[data-native-rewrite-instruction]');

        const rangeEnd = rewritten.indexOf('\n\n');
        await selectRange(page, 0, rangeEnd);
        await page.locator('[data-native-rewrite-regenerate] > summary').click();
        await page.fill('[data-native-regenerate-instruction]', '保留门前的来客和信件，重新安排整段节奏。');
        const regenerate = provider.enqueue('来客没有敲门。她先把信收进抽屉。');
        await page.click('[data-native-regenerate-selection]'); await waitProviderRequest(regenerate);
        await waitCandidate(page, '来客没有敲门。她先把信收进抽屉。');
        assert.strictEqual(await page.locator('[data-native-revision-mark]').textContent(), rewritten.slice(0, rangeEnd));
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), rewritten);
        await page.click('[data-native-scene-id="scene-2"]');
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), otherScene);
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), false);
        await page.click('[data-native-accept-generation]');
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), otherScene, 'a candidate cannot overwrite another scene');
        assert.ok((await page.locator('[data-native-save-status]').textContent()).includes('原文或项目已变化'));
        await page.click('[data-native-scene-id="scene-1"]');
        assert.strictEqual(await page.locator('[data-native-revision-mark]').textContent(), rewritten.slice(0, rangeEnd));
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), true);
        await page.click('[data-native-discard-generation]');
        assert.strictEqual(await page.inputValue('[data-native-scene-editor]'), rewritten);
        assert.strictEqual(await page.locator('[data-native-revision-layer]').isVisible(), false);
        await assertComposerRestored(page, '[data-native-rewrite-instruction]');

        assert.strictEqual(provider.requests.length, 4);
        assert.ok(provider.requests.every(request => request.model === 'desk-local-fixture' && request.stream === true));
        assert.ok(provider.requests[0].messages.some(message => message.content.includes('继续写门后的来客')));
        assert.ok(provider.requests[2].messages.some(message => message.content.includes(selected) && message.content.includes('需要改写的文本')));
        assert.ok(provider.requests[3].messages.some(message => message.content.includes('保留门前的来客和信件')));
        assert.deepStrictEqual(errors, [], 'complete desk generation lifecycle has no renderer exceptions');
        assert.deepStrictEqual(unexpectedHosts, [], 'test never contacts a remote host');
        console.log('Writer desk generation E2E passed (local SSE provider, keep/undo/save, revision targets, scene guards, 44px actions, >=120px clear manuscript viewport and composer recovery at 1440 and 1280).');
    } catch (error) {
        if (page) {
            const status = await page.evaluate(() => ({ save: document.querySelector('[data-native-save-status]')?.textContent,
                generation: document.querySelector('[data-native-generation-output-status]')?.textContent,
                text: nativeEditorState.generation.text, inProgress: nativeEditorState.generation.inProgress })).catch(() => ({}));
            error.message += `\nRenderer status: ${JSON.stringify(status)}\nPage errors: ${JSON.stringify(errors)}`;
        }
        throw error;
    } finally {
        if (browser) await browser.close();
        if (servers) await servers.close();
        if (provider) await provider.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
