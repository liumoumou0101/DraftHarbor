/* global bindWorkshop renderWorkshop loadWorkshopSessions workshopState nativeEditorState */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

async function setup(page, fragment, sources, styles) {
    await page.setContent(`<!doctype html><html><head><style>[hidden]{display:none!important} [data-workshop-messages]{height:380px;overflow:auto} .desktop-workshop-message-text{white-space:pre-wrap} .desktop-workshop-message{margin:16px 0;max-width:860px} ${styles}</style></head><body>${fragment}</body></html>`);
    await page.evaluate(() => {
        const session = { id: 'session-a', projectId: 'project-a', title: 'Current discussion', promptTemplateId: 'default-workshop-coach', messages: [], directiveContract: {} };
        window.nativeEditorState = { snapshot: { project: { id: 'project-a', title: 'Project A' }, workshopSessions: [session] }, activeSceneId: 'scene-a', dirty: false, generation: {} };
        window.workshopState = { sessions: [session], selectedId: session.id, selectedAssistantMessageId: '', templates: [{ id: 'default-workshop-coach', title: 'Discuss' }], input: '', generating: false };
        window.compendiumState = { entries: [], dirty: false };
        window.currentProjectId = () => nativeEditorState.snapshot?.project.id || '';
        window.currentProjectName = () => nativeEditorState.snapshot?.project.title || '';
        window.currentNativeScene = () => ({ id: 'scene-a', title: 'Scene A' });
        window.renderContextStrip = () => {};
        window.setView = () => {};
        window.confirm = () => true;
        window.desktopGenerationAvailable = () => true;
        window.runtimeProviderConfig = config => config;
        window.DraftHarborWorkshopPrompt = { buildWorkshopPrompt: value => value };
        window.streamDesktopGeneration = (prompt, token, config) => new Promise((resolve, reject) => { window.chat = { prompt, token, config, resolve, reject }; });
        window.refreshCalls = [];
        window.refreshWorkshopAgentProject = async (projectId, snapshot, response) => { window.refreshCalls.push({ projectId, sameSnapshot: snapshot === nativeEditorState.snapshot, response }); if (window.failRefresh) throw new Error('已写入，但刷新失败'); return true; };
        window.run = { id: 'run-1', projectId: 'project-a', sessionId: 'session-a', status: 'completed', answer: '已核对人物动机。', steps: [{ label: '读取场景：Scene A' }, { label: '核对人物资料' }], proposal: { id: 'proposal-1', changes: [{ kind: 'scene', targetId: 'scene-a', title: 'Scene A', before: { content: '原正文' }, after: { content: '修改后的正文' }, reason: '让人物动机与行动一致。' }] } };
        window.requests = [];
        window.holds = {};
        window.failures = {};
        window.fetch = async (url, options = {}) => {
            const action = url.startsWith('/api/workshop-agent/') ? url.split('/').pop().split('?')[0] : options.method === 'POST' ? 'save' : url.startsWith('/api/prompts') ? 'prompts' : 'sessions';
            const body = options.body ? JSON.parse(options.body) : null;
            const record = { action, body, url };
            window.requests.push(record);
            const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
            if (window.failures[action]) return response({ ok: false, error: window.failures[action].error }, window.failures[action].status);
            if (window.holds[action]) return new Promise(resolve => { record.finish = (data, status = 200) => resolve(response(data, status)); });
            if (action === 'save') return response({ ok: true, session: body.session });
            if (action === 'prompts') return response({ ok: true, prompts: [] });
            if (action === 'sessions') return response({ ok: true, sessions: workshopState.sessions });
            if (action === 'apply') window.run = { ...window.run, status: 'applied', receipt: { id: 'receipt-1' } };
            if (action === 'undo') window.run = { ...window.run, status: 'undone' };
            if (action === 'cancel') window.run = { ...window.run, status: 'cancelled' };
            return response({ ok: true, run: structuredClone(window.run) });
        };
    });
    for (const source of sources) await page.addScriptTag({ content: source });
    await page.evaluate(() => bindWorkshop());
}

async function agent(page, text = '核对当前作品并提出修改。') {
    await page.click('[data-workshop-mode="agent"]');
    await page.fill('[data-workshop-input]', text);
    await page.click('[data-workshop-send]');
}

async function completed(page) {
    await page.waitForFunction(() => !workshopState.generating && !!document.querySelector('[data-workshop-agent-action="apply"]'));
}

const cases = [
    ['ordinary discussion remains the default and the assistant clearly scopes changes', async page => {
        assert.strictEqual(await page.locator('[data-workshop-status]').textContent(), '1 个对话');
        assert.strictEqual(await page.getAttribute('[data-workshop-mode="chat"]', 'aria-pressed'), 'true');
        await page.click('[data-workshop-mode="agent"]');
        assert.ok((await page.locator('[data-workshop-mode-help]').textContent()).includes('只操作当前作品'));
        assert.ok((await page.locator('[data-workshop-mode-help]').textContent()).includes('确认应用'));
        assert.strictEqual(await page.locator('[data-workshop-template]').isHidden(), true);
        assert.strictEqual(await page.isDisabled('[data-workshop-template]'), true);
        assert.ok(!(await page.locator('[data-workshop-empty-content]').textContent()).includes('@['));
        assert.ok((await page.locator('[data-workshop-empty-content]').textContent()).includes('核对当前场景'));
        await page.click('[data-workshop-mode="chat"]');
        assert.strictEqual(await page.locator('[data-workshop-template]').isVisible(), true);
        assert.strictEqual(await page.isDisabled('[data-workshop-template]'), false);
    }],
    ['update previews show only changed business fields and preserve explicit clearing', async page => {
        await page.evaluate(() => {
            const before = { title: '人物卡', type: 'character', body: 'Unchanged body', summary: 'Old summary', tags: ['same'], aliases: ['Old alias'], characterProfile: { goal: 'Old goal', role: '', voice: '', motivation: '', conflict: '', currentState: '', knowledge: '', relationshipNotes: '' } };
            window.run.proposal.changes = [{ kind: 'compendium.update', title: '人物卡', before, after: { ...before, summary: 'New summary', aliases: [], characterProfile: { ...before.characterProfile, goal: '' } } },
                { kind: 'scene.update', title: '第一场', before: { content: 'Before scene', tags: ['old'] }, after: { content: 'After scene', tags: ['new'] } }];
        });
        await agent(page); await completed(page);
        const paths = await page.locator('[data-workshop-changed-field]').evaluateAll(elements => elements.map(element => element.dataset.workshopChangedField));
        assert.deepStrictEqual(paths, ['summary', 'aliases', 'characterProfile.goal', 'content']);
        const text = await page.locator('[data-workshop-agent-result]').textContent();
        assert.ok(text.includes('变更字段：摘要、别名、人物目标'));
        assert.ok(text.includes('已清空'));
        assert.ok(!text.includes('Unchanged body'));
        assert.ok(!text.includes('人物口吻'));
    }],
    ['created cards show nonempty fields and translated types in a wide preview without inner scrolling', async page => {
        await page.setViewportSize({ width: 2560, height: 1377 });
        await page.evaluate(() => {
            window.run.proposal.changes = [{ kind: 'compendium.create', title: '铜钥匙', before: null, after: { title: '铜钥匙', type: 'item', body: '有效线索。\n'.repeat(35), summary: '', tags: ['线索'], aliases: [], characterProfile: { role: '', goal: '' } } }];
        });
        await agent(page); await completed(page);
        assert.deepStrictEqual(await page.locator('[data-workshop-changed-field]').evaluateAll(elements => elements.map(element => element.dataset.workshopChangedField)), ['title', 'type', 'body', 'tags']);
        const text = await page.locator('[data-workshop-agent-result]').textContent();
        assert.ok(text.includes('物品'));
        assert.ok(!text.includes('item'));
        assert.ok(text.includes('新增 · 铜钥匙'));
        const dimensions = await page.locator('.is-agent-result').evaluate(item => ({ width: item.getBoundingClientRect().width, maxHeight: getComputedStyle(item.querySelector('[data-workshop-changed-field="body"] pre')).maxHeight }));
        assert.ok(dimensions.width >= 1320 && dimensions.width <= 1480);
        assert.strictEqual(dimensions.maxHeight, 'none');
    }],
    ['dirty drafts block agent start without consuming the message', async page => {
        await page.evaluate(() => { nativeEditorState.dirty = true; });
        await agent(page, '请保留我的输入');
        assert.strictEqual(await page.inputValue('[data-workshop-input]'), '请保留我的输入');
        assert.strictEqual(await page.evaluate(() => window.requests.filter(item => item.action === 'start').length), 0);
        assert.ok((await page.locator('[data-workshop-status]').textContent()).includes('先保存'));
    }],
    ['agent shows readable steps and preview, stores meta, then applies and undoes once', async page => {
        await agent(page); await completed(page);
        assert.ok((await page.locator('[data-workshop-messages]').textContent()).includes('修改后的正文'));
        assert.strictEqual(await page.locator('.desktop-workshop-agent-steps li').count(), 2);
        const saves = await page.evaluate(() => window.requests.filter(item => item.action === 'save').map(item => item.body));
        assert.strictEqual(saves[0].session.messages.length, 0, 'history saved before start excludes the new user message');
        assert.strictEqual(saves.at(-1).session.messages.at(-1).meta.workshopAgent.id, 'run-1');
        await page.evaluate(() => { window.holds.apply = true; });
        await page.click('[data-workshop-agent-action="apply"]');
        await page.waitForFunction(() => window.requests.some(item => item.action === 'apply'));
        assert.strictEqual(await page.evaluate(() => window.WorkshopAgent.canLeave(false)), false);
        assert.strictEqual(await page.isDisabled('[data-workshop-agent-action="apply"]'), true);
        await page.evaluate(() => { window.run.status = 'applied'; window.requests.find(item => item.action === 'apply').finish({ ok: true, run: window.run }); });
        await page.waitForFunction(() => !!document.querySelector('[data-workshop-agent-action="undo"]') && !workshopState.generating);
        await page.click('[data-workshop-agent-action="undo"]');
        await page.waitForFunction(() => !workshopState.generating && document.querySelector('[data-workshop-agent-result]').textContent.includes('已撤销'));
        assert.deepStrictEqual(await page.evaluate(() => window.refreshCalls.map(item => [item.projectId, item.sameSnapshot])), [['project-a', true], ['project-a', true]]);
        assert.strictEqual(await page.evaluate(() => window.requests.filter(item => item.action === 'apply').length), 1);
    }],
    ['a refresh failure keeps an applied receipt and never offers apply again', async page => {
        await agent(page); await completed(page);
        await page.evaluate(() => { window.failRefresh = true; });
        await page.click('[data-workshop-agent-action="apply"]');
        await page.waitForFunction(() => !workshopState.generating);
        assert.strictEqual(await page.locator('[data-workshop-agent-action="apply"]').count(), 0);
        assert.strictEqual(await page.locator('[data-workshop-agent-action="undo"]').count(), 1);
        assert.ok((await page.locator('[data-workshop-agent-result]').textContent()).includes('刷新失败'));
    }],
    ['new dirty input blocks application while keeping the proposal', async page => {
        await agent(page); await completed(page);
        await page.evaluate(() => { window.compendiumState.dirty = true; });
        await page.click('[data-workshop-agent-action="apply"]');
        assert.strictEqual(await page.evaluate(() => window.requests.filter(item => item.action === 'apply').length), 0);
        assert.strictEqual(await page.locator('[data-workshop-agent-action="apply"]').count(), 1);
    }],
    ['cancelling a proposal removes the apply action without touching the manuscript', async page => {
        await agent(page); await completed(page);
        await page.click('[data-workshop-agent-action="cancel"]');
        await page.waitForFunction(() => !workshopState.generating);
        assert.strictEqual(await page.locator('[data-workshop-agent-action="apply"]').count(), 0);
        assert.strictEqual(await page.evaluate(() => window.refreshCalls.length), 0);
        assert.ok((await page.locator('[data-workshop-agent-result]').textContent()).includes('已取消'));
    }],
    ['failed start retains user text and a readable failure in the session', async page => {
        await page.evaluate(() => { window.failures.start = { status: 503, error: 'Provider unavailable' }; });
        await agent(page, '仍要保留这条输入');
        await page.waitForFunction(() => !workshopState.generating);
        assert.strictEqual(await page.inputValue('[data-workshop-input]'), '仍要保留这条输入');
        assert.ok((await page.locator('[data-workshop-messages]').textContent()).includes('Provider unavailable'));
        assert.strictEqual(await page.evaluate(() => workshopState.sessions[0].messages.length), 2);
    }],
    ['a late start is cancelled after changing projects and cannot leak into the new session', async page => {
        await page.evaluate(() => { window.holds.start = true; });
        await agent(page);
        await page.waitForFunction(() => window.requests.some(item => item.action === 'start'));
        await page.evaluate(() => {
            const session = { id: 'session-b', projectId: 'project-b', title: 'B', messages: [] };
            nativeEditorState.snapshot = { project: { id: 'project-b', title: 'B' }, workshopSessions: [session] };
            workshopState.sessions = [session]; workshopState.selectedId = session.id; renderWorkshop();
            window.requests.find(item => item.action === 'start').finish({ ok: true, run: window.run });
        });
        await page.waitForFunction(() => window.requests.some(item => item.action === 'cancel'));
        assert.strictEqual(await page.evaluate(() => workshopState.sessions[0].messages.length), 0);
        assert.ok((await page.evaluate(() => window.requests.filter(item => item.action === 'save').map(item => item.body.projectId))).every(id => id === 'project-a'));
    }],
    ['reopening a persisted proposal verifies the run and renders an expired run read-only', async page => {
        await page.evaluate(() => {
            window.failures.run = { status: 404, error: 'Expired run' };
            workshopState.sessions[0].messages = [{ id: 'old-message', role: 'assistant', content: 'Saved answer', meta: { workshopAgent: window.run } }];
            renderWorkshop(); window.WorkshopAgent.restore();
        });
        await page.waitForFunction(() => document.querySelector('[data-workshop-agent-result]').textContent.includes('操作已过期'));
        assert.strictEqual(await page.locator('[data-workshop-agent-action="apply"]').count(), 0);
        assert.ok((await page.locator('[data-workshop-messages]').textContent()).includes('Saved answer'));
    }],
    ['running polling stops on cancellation and stale polls cannot reopen the result', async page => {
        await page.evaluate(() => { window.run.status = 'running'; window.holds.run = true; });
        await agent(page);
        await page.waitForFunction(() => window.requests.some(item => item.action === 'run'));
        await page.click('[data-workshop-stop]');
        await page.waitForFunction(() => !workshopState.generating);
        await page.evaluate(() => { window.requests.find(item => item.action === 'run').finish({ ok: true, run: { ...window.run, status: 'completed', answer: 'Obsolete answer' } }); });
        assert.ok(!(await page.locator('[data-workshop-messages]').textContent()).includes('Obsolete answer'));
        assert.ok((await page.locator('[data-workshop-agent-result]').textContent()).includes('已取消'));
    }],
    ['ordinary streaming retains message nodes, selection and a reader scroll position', async page => {
        await page.evaluate(() => { workshopState.sessions[0].messages = Array.from({ length: 8 }, (_, index) => ({ id: `old-${index}`, role: 'assistant', content: 'Long existing content\n'.repeat(12) })); renderWorkshop(); });
        await page.fill('[data-workshop-input]', 'Continue'); await page.click('[data-workshop-send]');
        await page.waitForFunction(() => !!window.chat);
        await page.evaluate(() => {
            window.chat.token('First answer.');
            const messages = document.querySelector('[data-workshop-messages]'); const text = messages.querySelector('.desktop-workshop-message-text').firstChild;
            window.firstText = text; const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); messages.scrollTop = 100;
            window.chat.token(' Second token.');
        });
        assert.strictEqual(await page.evaluate(() => document.querySelector('[data-workshop-messages]').scrollTop), 100);
        assert.strictEqual(await page.evaluate(() => window.getSelection().toString()), 'Long');
        assert.strictEqual(await page.evaluate(() => window.firstText === document.querySelector('.desktop-workshop-message-text').firstChild), true);
        await page.evaluate(() => window.chat.resolve());
    }],
    ['ordinary stream saves to its captured project after a project switch', async page => {
        await page.fill('[data-workshop-input]', 'Discuss A'); await page.click('[data-workshop-send]');
        await page.waitForFunction(() => !!window.chat);
        await page.evaluate(() => {
            const session = { id: 'session-b', projectId: 'project-b', title: 'B', messages: [] };
            nativeEditorState.snapshot = { project: { id: 'project-b', title: 'B' }, workshopSessions: [session] };
            workshopState.sessions = [session]; workshopState.selectedId = session.id; renderWorkshop();
            window.chat.token('Should never reach B'); window.chat.resolve();
        });
        await page.waitForFunction(() => window.requests.some(item => item.action === 'save'));
        assert.strictEqual(await page.evaluate(() => window.requests.find(item => item.action === 'save').body.projectId), 'project-a');
        assert.strictEqual(await page.evaluate(() => workshopState.sessions[0].messages.length), 0);
    }],
    ['ordinary discussion can stop even when the provider ignores abort', async page => {
        await page.fill('[data-workshop-input]', 'Stop this discussion'); await page.click('[data-workshop-send]');
        await page.waitForFunction(() => !!window.chat);
        await page.evaluate(() => window.chat.token('Keep the partial reply.'));
        await page.click('[data-workshop-stop]');
        await page.waitForFunction(() => !workshopState.generating);
        await page.evaluate(() => { window.chat.token('Late token must not appear'); window.chat.resolve(); });
        assert.ok((await page.locator('[data-workshop-messages]').textContent()).includes('Keep the partial reply.'));
        assert.ok(!(await page.locator('[data-workshop-messages]').textContent()).includes('Late token'));
    }],
    ['switching conversations restores each unsent input independently', async page => {
        await page.fill('[data-workshop-input]', 'Unsent A');
        await page.evaluate(() => { workshopState.sessions.push({ id: 'session-b', projectId: 'project-a', title: 'B', messages: [] }); renderWorkshop(); });
        await page.locator('.desktop-workshop-session').filter({ hasText: 'B' }).click();
        assert.strictEqual(await page.inputValue('[data-workshop-input]'), '');
        await page.fill('[data-workshop-input]', 'Unsent B');
        await page.locator('.desktop-workshop-session').filter({ hasText: 'Current discussion' }).click();
        assert.strictEqual(await page.inputValue('[data-workshop-input]'), 'Unsent A');
    }],
    ['late session loads cannot replace another project', async page => {
        await page.evaluate(() => { window.holds.sessions = true; window.loading = loadWorkshopSessions(); });
        await page.waitForFunction(() => window.requests.some(item => item.action === 'sessions'));
        await page.evaluate(async () => {
            const session = { id: 'session-b', projectId: 'project-b', title: 'B', messages: [] };
            nativeEditorState.snapshot = { project: { id: 'project-b', title: 'B' }, workshopSessions: [session] };
            workshopState.sessions = [session]; workshopState.selectedId = session.id; renderWorkshop();
            window.requests.find(item => item.action === 'sessions').finish({ ok: true, sessions: [{ id: 'old', projectId: 'project-a', title: 'Old A' }] }); await window.loading;
        });
        assert.strictEqual(await page.evaluate(() => workshopState.sessions[0].id), 'session-b');
        assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.workshopSessions[0].id), 'session-b');
    }]
];

(async () => {
    const root = path.resolve(__dirname, '..');
    const fragment = await fs.readFile(path.join(root, 'desktop/fragments/workshop.html'), 'utf8');
    const styles = await fs.readFile(path.join(root, 'src/styles/desktop/desktop-workshop-agent.css'), 'utf8');
    const sources = await Promise.all(['src/core/workshop/workshop-schema.js', 'src/desktop/shell/workshop.js', 'src/desktop/shell/workshop-agent.js'].map(file => fs.readFile(path.join(root, file), 'utf8')));
    const browser = await chromium.launch({ headless: true });
    let failed = 0;
    try {
        for (const [name, run] of cases) {
            const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
            const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
            await page.route('**/*', route => route.abort());
            try { await setup(page, fragment, sources, styles); await run(page); assert.deepStrictEqual(errors, []); console.log(`PASS ${name}`); }
            catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.stack || error}`); }
            finally { await page.close(); }
        }
    } finally { await browser.close(); }
    assert.strictEqual(failed, 0, `${failed} workshop UI cases failed`);
    console.log(`Workshop agent UI tests passed (${cases.length} cases, no provider requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
