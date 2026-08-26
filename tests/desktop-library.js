const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const { openNativePanel, openGenerationAdvanced, closeGenerationAdvanced, clickMoreAction } = require('./helpers/native-panel');

function snapshot(id, name, text, exportedAt) {
    return {
        version: '2.1-desktop-library-test',
        exportedAt,
        filesystemSavedAt: exportedAt,
        project: { id, name, created: exportedAt, modified: exportedAt },
        chapters: [{ id: `${id}-c1`, projectId: id, title: '第一章', order: 0 }],
        scenes: [{ id: `${id}-s1`, projectId: id, chapterId: `${id}-c1`, title: '第一场', order: 0 }],
        sceneContents: { [`${id}-s1`]: text },
        compendium: [],
        prompts: [],
        codex: [],
        promptHistory: [],
        workshopSessions: []
    };
}

async function openCompendiumMore(page) {
    const menu = page.locator('[data-compendium-more-menu]');
    if (await menu.isVisible()) return;
    await page.click('[data-compendium-more]');
    await page.waitForSelector('[data-compendium-more-menu]:not([hidden])');
}

async function acceptNextConfirm(page) {
    page.once('dialog', async (dialog) => {
        await dialog.accept();
    });
}

async function openCompendiumPolicyDetails(page) {
    await page.locator('[data-compendium-policy-details]').evaluate((element) => {
        element.open = true;
    });
}

async function submitNativeName(page, value) {
    await page.waitForFunction(() => {
        const modal = document.querySelector('[data-native-name-modal]');
        return modal && !modal.hidden;
    });
    await page.fill('[data-native-name-input]', value);
    await page.locator('[data-native-name-form] button[type="submit"]').click();
    await page.waitForFunction(() => {
        const modal = document.querySelector('[data-native-name-modal]');
        return modal && modal.hidden;
    });
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-library-test-'));
    const projectsDir = path.join(dataRoot, 'projects');
    const revealedPaths = [];
    let servers = null;
    let browser = null;

    try {
        await fs.mkdir(projectsDir, { recursive: true });
        await fs.writeFile(
            path.join(projectsDir, '星河长卷--book-1.json'),
            JSON.stringify(snapshot('book-1', '星河长卷', 'alpha beta gamma', '2026-06-23T10:00:00.000Z')),
            'utf8'
        );
        await fs.writeFile(
            path.join(projectsDir, '短篇集--book-2.json'),
            JSON.stringify(snapshot('book-2', '短篇集', 'one two', '2026-06-24T10:00:00.000Z')),
            'utf8'
        );

        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            revealPath: async (targetPath) => {
                revealedPaths.push(targetPath);
                return '';
            }
        });

        const apiResponse = await fetch(servers.appUrl + '/api/list-projects');
        const apiBody = await apiResponse.json();
        assert.ok(apiResponse.ok && apiBody.ok, 'list-projects should return ok');
        assert.strictEqual(apiBody.projects.length, 2, 'API should list two projects');
        assert.strictEqual(apiBody.projects[0].name, '短篇集', 'newest project should be first');
        assert.strictEqual(apiBody.projects[0].wordCount, 2, 'word count should be calculated from sceneContents');

        const projectResponse = await fetch(servers.appUrl + '/api/get-project?projectId=book-2');
        const projectBody = await projectResponse.json();
        assert.ok(projectResponse.ok && projectBody.ok, 'get-project should return ok');
        assert.strictEqual(projectBody.project.project.name, '短篇集', 'get-project should return the snapshot payload');

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
        await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('.desktop-project-card').length === 2);

        await page.setViewportSize({ width: 2560, height: 1440 });
        const libraryDensity = await page.evaluate(() => {
            const bookshelf = document.querySelector('.desktop-bookshelf');
            const card = document.querySelector('.desktop-project-card');
            const main = document.querySelector('.desktop-main') || document.querySelector('#desktop-root');
            return {
                bookshelfWidth: bookshelf ? Math.round(bookshelf.getBoundingClientRect().width) : 0,
                mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
                cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0
            };
        });
        assert.ok(libraryDensity.bookshelfWidth > 1800, `2K bookshelf should use the workspace width, got ${libraryDensity.bookshelfWidth}`);
        assert.ok(libraryDensity.cardWidth >= 260 && libraryDensity.cardWidth <= 380, `2K library cards should stay compact, got ${libraryDensity.cardWidth}`);
        await page.setViewportSize({ width: 1366, height: 850 });

        await page.evaluate(() => {
            window.__fullscreenClicked = false;
            window.draftHarborDesktop = {
                toggleFullscreen: async () => {
                    window.__fullscreenClicked = true;
                    return true;
                }
            };
        });
        await page.click('[data-toggle-fullscreen]');
        assert.strictEqual(await page.evaluate(() => window.__fullscreenClicked), true, 'fullscreen button should call desktop API');

        assert.strictEqual(await page.locator('.desktop-placeholder-copy').count(), 0, 'bookshelf should not keep a left action column');
        assert.strictEqual(await page.locator('[data-bookshelf-more]').count(), 1, 'maintenance actions should live in the 维护 menu');

        let cardText = await page.locator('.desktop-project-card').first().innerText();
        assert.ok(cardText.includes('短篇集'), 'first card should render project name');
        assert.ok(cardText.includes('字'), 'first card should render word count');
        assert.ok(!cardText.includes('打开写作器'), 'project card should not expose a second open-writer action');

        const firstCard = page.locator('.desktop-project-card').first();
        await firstCard.locator('.desktop-project-more-toggle').click();
        await firstCard.locator('[data-project-edit]').click();
        await page.fill('[data-project-edit-name]', '短篇集修订版');
        await page.selectOption('[data-project-edit-status]', '修订中');
        await page.fill('[data-project-edit-tags]', '短篇, 测试');
        await page.fill('[data-project-edit-description]', '这是一个用于桌面书库测试的简介。');
        await page.locator('[data-project-edit-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.body.innerText.includes('短篇集修订版'));

        const updatedProjectResponse = await fetch(servers.appUrl + '/api/get-project?projectId=book-2');
        const updatedProjectBody = await updatedProjectResponse.json();
        assert.ok(updatedProjectResponse.ok && updatedProjectBody.ok, 'edited project should remain readable');
        assert.strictEqual(updatedProjectBody.project.project.name, '短篇集修订版', 'project metadata edit should rename the project');
        assert.strictEqual(updatedProjectBody.project.project.status, '修订中', 'project metadata edit should save status');
        assert.deepStrictEqual(updatedProjectBody.project.project.tags, ['短篇', '测试'], 'project metadata edit should save tags');
        assert.strictEqual(updatedProjectBody.project.project.description, '这是一个用于桌面书库测试的简介。', 'project metadata edit should save description');

        await page.selectOption('[data-project-sort]', 'words');
        const wordSortedText = await page.locator('.desktop-project-card').first().innerText();
        assert.ok(wordSortedText.includes('星河长卷'), 'word sort should put the longest project first');

        await page.fill('[data-project-search]', '短篇');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-project-card').length === 1);
        const filteredText = await page.locator('.desktop-project-card').first().innerText();
        assert.ok(filteredText.includes('短篇集修订版'), 'search should filter project cards by name');
        assert.ok(filteredText.includes('修订中'), 'project card should show edited status');
        assert.ok(filteredText.includes('桌面书库测试'), 'project card should show edited description');

        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async (text) => {
                        window.__copiedProjectPath = text;
                    }
                }
            });
        });
        await page.locator('.desktop-project-more-toggle').first().click();
        await page.locator('[data-action="copy-path"]').first().click();
        const copiedPath = await page.evaluate(() => window.__copiedProjectPath);
        assert.ok(copiedPath && copiedPath.includes('book-2.json'), 'copy path should use the project snapshot path');

        await page.locator('[data-action="reveal-file"]').first().click();
        await page.waitForFunction(() => document.body.innerText.includes('已在文件管理器中定位项目文件'));
        assert.strictEqual(revealedPaths.length, 1, 'reveal project file should call the desktop reveal hook');
        assert.ok(revealedPaths[0].includes('book-2.json'), 'revealed path should point at the edited project snapshot');

        await page.locator('[data-project-continue]').first().click();
        await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent === '短篇集修订版', { timeout: 12000 });
        assert.strictEqual(
            await page.evaluate(() => document.getElementById('legacy-writer-frame')),
            null,
            'desktop mainline should not contain the legacy iframe element'
        );

        await page.click('[data-view-target="bookshelf"]');
        await page.fill('[data-project-search]', '');
        await page.selectOption('[data-project-sort]', 'words');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-project-card').length === 2);
        const pinnedCard = page.locator('.desktop-project-card').first();
        const pinnedText = await pinnedCard.innerText();
        assert.ok(pinnedText.includes('短篇集修订版'), 'last opened project should stay pinned above the current sort');
        assert.ok(pinnedText.includes('最近'), 'last opened card should show a 最近 badge');
        assert.strictEqual(await pinnedCard.evaluate((card) => card.classList.contains('is-recent')), true, 'last opened card should use the recent modifier');
        page.once('dialog', async (dialog) => {
            await dialog.accept();
        });
        await pinnedCard.locator('.desktop-project-more-toggle').click();
        await pinnedCard.locator('.desktop-mini-action-danger').click();
        await page.waitForFunction(() => document.querySelectorAll('.desktop-project-card').length === 1);

        const removedListResponse = await fetch(servers.appUrl + '/api/list-projects');
        const removedListBody = await removedListResponse.json();
        assert.ok(removedListResponse.ok && removedListBody.ok, 'project list should remain readable after remove');
        assert.strictEqual(removedListBody.projects.some((project) => project.id === 'book-2'), false, 'removed project should leave the active library');
        const removedFiles = await fs.readdir(path.join(projectsDir, '.removed-projects'));
        assert.ok(removedFiles.some((file) => file.includes('book-2.json')), 'removed project should be moved to the recovery folder');

        await page.fill('[data-project-search]', '');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-project-card').length === 1);
        await page.click('[data-open-new-project]');
        await page.fill('[data-project-create-name]', 'Desktop Draft');
        await page.fill('[data-project-create-tags]', 'desktop, draft');
        await page.fill('[data-project-create-description]', 'Created from the native desktop library.');
        await page.locator('[data-project-create-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent === 'Desktop Draft');
        await page.fill('[data-native-scene-editor]', 'Native editor saved prose.');
        await page.click('[data-native-save-scene]');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
        await page.click('[data-native-add-scene]');
        await submitNativeName(page, 'Second Scene');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent === 'Second Scene');
        await page.fill('[data-native-scene-editor]', 'Second native scene.');
        await openNativePanel(page, 'structure');
        await page.click('[data-native-rename-scene]');
        await submitNativeName(page, 'Renamed Second Scene');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent === 'Renamed Second Scene');
        await openNativePanel(page, 'metadata');
        await page.fill('[data-native-scene-summary]', 'A saved native scene summary.');
        await page.fill('[data-native-scene-tags]', 'draft, important');
        await page.fill('[data-native-scene-pov]', 'Ada');
        await page.selectOption('[data-native-scene-tense]', 'present');
        await openNativePanel(page, 'structure');
        await page.click('[data-native-move-scene-up]');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('未保存'));
        await openNativePanel(page, 'search');
        await page.fill('[data-native-search]', 'Renamed Second');
        await page.waitForFunction(() => {
            const scenes = Array.from(document.querySelectorAll('[data-native-scene-id]'));
            return scenes.length === 1 && scenes[0].textContent.includes('Renamed Second Scene');
        });
        await page.fill('[data-native-search]', '');
        await page.waitForFunction(() => document.querySelectorAll('[data-native-scene-id]').length >= 2);
        await openNativePanel(page, 'structure');
        await page.click('[data-native-rename-chapter]');
        await submitNativeName(page, 'Opening Chapter');
        await page.waitForFunction(() => document.querySelector('[data-native-chapter-title]').textContent === '第 1 章 · Opening Chapter');
        await page.click('[data-native-add-chapter]');
        await submitNativeName(page, 'Disposable Chapter');
        await page.waitForFunction(() => document.querySelector('[data-native-chapter-title]').textContent === '第 2 章 · Disposable Chapter');
        page.once('dialog', async (dialog) => {
            assert.strictEqual(dialog.type(), 'confirm');
            await dialog.accept();
        });
        await page.click('[data-native-delete-chapter]');
        await page.waitForFunction(() => document.querySelector('[data-native-chapter-title]').textContent === '第 1 章 · Opening Chapter');
        await openNativePanel(page, 'search');
        await page.fill('[data-native-search]', 'Second native');
        await page.waitForFunction(() => document.querySelectorAll('[data-native-scene-id]').length === 1);
        await page.click('[data-native-scene-id]');
        await page.fill('[data-native-replace]', 'Replaced native');
        await page.click('[data-native-replace-current]');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Replaced native scene.'));
        await page.fill('[data-native-search]', '');
        await page.click('[data-native-add-scene]');
        await submitNativeName(page, 'Temporary Scene');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent === 'Temporary Scene');
        page.once('dialog', async (dialog) => {
            assert.strictEqual(dialog.type(), 'confirm');
            await dialog.accept();
        });
        await openNativePanel(page, 'structure');
        await page.click('[data-native-delete-scene]');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent !== 'Temporary Scene');
        await page.click('[data-native-save-scene]');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
        const downloadPromise = page.waitForEvent('download');
        await openNativePanel(page, 'structure');
        await page.click('[data-native-export-md]');
        const download = await downloadPromise;
        assert.ok(download.suggestedFilename().endsWith('.md'), 'native editor should export Markdown');
        const draftListBeforeCompendium = await fetch(servers.appUrl + '/api/list-projects');
        const draftListBeforeCompendiumBody = await draftListBeforeCompendium.json();
        const draftProjectId = draftListBeforeCompendiumBody.projects.find((project) => project.name === 'Desktop Draft').id;
        await page.click('[data-view-target="compendium"]');
        await page.waitForSelector('[data-compendium-new]:not([disabled])');
        await page.click('[data-compendium-new]');
        await page.waitForSelector('.desktop-compendium-item.is-active');
        await page.selectOption('[data-compendium-entry-type]', 'character');
        await page.fill('[data-compendium-title]', 'Ada Navigator');
        await page.fill('[data-compendium-summary]', 'A pilot with a careful memory.');
        await page.fill('[data-compendium-body]', 'Ada remembers every route through the storm belt.');
        await openCompendiumPolicyDetails(page);
        await page.fill('[data-compendium-tags]', 'pilot, protagonist');
        await page.fill('[data-compendium-aliases]', 'Ada, Navigator');
        await page.check('[data-compendium-always]');
        const firstScreen = await page.evaluate(() => {
            const list = document.querySelector('.desktop-compendium-list');
            const tools = document.querySelector('.desktop-compendium-tools');
            const body = document.querySelector('[data-compendium-body]');
            const listRect = list.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            return {
                listHeight: Math.round(listRect.height),
                toolsHeight: Math.round(tools.getBoundingClientRect().height),
                bodyVisible: bodyRect.top < window.innerHeight - 24 && bodyRect.height >= 160
            };
        });
        assert.ok(firstScreen.listHeight > firstScreen.toolsHeight, `compendium list should outgrow the tool cluster (${firstScreen.listHeight} vs ${firstScreen.toolsHeight})`);
        assert.ok(firstScreen.bodyVisible, 'compendium body should stay on the first screen');
        await page.locator('[data-compendium-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-compendium-status]').textContent.includes('资料已保存'));
        await page.fill('[data-compendium-search]', 'storm belt');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-compendium-item').length === 1 && document.body.innerText.includes('Ada Navigator'));
        const compendiumApiResponse = await fetch(`${servers.appUrl}/api/compendium?projectId=${encodeURIComponent(draftProjectId)}&query=storm%20belt`);
        const compendiumApiBody = await compendiumApiResponse.json();
        assert.ok(compendiumApiResponse.ok && compendiumApiBody.ok, 'native compendium API should stay readable after UI save');
        assert.strictEqual(compendiumApiBody.entries[0].title, 'Ada Navigator', 'native compendium UI should save entries');
        await page.click('[data-view-target="writer"]');
        await openNativePanel(page, 'generate');
        await openGenerationAdvanced(page);
        await page.click('[data-native-manage-prompts]');
        await page.fill('[data-prompt-manager-title]', 'Test Prose Prompt');
        await page.fill('[data-prompt-manager-system]', 'Write with luminous restraint.');
        await page.fill('[data-prompt-manager-content]', 'Mention tactile details when appropriate.');
        await page.locator('[data-prompt-manager-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('提示词已保存'));
        await page.locator('[data-prompt-manager-close]').click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-native-prompt-template] option')).some((option) => option.textContent.includes('Test Prose Prompt')));
        await closeGenerationAdvanced(page);
        await page.click('[data-view-target="settings"]');
        await page.waitForSelector('[data-settings-form]');
        await page.selectOption('[data-settings-mode]', 'api');
        const writingProviders = await page.locator('[data-settings-provider] option').evaluateAll((opts) => opts.map((option) => option.value));
        assert.ok(writingProviders.includes('anthropic') && writingProviders.includes('google') && writingProviders.includes('custom'), 'writing provider list should expose Anthropic, Gemini and custom');
        await page.selectOption('[data-settings-provider]', 'google');
        await page.waitForFunction(() => (document.querySelector('[data-settings-endpoint]') || {}).value.includes('generativelanguage.googleapis.com'));
        await page.selectOption('[data-settings-provider]', 'anthropic');
        await page.waitForFunction(() => (document.querySelector('[data-settings-endpoint]') || {}).value.includes('api.anthropic.com'));
        await page.selectOption('[data-settings-provider]', 'custom');
        await page.waitForFunction(() => {
            const hint = document.querySelector('[data-settings-zen-hint]');
            const model = document.querySelector('[data-settings-model]');
            return hint && !hint.hidden && /chat\/completions|Chat Completions|兼容/.test(hint.textContent || '') && model && !model.hidden;
        });
        await page.selectOption('[data-settings-provider]', 'openai-compatible');
        await page.fill('[data-settings-endpoint]', 'https://example.test/v1/chat/completions');
        await page.selectOption('[data-settings-model-pick]', '__custom__');
        await page.fill('[data-settings-model]', 'desktop-test-model');
        await page.fill('[data-settings-api-key]', 'desktop-test-key');
        await page.click('[data-settings-cat-target="generation"]');
        await page.fill('[data-settings-temperature]', '0.55');
        await page.fill('[data-settings-max-tokens]', '444');
        await page.check('[data-settings-global-prompt-enabled]');
        await page.fill('[data-settings-global-prompt]', '全局前缀：始终遵守作品设定。');
        await page.click('[data-settings-save-generation]');
        await page.waitForFunction(() => document.querySelector('[data-settings-status]').textContent.includes('设置已保存'));
        const globalPromptSettings = await fetch(`${servers.appUrl}/api/settings`).then((response) => response.json());
        assert.strictEqual(globalPromptSettings.settings.globalPrompt.enabled, true, 'global prompt should persist in desktop settings');
        assert.strictEqual(globalPromptSettings.settings.globalPrompt.content, '全局前缀：始终遵守作品设定。', 'global prompt content should persist in desktop settings');
        await page.click('[data-settings-cat-target="profiles"]');
        await page.waitForSelector('[data-settings-profile-add]');
        assert.ok(await page.locator('[data-settings-profile-add]').isVisible(), 'profile list should expose create-profile action');
        await page.click('[data-settings-profile-add]');
        await page.waitForFunction(() => !document.querySelector('[data-settings-profile-editor]').hidden);
        const profileProviders = await page.locator('[data-settings-profile-provider] option').evaluateAll((opts) => opts.map((option) => option.value));
        assert.ok(profileProviders.includes('anthropic') && profileProviders.includes('google') && profileProviders.includes('custom'), 'profile editor should list Anthropic, Gemini and custom');
        await page.click('[data-settings-profile-cancel]');
        await page.waitForFunction(() => document.querySelector('[data-settings-profile-editor]').hidden);
        await page.click('[data-settings-cat-target="profiles"]');
        await page.waitForFunction(() => document.querySelector('[data-settings-section="provider"]').hidden === false);
        await page.click('[data-settings-cat-target="compendium-agent"]');
        await page.selectOption('[data-settings-compendium-agent-api-provider]', 'deepseek');
        await page.fill('[data-settings-compendium-agent-api-endpoint]', 'http://127.0.0.1:1/v1/chat/completions');
        await page.selectOption('[data-settings-compendium-agent-model-pick]', 'deepseek-v4-flash');
        await page.fill('[data-settings-compendium-agent-api-key]', 'desktop-agent-key');
        await page.click('[data-settings-compendium-agent-api-save]');
        await page.waitForFunction(() => document.querySelector('[data-settings-status]').textContent.includes('专用 API 已保存并启用'));
        const agentSettings = await fetch(`${servers.appUrl}/api/settings`).then((response) => response.json());
        assert.strictEqual(agentSettings.settings.compendiumAgent.enabled, true, 'inline agent API setup should enable the agent');
        assert.ok(agentSettings.settings.compendiumAgent.providerProfileId, 'inline agent API setup should select the saved profile');
        const agentProfile = agentSettings.settings.providerProfiles.find((profile) => profile.id === agentSettings.settings.compendiumAgent.providerProfileId);
        assert.ok(agentProfile && agentProfile.hasApiKey, 'inline agent API setup should save a usable local profile');
        assert.strictEqual(agentProfile.model, 'deepseek-v4-flash', 'inline agent API setup should save its own model');
        assert.strictEqual(await page.locator('.desktop-settings-global-actions').isHidden(), true, 'global settings actions should be hidden in the agent configuration section');
        await page.click('[data-settings-compendium-agent-api-test]');
        await page.waitForFunction(() => document.querySelector('[data-settings-compendium-agent-api-status]').textContent.includes('连接失败'));
        await page.click('[data-view-target="compendium"]');
        await openCompendiumMore(page);
        await page.waitForSelector('[data-compendium-agent-qa]:not([hidden])');
        await page.click('[data-compendium-agent-qa]');
        await page.waitForSelector('[data-compendium-agent-qa-modal][open]');
        const qaModalWidth = await page.locator('[data-compendium-agent-qa-modal]').evaluate((element) => Math.round(element.getBoundingClientRect().width));
        assert.ok(qaModalWidth <= 620, 'question dialog should use a focused reading width');
        await page.click('[data-compendium-agent-qa-cancel]');
        await page.waitForFunction(() => !document.querySelector('[data-compendium-agent-qa-modal]').open);
        await openCompendiumMore(page);
        await page.click('[data-compendium-agent]');
        await page.waitForSelector('[data-compendium-agent-modal][open]');
        assert.strictEqual(await page.locator('[data-compendium-agent-result-actions]').isHidden(), true, 'selection actions should stay hidden before a result exists');
        await page.click('[data-compendium-agent-cancel]');
        await page.waitForFunction(() => !document.querySelector('[data-compendium-agent-modal]').open);
        await page.click('[data-view-target="writer"]');
        await clickMoreAction(page, '[data-native-style-guard]');
        await page.waitForFunction(() => document.querySelector('[data-style-guard-modal]') && !document.querySelector('[data-style-guard-modal]').hidden);
        await page.selectOption('[data-style-guard-scope]', 'global');
        await page.fill('[data-style-guard-rules]', '冷月像银盘 | 避免陈旧比喻');
        await page.locator('[data-style-guard-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('全局避免写法规则'));
        const globalRulesSettings = await fetch(`${servers.appUrl}/api/settings`).then((response) => response.json());
        assert.strictEqual(globalRulesSettings.settings.globalStyleGuardRules[0].text, '冷月像银盘', 'global avoidance rules should persist in desktop settings');
        await page.click('[data-view-target="compendium"]');
        await page.waitForSelector('[data-compendium-ai-rewrite]:not([disabled])');
        const compendiumEditorScroll = await page.locator('.desktop-compendium-form-grid').evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowY: getComputedStyle(element).overflowY
        }));
        assert.strictEqual(compendiumEditorScroll.overflowY, 'auto', 'compendium editor should keep an independent vertical scroll container');
        assert.ok(compendiumEditorScroll.clientHeight > 0, 'compendium editor scroll container should have a constrained visible height');
        await page.click('[data-compendium-ai-rewrite]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-rewrite-modal]') && !document.querySelector('[data-compendium-rewrite-modal]').hidden);
        assert.deepStrictEqual(await page.locator('[data-compendium-rewrite-field]').evaluateAll((fields) => fields.map((field) => field.value).filter((value) => value.startsWith('characterProfile.'))), ['characterProfile.role', 'characterProfile.goal', 'characterProfile.motivation', 'characterProfile.conflict', 'characterProfile.voice', 'characterProfile.currentState', 'characterProfile.knowledge', 'characterProfile.relationshipNotes'], 'rewrite should expose the complete structured character profile');
        await page.evaluate(() => {
            document.querySelectorAll('[data-compendium-rewrite-field]').forEach((field) => { field.checked = field.value === 'summary'; });
            window.__draftHarborGenerationStub = async (prompt, onToken) => onToken('{"summary":"AI refined navigator summary."}');
        });
        await page.click('[data-compendium-rewrite-generate]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-rewrite-preview]').value.includes('AI refined navigator summary.'));
        await page.locator('[data-compendium-rewrite-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-compendium-status]').textContent.includes('字段补丁已应用'));
        const rewrittenCompendiumResponse = await fetch(`${servers.appUrl}/api/compendium?projectId=${encodeURIComponent(draftProjectId)}&query=Ada%20Navigator`);
        const rewrittenCompendiumBody = await rewrittenCompendiumResponse.json();
        assert.strictEqual(rewrittenCompendiumBody.entries[0].summary, 'AI refined navigator summary.', 'AI rewrite should update the selected summary field');
        assert.strictEqual(rewrittenCompendiumBody.entries[0].body, 'Ada remembers every route through the storm belt.', 'AI rewrite should preserve unselected card fields');
        await openCompendiumMore(page);
        await page.click('[data-compendium-draw]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-draw-modal]') && !document.querySelector('[data-compendium-draw-modal]').hidden);
        assert.strictEqual(await page.locator('[data-compendium-draw-draft]').isHidden(), true, 'draw details should stay hidden until a draft is generated');
        assert.strictEqual(await page.locator('[data-compendium-draw-save]').isDisabled(), true, 'draw save should stay disabled until a draft exists');
        await page.evaluate(() => {
            window.__draftHarborGenerationStub = async (prompt, onToken) => onToken('{"cards":[{"type":"character","title":"Locked Harbor Guide","summary":"First draw.","tags":["draw"],"body":"A guide knows every tide route.","characterProfile":{"role":"港口向导","goal":"守住潮汐航路","motivation":"偿还家族债务","conflict":"害怕暴风","voice":"克制简短","currentState":"躲避追捕","knowledge":"熟悉暗港","relationshipNotes":"信任船长"}}]}');
        });
        await page.click('[data-compendium-draw-generate]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-draw-title]').value === 'Locked Harbor Guide');
        assert.strictEqual(await page.locator('[data-compendium-draw-draft]').isVisible(), true, 'generated draft should reveal editable fields and reroll locks');
        assert.strictEqual(await page.locator('[data-compendium-draw-character]').isVisible(), true, 'character draws should reveal structured character fields');
        assert.strictEqual(await page.locator('[data-compendium-draw-character-goal]').inputValue(), '守住潮汐航路', 'character draw should fill the goal field');
        await page.check('[data-compendium-draw-lock="title"]');
        await page.evaluate(() => {
            window.__draftHarborGenerationStub = async (prompt, onToken) => onToken('{"cards":[{"type":"character","title":"Different Title","summary":"Second draw.","tags":["rerolled"],"body":"A different body.","characterProfile":{"role":"密探","goal":"找回航图","motivation":"保护妹妹","conflict":"不信任同伴","voice":"冷静尖锐","currentState":"潜伏码头","knowledge":"掌握密道","relationshipNotes":"提防船长"}}]}');
        });
        await page.click('[data-compendium-draw-generate]');
        await page.waitForFunction(() => document.querySelector('[data-compendium-draw-summary]').value === 'Second draw.');
        assert.strictEqual(await page.locator('[data-compendium-draw-title]').inputValue(), 'Locked Harbor Guide', 'locked draw fields should survive reroll');
        await page.locator('[data-compendium-draw-form] button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-compendium-status]').textContent.includes('已保存抽卡资料'));
        const drawnCompendiumResponse = await fetch(`${servers.appUrl}/api/compendium?projectId=${encodeURIComponent(draftProjectId)}&query=Locked%20Harbor%20Guide`);
        const drawnCompendiumBody = await drawnCompendiumResponse.json();
        assert.strictEqual(drawnCompendiumBody.entries[0].title, 'Locked Harbor Guide', 'confirmed draw should save the locked title');
        assert.strictEqual(drawnCompendiumBody.entries[0].summary, 'Second draw.', 'confirmed draw should save rerolled unlocked fields');
        assert.strictEqual(drawnCompendiumBody.entries[0].characterProfile.goal, '找回航图', 'confirmed character draw should save structured character fields');
        await page.click('[data-view-target="writer"]');
        await openNativePanel(page, 'generate');
        await openGenerationAdvanced(page);
        await page.waitForSelector('[data-native-temperature]');
        await page.fill('[data-native-temperature]', '0.7');
        await page.locator('[data-native-temperature]').dispatchEvent('change');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('生成参数已更新'));
        await page.fill('[data-native-max-tokens]', '1800');
        await page.locator('[data-native-max-tokens]').dispatchEvent('change');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('生成参数已更新'));
        await closeGenerationAdvanced(page);
        await page.evaluate(() => {
            window.__nativeGenerationCalls = 0;
            window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
                window.__nativeGenerationCalls += 1;
                window.__lastNativePrompt = prompt && prompt.asString ? prompt.asString() : String(prompt);
                window.__lastDraftHarborGenerationConfig = config;
                for (const token of [' Generated', ' native', ' prose.']) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    onToken(token);
                }
            };
        });
        await page.waitForFunction(() => window.DraftHarborProviderStream && typeof window.DraftHarborProviderStream.streamGeneration === 'function');
        await page.fill('[data-native-beat-input]', '让主角发现一封旧信。');
        await page.waitForFunction(() => !document.querySelector('[data-native-generate]').disabled);
        await page.click('[data-native-preview-prompt]');
        await page.waitForFunction(() => document.querySelector('[data-native-prompt-preview]').textContent.includes('BEAT TO EXPAND'));
        const previewText = await page.locator('[data-native-prompt-preview]').innerText();
        assert.ok(previewText.includes('Write with luminous restraint.'), 'prompt preview should include selected system template');
        assert.ok(previewText.includes('Mention tactile details'), 'prompt preview should include selected user template');
        assert.ok(previewText.includes('冷月像银盘'), 'global avoidance rules should be injected into prose prompts');
        assert.ok(previewText.includes('Ada remembers every route'), 'prompt preview should include always-in-context compendium entry');
        await page.evaluate(() => document.querySelector('[data-native-prompt-dialog]').close());
        await page.waitForFunction(() => !document.querySelector('[data-native-prompt-dialog]').open);
        await page.click('[data-view-target="workshop"]');
        await page.waitForSelector('[data-workshop-new]:not([disabled])');
        await page.click('[data-workshop-new]');
        await page.waitForFunction(() => document.querySelector('[data-workshop-title]').textContent.includes('对话'));
        await page.evaluate(() => {
            window.__workshopGenerationCalls = 0;
            window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
                window.__workshopGenerationCalls += 1;
                window.__lastWorkshopPrompt = prompt && prompt.asString ? prompt.asString() : JSON.stringify(prompt);
                window.__lastWorkshopConfig = config;
                for (const token of [' Workshop', ' answer', ' text.']) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    onToken(token);
                }
            };
        });
        await page.fill('[data-workshop-input]', '讨论 @[Ada Navigator] 接下来该去哪里？');
        await page.click('[data-workshop-send]');
        await page.waitForFunction(() => window.__workshopGenerationCalls > 0);
        await page.waitForFunction(() => document.querySelector('[data-workshop-messages]').textContent.includes('Workshop answer text.'));
        const workshopPrompt = await page.evaluate(() => window.__lastWorkshopPrompt);
        assert.ok(workshopPrompt.includes('Ada remembers every route'), 'workshop prompt should include referenced compendium context');
        await page.waitForSelector('[data-workshop-output-actions]:not([hidden])');
        acceptNextConfirm(page);
        await page.click('[data-workshop-to-compendium]');
        await page.waitForFunction(() => document.querySelector('[data-workshop-status]').textContent.includes('已转为资料条目'));
        acceptNextConfirm(page);
        await page.click('[data-workshop-to-summary]');
        await page.waitForFunction(() => document.querySelector('[data-workshop-status]').textContent.includes('已写入当前场景摘要'));
        acceptNextConfirm(page);
        await page.click('[data-workshop-insert-draft]');
        await page.waitForFunction(() => document.querySelector('[data-workshop-status]').textContent.includes('已插入当前正文'));
        await page.click('[data-view-target="writer"]');
        await page.click('[data-native-focus-mode]');
        await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
        await page.click('[data-native-focus-mode]');
        await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
        await openNativePanel(page, 'generate');
        await page.evaluate(() => {
            window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
                window.__nativeGenerationCalls += 1;
                window.__lastNativePrompt = prompt && prompt.asString ? prompt.asString() : String(prompt);
                window.__lastDraftHarborGenerationConfig = config;
                for (const token of [' Generated', ' native', ' prose.']) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    onToken(token);
                }
            };
        });
        const generationStart = await page.evaluate(() => window.DraftHarborDesktopShell.startNativeGeneration());
        assert.ok(generationStart && generationStart.ok, `native generation should start: ${JSON.stringify(generationStart)}`);
        await page.waitForFunction(() => window.__nativeGenerationCalls > 0);
        const generationConfig = await page.evaluate(() => window.__lastDraftHarborGenerationConfig);
        assert.strictEqual(generationConfig.mode, 'api', 'native generation should use settings provider mode');
        assert.strictEqual(generationConfig.endpoint, 'https://example.test/v1/chat/completions', 'native generation should use settings endpoint');
        assert.strictEqual(generationConfig.model, 'desktop-test-model', 'native generation should use settings model');
        assert.strictEqual(generationConfig.temperature, 0.7, 'native generation should use writer quick temperature');
        assert.strictEqual(generationConfig.maxTokens, 1800, 'native generation should use writer quick max tokens');
        await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Generated native prose.'));
        await openGenerationAdvanced(page);
        await page.selectOption('[data-native-generation-insert-mode]', 'append');
        await closeGenerationAdvanced(page);
        await page.click('[data-native-accept-generation]');
        await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Generated native prose.'));
        await page.click('[data-native-save-scene]');
        await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));

        await page.click('[data-view-target="workflow"]');
        await page.waitForSelector('[data-workflow-start]:not([disabled])');
        await page.fill('[data-workflow-brief]', 'A storm-road novel about Ada following a dangerous map.');
        await page.evaluate(() => {
            window.__workflowGenerationCalls = 0;
            window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
                window.__workflowGenerationCalls += 1;
                window.__lastWorkflowPrompt = prompt && prompt.promptText ? prompt.promptText : JSON.stringify(prompt);
                window.__lastWorkflowConfig = config;
                const text = window.__workflowGenerationCalls === 1
                    ? 'Chapter 1: Ada finds the storm road.'
                    : 'Workflow drafted scene text with a storm-road clue.';
                for (const token of text.split(/(?= )/)) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    onToken(token);
                }
            };
        });
        await page.click('[data-workflow-start]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('工作流已启动'));
        await page.click('[data-workflow-generate]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-artifacts]').textContent.includes('Ada finds the storm road.'));
        await page.click('[data-workflow-approve]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-title]').textContent.includes('scene-draft'));
        await page.click('[data-workflow-generate]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-artifacts]').textContent.includes('Workflow drafted scene text'));
        await page.waitForSelector('[data-workflow-apply-artifact]:not([disabled])');
        await page.click('[data-workflow-apply-artifact]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('草稿已采纳'));
        const partialApplyProject = await page.evaluate(async () => {
            const listResponse = await fetch('/api/list-projects', { cache: 'no-store' });
            const listBody = await listResponse.json();
            const projectId = listBody.projects.find((project) => project.name === 'Desktop Draft').id;
            const response = await fetch(`/api/get-project?projectId=${projectId}`, { cache: 'no-store' });
            return response.json();
        });
        assert.ok(
            Object.values(partialApplyProject.project.sceneContents || {}).some((content) => String(content || '').includes('Workflow drafted scene text')),
            'workflow artifact adoption should write the draft before final approval'
        );
        await page.click('[data-workflow-approve]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-title]').textContent.includes('user-confirmation'));
        await page.click('[data-workflow-approve]');
        await page.waitForFunction(() => document.querySelector('[data-workflow-status]').textContent.includes('工作流已完成'));
        assert.strictEqual(await page.evaluate(() => window.__workflowGenerationCalls), 2, 'workflow should generate outline and draft steps');
        const workflowPrompt = await page.evaluate(() => window.__lastWorkflowPrompt);
        assert.ok(workflowPrompt.includes('storm-road novel'), 'workflow prompt should include project brief');
        assert.ok(workflowPrompt.includes('Ada remembers every route'), 'workflow prompt should include compendium context');

        const createdListResponse = await fetch(servers.appUrl + '/api/list-projects');
        const createdListBody = await createdListResponse.json();
        assert.ok(createdListResponse.ok && createdListBody.ok, 'project list should remain readable after create');
        const createdSummary = createdListBody.projects.find((project) => project.name === 'Desktop Draft');
        assert.ok(createdSummary, 'created project should be saved to the desktop library');
        assert.strictEqual(createdSummary.source, 'project-directory', 'created project should use the new directory format');
        const nativeSavedResponse = await fetch(`${servers.appUrl}/api/get-project?projectId=${createdSummary.id}`);
        const nativeSavedBody = await nativeSavedResponse.json();
        assert.ok(nativeSavedResponse.ok && nativeSavedBody.ok, 'native editor saved project should be readable');
        assert.ok(
            Object.values(nativeSavedBody.project.sceneContents).some((text) => text.includes('Native editor saved prose.')),
            'native editor should save scene prose through the project directory API'
        );
        assert.ok(
            Object.values(nativeSavedBody.project.sceneContents).some((text) => text.includes('Replaced native scene.')),
            'native editor should replace text in the active scene'
        );
        assert.ok(
            Object.values(nativeSavedBody.project.sceneContents).some((text) => text.includes('Generated native prose.')),
            'native generation should append accepted prose to the active scene'
        );
        assert.ok(
            Object.values(nativeSavedBody.project.sceneContents).some((text) => text.includes('Workflow drafted scene text')),
            'workflow final approval should write draft text into the project'
        );
        assert.ok(
            (nativeSavedBody.project.promptHistory || []).some((record) => record.beat === '让主角发现一封旧信。' && record.resultText.includes('Generated native prose.')),
            'native generation should save generation history records'
        );
        assert.ok(
            (nativeSavedBody.project.promptHistory || []).some((record) => record.task === 'workflow:scene-draft' && record.resultText.includes('Workflow drafted scene text')),
            'workflow generation should save generation history records'
        );
        assert.ok(
            (nativeSavedBody.project.workflowRuns || []).some((run) => run.status === 'completed'),
            'workflow runs should be stored in the project directory'
        );
        assert.ok(
            (nativeSavedBody.project.compendium || []).some((entry) => entry.title === 'Ada Navigator' && entry.body.includes('storm belt')),
            'native compendium entries should be stored in the project directory'
        );
        assert.ok(
            nativeSavedBody.project.scenes.some((scene) => scene.title === 'Renamed Second Scene'),
            'native editor should rename scenes'
        );
        const renamedScene = nativeSavedBody.project.scenes.find((scene) => scene.title === 'Renamed Second Scene');
        assert.ok(renamedScene, 'renamed scene should be present');
        assert.strictEqual(renamedScene.summary, 'A saved native scene summary.', 'native editor should save scene summary');
        assert.deepStrictEqual(renamedScene.tags, ['draft', 'important'], 'native editor should save scene tags');
        assert.strictEqual(renamedScene.povCharacter, 'Ada', 'native editor should save POV character');
        assert.strictEqual(renamedScene.tense, 'present', 'native editor should save tense');
        assert.strictEqual(
            nativeSavedBody.project.chapters.some((chapter) => chapter.title === 'Opening Chapter'),
            true,
            'native editor should rename chapters'
        );
        assert.strictEqual(
            nativeSavedBody.project.chapters.some((chapter) => chapter.title === 'Disposable Chapter'),
            false,
            'native editor should delete chapters and their scenes'
        );
        const openingChapter = nativeSavedBody.project.chapters.find((chapter) => chapter.title === 'Opening Chapter');
        const openingScenes = nativeSavedBody.project.scenes
            .filter((scene) => scene.chapterId === openingChapter.id)
            .sort((a, b) => a.order - b.order);
        assert.strictEqual(openingScenes[0].title, 'Renamed Second Scene', 'native editor should reorder scenes within a chapter');
        assert.strictEqual(
            nativeSavedBody.project.scenes.some((scene) => scene.title === 'Temporary Scene'),
            false,
            'native editor should delete scenes'
        );
        assert.strictEqual(await page.evaluate(() => !!window.DraftHarborReaderDocument), true, 'desktop reader should load the core reader document module');

        const backupResponse = await fetch(servers.appUrl + '/api/create-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...nativeSavedBody.project,
                backupRequest: { reason: 'manual', note: 'desktop recovery list test' }
            })
        });
        const backupBody = await backupResponse.json();
        assert.ok(backupResponse.ok && backupBody.ok, 'test backup should be created');
        await page.click('[data-view-target="recovery"]');
        await page.click('[data-refresh-recovery]');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-recovery-item').length > 0);
        await page.fill('[data-recovery-search]', 'Desktop Draft');
        await page.waitForFunction(() => document.querySelectorAll('.desktop-recovery-item').length >= 1);
        await page.click('.desktop-recovery-item');
        await page.waitForFunction(() => !document.querySelector('[data-recovery-restore-new]').disabled);
        await page.waitForFunction(() => document.querySelector('[data-recovery-diff]').textContent.includes('变更'));
        page.once('dialog', async (dialog) => {
            assert.strictEqual(dialog.type(), 'confirm');
            await dialog.accept();
        });
        await page.click('[data-recovery-restore-scene]');
        await page.waitForFunction(() => !document.querySelector('[data-recovery-status]').textContent.includes('正在恢复'));
        page.once('dialog', async (dialog) => {
            assert.strictEqual(dialog.type(), 'confirm');
            await dialog.accept();
        });
        await page.click('[data-recovery-restore-new]');
        await page.waitForFunction(() => document.querySelector('[data-recovery-status]').textContent.includes('已恢复为新项目'));
        const restoredListResponse = await fetch(servers.appUrl + '/api/list-projects');
        const restoredListBody = await restoredListResponse.json();
        assert.ok(
            restoredListBody.projects.some((project) => project.name.includes('(Recovered)')),
            'native recovery should restore a backup as a new project'
        );

        await page.click('[data-view-target="bookshelf"]');
        await page.waitForFunction(() => {
            return Array.from(document.querySelectorAll('.desktop-project-card'))
                .some((card) => card.textContent.includes('Desktop Draft') && card.dataset.projectSource === 'project-directory');
        });

        // Phase 40: Legacy iframe has been retired from desktop mainline.
        // Verify the legacy-writer-frame element is absent from the DOM.
        assert.strictEqual(
            await page.evaluate(() => document.getElementById('legacy-writer-frame')),
            null,
            'legacy-writer-frame should be absent from the DOM after legacy writer retirement'
        );

        // Phase 35: Cross-module linkage UI tests

        // Context strip: hidden on writer (W-02); project title still lives in the outline.
        await page.click('[data-view-target="writer"]');
        await page.waitForFunction(function () {
            var strip = document.querySelector('[data-context-strip]');
            return strip && strip.hidden;
        });

        // Context strip: hidden on bookshelf
        await page.click('[data-view-target="bookshelf"]');
        await page.waitForFunction(function () {
            var strip = document.querySelector('[data-context-strip]');
            return strip && strip.hidden;
        });

        // Context strip: hidden on writer/compendium/workshop, visible on workflow
        await page.click('[data-view-target="compendium"]');
        await page.waitForFunction(function () {
            var strip = document.querySelector('[data-context-strip]');
            return strip && strip.hidden;
        });
        await page.click('[data-view-target="workshop"]');
        await page.waitForFunction(function () {
            var strip = document.querySelector('[data-context-strip]');
            return strip && strip.hidden;
        });
        await page.click('[data-view-target="workflow"]');
        await page.waitForSelector('[data-context-strip]:not([hidden])');
        await page.click('[data-context-goto-compendium]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-view-panel="compendium"]') && document.querySelector('[data-view-panel="compendium"]').classList.contains('is-active');
        });
        await page.click('[data-view-target="workflow"]');
        await page.waitForSelector('[data-context-strip]:not([hidden])');
        await page.click('[data-context-goto-writer]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-view-panel="writer"]') && document.querySelector('[data-view-panel="writer"]').classList.contains('is-active');
        });

        // Compendium injection status labels
        await page.click('[data-view-target="compendium"]');
        await page.waitForSelector('.desktop-compendium-injection-badge');
        var badges = await page.$$eval('.desktop-compendium-injection-badge', function (els) {
            return els.map(function (el) { return el.textContent.trim(); });
        });
        assert.ok(badges.length >= 1, 'compendium entries should show injection badges');
        assert.ok(badges.some(function (b) { return b === '总是注入'; }), 'always-in-context entry should show 总是注入 badge');

        // Writer handoff: Save to compendium
        await page.click('[data-view-target="writer"]');
        await page.waitForFunction(function () {
            var btn = document.querySelector('[data-native-save-to-compendium]');
            return btn && !btn.disabled;
        });
        await page.fill('[data-native-scene-editor]', 'Handoff test text for saving.');
        await page.evaluate(function () {
            var editor = document.querySelector('[data-native-scene-editor]');
            editor.focus();
            editor.setSelectionRange(0, 12);
            editor.dispatchEvent(new Event('select', { bubbles: true }));
        });
        await clickMoreAction(page, '[data-native-save-to-compendium]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-native-extract-modal]') && !document.querySelector('[data-native-extract-modal]').hidden;
        });
        await page.evaluate(function () {
            window.__draftHarborGenerationStub = async function (prompt, onToken) {
                onToken('{"cards":[{"type":"character","title":"Handoff Character","summary":"Extracted from selection.","tags":["handoff"],"body":"Handoff test text"}]}');
            };
        });
        await page.click('[data-native-extract-generate]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-native-extract-title]').value === 'Handoff Character';
        });
        await page.locator('[data-native-extract-form] button[type="submit"]').click();
        await page.waitForFunction(function () {
            return document.querySelector('[data-native-save-status]').textContent.includes('已保存资料卡');
        });
        var handoffCompendiumApiResponse = await fetch(servers.appUrl + '/api/compendium?projectId=' + encodeURIComponent(draftProjectId));
        var handoffCompendiumApiBody = await handoffCompendiumApiResponse.json();
        var fragmentEntry = handoffCompendiumApiBody.entries.find(function (e) { return e.title === 'Handoff Character'; });
        assert.ok(fragmentEntry, 'writer extraction should save the confirmed card draft');
        assert.ok(fragmentEntry.body.includes('Handoff test'), 'saved compendium entry should contain the selected text');
        assert.ok((fragmentEntry.tags || []).includes('handoff'), 'saved compendium entry should keep AI draft tags');
        assert.ok(fragmentEntry.sourceReferences && fragmentEntry.sourceReferences[0].excerpt.includes('Handoff test'), 'saved card should retain its source excerpt');

        // Writer handoff: Send to workshop
        await page.click('[data-view-target="writer"]');
        await page.waitForFunction(function () {
            var btn = document.querySelector('[data-native-send-to-workshop]');
            return btn && !btn.disabled;
        });
        await page.evaluate(function () {
            var editor = document.querySelector('[data-native-scene-editor]');
            var text = 'Discussion test excerpt.';
            var start = editor.value.indexOf(text);
            if (start < 0) {
                editor.value = text;
                start = 0;
            }
            editor.setSelectionRange(start, start + text.length);
            editor.dispatchEvent(new Event('select', { bubbles: true }));
        });
        await clickMoreAction(page, '[data-native-send-to-workshop]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-view-panel="workshop"]') && document.querySelector('[data-view-panel="workshop"]').classList.contains('is-active');
        });
        await page.waitForFunction(function () {
            var input = document.querySelector('[data-workshop-input]');
            return input && input.value.includes('Discussion test excerpt');
        });
        var workshopInputValue = await page.locator('[data-workshop-input]').inputValue();
        assert.ok(workshopInputValue.includes('Discussion test excerpt'), 'send to workshop should prefilled input with selected text');

        // Workshop output to compendium: better title
        await page.click('[data-view-target="workshop"]');
        await page.waitForSelector('[data-workshop-new]:not([disabled])');
        var currentSessionCount = await page.evaluate(function () {
            return document.querySelectorAll('.desktop-workshop-session').length;
        });
        if (currentSessionCount === 0) {
            await page.click('[data-workshop-new]');
            await page.waitForFunction(function () { return document.querySelector('[data-workshop-title]').textContent.includes('对话'); });
        }
        await page.fill('[data-workshop-input]', 'Discuss the compendium conversion test.');
        await page.evaluate(function () {
            window.__workshopGenerationCalls = 0;
            window.__draftHarborGenerationStub = async function (prompt, onToken) {
                window.__workshopGenerationCalls += 1;
                for (var _i = 0, _a = ['Workshop', ' to ', 'compendium ', 'conversion ', 'result.']; _i < _a.length; _i++) {
                    var token = _a[_i];
                    await new Promise(function (resolve) { return setTimeout(resolve, 5); });
                    onToken(token);
                }
            };
        });
        await page.click('[data-workshop-send]');
        await page.waitForFunction(function () { return window.__workshopGenerationCalls > 0; });
        await page.waitForFunction(function () {
            return document.querySelector('[data-workshop-messages]').textContent.includes('Workshop to compendium conversion result.');
        });
        await page.waitForSelector('[data-workshop-output-actions]:not([hidden])');
        acceptNextConfirm(page);
        await page.click('[data-workshop-to-compendium]');
        await page.waitForFunction(function () {
            return document.querySelector('[data-workshop-status]').textContent.includes('已转为资料条目');
        });
        var workshopConvertStatus = await page.locator('[data-workshop-status]').textContent();
        assert.ok(!workshopConvertStatus.includes('Workshop note'), 'workshop conversion should not use generic Workshop note title');

        await page.evaluate(() => {
            localStorage.setItem('draftharbor:desktop:lastView', 'writer');
            localStorage.setItem('draftharbor:desktop:lastOpenedProjectId', 'book-1');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#desktop-root') && document.querySelector('#desktop-root').dataset.view === 'writer');
        await page.waitForFunction(() => {
            const title = document.querySelector('[data-native-project-title]');
            return title && title.textContent.includes('星河长卷');
        });

        await page.evaluate(() => {
            localStorage.setItem('draftharbor:desktop:lastView', 'compendium');
            localStorage.setItem('draftharbor:desktop:lastOpenedProjectId', 'book-1');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#desktop-root') && document.querySelector('#desktop-root').dataset.view === 'compendium');
        await page.waitForFunction(() => {
            const status = document.querySelector('[data-compendium-status]');
            return status && !status.textContent.includes('未打开项目');
        });

        await page.evaluate(() => {
            localStorage.setItem('draftharbor:desktop:lastView', 'bookshelf');
            localStorage.setItem('draftharbor:desktop:lastOpenedProjectId', 'book-1');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#desktop-root') && document.querySelector('#desktop-root').dataset.view === 'bookshelf');
        await page.waitForFunction(() => {
            const first = document.querySelector('.desktop-project-card');
            return first && first.classList.contains('is-recent') && first.textContent.includes('星河长卷');
        });
        assert.ok(!(await page.locator('[data-native-scene-editor]').inputValue()).includes('alpha beta gamma'), 'bookshelf restore should not auto-open the last manuscript');

        await page.evaluate(() => {
            localStorage.setItem('draftharbor:desktop:lastView', 'writer');
            localStorage.setItem('draftharbor:desktop:lastOpenedProjectId', 'missing-project');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#desktop-root') && document.querySelector('#desktop-root').dataset.view === 'bookshelf');

        console.log('Desktop project library test passed.');
    } finally {
        if (browser) await browser.close();
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('Desktop project library test failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
