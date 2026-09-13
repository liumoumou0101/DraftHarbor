/* global renderReaderLibraryCard */
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

async function prepare(page, source, viewMode = 'grid') {
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: source });
    await page.evaluate(mode => {
        window.__readerCardAudit = { opened: [], details: [], saved: [], renders: 0 };
        window.openReaderLibraryDocument = id => window.__readerCardAudit.opened.push(id);
        window.openReaderLibraryDetail = id => window.__readerCardAudit.details.push(id);
        window.persistReaderLibraryView = changes => window.__readerCardAudit.saved.push(changes);
        window.renderReaderLibrary = () => { window.__readerCardAudit.renders += 1; };
        const card = renderReaderLibraryCard({ documentId: 'book', title: 'Book title' }, {
            viewMode: mode, favoriteDocumentIds: [], hiddenDocumentIds: [],
            shelves: [{ shelfId: 'reading', title: 'Reading', documentIds: [] }]
        });
        document.querySelector('main').appendChild(card);
    }, viewMode);
}

const cases = [
    ['shelf pointer and keyboard interaction only changes membership', async page => {
        const select = page.getByRole('combobox', { name: '将书籍加入自定义书架' });
        await select.click();
        await page.keyboard.press('Escape');
        assert.deepStrictEqual(await page.evaluate(() => window.__readerCardAudit.opened), [], 'opening the native dropdown must not open the book');
        await select.selectOption('reading');
        let state = await page.evaluate(() => window.__readerCardAudit);
        assert.deepStrictEqual(state.opened, []);
        assert.deepStrictEqual(state.saved.at(-1).shelves[0].documentIds, ['book']);
        await select.focus();
        await select.press('ArrowUp');
        await select.press('Enter');
        await select.press('Space');
        await select.press('Escape');
        state = await page.evaluate(() => window.__readerCardAudit);
        assert.deepStrictEqual(state.opened, [], 'select keyboard activation must not become card activation');
        assert.deepStrictEqual(state.saved.at(-1).shelves[0].documentIds, []);
    }],
    ['card surface and focused card retain open behavior', async page => {
        await page.locator('.desktop-reader-library-cover').click();
        await page.getByText('Book title', { exact: true }).click();
        const card = page.locator('article');
        await card.focus();
        await card.press('Enter');
        await card.press('Space');
        assert.deepStrictEqual(await page.evaluate(() => window.__readerCardAudit.opened), ['book', 'book', 'book', 'book']);
    }],
    ['nested action buttons keep their own behavior without opening twice', async page => {
        await page.getByRole('button', { name: '详情', exact: true }).click();
        await page.getByRole('button', { name: '收藏', exact: true }).click();
        await page.getByRole('button', { name: '移出', exact: true }).focus();
        await page.getByRole('button', { name: '移出', exact: true }).press('Space');
        let state = await page.evaluate(() => window.__readerCardAudit);
        assert.deepStrictEqual(state.opened, []);
        assert.deepStrictEqual(state.details, ['book']);
        assert.deepStrictEqual(state.saved[0].favoriteDocumentIds, ['book']);
        assert.deepStrictEqual(state.saved[1].hiddenDocumentIds, ['book']);
        const open = page.getByRole('button', { name: '开始', exact: true });
        await open.evaluate(button => { button.innerHTML = '<span>开始</span>'; });
        await open.locator('span').click();
        await open.focus();
        await open.press('Enter');
        state = await page.evaluate(() => window.__readerCardAudit);
        assert.deepStrictEqual(state.opened, ['book', 'book'], 'the open button must open exactly once per activation');
    }],
    ['other nested controls retain native pointer and keyboard interaction', async page => {
        await page.evaluate(() => {
            const controls = document.createElement('div');
            controls.innerHTML = `
                <input data-probe="input" aria-label="Card input">
                <textarea data-probe="textarea" aria-label="Card notes"></textarea>
                <a data-probe="link" href="#card-link"><span>Card link</span></a>
                <input id="card-checkbox" type="checkbox"><label data-probe="label" for="card-checkbox"><span>Card checkbox</span></label>
                <details><summary data-probe="summary"><span>More information</span></summary><p>Detail text</p></details>
                <div data-probe="editable" contenteditable="true" aria-label="Editable notes">Editable text</div>
                <div data-probe="custom" role="button" tabindex="0"><span>Custom control</span></div>
                <div data-probe="focusable" tabindex="0"><span>Focusable content</span></div>`;
            document.querySelector('article').appendChild(controls);
        });
        for (const name of ['input', 'textarea', 'link', 'label', 'summary', 'editable', 'custom', 'focusable']) {
            const control = page.locator(`[data-probe="${name}"]`);
            const nested = control.locator('span');
            await (await nested.count() ? nested : control).click();
        }
        assert.strictEqual(await page.locator('#card-checkbox').isChecked(), true, 'clicking the label should still toggle its checkbox');
        assert.strictEqual(await page.locator('details').evaluate(details => details.open), true, 'summary should still expand details');
        await page.locator('[data-probe="input"]').fill('Input text');
        await page.locator('[data-probe="input"]').press('Enter');
        await page.locator('[data-probe="textarea"]').fill('Notes');
        await page.locator('[data-probe="textarea"]').press('Enter');
        await page.locator('[data-probe="editable"]').press('Space');
        await page.locator('[data-probe="link"]').press('Enter');
        await page.locator('[data-probe="custom"]').press('Enter');
        await page.locator('[data-probe="focusable"]').press('Space');
        assert.deepStrictEqual(await page.evaluate(() => window.__readerCardAudit.opened), [], 'nested controls must not invoke the card open action');
    }],
    ['handled child events and handled card keys are respected', async page => {
        await page.evaluate(() => {
            const label = document.createElement('span');
            label.textContent = 'Handled child';
            label.addEventListener('click', event => event.preventDefault());
            const card = document.querySelector('article');
            card.appendChild(label);
            card.addEventListener('keydown', event => event.preventDefault(), true);
        });
        await page.getByText('Handled child', { exact: true }).click();
        await page.locator('article').focus();
        await page.locator('article').press('Enter');
        assert.deepStrictEqual(await page.evaluate(() => window.__readerCardAudit.opened), []);
    }]
];

(async () => {
    const source = await fs.readFile(path.join(__dirname, '../src/desktop/shell/reader-library.js'), 'utf8');
    const browser = await chromium.launch({ headless: true });
    try {
        for (const mode of ['grid', 'list']) {
            for (const [name, run] of cases) {
                const context = await browser.newContext();
                await context.route('**/*', route => route.abort());
                const page = await context.newPage();
                page.setDefaultTimeout(5000);
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                try {
                    await prepare(page, source, mode);
                    await run(page);
                    assert.deepStrictEqual(errors, []);
                    console.log(`PASS ${mode}: ${name}`);
                } finally {
                    await context.close();
                }
            }
        }
    } finally {
        await browser.close();
    }
    console.log(`Reader library interaction tests passed (${cases.length * 2} cases, no API requests).`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
