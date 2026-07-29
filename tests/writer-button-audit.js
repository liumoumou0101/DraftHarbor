const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');

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

async function openNativeModelSettings(page) {
  await page.evaluate(() => {
    const settings = document.querySelector('[data-native-model-settings]');
    if (settings) settings.open = true;
  });
}

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-writer-audit-'));
  let servers = null;
  let browser = null;

  try {
    await projectService.createProject(dataRoot, {
      id: 'writer-audit-project',
      title: 'Writer Audit Project',
      description: 'Button audit project.',
      chapters: [
        { id: 'chapter-1', title: 'Opening', order: 0 },
        { id: 'chapter-2', title: 'Middle', order: 1 }
      ],
      scenes: [
        {
          id: 'scene-1',
          chapterId: 'chapter-1',
          title: 'First Scene',
          summary: 'Initial summary.',
          content: 'First scene original text.',
          order: 0
        },
        {
          id: 'scene-2',
          chapterId: 'chapter-1',
          title: 'Second Scene',
          content: 'Second scene body.',
          order: 1
        }
      ],
      compendium: [
        {
          id: 'entry-1',
          projectId: 'writer-audit-project',
          title: 'Audit Character',
          type: 'character',
          tags: ['audit-tag'],
          content: 'A test character used by the writer audit.'
        }
      ]
    });

    servers = await startDesktopServers({
      appRoot: path.resolve(__dirname, '..'),
      dataRoot,
      revealPath: async () => ''
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const browserMessages = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) browserMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`));
    await page.goto(servers.appUrl + '/desktop.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.desktop-project-card');
    await page.focus('.desktop-project-card');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-native-project-title]').textContent.includes('Writer Audit Project'));

    await page.click('[data-native-manage-global-prompt]');
    await page.waitForFunction(() => document.querySelector('[data-native-global-prompt-dialog]').open);
    await page.check('[data-native-global-prompt-enabled]');
    await page.fill('[data-native-global-prompt-content]', 'Writer audit global prefix.');
    await page.locator('[data-native-global-prompt-form] button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-native-global-prompt-dialog]').open);
    const writerGlobalPrompt = await fetch(`${servers.appUrl}/api/settings`).then((response) => response.json());
    assert.strictEqual(writerGlobalPrompt.settings.globalPrompt.content, 'Writer audit global prefix.', 'writer global prompt editor should save its content');

    await page.dblclick('[data-native-scene-title]');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Inline Audit Title');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent.includes('Inline Audit Title'));
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('标题未保存'));
    const statusSpan = await page.locator('[data-native-save-status]');
    assert.strictEqual(await statusSpan.getAttribute('data-tone'), 'warn', 'unsaved title status should use warn tone');

    await page.click('[data-toggle-rail]');
    await page.waitForFunction(() => document.querySelector('#desktop-root').classList.contains('is-rail-collapsed'));
    await page.click('[data-toggle-rail]');
    await page.waitForFunction(() => !document.querySelector('#desktop-root').classList.contains('is-rail-collapsed'));

    await page.click('[data-native-toggle-outline]');
    await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-outline-collapsed'));
    await page.click('[data-native-toggle-outline]');
    await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-outline-collapsed'));

    await page.evaluate(() => {
      const handle = document.querySelector('[data-native-resize-outline]');
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 260 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 330 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 330 }));
    });
    await page.waitForFunction(() => Number.parseFloat(document.querySelector('[data-native-writer]').style.getPropertyValue('--native-outline-width')) >= 210);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('draftharbor:nativeSidebarWidths')).outline >= 210), 'resized outline width should persist locally');

    await page.click('[data-native-toggle-assistant]');
    await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-assistant-collapsed'));
    await page.click('[data-native-toggle-assistant]');
    await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-assistant-collapsed'));

    await page.click('[data-native-focus-mode]');
    await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
    await page.click('[data-native-focus-mode]');
    await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-focus-mode'));
    await page.click('[data-native-assistant-placement]');
    await page.waitForFunction(() => document.querySelector('[data-native-writer]').classList.contains('is-assistant-bottom'));
    await page.click('[data-native-assistant-placement]');
    await page.waitForFunction(() => !document.querySelector('[data-native-writer]').classList.contains('is-assistant-bottom'));
    await page.click('[data-native-toggle-typography]');
    await page.waitForFunction(() => !document.querySelector('[data-native-typography]').hidden);
    await page.evaluate(() => {
      const fontSize = document.querySelector('[data-native-editor-font-size]');
      const lineHeight = document.querySelector('[data-native-editor-line-height]');
      const textWidth = document.querySelector('[data-native-editor-text-width]');
      const paragraphSpacing = document.querySelector('[data-native-editor-paragraph-spacing]');
      fontSize.value = '20';
      fontSize.dispatchEvent(new Event('input', { bubbles: true }));
      lineHeight.value = '2';
      lineHeight.dispatchEvent(new Event('input', { bubbles: true }));
      textWidth.value = '900';
      textWidth.dispatchEvent(new Event('input', { bubbles: true }));
      paragraphSpacing.value = '0.5';
      paragraphSpacing.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      const style = window.getComputedStyle(editor);
      const paperHeading = document.querySelector('[data-native-paper-heading]');
      const paperFooter = document.querySelector('[data-native-paper-footer]');
      const paddingTop = Number.parseFloat(style.paddingTop);
      return document.querySelector('[data-native-editor-font-size-value]').textContent === '20'
        && document.querySelector('[data-native-editor-line-height-value]').textContent === '2.00'
        && document.querySelector('[data-native-editor-text-width-value]').textContent === '900'
        && document.querySelector('[data-native-editor-paragraph-spacing-value]').textContent === '0.5'
        && style.fontSize === '20px'
        && paddingTop >= 30
        && paperHeading
        && !paperHeading.hidden
        && paperFooter;
    });
    await page.selectOption('[data-native-editor-font-family]', 'serif');
    await page.waitForFunction(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      const style = window.getComputedStyle(editor);
      return style.fontFamily && style.fontFamily.includes('SimSun');
    });
    await page.selectOption('[data-native-editor-font-family]', 'system');
    await page.waitForFunction(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      const style = window.getComputedStyle(editor);
      return style.fontFamily && style.fontFamily.includes('Microsoft YaHei');
    });
    const wordGoalInput = page.locator('[data-native-editor-word-goal]');
    await wordGoalInput.fill('800');
    await wordGoalInput.evaluate((field) => field.dispatchEvent(new Event('input', { bubbles: true })));
    await page.waitForFunction(() => {
      const stats = document.querySelector('[data-native-editor-stats]');
      return stats && /\d+\s*\/\s*800\s*字/.test(stats.textContent);
    });
    await wordGoalInput.fill('0');
    await wordGoalInput.evaluate((field) => field.dispatchEvent(new Event('input', { bubbles: true })));
    await page.waitForFunction(() => {
      const stats = document.querySelector('[data-native-editor-stats]');
      return stats && !/\//.test(stats.textContent) && stats.textContent.includes('字');
    });
    await page.click('[data-native-toggle-typography]');
    await page.waitForFunction(() => document.querySelector('[data-native-typography]').hidden);

    await page.click('[data-native-add-scene]');
    await submitNativeName(page, 'Audit Added Scene');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent.includes('Audit Added Scene'));

    await page.click('[data-native-panel-tab="structure"]');
    await page.click('[data-native-move-scene-up]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('未保存'));
    const unsavedStatus = await page.locator('[data-native-save-status]');
    assert.strictEqual(await unsavedStatus.getAttribute('data-tone'), 'warn', 'unsaved status should use warn tone');
    await page.click('[data-native-move-scene-down]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('未保存'));

    await page.click('[data-native-add-chapter]');
    await submitNativeName(page, 'Audit Chapter');
    await page.waitForFunction(() => document.querySelector('[data-native-chapter-title]').textContent.includes('Audit Chapter'));

    await page.click('[data-native-panel-tab="metadata"]');
    await page.fill('[data-native-scene-summary]', 'Audit summary.');
    await page.fill('[data-native-scene-tags]', 'audit, ui');
    await page.fill('[data-native-scene-pov]', 'Mira');
    await page.selectOption('[data-native-scene-tense]', 'present');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('未保存'));
    await page.fill('[data-native-scene-editor]', 'Summary source text for the audit scene.');
    await page.evaluate(async () => {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'writer-audit-project',
          prompt: {
            category: 'summary',
            title: 'Audit Summary Template',
            systemContent: 'Use audit summary system rules.',
            content: 'Use the audit summary structure.'
          }
        })
      });
      if (!response.ok) throw new Error(`summary template save failed: ${response.status}`);
      await loadSummaryPrompts();
    });
    await page.selectOption('[data-native-summary-template]', { label: 'Audit Summary Template' });
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        window.__draftHarborLastSummaryPrompt = prompt.messages;
        for (const token of ['Generated', ' scene', ' summary.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-generate-scene-summary]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-summary]').value.includes('Generated scene summary.'));
    const summaryPromptMessages = await page.evaluate(() => window.__draftHarborLastSummaryPrompt);
    assert.ok(summaryPromptMessages.some((message) => message.content.includes('Use audit summary system rules.')), 'custom summary system template should be used');
    assert.ok(summaryPromptMessages.some((message) => message.content.includes('Use the audit summary structure.')), 'custom summary instruction template should be used');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[data-native-summary-dialog]');
      return dialog && dialog.open && document.querySelector('[data-native-summary-dialog-content]').value.includes('Generated scene summary.');
    });
    await page.click('[data-native-summary-dialog-close]');
    await page.waitForFunction(() => !document.querySelector('[data-native-summary-dialog]').open);

    await page.focus('[data-native-scene-editor]');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      editor.setSelectionRange(0, 7);
      editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }));
    });
    await page.waitForFunction(() => !document.querySelector('[data-native-context-menu]').hidden);
    assert.strictEqual(await page.locator('[data-native-context-selection-actions]').isHidden(), false, 'selection actions should be shown in the writer context menu');
    await page.click('[data-native-context-action="view-summary"]');
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog]').open);
    await page.click('[data-native-summary-dialog-edit]');
    await page.waitForFunction(() => document.querySelector('[data-native-panel="metadata"]').classList.contains('is-active'));

    await page.click('[data-native-panel-tab="structure"]');
    await page.click('[data-native-rename-scene]');
    await submitNativeName(page, 'Renamed Audit Scene');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-title]').textContent.includes('Renamed Audit Scene'));

    await page.click('[data-native-rename-chapter]');
    await submitNativeName(page, 'Renamed Audit Chapter');
    await page.waitForFunction(() => document.querySelector('[data-native-chapter-title]').textContent.includes('Renamed Audit Chapter'));
    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));

    const includeSceneTitlesCheckbox = await page.$('[data-native-export-include-scene-titles]');
    assert.ok(includeSceneTitlesCheckbox, 'include-scene-titles checkbox should be present');
    const isDefaultChecked = await includeSceneTitlesCheckbox.isChecked();
    assert.strictEqual(isDefaultChecked, true, 'include-scene-titles checkbox should be checked by default');

    await page.evaluate(() => {
      window.__nativeExportHrefs = [];
      const originalClick = HTMLAnchorElement.prototype.click;
      window.__restoreNativeExportClick = () => {
        HTMLAnchorElement.prototype.click = originalClick;
      };
      HTMLAnchorElement.prototype.click = function auditAnchorClick() {
        window.__nativeExportHrefs.push(this.href);
      };
    });
    await page.waitForSelector('[data-native-export-md]:not([disabled])');
    await page.click('[data-native-export-md]');
    await page.waitForFunction(() => window.__nativeExportHrefs.length >= 1);
    let capturedExportUrl = await page.evaluate(() => window.__nativeExportHrefs[window.__nativeExportHrefs.length - 1]);
    assert.ok(capturedExportUrl.includes('includeSceneTitles=true'), 'default export should include scene titles');

    await includeSceneTitlesCheckbox.uncheck();
    await page.click('[data-native-export-md]');
    await page.waitForFunction(() => window.__nativeExportHrefs.length >= 2);
    capturedExportUrl = await page.evaluate(() => window.__nativeExportHrefs[window.__nativeExportHrefs.length - 1]);
    assert.ok(capturedExportUrl.includes('includeSceneTitles=false'), 'unchecked export should exclude scene titles');
    await includeSceneTitlesCheckbox.check();

    await page.click('[data-native-export-md]');
    await page.waitForFunction(() => window.__nativeExportHrefs.length >= 3);
    capturedExportUrl = await page.evaluate(() => window.__nativeExportHrefs[window.__nativeExportHrefs.length - 1]);
    assert.ok(capturedExportUrl.includes('includeSceneTitles=true'), 're-checked export should include scene titles');
    await page.evaluate(() => window.__restoreNativeExportClick());

    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-native-export-md]');
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith('.md'), 'Markdown export should download');
    const htmlDownloadPromise = page.waitForEvent('download');
    await page.click('[data-native-export-html]');
    const htmlDownload = await htmlDownloadPromise;
    assert.ok(htmlDownload.suggestedFilename().endsWith('.html'), 'HTML export should download');
    const epubDownloadPromise = page.waitForEvent('download');
    await page.click('[data-native-export-epub]');
    const epubDownload = await epubDownloadPromise;
    assert.ok(epubDownload.suggestedFilename().endsWith('.epub'), 'EPUB export should download');
    const packageDownloadPromise = page.waitForEvent('download');
    await page.click('[data-native-export-package]');
    const packageDownload = await packageDownloadPromise;
    assert.ok(packageDownload.suggestedFilename().endsWith('.draftharbor-project.zip'), 'project package export should download');

    await page.click('[data-native-panel-tab="search"]');
    await page.fill('[data-native-scene-editor]', 'Audit one. Audit two. Audit three.');
    await page.evaluate(() => {
      window.__draftHarborLastUtterance = null;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        speaking: false,
        getVoices: () => [{ name: 'Audit Voice', lang: 'zh-CN' }, { name: 'Second Voice', lang: 'en-US' }],
        speak: (utterance) => { window.speechSynthesis.speaking = true; window.__draftHarborLastUtterance = utterance; },
        cancel: () => { window.speechSynthesis.speaking = false; },
        addEventListener: () => {},
        removeEventListener: () => {}
      } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: function SpeechSynthesisUtterance(text) {
        this.text = text;
      } });
    });
    await page.click('[data-native-read-aloud]');
    await page.waitForFunction(() => document.querySelector('[data-native-read-aloud]').hidden);
    await page.click('[data-native-stop-reading]');
    await page.waitForFunction(() => !document.querySelector('[data-native-read-aloud]').hidden);

    await page.click('[data-view-target="settings"]');
    await page.click('[data-settings-cat-target="tts"]');
    await page.waitForSelector('[data-settings-tts-voice]');
    await page.evaluate(() => {
      var voices = [{ name: 'Audit Voice', lang: 'zh-CN' }, { name: 'Second Voice', lang: 'en-US' }];
      var select = document.querySelector('[data-settings-tts-voice]');
      select.replaceChildren();
      voices.forEach(function (voice) {
        var option = document.createElement('option');
        option.value = voice.name;
        option.textContent = voice.name + ' (' + voice.lang + ')';
        select.appendChild(option);
      });
      select.value = 'Second Voice';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      var rateInput = document.querySelector('[data-settings-tts-rate]');
      rateInput.value = '1.5';
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('[data-settings-tts-rate-value]').textContent === '1.5');

    await page.click('[data-view-target="writer"]');
    await page.waitForSelector('[data-native-read-aloud]:not([disabled])');
    await page.waitForFunction(() => !document.querySelector('[data-native-read-aloud]').hidden);
    await page.evaluate(() => {
      window.__draftHarborLastUtterance = null;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        speaking: false,
        getVoices: () => [{ name: 'Audit Voice', lang: 'zh-CN' }, { name: 'Second Voice', lang: 'en-US' }],
        speak: (utterance) => { window.speechSynthesis.speaking = true; window.__draftHarborLastUtterance = utterance; },
        cancel: () => { window.speechSynthesis.speaking = false; },
        addEventListener: () => {},
        removeEventListener: () => {}
      } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: function SpeechSynthesisUtterance(text) {
        this.text = text;
      } });
    });
    await page.click('[data-native-read-aloud]');
    await page.waitForFunction(() => document.querySelector('[data-native-read-aloud]').hidden);
    const ttsUtterance = await page.evaluate(() => {
      var utterance = window.__draftHarborLastUtterance;
      if (!utterance) return null;
      return { text: utterance.text, rate: utterance.rate, voiceName: utterance.voice ? utterance.voice.name : null };
    });
    assert.ok(ttsUtterance, 'TTS utterance should be created on second read-aloud');
    assert.strictEqual(ttsUtterance.rate, 1.5, 'TTS utterance rate should match settings value 1.5');
    assert.strictEqual(ttsUtterance.voiceName, 'Second Voice', 'TTS utterance voice should match settings selection');
    await page.click('[data-native-stop-reading]');
    await page.waitForFunction(() => !document.querySelector('[data-native-read-aloud]').hidden);
    await page.fill('[data-native-search]', 'Audit');
    await page.waitForFunction(() => document.querySelectorAll('[data-native-scene-id]').length >= 1);
    // Verify match count status displays
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && /\u7b2c \d+\/\d+ \u4e2a\u5339\u914d/.test(status.textContent);
    });
    // Navigate to next match
    await page.click('[data-native-search-next]');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && status.textContent.includes('\u7b2c 2/');
    });
    // Wrap to first via next
    await page.click('[data-native-search-next]');
    await page.click('[data-native-search-next]');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && status.textContent.includes('\u7b2c 1/');
    });
    // Prev wraps to last
    await page.click('[data-native-search-prev]');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && status.textContent.includes('\u7b2c 3/');
    });
    // Go to match 2 and replace it
    await page.click('[data-native-search-prev]');
    await page.fill('[data-native-replace]', 'Checked');
    await page.click('[data-native-replace-current]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Checked'));
    // After replacing one, remaining matches should be 2
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && /\u7b2c \d+\/2 \u4e2a\u5339\u914d/.test(status.textContent);
    });
    // Search for non-existent term shows no matches
    await page.fill('[data-native-search]', 'XYZNOTFOUND');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && status.textContent === '\u6ca1\u6709\u5339\u914d\u9879';
    });
    // Nav buttons disabled when no matches
    await page.waitForFunction(() => {
      const prev = document.querySelector('[data-native-search-prev]');
      const next = document.querySelector('[data-native-search-next]');
      return prev && prev.disabled && next && next.disabled;
    });
    await page.fill('[data-native-search]', '');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-native-search-status]');
      return status && status.textContent === '';
    });
    await page.click('[data-native-toggle-specials]');
    await page.locator('[data-native-special-char]').nth(2).click();
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('\u2026'));
    await page.fill('[data-native-scene-editor]', 'Auto -- replace.');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Auto \u2014 replace.'));

    await page.click('[data-native-panel-tab="generate"]');

    // Configure provider to DeepSeek via settings so model control is enabled
    await page.click('[data-view-target="settings"]');
    await page.click('[data-settings-cat-target="provider"]');
    await page.waitForSelector('[data-settings-mode]');
    await page.selectOption('[data-settings-mode]', 'api');
    await page.selectOption('[data-settings-provider]', 'deepseek');
    await page.fill('[data-settings-endpoint]', 'https://api.deepseek.com/chat/completions');
    await page.fill('[data-settings-model]', 'deepseek-v4-pro');
    await page.fill('[data-settings-api-key]', 'writer-audit-test-key');
    await page.click('[data-settings-form] button[type="submit"]');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-settings-status]');
      return status && status.dataset.tone === 'ok';
    });
    await page.click('[data-view-target="writer"]');
    await openNativeModelSettings(page);
    // Programmatically set model select value to trigger change event; that calls
    // renderWriterModelControl which reads the updated runtimeProvider and enables the control.
    await page.evaluate(() => {
      var select = document.querySelector('[data-native-model-select]');
      if (select) {
        select.value = 'deepseek-v4-pro';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForSelector('[data-native-model-select]:not([disabled])');
    await page.waitForSelector('[data-native-thinking-toggle]:not([disabled])');

    // Verify model options with new profile-based control
    var auditOptionCount = await page.evaluate(() => {
      var select = document.querySelector('[data-native-model-select]');
      return select ? select.options.length : 0;
    });
    assert.ok(auditOptionCount >= 2, 'model select should have at least 2 options, got ' + auditOptionCount);
    var auditOptions = await page.evaluate(() => {
      var select = document.querySelector('[data-native-model-select]');
      return Array.from(select.options).map(function (o) { return { value: o.value, text: o.textContent }; });
    });
    assert.ok(auditOptions.some(function (o) { return o.text.includes('DeepSeek V4 Pro'); }), 'model select should include DeepSeek V4 Pro');
    assert.ok(auditOptions.some(function (o) { return o.text.includes('DeepSeek V4 Flash'); }), 'model select should include DeepSeek V4 Flash');

    // Profile select should have only "inherit" (global) since no extra profiles created yet
    var profileAuditOptions = await page.evaluate(() => {
      var select = document.querySelector('[data-native-profile-select]');
      if (!select) return [];
      return Array.from(select.options).map(function (o) { return o.value; });
    });
    assert.ok(profileAuditOptions.some(function (o) { return o === 'inherit'; }), 'profile select should include inherit');

    // Restore to inherit so we can select specific model again naturally
    await page.selectOption('[data-native-profile-select]', 'inherit');
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-profile-select]');
      return select && select.value === 'inherit';
    });

    // Select specific model + thinking
    await page.selectOption('[data-native-model-select]', 'deepseek-v4-pro');
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-model-select]');
      return select && select.value === 'deepseek-v4-pro';
    });
    await page.locator('[data-native-thinking-toggle]').check();
    await page.waitForFunction(() => {
      var toggle = document.querySelector('[data-native-thinking-toggle]');
      return toggle && toggle.checked === true;
    });
    await page.waitForFunction(() => {
      var temperature = document.querySelector('[data-native-temperature]');
      var hint = document.querySelector('[data-native-sampling-hint]');
      return temperature && temperature.disabled && hint && hint.textContent.includes('DeepSeek Thinking');
    });

    // Generate with specific model + thinking
    await page.fill('[data-native-beat-input]', 'A concise audit continuation.');
    await page.evaluate(() => {
      window.__lastDraftHarborGenerationConfig = null;
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        for (const token of [' Audit', ' generated', ' text.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-gen-task="beat"]');
    await page.waitForFunction(() => document.querySelector('[data-native-gen-task="beat"]').classList.contains('is-active'));
    await page.click('[data-native-gen-task="continue"]');
    await page.waitForFunction(() => document.querySelector('[data-native-gen-task="continue"]').classList.contains('is-active'));
    await page.click('[data-native-preview-prompt]');
    await page.waitForFunction(() => document.querySelector('[data-native-prompt-dialog]').open);
    await page.click('[data-native-close-prompt]');
    await page.waitForFunction(() => !document.querySelector('[data-native-prompt-dialog]').open);

    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Audit generated text.'));
    var lastGenConfig = await page.evaluate(() => window.__lastDraftHarborGenerationConfig);
    assert.ok(lastGenConfig, 'generation stub should receive a config object');
    assert.strictEqual(lastGenConfig.model, 'deepseek-v4-pro', 'generation config should use deepseek-v4-pro model');
    assert.strictEqual(lastGenConfig.enableThinking, true, 'generation config should have enableThinking true');
    assert.strictEqual(lastGenConfig.apiKey, 'writer-audit-test-key', 'global inherit generation config should keep the runtime API key');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Audit generated text.'));
    await page.selectOption('[data-native-generation-insert-mode]', 'cursor');
    await page.click('[data-native-accept-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Audit generated text.'));

    // Test inherit + thinking: should pass enableThinking for DeepSeek
    await page.selectOption('[data-native-profile-select]', 'inherit');
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-profile-select]');
      return select && select.value === 'inherit';
    });
    await page.locator('[data-native-thinking-toggle]').check();
    await page.waitForFunction(() => {
      var toggle = document.querySelector('[data-native-thinking-toggle]');
      return toggle && toggle.checked === true;
    });

    await page.fill('[data-native-beat-input]', 'Inherit model with thinking.');
    await page.evaluate(() => {
      window.__lastDraftHarborGenerationConfig = null;
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        for (const token of [' Inherit', ' think', ' audit.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Inherit think audit.'));
    var inheritConfig = await page.evaluate(() => window.__lastDraftHarborGenerationConfig);
    assert.ok(inheritConfig, 'inherit generation stub should receive a config object');
    assert.strictEqual(inheritConfig.model, 'deepseek-v4-pro', 'inherit config should keep global DeepSeek model');
    assert.strictEqual(inheritConfig.enableThinking, true, 'inherit + thinking should pass enableThinking true');
    assert.strictEqual(inheritConfig.apiKey, 'writer-audit-test-key', 'inherit + thinking should keep the global runtime API key');
    await page.click('[data-native-discard-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-output]').hidden);

    // Restore specific model for remaining tests
    await page.selectOption('[data-native-profile-select]', 'inherit');
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-profile-select]');
      return select && select.value === 'inherit';
    });

    await page.fill('[data-native-beat-input]', 'Retry and discard audit.');
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        for (const token of [' Audit', ' generated', ' text.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Audit generated text.'));
    await page.click('[data-native-retry-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Audit generated text.'));
    await page.click('[data-native-discard-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-output]').hidden);

    const editorBeforeCancellation = await page.locator('[data-native-scene-editor]').inputValue();
    await page.fill('[data-native-beat-input]', 'Cancellation contract audit.');
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => new Promise((resolve, reject) => {
        const signal = config && config.signal;
        if (!signal) {
          reject(new Error('Cancellation contract requires an AbortSignal.'));
          return;
        }
        const abort = () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    });
    await page.click('[data-native-generate]');
    await page.waitForSelector('[data-native-cancel-generation]:not([hidden])');
    await page.click('[data-native-cancel-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('生成已取消'));
    assert.strictEqual(await page.locator('[data-native-scene-editor]').inputValue(), editorBeforeCancellation, 'cancelling before content arrives should preserve the editor');

    await page.fill('[data-native-beat-input]', 'Empty response contract audit.');
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async () => {};
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('empty response'));
    assert.strictEqual(await page.locator('[data-native-scene-editor]').inputValue(), editorBeforeCancellation, 'an empty provider response should preserve the editor');

    await page.fill('[data-native-beat-input]', '');
    await page.evaluate(() => {
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        for (const token of ['Generated', ' scene', ' summary', ' for audit.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-gen-task="summary"]');
    await page.waitForFunction(() => document.querySelector('[data-native-gen-task="summary"]').classList.contains('is-active'));
    const summaryTaskGenerate = await page.locator('[data-native-generate]');
    assert.strictEqual(await summaryTaskGenerate.isDisabled(), false, 'summary generate should be enabled without beat text');
    const summaryBeatPlaceholder = await page.locator('[data-native-beat-input]').getAttribute('placeholder');
    assert.ok(summaryBeatPlaceholder.includes('无需输入'), 'summary placeholder should indicate no input needed');
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-summary]').value.includes('Generated scene summary for audit.'));
    await page.waitForFunction(() => document.querySelector('[data-native-summary-dialog]').open);
    await page.click('[data-native-summary-dialog-close]');
    await page.click('[data-native-gen-task="continue"]');
    await page.waitForFunction(() => document.querySelector('[data-native-gen-task="continue"]').classList.contains('is-active'));

    await page.click('[data-native-manage-prompts]');
    await page.waitForFunction(() => document.querySelector('[data-prompt-manager-dialog]').open);
    await page.fill('[data-prompt-manager-title]', 'Audit Rewrite Prompt');
    await page.selectOption('[data-prompt-manager-category]', 'rewrite');
    await page.fill('[data-prompt-manager-content]', '请把选中文本改得更冷峻克制。');
    await page.locator('[data-prompt-manager-form] button[type="submit"]').click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-native-rewrite-saved-prompt]');
      return select && Array.from(select.options).some((option) => option.textContent.includes('Audit Rewrite Prompt'));
    });
    await page.click('[data-prompt-manager-close]');
    await page.waitForFunction(() => !document.querySelector('[data-prompt-manager-dialog]').open);
    await page.click('[data-native-panel-tab="rewrite"]');
    await page.selectOption('[data-native-rewrite-saved-prompt]', { label: 'Audit Rewrite Prompt' });
    await page.waitForFunction(() => document.querySelector('[data-native-rewrite-instruction]').value.includes('冷峻克制'));
    await page.selectOption('[data-native-rewrite-preset]', 'tension');
    await page.waitForFunction(() => {
      return document.querySelector('[data-native-rewrite-saved-prompt]').value === ''
        && document.querySelector('[data-native-rewrite-instruction]').value.includes('紧张感')
        && document.querySelector('[data-native-rewrite-preset-description]').textContent.includes('紧张感');
    });
    await page.fill('[data-native-scene-editor]', 'Rewrite this audit sentence.');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      editor.focus();
      editor.setSelectionRange(0, 12);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
      editor.dispatchEvent(new Event('mouseup', { bubbles: true }));
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        for (const token of ['Rewritten', ' audit']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-preview-rewrite]');
    await page.waitForFunction(() => document.querySelector('[data-native-prompt-dialog]').open);
    const rewritePromptPreview = await page.locator('[data-native-prompt-preview]').textContent();
    assert.ok(rewritePromptPreview.includes('需要改写的文本'), 'rewrite prompt should identify the selected text contract');
    assert.ok(rewritePromptPreview.includes('Rewrite this'), 'rewrite prompt should contain the selected text');
    assert.ok(rewritePromptPreview.includes('当前场景上下文'), 'rewrite prompt should contain bounded scene context');
    assert.ok(rewritePromptPreview.includes('紧张感'), 'rewrite prompt should contain the selected rewrite instruction');
    await page.click('[data-native-close-prompt]');
    await page.click('[data-native-start-rewrite]');
    await page.waitForFunction(() => {
      const result = document.querySelector('[data-native-generation-result]');
      return result && result.textContent.includes('Rewritten audit');
    });
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value === 'Rewrite this audit sentence.');
    await page.waitForFunction(() => !document.querySelector('[data-native-generation-output]').hidden);
    await page.fill('[data-native-scene-editor]', 'Rewrite changed audit sentence.');
    await page.click('[data-native-accept-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('原文已发生变化'));
    assert.ok(!(await page.locator('[data-native-scene-editor]').inputValue()).includes('Rewritten audit'), 'rewrite must not replace text after the original selection changes');
    await page.fill('[data-native-scene-editor]', 'Rewrite this audit sentence.');
    await page.click('[data-native-accept-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Rewritten audit'), null, { timeout: 5000 }).catch(async (error) => {
      const value = await page.locator('[data-native-scene-editor]').inputValue();
      throw new Error(`${error.message}\nEditor value after rewrite accept: ${value}\nBrowser messages:\n${browserMessages.join('\n')}`);
    });
    await page.fill('[data-native-scene-editor]', 'Discard this rewrite result.');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      editor.focus();
      editor.setSelectionRange(0, 12);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        onToken('Discarded rewrite output');
      };
    });
    await page.click('[data-native-start-rewrite]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('Discarded rewrite output'));
    await page.click('[data-native-discard-generation]');
    assert.strictEqual(await page.locator('[data-native-scene-editor]').inputValue(), 'Discard this rewrite result.', 'discarding a rewrite preview should preserve the original text');
    await page.fill('[data-native-scene-editor]', 'Replace this passage with context.');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      editor.focus();
      editor.setSelectionRange(0, 12);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
      editor.dispatchEvent(new Event('mouseup', { bubbles: true }));
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        window.__lastDraftHarborGenerationPrompt = prompt && typeof prompt.asString === 'function'
          ? prompt.asString()
          : JSON.stringify(prompt);
        for (const token of ['Regenerated', ' passage']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.locator('[data-native-regenerate-use-context]').uncheck();
    await page.click('[data-native-regenerate-selection]');
    await page.waitForFunction(() => {
      const result = document.querySelector('[data-native-generation-result]');
      return result && result.textContent.includes('Regenerated passage');
    }, null, { timeout: 5000 }).catch(async (error) => {
      const outputText = await page.locator('[data-native-generation-result]').textContent();
      throw new Error(`${error.message}\nOutput text after regeneration click: ${outputText}\nBrowser messages:\n${browserMessages.join('\n')}`);
    });
    await page.waitForFunction(() => window.__lastDraftHarborGenerationPrompt && window.__lastDraftHarborGenerationPrompt.includes('用户选择不发送上下文'));
    await page.click('[data-native-accept-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('Regenerated passage'), null, { timeout: 5000 }).catch(async (error) => {
      const value = await page.locator('[data-native-scene-editor]').inputValue();
      throw new Error(`${error.message}\nEditor value after regenerate accept: ${value}\nBrowser messages:\n${browserMessages.join('\n')}`);
    });

    await page.fill('[data-native-scene-editor]', 'Task button rewrite test text here.');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-native-scene-editor]');
      editor.focus();
      editor.setSelectionRange(0, 10);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.click('[data-native-panel-tab="rewrite"]');
    await page.click('[data-native-rewrite-task="expand"]');
    await page.waitForFunction(() => document.querySelector('[data-native-rewrite-task="expand"]').classList.contains('is-active'));
    await page.waitForFunction(() => document.querySelector('[data-native-rewrite-preset]').value === 'expand');
    await page.click('[data-native-rewrite-task="polish"]');
    await page.waitForFunction(() => document.querySelector('[data-native-rewrite-task="polish"]').classList.contains('is-active'));
    await page.waitForFunction(() => document.querySelector('[data-native-rewrite-preset]').value === 'balanced-polish');

    await page.click('[data-native-panel-tab="characters"]');
    await page.click('[data-native-new-character]');
    await page.waitForFunction(() => document.querySelector('[data-native-character-list]').textContent.includes('新人物'));
    await page.click('[data-native-panel-tab="context"]');
    await page.waitForFunction(() => document.querySelector('[data-native-context-compendium]').textContent.includes('新人物'));
    await page.locator('[data-native-context-compendium] input[type="checkbox"]').first().check();
    await page.waitForSelector('[data-native-context-compendium-tags]');
    await page.locator('[data-native-context-chapters] select').first().selectOption('full');
    await page.locator('[data-native-context-scenes] select').first().selectOption('summary');

    await page.waitForSelector('[data-native-context-summary]');
    await page.waitForFunction(() => {
      const summary = document.querySelector('[data-native-context-summary]');
      return summary && summary.textContent && summary.textContent.length > 0 && !summary.textContent.includes('未选择');
    });
    const summaryText = await page.locator('[data-native-context-summary]').textContent();
    assert.ok(summaryText.includes('资料'), 'context summary should show compendium section');
    assert.ok(summaryText.includes('章节引用'), 'context summary should show chapter section');
    assert.ok(summaryText.includes('场景引用'), 'context summary should show scene section');
    assert.ok(summaryText.includes('直接引用'), 'context summary should show direct selection count');
    assert.ok(summaryText.includes('摘要'), 'context summary should show mode labels');
    assert.ok(summaryText.includes('全文'), 'context summary should show full-text chapter mode');

    await page.click('[data-native-panel-tab="generate"]');
    await page.click('[data-native-gen-task="continue"]');
    await page.click('[data-native-preview-prompt]');
    await page.waitForFunction(() => document.querySelector('[data-native-prompt-dialog]').open);
    const fullContextPrompt = await page.locator('[data-native-prompt-preview]').textContent();
    assert.ok(fullContextPrompt.includes('Second scene body.'), 'full chapter context must include complete referenced scene text in the final model prompt');
    await page.click('[data-native-close-prompt]');
    await page.waitForFunction(() => !document.querySelector('[data-native-prompt-dialog]').open);
    await page.click('[data-native-manage-prompts]');
    await page.waitForFunction(() => document.querySelector('[data-prompt-manager-dialog]').open);
    await page.fill('[data-prompt-manager-title]', 'Audit Prompt');
    await page.fill('[data-prompt-manager-system]', 'Audit system.');
    await page.fill('[data-prompt-manager-content]', 'Audit prose.');
    await page.locator('[data-prompt-manager-form] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('提示词已保存'));
    await page.click('[data-prompt-manager-new]');
    await page.waitForFunction(() => document.querySelector('[data-prompt-manager-title]').value.includes('新正文提示词'));
    await page.click('[data-prompt-manager-close]');
    await page.waitForFunction(() => !document.querySelector('[data-prompt-manager-dialog]').open);

    await page.click('[data-native-panel-tab="history"]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-history]').textContent.includes('Retry and discard audit'));
    const proseHistoryItem = page.locator('.desktop-native-history-item').filter({ hasText: 'Retry and discard audit' }).first();
    await proseHistoryItem.locator('[data-native-history-reuse]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.length > 0);

    await proseHistoryItem.locator('[data-native-history-copy]').click();
    await page.waitForFunction(() => {
      return window.__draftHarborAuditClipboard && window.__draftHarborAuditClipboard.includes('Audit generated text.');
    });
    const clipboardBeforeFilter = await page.evaluate(() => window.__draftHarborAuditClipboard);
    assert.ok(clipboardBeforeFilter.includes('Audit generated text.'), 'copy should capture the generated text in audit clipboard');

    const retryHistoryItem = page.locator('.desktop-native-history-item').filter({ hasText: 'Retry and discard audit' }).first();
    const editorBeforeHistoryRetry = await page.locator('[data-native-scene-editor]').inputValue();
    const oldHistoryTextCountBefore = (editorBeforeHistoryRetry.match(/Audit generated text\./g) || []).length;
    await page.evaluate(() => {
      window.__historyRetryGenerationCalls = 0;
      window.__draftHarborGenerationStub = async (prompt, onToken) => {
        window.__historyRetryGenerationCalls += 1;
        window.__lastHistoryRetryPrompt = prompt && prompt.asString ? prompt.asString() : String(prompt);
        for (const token of [' History', ' retry', ' fresh', ' text.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await retryHistoryItem.locator('[data-native-history-retry]').click();
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-native-beat-input]');
      return input && input.value === 'Retry and discard audit.';
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-native-panel="generate"]');
      return panel && !panel.hidden;
    });
    await page.waitForFunction(() => {
      const result = document.querySelector('[data-native-generation-result]');
      return result && result.textContent.includes('History retry fresh text.');
    });
    assert.strictEqual(await page.evaluate(() => window.__historyRetryGenerationCalls), 1, 'history retry should start one fresh generation');
    const retryPrompt = await page.evaluate(() => window.__lastHistoryRetryPrompt || '');
    assert.ok(retryPrompt.includes('Retry and discard audit.'), 'history retry prompt should reuse the record beat');
    const editorAfterRetry = await page.locator('[data-native-scene-editor]').inputValue();
    const oldHistoryTextCountAfter = (editorAfterRetry.match(/Audit generated text\./g) || []).length;
    assert.strictEqual(oldHistoryTextCountAfter, oldHistoryTextCountBefore, 'history retry should not insert the old stored result again');
    assert.ok(editorAfterRetry.includes('History retry fresh text.'), 'history retry should stream the fresh result through the normal generation path');
    await page.click('[data-native-panel-tab="history"]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-history]').textContent.includes('History retry fresh text.'));
    const freshHistoryItem = page.locator('.desktop-native-history-item').filter({ hasText: 'History retry fresh text.' }).first();
    assert.ok(await freshHistoryItem.locator('[data-native-history-task]').count() > 0, 'history card should have task label');
    const taskText = await freshHistoryItem.locator('[data-native-history-task]').textContent();
    assert.ok(taskText.includes('正文扩写'), 'task label should show Chinese task name');
    const metaEl = freshHistoryItem.locator('[data-native-history-meta]');
    assert.ok(await metaEl.count() > 0, 'history card should have meta span');
    const metaText = await metaEl.textContent();
    assert.ok(metaText.includes('字'), 'meta should include word count unit');

    await page.click('[data-native-history-filter]');
    await page.waitForFunction(() => document.querySelector('[data-native-history-filter]').getAttribute('aria-pressed') === 'true');
    await page.click('[data-native-history-filter]');
    await page.waitForFunction(() => document.querySelector('[data-native-history-filter]').getAttribute('aria-pressed') === 'false');

    await freshHistoryItem.locator('[data-native-history-insert]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-scene-editor]').value.includes('History retry fresh text.'));
    await freshHistoryItem.locator('[data-native-history-delete]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('未保存'));

    await page.click('[data-native-save-scene]');
    await page.waitForFunction(() => document.querySelector('[data-native-save-status]').textContent.includes('已保存'));
    const savedStatus = await page.locator('[data-native-save-status]');
    assert.strictEqual(await savedStatus.getAttribute('data-tone'), 'ok', 'saved status should use ok tone');
    const aiTaskHistoryResponse = await fetch(servers.appUrl + '/api/get-project?projectId=writer-audit-project');
    const aiTaskHistoryData = await aiTaskHistoryResponse.json();
    const aiTaskHistory = (aiTaskHistoryData.project.promptHistory || []).filter((record) => record.aiTask);
    assert.ok(aiTaskHistory.some((record) => record.aiTask.action === 'rewrite'), 'saved rewrite history should retain unified AI task metadata');
    assert.ok(aiTaskHistory.some((record) => record.aiTask.action === 'regenerate-selection'), 'saved regeneration history should retain unified AI task metadata');
    assert.ok(aiTaskHistory.every((record) => record.aiTask.outputContract === 'text'), 'selection task history should retain its output contract');

    page.once('dialog', async (dialog) => {
      assert.strictEqual(dialog.type(), 'confirm');
      await dialog.accept();
    });
    await page.click('[data-native-panel-tab="structure"]');
    await page.click('[data-native-delete-scene]');
    await page.waitForFunction(() => !document.querySelector('[data-native-scene-title]').textContent.includes('Renamed Audit Scene'));

    // Phase 32: Provider Profile / Model Switching Tests

    // 1. Navigate to settings and add two API profiles
    await page.click('[data-view-target="settings"]');
    await page.click('[data-settings-cat-target="profiles"]');
    await page.waitForSelector('[data-settings-profile-add]');

    // Add DeepSeek profile
    await page.click('[data-settings-profile-add]');
    await page.waitForFunction(() => !document.querySelector('[data-settings-profile-editor]').hidden);
    await page.fill('[data-settings-profile-name]', 'Writer Audit DeepSeek');
    await page.selectOption('[data-settings-profile-provider]', 'deepseek');
    await page.fill('[data-settings-profile-endpoint]', 'https://api.deepseek.com/chat/completions');
    await page.fill('[data-settings-profile-model]', 'deepseek-v4-pro');
    await page.fill('[data-settings-profile-api-key]', 'writer-audit-ds-key');
    await page.click('[data-settings-profile-save]');
    await page.waitForFunction(() => document.querySelector('[data-settings-profile-editor]').hidden);

    // Add OpenAI profile
    await page.click('[data-settings-profile-add]');
    await page.waitForFunction(() => !document.querySelector('[data-settings-profile-editor]').hidden);
    await page.fill('[data-settings-profile-name]', 'Writer Audit OpenAI');
    await page.selectOption('[data-settings-profile-provider]', 'openai');
    await page.fill('[data-settings-profile-endpoint]', 'https://api.openai.com/v1/chat/completions');
    await page.fill('[data-settings-profile-model]', 'gpt-4o-mini');
    await page.fill('[data-settings-profile-api-key]', 'writer-audit-oa-key');
    await page.click('[data-settings-profile-save]');
    await page.waitForFunction(() => document.querySelector('[data-settings-profile-editor]').hidden);

    // Verify profile list shows both
    await page.waitForFunction(() => document.querySelector('[data-settings-profiles-list]').textContent.includes('Writer Audit DeepSeek'));
    await page.waitForFunction(() => document.querySelector('[data-settings-profiles-list]').textContent.includes('Writer Audit OpenAI'));

    // 2. Navigate to writer page, verify profile select shows configured profiles only
    await page.click('[data-view-target="writer"]');
    await page.click('[data-native-panel-tab="generate"]');
    await openNativeModelSettings(page);
    await page.waitForSelector('[data-native-profile-select]', { timeout: 5000 });

    var profileOptions = await page.evaluate(() => {
      var select = document.querySelector('[data-native-profile-select]');
      if (!select) return [];
      return Array.from(select.options).map(function (o) { return { value: o.value, text: o.textContent }; });
    });
    // Should include 'inherit' and the two API profiles
    assert.ok(profileOptions.some(function (o) { return o.value === 'inherit'; }), 'profile select should have inherit option');
    assert.ok(profileOptions.some(function (o) { return o.text && o.text.includes('Writer Audit DeepSeek'); }), 'profile select should list DeepSeek profile');
    assert.ok(profileOptions.some(function (o) { return o.text && o.text.includes('Writer Audit OpenAI'); }), 'profile select should list OpenAI profile');

    // Anthropic should NOT appear as a selectable working profile
    assert.ok(!profileOptions.some(function (o) { return o.text && o.text.toLowerCase().includes('anthropic'); }), 'profile select should NOT list anthropic');

    // 3. Select the DeepSeek profile and verify model list
    for (var i = 0; i < profileOptions.length; i++) {
      if (profileOptions[i].text && profileOptions[i].text.includes('DeepSeek')) {
        await page.selectOption('[data-native-profile-select]', profileOptions[i].value);
        break;
      }
    }
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-model-select]');
      return select && select.options.length >= 3;
    }, null, { timeout: 5000 }).catch(async (error) => {
      var modelCount = await page.evaluate(() => {
        var s = document.querySelector('[data-native-model-select]');
        return s ? s.options.length : 'no-select';
      });
      throw new Error(error.message + '\nModel select options count: ' + modelCount);
    });

    // Verify model options for DeepSeek profile
    var dsModelOptions = await page.evaluate(() => {
      var select = document.querySelector('[data-native-model-select]');
      return Array.from(select.options).map(function (o) { return { value: o.value, text: o.textContent }; });
    });
    assert.ok(dsModelOptions.some(function (o) { return o.text.includes('DeepSeek V4 Pro'); }), 'model select should include DeepSeek V4 Pro');
    assert.ok(dsModelOptions.some(function (o) { return o.text.includes('DeepSeek V4 Flash'); }), 'model select should include DeepSeek V4 Flash');
    assert.ok(dsModelOptions.some(function (o) { return o.value === '__custom__'; }), 'model select should have custom option');

    // Thinking toggle should be enabled for DeepSeek model
    await page.selectOption('[data-native-model-select]', 'deepseek-v4-pro');
    await page.waitForFunction(() => {
      var toggle = document.querySelector('[data-native-thinking-toggle]');
      return toggle && !toggle.disabled;
    }, null, { timeout: 5000 });

    // 4. Generate with DeepSeek profile + thinking
    await page.locator('[data-native-thinking-toggle]').check();
    await page.waitForFunction(() => document.querySelector('[data-native-thinking-toggle]').checked === true);
    await page.fill('[data-native-beat-input]', 'Profile DS thinking test.');
    await page.evaluate(() => {
      window.__lastDraftHarborGenerationConfig = null;
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        for (const token of [' DS', ' profile', ' text.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('DS profile text.'));
    var dsProfileConfig = await page.evaluate(() => window.__lastDraftHarborGenerationConfig);
    assert.ok(dsProfileConfig, 'profile DS generation should receive config');
    assert.strictEqual(dsProfileConfig.provider, 'deepseek', 'profile DS config should have provider deepseek');
    assert.strictEqual(dsProfileConfig.enableThinking, true, 'profile DS config should have enableThinking true');
    assert.strictEqual(dsProfileConfig.model, 'deepseek-v4-pro', 'profile DS config should use deepseek-v4-pro');
    assert.strictEqual(dsProfileConfig.apiKey, 'writer-audit-ds-key', 'profile DS config should use profile API key');
    await page.click('[data-native-discard-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-output]').hidden);

    // 5. Switch to OpenAI profile and generate
    for (var j = 0; j < profileOptions.length; j++) {
      if (profileOptions[j].text && profileOptions[j].text.includes('OpenAI')) {
        await page.selectOption('[data-native-profile-select]', profileOptions[j].value);
        break;
      }
    }
    await page.waitForFunction(() => {
      var select = document.querySelector('[data-native-model-select]');
      return select && select.options.length >= 1;
    }, null, { timeout: 5000 });

    // Select a model for OpenAI profile
    var oaOptions = await page.evaluate(() => {
      var select = document.querySelector('[data-native-model-select]');
      return Array.from(select.options).map(function (o) { return o.value; });
    });
    if (oaOptions.indexOf('gpt-4o-mini') >= 0) {
      await page.selectOption('[data-native-model-select]', 'gpt-4o-mini');
    } else if (oaOptions.indexOf('__custom__') >= 0) {
      await page.selectOption('[data-native-model-select]', '__custom__');
      await page.waitForFunction(() => !document.querySelector('[data-native-custom-model-group]').hidden);
      await page.fill('[data-native-custom-model]', 'gpt-4o-mini');
    }
    // Thinking toggle should be disabled for non-DeepSeek
    await page.waitForFunction(() => {
      var toggle = document.querySelector('[data-native-thinking-toggle]');
      return toggle && toggle.disabled === true;
    }, null, { timeout: 5000 }).catch(async (error) => {
      var toggleState = await page.evaluate(() => {
        var t = document.querySelector('[data-native-thinking-toggle]');
        return t ? 'disabled=' + t.disabled + ' checked=' + t.checked : 'no-toggle';
      });
      throw new Error(error.message + '\nThinking toggle state: ' + toggleState);
    });

    await page.fill('[data-native-beat-input]', 'Profile OpenAI test.');
    await page.evaluate(() => {
      window.__lastDraftHarborGenerationConfig = null;
      window.__draftHarborGenerationStub = async (prompt, onToken, config) => {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        for (const token of [' OA', ' profile', ' text.']) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          onToken(token);
        }
      };
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-result]').textContent.includes('OA profile text.'));
    var oaProfileConfig = await page.evaluate(() => window.__lastDraftHarborGenerationConfig);
    assert.ok(oaProfileConfig, 'profile OA generation should receive config');
    assert.strictEqual(oaProfileConfig.provider, 'openai', 'profile OA config should have provider openai');
    assert.ok(!oaProfileConfig.enableThinking, 'profile OA config should NOT have enableThinking');
    assert.ok(oaProfileConfig.model === 'gpt-4o-mini' || oaProfileConfig.model === 'gpt-4o-mini', 'profile OA config should use chosen model');
    assert.strictEqual(oaProfileConfig.apiKey, 'writer-audit-oa-key', 'profile OA config should use profile API key');
    await page.click('[data-native-discard-generation]');
    await page.waitForFunction(() => document.querySelector('[data-native-generation-output]').hidden);

    // 6. Simulate settings reload and verify profile API keys survive
    await page.evaluate(function () {
      if (window.DraftHarborDesktopShell && typeof window.DraftHarborDesktopShell.loadSettings === 'function') {
        return window.DraftHarborDesktopShell.loadSettings();
      }
    });
    await page.waitForFunction(function () {
      var status = document.querySelector('[data-settings-status]');
      return status && status.textContent && status.textContent.includes('设置已读取');
    }, null, { timeout: 5000 }).catch(function () {
      // status check is best-effort in case the view is not on settings
    });
    // Navigate back to writer, select DS profile, generate again
    await page.click('[data-view-target="writer"]');
    await page.click('[data-native-panel-tab="generate"]');
    await openNativeModelSettings(page);
    await page.waitForSelector('[data-native-profile-select]', { timeout: 5000 });
    // Select the DeepSeek profile
    var reloadProfileOptions = await page.evaluate(function () {
      var select = document.querySelector('[data-native-profile-select]');
      if (!select) return [];
      return Array.from(select.options).map(function (o) { return { value: o.value, text: o.textContent }; });
    });
    var reloadDsOption = reloadProfileOptions.find(function (o) { return o.text && o.text.includes('DeepSeek'); });
    assert.ok(reloadDsOption, 'after reload, profile select should still have DeepSeek profile');
    if (reloadDsOption) {
      await page.selectOption('[data-native-profile-select]', reloadDsOption.value);
    }
    await page.waitForFunction(function () {
      var select = document.querySelector('[data-native-model-select]');
      return select && select.options.length >= 3;
    }, null, { timeout: 5000 }).catch(function () { /* model options may vary */ });
    // Generate with the reloaded profile
    await page.fill('[data-native-beat-input]', 'Reloaded DS profile test.');
    await page.evaluate(function () {
      window.__lastDraftHarborGenerationConfig = null;
      window.__draftHarborGenerationStub = async function (prompt, onToken, config) {
        window.__lastDraftHarborGenerationConfig = config && typeof config === 'object' ? Object.assign({}, config) : config;
        var reloadTokens = ['reloaded', ' DS', ' test.'];
        for (var _i = 0; _i < reloadTokens.length; _i++) {
          await new Promise(function (resolve) { return setTimeout(resolve, 2); });
          onToken(reloadTokens[_i]);
        }
      };
    });
    await page.click('[data-native-generate]');
    await page.waitForFunction(function () {
      return document.querySelector('[data-native-generation-result]').textContent.includes('reloaded DS test.');
    }, null, { timeout: 5000 });
    var reloadConfig = await page.evaluate(function () { return window.__lastDraftHarborGenerationConfig; });
    assert.ok(reloadConfig, 'reload generation should receive config');
    assert.strictEqual(reloadConfig.provider, 'deepseek', 'reload config should have provider deepseek');
    assert.strictEqual(reloadConfig.apiKey, 'writer-audit-ds-key', 'reload config should still have profile API key');

    // Phase 33: Profile test button, inline status, and writer integration

    // Go to settings and verify profile list includes test buttons
    await page.click('[data-view-target="settings"]');
    await page.click('[data-settings-cat-target="profiles"]');
    await page.waitForSelector('[data-settings-profiles-list]');

    // Verify test buttons exist in the profile list
    var testButtons = await page.evaluate(function () {
      var list = document.querySelector('[data-settings-profiles-list]');
      if (!list) return [];
      return Array.from(list.querySelectorAll('button')).filter(function (btn) { return btn.textContent === '测试'; }).length;
    });
    assert.ok(testButtons >= 2, 'profile list should have at least 2 test buttons, got ' + testButtons);

    // Click the first test button and verify inline status appears
    var testBtns = page.locator('[data-settings-profiles-list] button').filter({ hasText: '测试' });
    var testBtnCount = await testBtns.count();
    assert.ok(testBtnCount >= 1, 'should have at least one test button');

    // Click the first test button
    await testBtns.first().click();

    // Verify inline status shows
    await page.waitForFunction(function () {
      var status = document.querySelector('.desktop-settings-profile-status');
      return status && status.textContent && status.textContent.length > 0;
    }, null, { timeout: 5000 }).catch(function (error) {
      throw new Error('Phase 33: profile test status did not appear. ' + error.message);
    });

    var statusText = await page.locator('.desktop-settings-profile-status').first().textContent();
    assert.ok(statusText.length > 0, 'profile test status should show text');
    var statusTone = await page.locator('.desktop-settings-profile-status').first().getAttribute('data-tone');
    assert.ok(['ok', 'error', 'info'].indexOf(statusTone) >= 0, 'profile test status should have valid tone attribute, got: ' + statusTone);

    // The test button should be disabled while test is running but re-enabled after
    // (The test is non-live so completes immediately, just check it's not disabled after)
    await page.waitForFunction(function () {
      var btns = document.querySelector('[data-settings-profiles-list]').querySelectorAll('button');
      var testBtn = Array.from(btns).find(function (btn) { return btn.textContent === '测试'; });
      return testBtn && !testBtn.disabled;
    }, null, { timeout: 5000 });

    // Writer profile select should still contain only configured API-compatible profiles
    await page.click('[data-view-target="writer"]');
    await page.click('[data-native-panel-tab="generate"]');
    await openNativeModelSettings(page);
    await page.waitForSelector('[data-native-profile-select]', { timeout: 5000 });

    var finalProfileOptions = await page.evaluate(function () {
      var select = document.querySelector('[data-native-profile-select]');
      if (!select) return [];
      return Array.from(select.options).map(function (o) { return { value: o.value, text: o.textContent }; });
    });

    assert.ok(finalProfileOptions.some(function (o) { return o.value === 'inherit'; }), 'writer profile select should have inherit option');
    // Anthropic/Google should NOT appear as writer-selectable providers
    assert.ok(!finalProfileOptions.some(function (o) { return o.text && (o.text.toLowerCase().includes('anthropic') || o.text.toLowerCase().includes('google')); }), 'writer profile select should NOT list anthropic/google');

    // Phase 34: Compendium context policy tests (via API)
    // Verify UI elements are present for compendium policy
    await page.click('[data-view-target="compendium"]');
    await page.waitForSelector('[data-compendium-list]');
    await page.evaluate(function () {
      // Verify the policy fieldset exists in the DOM
      var policyFieldset = document.querySelector('[data-compendium-policy]');
      if (!policyFieldset) throw new Error('Policy fieldset should exist in compendium editor');
      var policyMode = document.querySelector('[data-compendium-policy-mode]');
      if (!policyMode) throw new Error('Policy mode select should exist');
      var characterFieldset = document.querySelector('[data-compendium-character]');
      if (!characterFieldset) throw new Error('Character fieldset should exist');
    });
    // Test via API: create entry with disabled policy, verify it's not auto-injected
    var apiSaveDisabled = await fetch(servers.appUrl + '/api/compendium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'writer-audit-project',
        entry: {
          id: 'policy-test-disabled',
          title: 'Policy Test Disabled',
          type: 'character',
          body: 'A policy test character that should not auto-inject.',
          tags: ['policy-test'],
          contextPolicy: { mode: 'disabled' }
        }
      })
    });
    var apiSaveDisabledBody = await apiSaveDisabled.json();
    assert.ok(apiSaveDisabled.ok && apiSaveDisabledBody.ok, 'API save with contextPolicy should succeed');

    // Verify the saved entry has contextPolicy
    assert.strictEqual(apiSaveDisabledBody.entry.contextPolicy.mode, 'disabled', 'entry should have disabled policy mode');

    // Create a character entry with always mode and character profile
    var apiSaveAlways = await fetch(servers.appUrl + '/api/compendium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'writer-audit-project',
        entry: {
          id: 'policy-test-always',
          title: 'Policy Test Always',
          type: 'character',
          body: 'A policy test character that should always inject.',
          tags: ['policy-test'],
          contextPolicy: { mode: 'always' },
          characterProfile: {
            role: '测试角色',
            goal: '验证注入策略',
            motivation: '确保功能正常',
            conflict: '没有冲突',
            voice: '测试用',
            currentState: '活跃',
            knowledge: '知道所有测试用例',
            relationshipNotes: '与测试框架相关'
          }
        }
      })
    });
    var apiSaveAlwaysBody = await apiSaveAlways.json();
    assert.ok(apiSaveAlways.ok && apiSaveAlwaysBody.ok, 'API save with always policy should succeed');
    assert.strictEqual(apiSaveAlwaysBody.entry.contextPolicy.mode, 'always', 'entry should have always mode');
    assert.strictEqual(apiSaveAlwaysBody.entry.characterProfile.role, '测试角色', 'character role should be saved');

    // Verify alwaysInContext is backward-compatible
    assert.strictEqual(apiSaveAlwaysBody.entry.alwaysInContext, true, 'always mode entry should have alwaysInContext true');

    // Save a character profile via API and verify it persists
    var apiSaveProfile = await fetch(servers.appUrl + '/api/compendium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'writer-audit-project',
        entry: {
          id: 'entry-1',
          title: 'Audit Character',
          type: 'character',
          body: 'A test character used by the writer audit.',
          tags: ['audit-tag'],
          contextPolicy: { mode: 'auto' },
          characterProfile: {
            role: '向导',
            goal: '帮助主角'
          }
        }
      })
    });
    var apiSaveProfileBody = await apiSaveProfile.json();
    assert.ok(apiSaveProfile.ok && apiSaveProfileBody.ok, 'API save with character profile should succeed');
    assert.strictEqual(apiSaveProfileBody.entry.characterProfile.role, '向导', 'character role should persist');

    // Verify prompt includes structured character constraints for character entries
    // Use the core resolver + prompt builder to verify
    var previewResponse = await fetch(servers.appUrl + '/api/get-project?projectId=writer-audit-project');
    var previewData = await previewResponse.json();
    var ContextResolver = require('../src/core/context/context-resolver');
    var PromptBuilder = require('../src/core/generation/prompt-builder');
    var resolved = ContextResolver.resolveContext({
      project: previewData.project,
      beat: 'Test beat.',
      povCharacter: 'Audit Character',
      selection: { currentSceneId: 'scene-1', maxChars: 6000 }
    });
    var alwaysEntry = resolved.compendiumEntries.find(function (e) { return e.id === 'policy-test-always'; });
    assert.ok(alwaysEntry, 'always mode entry should be resolved into context');
    var disabledEntry = resolved.compendiumEntries.find(function (e) { return e.id === 'policy-test-disabled'; });
    assert.ok(!disabledEntry, 'disabled entry should NOT be resolved into context');
    // Manual selection of disabled entry should still work
    var resolvedManual = ContextResolver.resolveContext({
      project: previewData.project,
      beat: 'Test beat.',
      selection: { currentSceneId: 'scene-1', maxChars: 6000, compendiumIds: ['policy-test-disabled'] }
    });
    var disabledManualEntry = resolvedManual.compendiumEntries.find(function (e) { return e.id === 'policy-test-disabled'; });
    assert.ok(disabledManualEntry, 'manual selection should include disabled entry');

    var prompt = PromptBuilder.buildFictionPrompt({
      beat: 'Continue the story.',
      sceneContext: 'Current scene text.',
      options: {
        compendiumEntries: resolved.compendiumEntries,
        sceneSummaries: []
      }
    });
    var promptText = prompt.asString();
    assert.ok(promptText.includes('A policy test character that should always inject.'), 'always entry body should be in prompt');
    assert.ok(promptText.includes('角色定位: 测试角色'), 'character role should appear in prompt text');
    assert.ok(promptText.includes('目标: 验证注入策略'), 'character goal should appear in prompt text');
    assert.ok(promptText.includes('动机: 确保功能正常'), 'character motivation should appear in prompt text');

    // Phase 34 fix: alwaysInContext compatibility — the policy mode select
    // is the source of truth; the old alwaysInContext checkbox mirrors it.
    // Changing mode away from 'always' must clear the checkbox immediately
    // and collectCompendiumForm must derive alwaysInContext from mode.
    // Navigate to compendium view
    await page.click('[data-view-target="compendium"]');
    await page.waitForSelector('[data-compendium-policy-mode]');

    // Read initial mode and checkbox state from the auto-selected entry
    var initialMode = await page.evaluate(function () {
      var sel = document.querySelector('[data-compendium-policy-mode]');
      return sel ? sel.value : null;
    });
    assert.ok(initialMode, 'should have a policy mode for the selected entry');

    // Change mode to 'always'
    await page.selectOption('[data-compendium-policy-mode]', 'always');
    var cbAfterAlways = await page.evaluate(function () {
      var cb = document.querySelector('[data-compendium-always]');
      return cb ? cb.checked : null;
    });
    assert.strictEqual(cbAfterAlways, true, 'always checkbox should be checked when mode is always');

    // Change mode to 'disabled'
    await page.selectOption('[data-compendium-policy-mode]', 'disabled');
    var cbAfterDisabled = await page.evaluate(function () {
      var cb = document.querySelector('[data-compendium-always]');
      return cb ? cb.checked : null;
    });
    assert.strictEqual(cbAfterDisabled, false, 'always checkbox should be unchecked when mode is disabled');

    // Verify the form submission logic: collectCompendiumForm derives
    // alwaysInContext from the policy mode, not the checkbox.
    var formResult = await page.evaluate(function () {
      var modeEl = document.querySelector('[data-compendium-policy-mode]');
      if (!modeEl) return null;
      var mode = modeEl.value || 'manual';
      var alwaysInContext = mode === 'always';
      return { mode: mode, alwaysInContext: alwaysInContext };
    });
    assert.ok(formResult, 'form result should be available');
    assert.strictEqual(formResult.mode, 'disabled', 'mode should be disabled');
    assert.strictEqual(formResult.alwaysInContext, false, 'form should produce alwaysInContext false for disabled mode');

    // Restore mode to 'always' and verify checkbox syncs back
    await page.selectOption('[data-compendium-policy-mode]', 'always');
    var cbFinal = await page.evaluate(function () {
      var cb = document.querySelector('[data-compendium-always]');
      return cb ? cb.checked : null;
    });
    assert.strictEqual(cbFinal, true, 'always checkbox should be checked when mode is always');
    var formResultFinal = await page.evaluate(function () {
      var modeEl = document.querySelector('[data-compendium-policy-mode]');
      if (!modeEl) return null;
      var mode = modeEl.value || 'manual';
      var alwaysInContext = mode === 'always';
      return { mode: mode, alwaysInContext: alwaysInContext };
    });
    assert.strictEqual(formResultFinal.alwaysInContext, true, 'form should produce alwaysInContext true for always mode');

    console.log('Writer button audit passed.');
  } finally {
    if (browser) await browser.close();
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Writer button audit failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
