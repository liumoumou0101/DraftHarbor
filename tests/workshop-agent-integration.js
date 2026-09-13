/* global nativeEditorState workshopState compendiumState */
const assert = require('assert');
const { chromium } = require('playwright');
const projects = require('../desktop/services/project-service');
const workshop = require('../desktop/services/workshop-service');
const { createFixture } = require('./workshop-agent-fixture');

(async () => {
    const fixture = await createFixture();
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 2560, height: 1377 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${fixture.servers.appUrl}/desktop.html`);
        await page.locator('.desktop-project-card').first().focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#desktop-root').dataset.view === 'writer' && nativeEditorState.snapshot?.writerRevision);
        const originalRevision = await page.evaluate(() => nativeEditorState.snapshot.writerRevision);
        await page.click('[data-view-target="workshop"]');
        await page.waitForFunction(() => workshopState.selectedId === 'session-demo');
        await page.click('[data-workshop-mode="agent"]');
        await page.fill('[data-workshop-input]', '核对当前场景和沈砚资料，补足动机，并记录已经出现的线索。');
        await page.click('[data-workshop-send]');
        await page.waitForSelector('[data-workshop-agent-action="apply"]');
        assert.strictEqual(fixture.requests.length, 8, 'the real provider transport must complete the bounded tool loop');
        assert.strictEqual((await projects.openProject(fixture.dataRoot, 'agent-demo')).project.scenes[0].content, fixture.ORIGINAL, 'preview does not modify the scene');
        assert.strictEqual(await page.locator('.desktop-workshop-agent-change').count(), 3);
        assert.ok((await page.locator('.desktop-workshop-agent-compare').first().innerText()).includes(fixture.REVISED));
        const dimensions = await page.locator('.desktop-workshop-agent-compare').first().evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
        assert.ok(dimensions.scroll <= dimensions.width + 1, 'preview must not overflow horizontally at maximized size');
        await page.click('[data-workshop-agent-action="apply"]');
        await page.waitForFunction(() => !workshopState.generating && nativeEditorState.snapshot.sceneContents['scene-harbor'].includes('替她送消息'));
        const after = (await projects.openProject(fixture.dataRoot, 'agent-demo')).project;
        assert.strictEqual(after.scenes[0].content, fixture.REVISED);
        assert.strictEqual(after.compendium.length, 2);
        assert.notStrictEqual(await page.evaluate(() => nativeEditorState.snapshot.writerRevision), originalRevision);
        assert.strictEqual(await page.evaluate(() => compendiumState.entries.length), 2);
        const history = (await workshop.listSessions(fixture.dataRoot, 'agent-demo')).sessions[0].messages;
        assert.strictEqual(history.at(-1).meta.workshopAgent.status, 'applied');
        await page.click('[data-workshop-agent-action="undo"]');
        await page.waitForFunction(() => !workshopState.generating && document.querySelector('[data-workshop-agent-result]').textContent.includes('已撤销'));
        const undone = (await projects.openProject(fixture.dataRoot, 'agent-demo')).project;
        assert.strictEqual(undone.scenes[0].content, fixture.ORIGINAL);
        assert.strictEqual(undone.compendium.length, 1);
        assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.sceneContents['scene-harbor']), fixture.ORIGINAL);
        assert.strictEqual(await page.evaluate(() => compendiumState.entries.length), 1);
        assert.strictEqual(await page.evaluate(() => nativeEditorState.snapshot.writerRevision), undone.writerRevision);
        await page.click('[data-view-target="writer"]');
        await page.evaluate(async () => {
            const saved = await window.saveNativeScene();
            if (saved === false) throw new Error('Writer could not save its refreshed version');
        });
        assert.strictEqual((await workshop.listSessions(fixture.dataRoot, 'agent-demo')).sessions[0].messages.length, 2, 'ordinary writer save preserves the discussion');
        assert.deepStrictEqual(errors, []);
        console.log('Workshop agent integration passed (real HTTP provider loop, preview, apply, undo, writer/card refresh, subsequent save).');
    } finally {
        if (browser) await browser.close();
        await fixture.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
