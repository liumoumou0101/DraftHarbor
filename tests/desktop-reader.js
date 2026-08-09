const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');

async function createReaderSelectionTransfer(page, layoutMode, destination, target) {
    await page.evaluate((mode) => {
        const control = document.querySelector('[data-reader-layout-mode]');
        control.value = mode;
        control.dispatchEvent(new Event('change', { bubbles: true }));
    }, layoutMode);
    await page.waitForFunction((mode) => document.querySelector('[data-reader-content]').dataset.readerLayout === mode, layoutMode);
    await page.evaluate(({ blockId, start, end }) => {
        const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => (
            node.dataset.readerBlock === blockId
            && Number(node.dataset.readerStartOffset) <= start
            && Number(node.dataset.readerEndOffset) >= end
        ));
        if (!fragment) throw new Error(`No rendered fragment contains ${blockId}:${start}-${end}`);
        const textNodes = [];
        const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        const localStart = start - Number(fragment.dataset.readerStartOffset);
        const localEnd = end - Number(fragment.dataset.readerStartOffset);
        let cursor = 0;
        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;
        textNodes.forEach((node) => {
            const next = cursor + node.nodeValue.length;
            if (!startNode && localStart >= cursor && localStart <= next) {
                startNode = node;
                startOffset = localStart - cursor;
            }
            if (!endNode && localEnd >= cursor && localEnd <= next) {
                endNode = node;
                endOffset = localEnd - cursor;
            }
            cursor = next;
        });
        if (!startNode || !endNode) throw new Error('Reader fragment must expose text nodes for the requested range');
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }, target);
    await page.waitForFunction(({ blockId, start, end }) => {
        const selection = readerState.transferSelection;
        return selection && selection.start.blockId === blockId && selection.start.offset === start && selection.end.offset === end;
    }, target);
    await page.waitForFunction(() => !document.querySelector('[data-reader-selection-toolbar]').hidden);
    await page.click('[data-reader-selection-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-reader-transfer-dialog]').open);
    await page.selectOption('[data-reader-transfer-scope]', 'selection');
    const previousEnvelopeId = await page.evaluate(() => readerState.transferLastEnvelopeId);
    await page.click(`[data-reader-transfer-destination="${destination}"]`);
    await page.waitForFunction((previous) => readerState.transferLastEnvelopeId && readerState.transferLastEnvelopeId !== previous, previousEnvelopeId);
    await page.waitForFunction((target) => document.getElementById('desktop-root').dataset.view === target, destination);
    await page.waitForFunction((target) => !document.querySelector(`[data-reader-source-bar="${target}"]`).hidden, destination);
    const result = await page.evaluate(async () => {
        const envelopeId = readerState.transferLastEnvelopeId;
        const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
        return {
            transfer: payload.transfer,
            selection: structuredClone(readerState.transferSelection),
            summary: `${payload.transfer.envelope.characterCount} 字符`
        };
    });
    await page.click(`[data-reader-source-bar="${destination}"] [data-reader-source-return]`);
    await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
    return result;
}

async function selectReaderStudioSection(page, section) {
    await page.click(`[data-reader-studio-tab="${section}"]`);
    await page.waitForFunction((expected) => (
        document.querySelector(`[data-reader-studio-section="${expected}"]`)?.hidden === false
    ), section);
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-reader-test-'));
    const fixturePath = path.join(dataRoot, 'reader-fixture.md');
    const fontFixturePath = path.join(dataRoot, 'Quiet Serif.woff2');
    let servers = null;
    let browser = null;

    try {
        await fs.writeFile(
            fixturePath,
            [
                '# Chapter One',
                '',
                'First paragraph.',
                '',
                'Second paragraph.',
                '',
                '# Chapter Two',
                '',
                'New chapter content.',
                '',
                ...Array.from({ length: 90 }, (_, index) => `Long reading paragraph ${index + 1}. This text makes the reader content scroll.`)
            ].join('\n'),
            'utf8'
        );
        await fs.writeFile(fontFixturePath, Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 7)]));

        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            revealPath: async () => ''
        });

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.click('[data-view-target="reader"]');
        await page.setInputFiles('[data-reader-file]', fixturePath);
        await page.waitForFunction(() => document.querySelector('[data-reader-import-dialog]').open);
        await page.click('[data-reader-import-confirm]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter One'));
        await page.evaluate(() => {
            let current = null;
            let timer = null;
            const voices = [{ name: 'Reader Test Voice', lang: 'zh-CN' }];
            const speech = {
                speaking: false,
                paused: false,
                getVoices: () => voices,
                addEventListener: () => {},
                speak: (next) => {
                    current = next;
                    speech.speaking = true;
                    speech.paused = false;
                    window.__readerTtsUtterances = window.__readerTtsUtterances || [];
                    window.__readerTtsUtterances.push(next.text);
                    next.onstart?.();
                    timer = window.setTimeout(() => {
                        if (speech.paused || current !== next) return;
                        speech.speaking = false;
                        next.onend?.();
                    }, 30);
                },
                pause: () => { speech.paused = true; },
                resume: () => {
                    speech.paused = false;
                    if (current && speech.speaking) {
                        window.clearTimeout(timer);
                        timer = window.setTimeout(() => {
                            speech.speaking = false;
                            current.onend?.();
                        }, 30);
                    }
                },
                cancel: () => {
                    window.clearTimeout(timer);
                    current = null;
                    speech.speaking = false;
                    speech.paused = false;
                }
            };
            function ReaderTestUtterance(text) { this.text = text; }
            Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
            Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: ReaderTestUtterance });
            window.initializeReaderTts();
        });
        await page.click('[data-reader-tts-toggle]');
        await page.waitForFunction(() => readerState.tts.status === 'speaking' && readerState.tts.blockId);
        assert.ok(await page.evaluate(() => window.__readerTtsUtterances.length > 0), 'Reader TTS should create a local utterance');
        await page.click('[data-reader-tts-toggle]');
        await page.waitForFunction(() => readerState.tts.status === 'paused');
        await page.click('[data-reader-tts-toggle]');
        await page.waitForFunction(() => readerState.tts.status === 'speaking');
        await page.evaluate(() => {
            readerState.transferSelection = { start: { blockId: 'block-1' } };
            document.dispatchEvent(new Event('selectionchange'));
        });
        await page.waitForFunction(() => readerState.tts.status === 'paused');
        await page.click('[data-reader-tts-stop]');
        await page.waitForFunction(() => readerState.tts.status === 'stopped');
        await page.evaluate(() => { readerState.transferSelection = null; document.dispatchEvent(new Event('selectionchange')); });
        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'tts');
        await page.selectOption('[data-reader-tts-voice]', 'Reader Test Voice');
        await page.fill('[data-reader-tts-rate]', '1.4');
        await page.fill('[data-reader-tts-volume]', '0.7');
        await page.fill('[data-reader-tts-paragraph-pause]', '500');
        await page.selectOption('[data-reader-tts-timer]', '10');
        await page.locator('[data-reader-tts-auto-advance]').uncheck();
        await page.waitForFunction(() => readerState.tts.settings.voiceName === 'Reader Test Voice'
            && readerState.tts.settings.rate === 1.4
            && readerState.tts.settings.volume === 0.7
            && readerState.tts.settings.paragraphPauseMs === 500
            && readerState.tts.settings.timerMinutes === 10
            && readerState.tts.settings.autoAdvance === false);
        await page.click('[data-reader-settings-close]');
        await page.click('[data-reader-library-toggle]');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-card');
        assert.ok(await page.locator('[data-reader-library] input[aria-label="搜索书库"]').count(), 'Reader library should expose a search control');
        const firstLibraryCard = page.locator('[data-reader-library] .desktop-reader-library-card').first();
        await firstLibraryCard.getByRole('button', { name: '详情' }).click();
        await page.waitForFunction(() => document.querySelector('[data-reader-detail-dialog]')?.open === true);
        await page.waitForFunction(() => document.querySelector('[data-reader-detail-body]')?.textContent.includes('章节'));
        const detailText = await page.locator('[data-reader-detail-body]').innerText();
        assert.ok(detailText.includes('章节') && detailText.includes('版本'), 'book detail should expose metadata and chapter summary');
        assert.ok(!detailText.includes('First paragraph.'), 'book detail must not expose chapter prose');
        await page.click('[data-reader-detail-close]');
        await firstLibraryCard.getByRole('button', { name: '收藏' }).click();
        await page.waitForFunction(() => document.querySelector('[data-reader-library] .desktop-reader-library-card button[aria-pressed="true"]'));
        await page.click('[data-reader-left-close]');

        const initial = await page.evaluate(() => ({
            title: document.querySelector('[data-reader-title]').textContent,
            source: document.querySelector('[data-reader-source]').textContent,
            chapters: Array.from(document.querySelectorAll('.desktop-reader-chapter')).map((item) => item.textContent),
            progress: document.querySelector('[data-reader-progress-percent]').textContent,
            body: document.querySelector('[data-reader-content]').textContent
        }));
        assert.strictEqual(initial.title, 'Chapter One', 'reader should show the first detected chapter');
        assert.ok(initial.source.includes('reader-fixture'), 'reader should show the imported file title');
        assert.deepStrictEqual(initial.chapters, ['Chapter One', 'Chapter Two'], 'reader should detect markdown chapters');
        assert.strictEqual(initial.progress, '0%', 'reader progress should start at the beginning of the book');
        assert.ok(initial.body.includes('First paragraph.') && initial.body.includes('Second paragraph.'), 'reader should render chapter paragraphs');
        assert.strictEqual(await page.locator('[data-reader-quick-theme]').inputValue(), 'ink', 'legacy dark preference should map to a visible quick theme');

        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent !== '0%');
        assert.ok(Number.parseInt(await page.locator('[data-reader-progress-percent]').innerText(), 10) > 0, 'reader progress should update on chapter change');

        await page.click('[data-reader-settings-toggle]');
        assert.strictEqual(await page.locator('[data-reader-settings-drawer]').getAttribute('aria-hidden'), 'false', 'settings drawer should open from the reading stage');
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-reader-settings-close]'));
        await page.selectOption('[data-reader-appearance-profile]', 'paper');
        await page.waitForFunction(() => readerState.appearanceProfileId === 'paper' && readerState.theme === 'paper');
        await selectReaderStudioSection(page, 'font');
        await page.setInputFiles('[data-reader-font-file]', fontFixturePath);
        await page.waitForFunction(() => document.querySelectorAll('[data-reader-font-list] [data-reader-font-item], .desktop-reader-font-item').length === 1);
        const userFontId = await page.locator('[data-reader-font-family] option[data-reader-user-font]').first().getAttribute('value');
        assert.ok(userFontId && userFontId.startsWith('user:'), 'installed font should receive a stable user fontId');
        await page.selectOption('[data-reader-font-family]', userFontId);
        try {
            await page.waitForFunction((fontId) => readerState.fontId === fontId, userFontId);
        } catch (error) {
            const fontState = await page.evaluate(() => ({
                fontId: readerState.fontId,
                fontFamily: readerState.fontFamily,
                value: document.querySelector('[data-reader-font-family]')?.value,
                options: Array.from(document.querySelectorAll('[data-reader-font-family] option')).map((option) => ({ value: option.value, id: option.dataset.readerFontId }))
            }));
            throw new Error(`user font selection did not persist: ${JSON.stringify(fontState)}; ${error.message}`);
        }
        const fontCatalog = await page.evaluate(async () => {
            const catalog = await (await fetch('/api/reader/fonts')).json();
            const file = await fetch(`/api/reader/fonts/file?fontId=${encodeURIComponent(readerState.fontId)}`);
            return { catalog, fileStatus: file.status, fileBytes: (await file.arrayBuffer()).byteLength };
        });
        assert.ok(fontCatalog.catalog.catalog.entries.some((entry) => entry.fontId === userFontId), 'font catalog should expose installed user font');
        assert.strictEqual(fontCatalog.fileStatus, 200, 'installed font file should be served locally');
        assert.ok(fontCatalog.fileBytes > 4, 'installed font file should retain its bytes');
        await page.evaluate(() => { window.confirm = () => true; });
        await page.locator('.desktop-reader-font-item').first().getByRole('button', { name: '删除' }).click();
        await page.waitForFunction((fontId) => !Array.from(document.querySelectorAll('[data-reader-font-family] option')).some((option) => option.value === fontId), userFontId);
        await page.waitForFunction(() => readerState.fontId === 'builtin:default');
        await page.selectOption('[data-reader-font-family]', 'serif');
        await selectReaderStudioSection(page, 'typography');
        await page.fill('[data-reader-font-size]', '22');
        await page.fill('[data-reader-line-height]', '2');
        await page.fill('[data-reader-width]', '840');
        await page.fill('[data-reader-paragraph-spacing]', '1.3');
        await selectReaderStudioSection(page, 'paper');
        await page.selectOption('select[data-reader-theme]', 'paper');
        await page.selectOption('[data-reader-paper-material]', 'grain');
        await page.locator('input[data-reader-paper-shadow]').setChecked(false);
        await page.locator('input[data-reader-paper-vignette]').setChecked(false);
        await selectReaderStudioSection(page, 'typography');
        await page.locator('[data-reader-indent]').setChecked(false);
        await selectReaderStudioSection(page, 'page');
        await page.selectOption('[data-reader-status-bar-mode]', 'visible');
        await page.locator('[data-reader-status-field][value="characters"]').setChecked(true);
        await page.locator('[data-reader-status-field][value="eta"]').setChecked(true);
        await page.waitForFunction(() => readerState.statusBarMode === 'visible'
            && readerState.statusBarFields.includes('characters')
            && readerState.statusBarFields.includes('eta'));
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = content.scrollHeight - content.clientHeight;
            requestAnimationFrame(() => content.dispatchEvent(new Event('scroll')));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-progress-percent]').textContent !== '0%');
        await page.waitForFunction(() => document.querySelector('[data-reader-status-bar]').textContent.includes('已读')
            && document.querySelector('[data-reader-status-bar]').textContent.includes('预计剩余'));
        const statusBarText = await page.locator('[data-reader-status-bar]').innerText();
        assert.ok(statusBarText.includes('已读') && statusBarText.includes('预计剩余'), 'reader status bar should expose selected progress fields');
        await page.waitForFunction(() => readerState.fontSize === 22 && readerState.lineHeight === 2 && readerState.textWidth === 840 && readerState.paragraphSpacing === 1.3);
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('全局设置已保存'));
        const settings = await page.evaluate(() => {
            const panel = document.querySelector('[data-reader-theme-panel]');
            return Promise.all([
                fetch('/api/reader/preferences').then((response) => response.json()),
                fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json())
            ]).then(([globalPayload, statePayload]) => ({
                theme: panel.dataset.readerTheme,
                indent: panel.dataset.readerIndentEnabled,
                fontSize: panel.style.getPropertyValue('--reader-font-size'),
                lineHeight: panel.style.getPropertyValue('--reader-line-height'),
                textWidth: panel.style.getPropertyValue('--reader-width'),
                paragraphSpacing: panel.style.getPropertyValue('--reader-paragraph-spacing'),
                fontFamily: panel.style.getPropertyValue('--reader-font-family'),
                 material: panel.dataset.readerMaterial,
                 shadow: panel.dataset.readerPaperShadow,
                 vignette: panel.dataset.readerVignette,
                 statusMode: readerState.statusBarMode,
                 statusFields: readerState.statusBarFields,
                progress: document.querySelector('[data-reader-progress-percent]').textContent,
                global: globalPayload.record.preferences,
                state: statePayload.state || {},
                saved: localStorage.getItem('draftharbor:desktop:reader')
            }));
        });
        assert.strictEqual(settings.theme, 'paper', 'reader theme should apply to the panel');
        assert.strictEqual(settings.indent, 'false', 'reader indent toggle should apply to the panel');
        assert.strictEqual(settings.fontSize, '22px', 'reader font size should update the panel CSS variable');
        assert.strictEqual(settings.lineHeight, '2', 'reader line height should update the panel CSS variable');
        assert.strictEqual(settings.textWidth, '840px', 'reader width should update the panel CSS variable');
        assert.strictEqual(settings.paragraphSpacing, '1.3em', 'reader paragraph spacing should update the panel CSS variable');
        assert.ok(settings.fontFamily.includes('SimSun'), 'reader font family should update the panel CSS variable');
        assert.strictEqual(settings.material, 'grain', 'reader grain material should apply to the stage');
        assert.strictEqual(settings.shadow, 'false', 'reader paper shadow switch should apply to the stage');
        assert.strictEqual(settings.vignette, 'false', 'reader vignette switch should apply to the stage');
        assert.ok(Number.parseInt(settings.progress, 10) > 0, 'reader progress should advance after scrolling down');
        assert.strictEqual(settings.global.themeId, 'paper', 'reader settings should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.textWidth, 840, 'reader width should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.indent, false, 'reader indent preference should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.paperMaterial, 'grain', 'reader material should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.paperShadow, false, 'reader shadow preference should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.paperVignette, false, 'reader vignette preference should be persisted in the global Reader preferences');
        assert.strictEqual(settings.global.statusBarMode, 'visible', 'status bar visibility should be persisted in the global Reader preferences');
        assert.ok(settings.global.statusBarFields.includes('characters') && settings.global.statusBarFields.includes('eta'), 'status bar field selection should be persisted in the global Reader preferences');
        assert.ok(settings.state && typeof settings.state === 'object', 'Reader Store state endpoint should remain available');
        assert.strictEqual(settings.saved, null, 'authoritative Reader Store flow must not mirror prose into localStorage');

        await selectReaderStudioSection(page, 'font');
        await page.click('[data-reader-font-help]');
        await page.waitForFunction(() => document.querySelector('[data-reader-font-dialog]').open);
        await page.click('[data-reader-font-close]');
        await page.waitForFunction(() => !document.querySelector('[data-reader-font-dialog]').open);
        await page.click('[data-reader-settings-close]');
        await page.click('[data-reader-focus-toggle]');
        await page.waitForFunction(() => {
            const shell = document.querySelector('[data-reader-shell]');
            return shell.dataset.readerControlsVisible === 'false'
                && shell.dataset.readerHudState === 'hidden'
                && document.getElementById('desktop-root').dataset.readerFocusMode === 'true';
        });
        const focusedShell = await page.evaluate(() => ({
            railVisibility: getComputedStyle(document.querySelector('.desktop-rail')).visibility,
            chromeDisplay: getComputedStyle(document.querySelector('.desktop-main > .desktop-topbar')).display,
            activeIsContent: document.activeElement === document.querySelector('[data-reader-content]')
        }));
        assert.strictEqual(focusedShell.railVisibility, 'hidden', 'Reader focus mode should collapse the global navigation rail');
        assert.strictEqual(focusedShell.chromeDisplay, 'none', 'Reader focus mode should collapse the global title bar');
        assert.strictEqual(focusedShell.activeIsContent, true, 'hiding Reader HUD must restore focus to the reading content');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerControlsVisible === 'true');
        await page.click('[data-reader-focus-toggle]');
        await page.waitForFunction(() => {
            const root = document.getElementById('desktop-root');
            return root.dataset.readerFocusMode === 'false'
                && getComputedStyle(document.querySelector('.desktop-rail')).visibility !== 'hidden'
                && getComputedStyle(document.querySelector('.desktop-main > .desktop-topbar')).display !== 'none';
        });

        await page.evaluate(() => {
            document.querySelector('[data-reader-content]').focus();
            readerState.hudMode = 'auto';
            window.readerHudShow();
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerHudState === 'hidden', null, { timeout: 9000 });
        await page.mouse.move(520, 390);
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerHudState === 'visible');

        await page.evaluate(async () => {
            const expectedChapterId = readerState.activeChapterId;
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                const payload = await fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json());
                if (payload.state && payload.state.positionLocator && payload.state.positionLocator.chapterId === expectedChapterId) return;
                await new Promise((resolve) => window.setTimeout(resolve, 50));
            }
            throw new Error('reader chapter position was not persisted before reload');
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        assert.strictEqual(await page.locator('[data-reader-title]').innerText(), '选择一本书开始阅读', 'reopening Reader should land on the library surface');
        await page.click('[data-reader-library] .desktop-reader-library-card .desktop-secondary-action');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('Chapter Two'));
        assert.ok(Number.parseInt(await page.locator('[data-reader-progress-percent]').innerText(), 10) > 0, 'reader should restore the persisted chapter and progress after reload');
        await page.click('[data-reader-prev]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('Chapter One'));
        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]')?.textContent.includes('Chapter Two'));
        assert.ok(Number.parseInt(await page.locator('[data-reader-progress-percent]').innerText(), 10) > 0, 'reader should advance progress after returning to the restored chapter');
        const formalLibrary = await page.evaluate(async () => (await fetch('/api/reader/documents')).json());
        assert.strictEqual(formalLibrary.documents.length, 1, 'confirmed file import should enter the Reader Store once');

        await page.click('[data-reader-library-toggle]');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.waitForFunction(() => readerState.apiMode === true);
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]').getAttribute('aria-hidden') === 'false');
        await page.click('[data-reader-library] .desktop-reader-library-card .desktop-secondary-action');
        await page.waitForFunction(() => document.querySelectorAll('[data-reader-block]').length > 0 && !document.querySelector('[data-reader-shell]').dataset.readerDrawer);
        const apiReader = await page.evaluate(() => ({
            apiMode: readerState.apiMode,
            activeDocumentId: readerState.activeDocumentId,
            renderedBlocks: document.querySelectorAll('[data-reader-block]').length,
            drawer: document.querySelector('[data-reader-shell]').dataset.readerDrawer || ''
        }));
        assert.strictEqual(apiReader.apiMode, true, 'library selection should switch to the authoritative Reader Store flow');
        assert.ok(apiReader.activeDocumentId, 'library selection should set the active document id');
        assert.ok(apiReader.renderedBlocks > 0, 'Reader Store flow should render chapter blocks');
        assert.strictEqual(apiReader.drawer, '', 'selecting a library document should return focus to the reading stage');

        const annotationTarget = await page.evaluate(() => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.textContent.length >= 8);
            const start = Number(fragment.dataset.readerStartOffset);
            return { blockId: fragment.dataset.readerBlock, start, end: start + 5 };
        });
        await page.evaluate(({ blockId, start, end }) => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.dataset.readerBlock === blockId);
            const textNode = fragment.firstChild;
            const range = document.createRange();
            range.setStart(textNode, start - Number(fragment.dataset.readerStartOffset));
            range.setEnd(textNode, end - Number(fragment.dataset.readerStartOffset));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }, annotationTarget);
        await page.waitForFunction(({ blockId, start, end }) => readerState.transferSelection
            && readerState.transferSelection.start.blockId === blockId
            && readerState.transferSelection.start.offset === start
            && readerState.transferSelection.end.offset === end, annotationTarget);
        await page.click('[data-reader-selection-highlight]');
        await page.waitForFunction(() => readerState.annotations.length === 1);
        await page.waitForFunction(() => document.querySelectorAll('[data-reader-content] .desktop-reader-annotation-mark').length > 0);
        assert.ok(await page.evaluate(() => readerState.annotations[0].excerpt.includes('New c')), 'annotations should retain a readable excerpt when toolbar focus clears the DOM selection');
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="annotations"]');
        assert.strictEqual(await page.locator('[data-reader-annotations] .desktop-reader-annotation').count(), 1, 'annotation navigation should list saved highlights');
        await page.click('[data-reader-left-close]');

        const noteTarget = await page.evaluate(() => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.textContent.length >= 8 && !node.querySelector('mark'));
            const start = Number(fragment.dataset.readerStartOffset);
            return { blockId: fragment.dataset.readerBlock, start, end: start + 5 };
        });
        await page.evaluate(({ blockId, start, end }) => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.dataset.readerBlock === blockId);
            const textNode = fragment.firstChild;
            const range = document.createRange();
            range.setStart(textNode, start - Number(fragment.dataset.readerStartOffset));
            range.setEnd(textNode, end - Number(fragment.dataset.readerStartOffset));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }, noteTarget);
        await page.waitForFunction(() => !document.querySelector('[data-reader-selection-toolbar]').hidden);
        await page.click('[data-reader-selection-note]');
        await page.waitForFunction(() => document.querySelector('[data-reader-annotation-dialog]').open);
        await page.selectOption('[data-reader-annotation-dialog] [data-reader-annotation-color]', 'blue');
        await page.fill('[data-reader-annotation-dialog] [data-reader-annotation-note]', '这里需要回看上下文');
        await page.click('[data-reader-annotation-dialog] [data-reader-annotation-save]');
        await page.waitForFunction(() => readerState.annotations.length === 2);
        const noteAnnotation = await page.evaluate(() => readerState.annotations.find((annotation) => annotation.type === 'note'));
        assert.strictEqual(noteAnnotation.color, 'blue', 'note annotation should persist its selected color');
        assert.strictEqual(noteAnnotation.note, '这里需要回看上下文', 'note annotation should persist its note text');
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="history"]');
        await page.waitForFunction(() => readerState.historyItems.length > 0 && document.querySelectorAll('[data-reader-history] .desktop-reader-history-item').length > 0);
        assert.strictEqual(await page.locator('[data-reader-history-back]').isDisabled(), false, 'history should expose a back action after navigation');
        await page.click('[data-reader-left-close]');

        await page.click('[data-reader-prev]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter One'));
        await page.click('[data-reader-next]');
        await page.waitForFunction(() => document.querySelector('[data-reader-title]').textContent.includes('Chapter Two'));
        await page.evaluate(() => {
            const control = document.querySelector('[data-reader-layout-mode]');
            control.value = 'flow';
            control.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'flow');

        const selectionTarget = await page.evaluate(() => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.textContent.length >= 8);
            const start = Number(fragment.dataset.readerStartOffset);
            return { blockId: fragment.dataset.readerBlock, start, end: start + 5 };
        });
        await page.evaluate(({ blockId, start, end }) => {
            const fragment = Array.from(document.querySelectorAll('[data-reader-block]')).find((node) => node.dataset.readerBlock === blockId);
            const nodes = [];
            const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) nodes.push(walker.currentNode);
            const localStart = start - Number(fragment.dataset.readerStartOffset);
            const localEnd = end - Number(fragment.dataset.readerStartOffset);
            let cursor = 0;
            let startNode;
            let endNode;
            let startOffset = 0;
            let endOffset = 0;
            nodes.forEach((node) => {
                const next = cursor + node.nodeValue.length;
                if (!startNode && localStart >= cursor && localStart <= next) {
                    startNode = node;
                    startOffset = localStart - cursor;
                }
                if (!endNode && localEnd >= cursor && localEnd <= next) {
                    endNode = node;
                    endOffset = localEnd - cursor;
                }
                cursor = next;
            });
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__readerCopiedText = value; } } });
        }, selectionTarget);
        await page.waitForFunction(({ blockId, start, end }) => readerState.transferSelection
            && readerState.transferSelection.start.blockId === blockId
            && readerState.transferSelection.start.offset === start
            && readerState.transferSelection.end.offset === end, selectionTarget);
        await page.click('[data-reader-selection-copy]');
        await page.waitForFunction(() => window.__readerCopiedText === readerState.transferSelection.text);
        assert.strictEqual(await page.evaluate(() => readerState.transferSelection !== null), true, 'copy should preserve the normalized selection for later transfer');
        const flowTransfer = await createReaderSelectionTransfer(page, 'flow', 'writer', selectionTarget);
        const singleTransfer = await createReaderSelectionTransfer(page, 'single-page', 'compendium', selectionTarget);
        const doubleTransfer = await createReaderSelectionTransfer(page, 'double-page', 'workflow', selectionTarget);
        const transferIdentity = (result) => ({
            text: result.transfer.text,
            textDigest: result.transfer.snapshot.textDigest,
            start: result.selection.start,
            end: result.selection.end
        });
        assert.deepStrictEqual(transferIdentity(singleTransfer), transferIdentity(flowTransfer), 'single-page selection must create the same locator and snapshot text as flow mode');
        assert.deepStrictEqual(transferIdentity(doubleTransfer), transferIdentity(flowTransfer), 'double-page selection must create the same locator and snapshot text as flow mode');
        assert.ok(flowTransfer.summary.includes('5'), 'selection confirmation should report the selected character count');

        await page.route('**/api/reader/transfer/range', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'forced failure' }) }));
        await page.click('[data-reader-selection-confirm]');
        const positionBeforeFailedTransfer = await page.evaluate(() => ({
            pageIndex: readerState.pageIndex,
            selection: structuredClone(readerState.transferSelection)
        }));
        await page.click('[data-reader-transfer-destination="writer"]');
        await page.waitForFunction(() => document.querySelector('[data-reader-transfer-status]').textContent.includes('范围和阅读位置已保留'));
        const positionAfterFailedTransfer = await page.evaluate(() => ({
            pageIndex: readerState.pageIndex,
            selection: structuredClone(readerState.transferSelection),
            dialogOpen: document.querySelector('[data-reader-transfer-dialog]').open
        }));
        assert.deepStrictEqual(positionAfterFailedTransfer.selection, positionBeforeFailedTransfer.selection, 'failed transfer must preserve the normalized selection');
        assert.strictEqual(positionAfterFailedTransfer.pageIndex, positionBeforeFailedTransfer.pageIndex, 'failed transfer must preserve the reading page');
        assert.strictEqual(positionAfterFailedTransfer.dialogOpen, true, 'failed transfer must keep confirmation open for retry');
        await page.unroute('**/api/reader/transfer/range');
        await page.click('[data-reader-transfer-close]');

        await page.click('[data-reader-selection-toggle]');
        await page.selectOption('[data-reader-transfer-scope]', 'document');
        const documentSummary = await page.locator('[data-reader-transfer-counts]').textContent();
        assert.ok(documentSummary.includes('2 章'), 'document confirmation should report its chapter count');
        const previousDocumentEnvelope = await page.evaluate(() => readerState.transferLastEnvelopeId);
        await page.click('[data-reader-transfer-destination="workflow"]');
        await page.waitForFunction((previous) => readerState.transferLastEnvelopeId !== previous, previousDocumentEnvelope);
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'workflow');
        const documentLeakage = await page.evaluate(async () => {
            const envelopeId = readerState.transferLastEnvelopeId;
            const payload = await (await fetch(`/api/reader/transfer?envelopeId=${encodeURIComponent(envelopeId)}`)).json();
            return {
                text: payload.transfer.text,
                domText: document.querySelector('[data-reader-content]').textContent,
                url: location.href,
                localStorage: JSON.stringify(localStorage),
                historyState: JSON.stringify(history.state)
            };
        });
        assert.ok(documentLeakage.text.includes('First paragraph.') && documentLeakage.text.includes('Long reading paragraph 90.'), 'document scope should freeze chapters that are not mounted together in the reader DOM');
        assert.ok(!documentLeakage.domText.includes('First paragraph.'), 'inactive chapter prose should remain outside the mounted reader DOM');
        assert.ok(!documentLeakage.url.includes('First paragraph.'), 'snapshot prose must not enter the route');
        assert.ok(!documentLeakage.localStorage.includes('First paragraph.'), 'snapshot prose must not enter localStorage');
        assert.ok(!documentLeakage.historyState.includes('First paragraph.'), 'snapshot prose must not enter browser history state');
        await page.click('[data-reader-source-bar="workflow"] [data-reader-source-return]');
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
        await page.evaluate(() => {
            const control = document.querySelector('[data-reader-layout-mode]');
            control.value = 'flow';
            control.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'flow');

        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="search"]');
        await page.evaluate(() => {
            window.__readerSearchFetch = window.fetch;
            window.fetch = (...args) => String(args[0]).includes('/api/reader/chapter')
                ? new Promise((resolve, reject) => window.setTimeout(() => window.__readerSearchFetch(...args).then(resolve, reject), 80))
                : window.__readerSearchFetch(...args);
        });
        await page.fill('[data-reader-search-input]', 'Long reading paragraph');
        await page.click('[data-reader-search-submit]');
        await page.waitForFunction(() => readerState.searchStatus === 'running');
        await page.click('[data-reader-search-cancel]');
        await page.waitForFunction(() => readerState.searchStatus === 'cancelled');
        const cancelledCount = await page.evaluate(() => readerState.searchResults.length);
        await page.waitForTimeout(250);
        assert.strictEqual(await page.evaluate(() => readerState.searchResults.length), cancelledCount, 'cancelled search must not append late chapter results');
        await page.evaluate(() => { window.fetch = window.__readerSearchFetch; });
        await page.fill('[data-reader-search-input]', 'First paragraph');
        await page.click('[data-reader-search-submit]');
        await page.fill('[data-reader-search-input]', 'New chapter content');
        await page.click('[data-reader-search-submit]');
        await page.waitForFunction(() => readerState.searchStatus === 'complete');
        const searchState = await page.evaluate(() => ({
            query: readerState.searchQuery,
            count: readerState.searchResults.length,
            excerpts: readerState.searchResults.map((result) => result.excerpt)
        }));
        assert.strictEqual(searchState.query, 'New chapter content', 'latest search request must own the result list');
        assert.strictEqual(searchState.count, 1, 'literal search should return the matching block once');
        assert.ok(searchState.excerpts.every((excerpt) => excerpt.includes('New chapter content')), 'cancelled search results must not arrive late');
        await page.click('[data-reader-search-results] .desktop-reader-search-result');
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[1].chapterId);

        await page.click('[data-reader-add-bookmark]');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks.length === 1);
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="bookmarks"]');
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="exact"]').count(), 1, 'new bookmarks should resolve exactly in the active revision');
        await page.fill('.desktop-reader-bookmark-controls input', 'Harbor checkpoint');
        await page.selectOption('.desktop-reader-bookmark-controls select:nth-of-type(1)', 'blue');
        await page.selectOption('.desktop-reader-bookmark-controls select:nth-of-type(2)', '重要');
        await page.fill('.desktop-reader-bookmark-controls textarea', '回看这一段的伏笔');
        await page.click('.desktop-reader-bookmark-controls .desktop-secondary-action');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks[0].title === 'Harbor checkpoint'
            && readerState.documentRecordState.bookmarks[0].color === 'blue'
            && readerState.documentRecordState.bookmarks[0].category === '重要'
            && readerState.documentRecordState.bookmarks[0].note === '回看这一段的伏笔');
        await page.click('[data-reader-left-close]');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.click('[data-reader-library] .desktop-reader-library-card .desktop-secondary-action');
        await page.waitForFunction(() => readerState.apiMode && readerState.documentRecordState && readerState.documentRecordState.bookmarks.length === 1);
        await page.click('[data-reader-library-toggle]');
        await page.click('[data-reader-tab="bookmarks"]');
        assert.strictEqual(await page.locator('.desktop-reader-bookmark-open strong').innerText(), 'Harbor checkpoint', 'bookmark edits should survive reload');
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="exact"]').count(), 1, 'persisted bookmarks should retain exact accuracy in the same revision');
        assert.strictEqual(await page.locator('.desktop-reader-bookmark-open').getAttribute('data-reader-bookmark-color'), 'blue', 'bookmark color should survive reload');
        assert.strictEqual(await page.locator('.desktop-reader-bookmark-meta').innerText().then((text) => text.includes('重要')), true, 'bookmark category should survive reload');
        assert.strictEqual(await page.locator('.desktop-reader-bookmark-controls textarea').inputValue(), '回看这一段的伏笔', 'bookmark note should survive reload');
        await page.evaluate(async () => {
            window.__readerOriginalBookmark = structuredClone(readerState.documentRecordState.bookmarks[0]);
            readerState.documentRecordState.bookmarks[0].locator.revisionId = 'older-revision';
            await refreshReaderBookmarkResolutions();
        });
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="approximate"]').count(), 1, 'a changed revision should expose approximate bookmark recovery');
        await page.evaluate(async () => {
            const bookmark = readerState.documentRecordState.bookmarks[0];
            bookmark.locator.blockId = 'missing-block';
            bookmark.locator.quote = { exact: '', prefix: '', suffix: '' };
            bookmark.locator.blockDigest = '';
            bookmark.locator.contextBlockDigests = { previous: '', next: '' };
            bookmark.locator.projectRef = {};
            await refreshReaderBookmarkResolutions();
        });
        assert.strictEqual(await page.locator('[data-reader-bookmark-accuracy="unresolved"]').count(), 1, 'unresolvable bookmarks should require confirmation instead of silently guessing');
        await page.evaluate(async () => {
            await persistReaderNavigationState([window.__readerOriginalBookmark]);
            await refreshReaderBookmarkResolutions();
        });
        await page.click('[data-reader-left-close]');

        await page.evaluate(async () => {
            const target = readerState.contents[1] || readerState.contents[0];
            await loadReaderWorkspaceChapter(target.chapterId);
        });
        const flowAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset };
        });
        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'scheme');
        await page.selectOption('[data-reader-preference-scope]', 'document');
        await selectReaderStudioSection(page, 'page');
        await page.selectOption('[data-reader-layout-mode]', 'single-page');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page' && readerState.pages.length > 2);
        const singleAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset, pageCount: readerState.pages.length };
        });
        assert.deepStrictEqual({ blockId: singleAnchor.blockId, offset: singleAnchor.offset }, flowAnchor, 'flow to single-page must preserve the shared locator');
        assert.ok(singleAnchor.pageCount > 2, 'long chapters should create multiple temporary pages');
        await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            for (const key of readerState.layoutCache.keys()) readerState.layoutCache.set(key, { corrupt: true });
            renderReaderReading({ locator });
        });
        assert.ok(await page.evaluate(() => readerState.pages.length) > 2, 'corrupt pagination cache must rebuild from the authoritative chapter');

        const preferenceAnchor = await page.evaluate(() => captureReaderPositionLocator());
        await selectReaderStudioSection(page, 'typography');
        await page.fill('[data-reader-letter-spacing]', '0.06');
        await page.fill('[data-reader-page-margin]', '64');
        await page.fill('[data-reader-width]', '900');
        await page.selectOption('[data-reader-text-align]', 'justify');
        await selectReaderStudioSection(page, 'font');
        await page.selectOption('[data-reader-font-family]', 'kai');
        await selectReaderStudioSection(page, 'paper');
        await page.selectOption('select[data-reader-theme]', 'sepia');
        await selectReaderStudioSection(page, 'motion');
        await page.selectOption('[data-reader-page-transition]', 'cover');
        await page.waitForFunction(() => readerEffectiveTransition() === 'cover');
        await page.selectOption('[data-reader-page-transition]', 'slide');
        await page.selectOption('[data-reader-reduced-motion]', 'reduce');
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('本书设置已保存'));
        const scopedPreferences = await page.evaluate(async () => {
            const [globalPayload, statePayload] = await Promise.all([
                fetch('/api/reader/preferences').then((response) => response.json()),
                fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json())
            ]);
            return {
                globalTheme: globalPayload.record.preferences.themeId,
                overrides: statePayload.state.preferenceOverrides,
                locator: captureReaderPositionLocator()
            };
        });
        assert.notStrictEqual(scopedPreferences.globalTheme, 'sepia', 'per-book changes must not overwrite global preferences');
        assert.strictEqual(scopedPreferences.overrides.themeId, 'sepia', 'per-book theme override should be authoritative');
        assert.strictEqual(scopedPreferences.overrides.fontFamilyId, 'kai', 'stable font family id should persist per book');
        assert.strictEqual(scopedPreferences.overrides.letterSpacing, 0.06, 'letter spacing should persist per book');
        assert.strictEqual(scopedPreferences.overrides.pageMargin, 64, 'page margin should persist per book');
        assert.strictEqual(scopedPreferences.overrides.textWidth, 900, 'text width should persist per book');
        assert.deepStrictEqual(
            { blockId: scopedPreferences.locator.blockId, offset: scopedPreferences.locator.offset },
            { blockId: preferenceAnchor.blockId, offset: preferenceAnchor.offset },
            'typography changes must preserve the shared locator'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-reader-left-drawer]')?.getAttribute('aria-hidden') === 'false');
        await page.waitForSelector('[data-reader-library] .desktop-reader-library-item');
        await page.click('[data-reader-library] .desktop-reader-library-card .desktop-secondary-action');
        await page.waitForFunction(() => readerState.apiMode && readerState.preferenceScope === 'document' && readerState.theme === 'sepia');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page');
        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'font');
        assert.strictEqual(await page.locator('[data-reader-font-family]').inputValue(), 'kai', 'per-book font override should survive reload');
        await selectReaderStudioSection(page, 'typography');
        assert.strictEqual(await page.locator('[data-reader-page-margin]').inputValue(), '64', 'per-book page margin should survive reload');
        assert.strictEqual(await page.locator('[data-reader-width]').inputValue(), '900', 'per-book text width should survive reload');
        await page.click('[data-reader-settings-close]');

        const reducedMotionPage = await page.evaluate(() => readerState.pageIndex);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction((previous) => readerState.pageIndex > previous, reducedMotionPage);
        const reducedMotionResult = await page.evaluate(() => ({
            transition: readerEffectiveTransition(),
            motion: document.querySelector('[data-reader-theme-panel]').dataset.readerMotion,
            animationName: getComputedStyle(document.querySelector('.desktop-reader-page-deck')).animationName
        }));
        assert.strictEqual(reducedMotionResult.transition, 'none', 'reduced motion must downgrade page transitions to none');
        assert.strictEqual(reducedMotionResult.motion, 'reduce', 'explicit reduced-motion preference should be visible on the stage');
        assert.strictEqual(reducedMotionResult.animationName, 'none', 'reduced motion must not translate or simulate a page turn');
        await page.waitForFunction(() => !document.querySelector('.desktop-reader-page-deck')?.classList.contains('is-reader-transitioning'));

        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'motion');
        await page.selectOption('[data-reader-reduced-motion]', 'allow');
        await page.click('[data-reader-settings-close]');
        await page.waitForFunction(() => readerState.reducedMotionOverride === false && readerEffectiveTransition() === 'slide');
        const motionKey = await page.evaluate(() => readerState.pageIndex < readerState.pages.length - 1 ? 'ArrowRight' : 'ArrowLeft');
        await page.keyboard.press(motionKey);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-reader-page-deck')).animationName.includes('slide'));
        await page.waitForTimeout(300);

        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'motion');
        await page.selectOption('[data-reader-page-transition]', 'curl');
        await page.click('[data-reader-settings-close]');
        await page.waitForFunction(() => readerState.pageTransition === 'curl' && readerEffectiveTransition() === 'curl');
        const pageFlipRuns = await page.locator('[data-reader-page-flip-host]').getAttribute('data-reader-page-flip-runs');
        const curlKey = await page.evaluate(() => readerState.pageIndex < readerState.pages.length - 1 ? 'ArrowRight' : 'ArrowLeft');
        await page.keyboard.press(curlKey);
        await page.waitForFunction((previousRuns) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipRuns || 0) > Number(previousRuns || 0), pageFlipRuns);
        await page.waitForFunction(() => document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'active'
            && Array.from(document.querySelectorAll('.desktop-reader-page-flip-sheet')).some((sheet) => getComputedStyle(sheet).display !== 'none'));
        const animatedPageStyle = await page.evaluate(() => {
            const source = document.querySelector('[data-reader-content] .desktop-reader-page [data-reader-block]');
            const sheet = Array.from(document.querySelectorAll('.desktop-reader-page-flip-sheet')).find((item) => getComputedStyle(item).display !== 'none');
            const animated = sheet?.querySelector('[data-reader-block]');
            const sourceStyle = getComputedStyle(source);
            const animatedStyle = getComputedStyle(animated);
            return {
                source: [sourceStyle.fontFamily, sourceStyle.fontSize, sourceStyle.fontWeight, sourceStyle.lineHeight, sourceStyle.color],
                animated: [animatedStyle.fontFamily, animatedStyle.fontSize, animatedStyle.fontWeight, animatedStyle.lineHeight, animatedStyle.color],
                background: getComputedStyle(sheet).backgroundColor
            };
        });
        assert.deepStrictEqual(animatedPageStyle.animated, animatedPageStyle.source, 'animated page text must preserve the source font metrics and color');
        assert.ok(!/rgba\([^)]*,\s*(?:0|0?\.\d+)\s*\)$/i.test(animatedPageStyle.background), 'animated page sheet must use an opaque background');
        await page.waitForFunction(() => document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle'
            && document.querySelector('[data-reader-page-flip-host]')?.hidden === true
            && !document.querySelector('[data-reader-content]')?.classList.contains('is-reader-page-flip-active')
            && !document.querySelector('.desktop-reader-page-flip-root'));

        const touchSelectionIndex = await page.evaluate(() => {
            const node = document.querySelector('[data-reader-page] [data-reader-block]');
            const range = document.createRange();
            range.selectNodeContents(node);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return readerState.pageIndex;
        });
        await page.click('[data-reader-touch-next]');
        await page.waitForTimeout(120);
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), touchSelectionIndex, 'text selection must take priority over the touch page-turn zone');
        await page.evaluate(() => window.getSelection().removeAllRanges());
        await page.click('[data-reader-touch-next]');
        await page.waitForFunction((previous) => readerState.pageIndex > previous, touchSelectionIndex);

        await page.evaluate(() => document.querySelector('[data-reader-content]').focus({ preventScroll: true }));
        const wheelPageIndex = await page.evaluate(() => readerState.pageIndex);
        await page.evaluate(() => document.querySelector('[data-reader-content]').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })));
        await page.waitForFunction((previous) => readerState.pageIndex > previous, wheelPageIndex);
        const swipePageIndex = await page.evaluate(() => readerState.pageIndex);
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: 520, clientY: 300, bubbles: true }));
            content.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'touch', clientX: 420, clientY: 304, bubbles: true }));
        });
        await page.waitForFunction((previous) => readerState.pageIndex > previous, swipePageIndex);
        const disabledWheelPageIndex = await page.evaluate(() => {
            readerState.pointerPageTurn = false;
            return readerState.pageIndex;
        });
        await page.evaluate(() => document.querySelector('[data-reader-content]').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })));
        await page.waitForTimeout(120);
        assert.strictEqual(await page.evaluate(() => readerState.pageIndex), disabledWheelPageIndex, 'disabled pointer page turn must suppress wheel input');
        await page.evaluate(() => { readerState.pointerPageTurn = true; });

        await page.evaluate(() => {
            window.__readerStateWrites = 0;
            const originalFetch = window.fetch;
            window.fetch = (...args) => {
                if (String(args[0]).includes('/api/reader/state') && args[1] && args[1].method === 'POST') window.__readerStateWrites += 1;
                return originalFetch(...args);
            };
            queueReaderPageTurn(1);
            queueReaderPageTurn(1);
            queueReaderPageTurn(1);
        });
        await page.waitForFunction(() => readerState.pageIndex >= 3);
        await page.waitForTimeout(700);
        assert.ok(await page.evaluate(() => window.__readerStateWrites) <= 1, 'rapid page turns should merge into at most one authoritative position write');

        const pagedAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset };
        });
        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'page');
        await page.selectOption('[data-reader-layout-mode]', 'double-page');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'double-page');
        const doubleAnchor = await page.evaluate(() => {
            const locator = captureReaderPositionLocator();
            return { blockId: locator.blockId, offset: locator.offset, visiblePages: document.querySelectorAll('[data-reader-page]').length };
        });
        assert.deepStrictEqual({ blockId: doubleAnchor.blockId, offset: doubleAnchor.offset }, pagedAnchor, 'single-page to double-page must preserve the shared locator');
        assert.strictEqual(doubleAnchor.visiblePages, 2, 'double-page mode should render a left-to-right spread');
        await page.click('[data-reader-settings-close]');
        const doubleFlipRuns = Number(await page.locator('[data-reader-page-flip-host]').getAttribute('data-reader-page-flip-runs') || 0);
        const doublePageIndex = await page.evaluate(() => readerState.pageIndex);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((previous) => readerState.pageIndex < previous, doublePageIndex);
        await page.waitForFunction((previousRuns) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipRuns || 0) > previousRuns, doubleFlipRuns);
        await page.waitForFunction(() => document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle');
        const previousFlipRuns = Number(await page.locator('[data-reader-page-flip-host]').getAttribute('data-reader-page-flip-runs') || 0);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction((previous) => readerState.pageIndex === previous, doublePageIndex);
        await page.waitForFunction((previousRuns) => Number(document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipRuns || 0) > previousRuns, previousFlipRuns);
        await page.waitForFunction(() => document.querySelector('[data-reader-page-flip-host]')?.dataset.readerPageFlipState === 'idle'
            && !document.querySelector('.desktop-reader-page-flip-root'));
        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'page');
        await page.selectOption('[data-reader-layout-mode]', 'auto');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'double-page');
        await page.setViewportSize({ width: 720, height: 820 });
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'single-page');
        assert.strictEqual(await page.locator('[data-reader-layout-mode]').inputValue(), 'auto', 'automatic fallback must not overwrite the saved auto choice');
        await page.selectOption('[data-reader-layout-mode]', 'double-page');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'double-page'
            && document.querySelectorAll('.desktop-reader-page-deck > [data-reader-page]').length === 2);
        const narrowDoublePage = await page.evaluate(() => {
            const pages = Array.from(document.querySelectorAll('.desktop-reader-page-deck > [data-reader-page]'));
            const [left, right] = pages.map((pageNode) => pageNode.getBoundingClientRect());
            return { aligned: Math.abs(left.top - right.top) < 2, ordered: left.right <= right.left, pageWidth: left.width };
        });
        assert.ok(narrowDoublePage.aligned && narrowDoublePage.ordered && narrowDoublePage.pageWidth >= 220, 'explicit double-page mode must render two side-by-side pages at a 720px viewport');
        await page.selectOption('[data-reader-layout-mode]', 'flow');
        await page.waitForFunction(() => document.querySelector('[data-reader-content]').dataset.readerLayout === 'flow');
        await page.click('[data-reader-settings-close]');
        const flowKeyboardState = await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = 0;
            content.focus();
            content.dispatchEvent(new Event('scroll'));
            return { chapterId: readerState.activeChapterId, scrollTop: content.scrollTop };
        });
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(({ chapterId, scrollTop }) => {
            const content = document.querySelector('[data-reader-content]');
            return readerState.activeChapterId === chapterId && content.scrollTop > scrollTop + 10;
        }, flowKeyboardState);
        assert.strictEqual(await page.locator('[data-reader-content]').getAttribute('data-reader-transition'), 'curl', 'flow navigation should honor the selected curl transition');
        const flowScrolledTop = await page.locator('[data-reader-content]').evaluate((content) => content.scrollTop);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((scrollTop) => document.querySelector('[data-reader-content]').scrollTop < scrollTop - 10, flowScrolledTop);
        assert.ok(await page.locator('[data-reader-block]').count() <= 73, 'flow mode must keep a bounded DOM window');
        await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            content.scrollTop = content.scrollHeight - content.clientHeight;
            content.dispatchEvent(new Event('scroll'));
        });
        await page.waitForFunction(() => readerState.virtualWindow.end === readerState.currentChapter.blocks.length);
        assert.ok(await page.locator('[data-reader-block]').count() <= 73, 'shifting the flow window must not accumulate chapter DOM');

        await page.evaluate(() => {
            const slider = document.querySelector('[data-reader-progress-slider]');
            slider.value = '0';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[0].chapterId && document.querySelector('[data-reader-progress-percent]').textContent === '0%');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-reader-progress-slider]');
            slider.value = '100';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => readerState.activeChapterId === readerState.contents[readerState.contents.length - 1].chapterId);
        await page.waitForTimeout(300);
        const endProgress = await page.evaluate(() => {
            const content = document.querySelector('[data-reader-content]');
            return {
                label: document.querySelector('[data-reader-progress-percent]').textContent,
                slider: document.querySelector('[data-reader-progress-slider]').value,
                scrollTop: content.scrollTop,
                maxScroll: content.scrollHeight - content.clientHeight
            };
        });
        assert.strictEqual(endProgress.label, '100%', `book progress should end at 100% (${JSON.stringify(endProgress)})`);

        await page.click('[data-reader-settings-toggle]');
        await selectReaderStudioSection(page, 'scheme');
        await page.click('[data-reader-preference-reset]');
        await page.waitForFunction(() => document.querySelector('[data-reader-preference-status]').textContent.includes('已恢复全局设置'));
        const resetPreferences = await page.evaluate(async () => {
            const payload = await fetch(`/api/reader/state?documentId=${encodeURIComponent(readerState.activeDocumentId)}`).then((response) => response.json());
            return { overrides: payload.state.preferenceOverrides, theme: readerState.theme };
        });
        assert.deepStrictEqual(resetPreferences.overrides, {}, 'reset should remove every per-book preference override');
        assert.strictEqual(resetPreferences.theme, scopedPreferences.globalTheme, 'reset should immediately restore the global theme');
        await page.click('[data-reader-settings-close]');

        await page.click('[data-reader-library-toggle]');
        assert.strictEqual(await page.locator('[data-reader-left-drawer]').evaluate((node) => node.inert), false, 'the active navigation drawer must be reachable');
        assert.strictEqual(await page.locator('[data-reader-settings-drawer]').evaluate((node) => node.inert), true, 'the inactive settings drawer must stay inert');
        assert.strictEqual(await page.locator('[data-reader-position-label]').getAttribute('aria-live'), 'polite', 'reading position changes should be announced politely');
        assert.strictEqual(await page.locator('[data-reader-progress-percent]').getAttribute('aria-live'), 'polite', 'book progress changes should be announced politely');
        await page.waitForTimeout(220);
        await page.locator('[data-reader-left-close]').focus();
        await page.keyboard.press('Shift+Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement === readerDrawerFocusable(document.querySelector('[data-reader-left-drawer]')).at(-1)), true, 'Shift+Tab at the start of a drawer must wrap to its last reachable control');
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement === document.querySelector('[data-reader-left-close]')), true, 'Tab at the end of a drawer must wrap to its close control');
        await page.locator('[data-reader-tab="bookmarks"]').focus();
        await page.keyboard.press('Home');
        assert.strictEqual(await page.locator('[data-reader-tab="library"]').getAttribute('aria-selected'), 'true', 'Home should select the first navigation tab');
        assert.strictEqual(await page.locator('[data-reader-tab="library"]').getAttribute('tabindex'), '0', 'the selected tab should be the only tab in the natural tab order');
        await page.keyboard.press('ArrowRight');
        assert.strictEqual(await page.locator('[data-reader-tab="contents"]').getAttribute('aria-selected'), 'true', 'ArrowRight should advance and select a navigation tab');
        await page.keyboard.press('End');
        assert.strictEqual(await page.locator('[data-reader-tab="history"]').getAttribute('aria-selected'), 'true', 'End should select the final navigation tab');
        await page.click('[data-reader-tab="bookmarks"]');
        await page.click('.desktop-reader-bookmark-controls .desktop-reader-tool');
        await page.waitForFunction(() => readerState.documentRecordState.bookmarks.length === 0);
        assert.strictEqual(await page.locator('.desktop-reader-bookmark').count(), 0, 'bookmark delete should update persistent state and the list');
        await page.click('[data-reader-tab="contents"]');
        assert.ok(await page.locator('[data-reader-chapters] .desktop-reader-chapter').count() >= 2, 'contents tab should expose the document chapter list');
        await page.keyboard.press('Escape');
        assert.strictEqual(await page.locator('[data-reader-left-drawer]').getAttribute('aria-hidden'), 'true', 'Escape should close the active drawer');
        assert.strictEqual(await page.evaluate(() => document.activeElement === document.querySelector('[data-reader-library-toggle]')), true, 'closing a drawer should restore focus to its trigger');
        await page.click('[data-reader-exit]');
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'bookshelf');
        const restoredShell = await page.evaluate(() => ({
            focusMode: document.getElementById('desktop-root').dataset.readerFocusMode,
            railVisibility: getComputedStyle(document.querySelector('.desktop-rail')).visibility,
            chromeDisplay: getComputedStyle(document.querySelector('.desktop-main > .desktop-topbar')).display
        }));
        assert.strictEqual(restoredShell.focusMode, 'false', 'leaving Reader should clear the focus mode marker');
        assert.notStrictEqual(restoredShell.railVisibility, 'hidden', 'leaving Reader should restore the global navigation rail');
        assert.notStrictEqual(restoredShell.chromeDisplay, 'none', 'leaving Reader should restore the application title bar');
        await page.click('[data-view-target="reader"]');
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'reader');
        await page.waitForFunction(() => document.querySelector('[data-reader-shell]').dataset.readerHudState === 'visible');
        await page.click('[data-reader-exit]');
        await page.waitForFunction(() => document.getElementById('desktop-root').dataset.view === 'bookshelf');

        console.log('Desktop reader test passed.');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Desktop reader test failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
