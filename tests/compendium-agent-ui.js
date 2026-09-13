/* global compendiumState nativeEditorState settingsState renderCompendium markCompendiumDirty collectCompendiumForm
   openCompendiumAgent bindCompendiumAgent openCompendiumAgentQa bindCompendiumAgentQa selectCompendiumEntry */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const analysis = (projectId = 'project-a', reason = 'Review B') => ({
    ok: true, projectId,
    findings: [{ id: 'finding', severity: 'low', reason, entryIds: ['b'], operationIds: ['operation'] }],
    operations: [{ id: 'operation', entryId: 'b', baseRevision: 'revision-b', patch: { summary: 'Suggested B summary' } }]
});
const answer = (projectId = 'project-a', text = 'Answer B') => ({
    ok: true, projectId, answer: text, sourceIds: ['b'], confidence: 'grounded', sources: [{ id: 'b', title: 'B' }]
});

async function prepare(browser, dialogs, sources) {
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`${dialogs}<input data-compendium-title><input data-compendium-summary><textarea data-compendium-body></textarea><select data-compendium-entry-type><option value="lore">lore</option></select><p data-compendium-status></p>`);
    await page.evaluate(() => {
        window.nativeEditorState = { snapshot: { project: { id: 'project-a', title: 'Project A' } } };
        window.compendiumState = {
            entries: [{ id: 'a', type: 'lore', title: 'A', summary: 'A summary', body: 'A body' }, { id: 'b', type: 'lore', title: 'B', summary: 'B summary', body: 'B body' }],
            selectedId: 'a', dirty: false, query: '', type: '', loading: false
        };
        window.settingsState = { settings: { compendiumAgent: { enabled: true, providerProfileId: 'profile', maxCardsPerRun: 30 } } };
        window.normalizeDesktopSettings = input => input;
        window.renderContextStrip = () => {};
        window.parseCommaList = text => String(text || '').split(',').filter(Boolean);
        window.__confirmResult = false;
        window.__confirms = [];
        window.confirm = message => { window.__confirms.push(message); return window.__confirmResult; };
        window.__requests = [];
        // Deliberately ignore abort so tests prove late fulfillment/rejection is
        // isolated even when the server has already received the request.
        window.fetch = (url, options) => new Promise((resolve, reject) => {
            window.__requests.push({ url, options, resolve, reject });
        });
        window.__reply = (index, payload, ok = true) => window.__requests[index].resolve({ ok, status: ok ? 200 : 400, json: async () => payload });
        window.setView = view => { window.__view = view; };
        window.setSettingsCategory = section => { window.__section = section; };
    });
    for (const source of sources) await page.addScriptTag({ content: source });
    await page.evaluate(() => {
        window.__loads = 0;
        window.loadCompendium = async () => { window.__loads += 1; };
        renderCompendium(); bindCompendiumAgent(); bindCompendiumAgentQa();
    });
    return { context, page, errors };
}

async function open(page, qa) {
    await page.evaluate(isQa => { if (isQa) openCompendiumAgentQa(); else openCompendiumAgent(); }, qa);
}
const prefix = qa => `data-compendium-agent${qa ? '-qa' : ''}`;
async function run(page, qa) {
    if (qa) await page.locator('[data-compendium-agent-qa-question]').fill('Question B');
    await page.locator(`[${prefix(qa)}-run]`).click();
}
async function reply(page, index, payload, qa, ok = true) {
    await page.evaluate(({ i, value, success }) => window.__reply(i, value, success), { i: index, value: payload, success: ok });
    await page.waitForFunction(selector => !document.querySelector(selector).disabled, `[${prefix(qa)}-run]`);
}

const cases = [
    ...[false, true].map(qa => [`${qa ? 'QA' : 'analysis'} source navigation preserves a rejected dirty draft and accepts the normal card switch`, async page => {
        await page.evaluate(() => { document.querySelector('[data-compendium-body]').value = 'A unsaved body'; markCompendiumDirty(); });
        await open(page, qa); await run(page, qa); await reply(page, 0, qa ? answer() : analysis(), qa);
        if (!qa) await page.locator('[data-compendium-agent-operation]').uncheck();
        const source = page.getByRole('button', { name: '查看资料：B', exact: true });
        await source.click();
        assert.deepStrictEqual(await page.evaluate(() => ({ selected: compendiumState.selectedId, dirty: compendiumState.dirty, saved: collectCompendiumForm().body, confirms: window.__confirms.length })),
            { selected: 'a', dirty: true, saved: 'A unsaved body', confirms: 1 });
        assert.ok(await page.locator(`[${prefix(qa)}-modal]`).evaluate(node => node.open));
        await page.evaluate(() => { window.__confirmResult = true; });
        await source.click();
        assert.deepStrictEqual(await page.evaluate(() => ({ selected: compendiumState.selectedId, dirty: compendiumState.dirty, saved: collectCompendiumForm().body })),
            { selected: 'b', dirty: false, saved: 'B body' });
        assert.strictEqual(await page.locator(`[${prefix(qa)}-modal]`).evaluate(node => node.open), false);
        await open(page, qa);
        assert.ok((await page.locator(`[${prefix(qa)}-${qa ? 'result' : 'results'}]`).innerText()).includes(qa ? 'Answer B' : 'Review B'));
        if (!qa) assert.strictEqual(await page.locator('[data-compendium-agent-operation]').isChecked(), false, 'review choices must survive inspecting a card');
        assert.strictEqual(await page.evaluate(() => window.__requests.length), 1, 'returning to results must not launch another model request');
    }]),
    ...[false, true].map(qa => [`${qa ? 'QA' : 'analysis'} late response cannot replace a newly opened project session`, async page => {
        await open(page, qa); await run(page, qa);
        await page.locator(`[${prefix(qa)}-cancel]`).click();
        assert.strictEqual(await page.evaluate(() => window.__requests[0].options.signal.aborted), true);
        await page.evaluate(() => { nativeEditorState.snapshot = { project: { id: 'project-b', title: 'Project B' } }; renderCompendium(); });
        await open(page, qa); await run(page, qa);
        await page.evaluate(({ value }) => window.__reply(0, value), { value: qa ? answer('project-a', 'OLD A') : analysis('project-a', 'OLD A') });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.strictEqual(await page.locator(`[${prefix(qa)}-run]`).isDisabled(), true, 'old finally must not unlock a new request');
        assert.ok(!(await page.locator(`[${prefix(qa)}-${qa ? 'result' : 'results'}]`).textContent()).includes('OLD A'));
        await reply(page, 1, qa ? answer('project-b', 'NEW B') : analysis('project-b', 'NEW B'), qa);
        assert.ok((await page.locator(`[${prefix(qa)}-${qa ? 'result' : 'results'}]`).textContent()).includes('NEW B'));
    }]),
    ...[false, true].map(qa => [`${qa ? 'QA' : 'analysis'} close and reopen isolate old errors while current errors restore controls`, async page => {
        await open(page, qa); await run(page, qa);
        await page.keyboard.press('Escape');
        await open(page, qa); await run(page, qa);
        await page.evaluate(() => window.__requests[0].reject(new Error('OLD ERROR')));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.strictEqual(await page.locator(`[${prefix(qa)}-run]`).isDisabled(), true);
        assert.ok(!(await page.locator(`[${prefix(qa)}-status]`).innerText()).includes('OLD ERROR'));
        await reply(page, 1, { ok: false, error: 'Current failure' }, qa, false);
        assert.ok((await page.locator(`[${prefix(qa)}-status]`).innerText()).includes('Current failure'));
        assert.strictEqual(await page.locator(`[${prefix(qa)}-${qa ? 'question' : 'scope'}]`).isDisabled(), false);
    }]),
    ['analysis apply protects drafts, serializes UI actions and ignores completion after switching project', async page => {
        await open(page, false); await run(page, false); await reply(page, 0, analysis(), false);
        await page.evaluate(() => { compendiumState.dirty = true; window.__confirmResult = true; });
        await page.locator('[data-compendium-agent-apply]').click();
        assert.strictEqual(await page.evaluate(() => window.__requests.length), 1);
        assert.strictEqual(await page.evaluate(() => compendiumState.dirty), true);
        await page.evaluate(() => { compendiumState.dirty = false; });
        await page.locator('[data-compendium-agent-apply]').click();
        assert.strictEqual(await page.locator('[data-compendium-agent-run]').isDisabled(), true);
        assert.strictEqual(await page.locator('[data-compendium-agent-cancel]').isDisabled(), true);
        await page.keyboard.press('Escape');
        assert.ok(await page.locator('[data-compendium-agent-modal]').evaluate(node => node.open));
        await page.evaluate(() => { nativeEditorState.snapshot = { project: { id: 'project-b' } }; openCompendiumAgent(); });
        await page.evaluate(() => window.__reply(1, { ok: true, appliedCount: 1 }));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.strictEqual(await page.evaluate(() => window.__loads), 0, 'old apply must not reload the new project');
        assert.ok(await page.locator('[data-compendium-agent-modal]').evaluate(node => node.open));
        assert.strictEqual(await page.locator('[data-compendium-agent-results]').textContent(), '');
    }],
    ['analysis retry replaces old preview and apply failure keeps the review available', async page => {
        await open(page, false); await run(page, false); await reply(page, 0, analysis(), false);
        await run(page, false);
        assert.strictEqual(await page.locator('[data-compendium-agent-results]').textContent(), '');
        assert.strictEqual(await page.locator('[data-compendium-agent-apply]').isDisabled(), true);
        await reply(page, 1, analysis(), false);
        await page.evaluate(() => { window.__confirmResult = true; });
        await page.locator('[data-compendium-agent-apply]').click();
        await page.evaluate(() => window.__reply(2, { ok: false, error: 'Card changed' }, false));
        await page.waitForFunction(() => !document.querySelector('[data-compendium-agent-apply]').disabled);
        assert.ok((await page.locator('[data-compendium-agent-status]').innerText()).includes('Card changed'));
        assert.strictEqual(await page.locator('[data-compendium-agent-cancel]').isDisabled(), false);
        assert.ok(await page.locator('[data-compendium-agent-operation]').isChecked());
    }],
    ['successful application clears consumed suggestions and local-only results disclose the AI failure', async page => {
        await open(page, false); await run(page, false); await reply(page, 0, analysis(), false);
        await page.evaluate(() => {
            window.__confirmResult = true;
            window.loadCompendium = async () => { window.__loads += 1; throw new Error('GET unavailable'); };
        });
        await page.locator('[data-compendium-agent-apply]').click();
        await page.evaluate(() => window.__reply(1, { ok: true, appliedCount: 1, entries: [{ ...compendiumState.entries.find(entry => entry.id === 'b'), summary: 'Persisted B summary', updatedAt: '2026-09-13T01:00:00.000Z' }] }));
        await page.waitForFunction(() => !document.querySelector('[data-compendium-agent-modal]').open);
        assert.strictEqual(await page.evaluate(() => window.__loads), 0, 'successful apply must not depend on a follow-up GET');
        assert.strictEqual(await page.evaluate(() => window.__requests.filter(request => request.url === '/api/compendium-agent/apply').length), 1);
        assert.strictEqual(await page.evaluate(() => window.__requests.length), 2, 'one analysis plus one apply request, without a cache reload');
        assert.strictEqual(await page.evaluate(() => compendiumState.entries.find(entry => entry.id === 'b').summary), 'Persisted B summary');
        assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.compendium.find(entry => entry.id === 'b').summary), 'Persisted B summary');
        assert.strictEqual(await page.locator('[data-compendium-summary]').inputValue(), 'A summary', 'updating B must not replace the current A form');
        await open(page, false);
        assert.strictEqual(await page.locator('[data-compendium-agent-results]').textContent(), '');
        await run(page, false);
        await reply(page, 2, { ok: true, projectId: 'project-a', findings: [{ id: 'local', severity: 'low', reason: 'Missing tags', entryIds: ['b'], operationIds: [] }], operations: [], warning: 'AI 体检未完成，以下仅为本地检查结果：Controlled failure' }, false);
        assert.ok((await page.locator('[data-compendium-agent-results]').textContent()).includes('Missing tags'));
        assert.strictEqual(await page.locator('[data-compendium-agent-status]').getAttribute('data-tone'), 'warn');
        assert.strictEqual(await page.locator('[data-compendium-agent-apply]').isDisabled(), true);
        await page.locator('[data-compendium-agent-cancel]').click();
        await page.evaluate(() => { nativeEditorState.snapshot = { project: { id: 'project-a', title: 'Reopened A' } }; });
        await open(page, false);
        assert.strictEqual(await page.locator('[data-compendium-agent-results]').textContent(), '', 'a reopened project snapshot must not reuse results from its previous editor session');
    }],
    ...[false, true].map(typeDuringApply => [`applying the current card ${typeDuringApply ? 'preserves later input and advances its saved baseline' : 'updates the saved form directly from the response'}`, async page => {
        await page.evaluate(() => selectCompendiumEntry('b'));
        await open(page, false); await run(page, false); await reply(page, 0, analysis(), false);
        await page.evaluate(() => {
            window.__confirmResult = true;
            window.loadCompendium = async () => { window.__loads += 1; throw new Error('GET unavailable'); };
        });
        await page.locator('[data-compendium-agent-apply]').click();
        if (typeDuringApply) await page.evaluate(() => {
            document.querySelector('[data-compendium-summary]').value = 'Newer unsaved summary';
            markCompendiumDirty();
        });
        await page.evaluate(() => window.__reply(1, { ok: true, appliedCount: 1, entries: [{ ...compendiumState.entries.find(entry => entry.id === 'b'), summary: 'Persisted B summary', updatedAt: '2026-09-13T01:00:00.000Z' }] }));
        await page.waitForFunction(() => !document.querySelector('[data-compendium-agent-modal]').open);
        assert.strictEqual(await page.evaluate(() => window.__loads), 0);
        assert.strictEqual(await page.evaluate(() => window.__requests.length), 2);
        assert.strictEqual(await page.evaluate(() => compendiumState.entries.find(entry => entry.id === 'b').summary), 'Persisted B summary');
        assert.strictEqual(await page.locator('[data-compendium-summary]').inputValue(), typeDuringApply ? 'Newer unsaved summary' : 'Persisted B summary');
        assert.strictEqual(await page.evaluate(() => compendiumState.dirty), typeDuringApply);
        assert.strictEqual(await page.evaluate(() => window.captureCompendiumDraft().entry.updatedAt), '2026-09-13T01:00:00.000Z');
    }]),
    ['uncited answers never show success and missing configuration opens the correct settings section', async page => {
        await open(page, true); await run(page, true);
        await reply(page, 0, { ...answer(), sourceIds: [], confidence: 'grounded' }, true);
        assert.strictEqual(await page.locator('[data-compendium-agent-qa-status]').getAttribute('data-tone'), 'info');
        assert.ok((await page.locator('[data-compendium-agent-qa-status]').textContent()).includes('未找到足够'));
        await page.locator('[data-compendium-agent-qa-cancel]').click();
        await page.evaluate(() => { settingsState.settings.compendiumAgent.enabled = false; openCompendiumAgentQa(); });
        assert.deepStrictEqual(await page.evaluate(() => [window.__view, window.__section]), ['settings', 'compendium-agent']);
        await page.evaluate(() => { window.__view = ''; window.__section = ''; openCompendiumAgent(); });
        assert.deepStrictEqual(await page.evaluate(() => [window.__view, window.__section]), ['settings', 'compendium-agent']);
    }]
];

(async () => {
    const fragment = await fs.readFile(path.join(root, 'desktop/fragments/compendium.html'), 'utf8');
    const dialogs = [...fragment.matchAll(/<dialog[^>]*data-compendium-agent(?:-qa)?-modal[\s\S]*?<\/dialog>/g)].map(match => match[0]).join('');
    assert.ok(dialogs.includes('data-compendium-agent-qa-modal'));
    const sources = await Promise.all(['compendium.js', 'compendium-agent.js', 'compendium-agent-qa.js'].map(file => fs.readFile(path.join(root, 'src/desktop/shell', file), 'utf8')));
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [name, test] of cases) {
            const { context, page, errors } = await prepare(browser, dialogs, sources);
            try { await test(page); assert.deepStrictEqual(errors, []); console.log(`PASS ${name}`); }
            finally { await context.close(); }
        }
        console.log(`Compendium agent UI tests passed (${cases.length} cases, real isolated DOM and controlled responses, no providers).`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
