const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('desktop/fragments/reader.html');
const desktop = read('desktop.html');
const bindings = read('src/desktop/shell/shell-bindings.js');
const css = read('src/styles/desktop/reader.css');
const hudCss = read('src/styles/desktop/reader-hud.css');
const appearanceCss = read('src/styles/desktop/reader-appearance.css');
const importCss = read('src/styles/desktop/reader-import.css');
const importWizard = read('src/desktop/shell/reader-import-wizard.js');
const settings = read('src/desktop/shell/reader-settings.js');
const appearanceStudio = read('src/desktop/shell/reader-appearance-studio.js');
const readerTts = read('src/desktop/shell/reader-tts.js');
const transferConsumer = read('src/desktop/shell/reader-transfer-consumer.js');
const writerTransfer = read('src/desktop/shell/reader-writer-transfer.js');
const compendiumTransfer = read('src/desktop/shell/reader-compendium-transfer.js');
const workflowTransfer = read('src/desktop/shell/reader-workflow-transfer.js');
const targetFragments = ['writer', 'compendium', 'workflow'].map((name) => read(`desktop/fragments/${name}.html`));

for (const hook of [
  'data-reader-shell', 'data-reader-left-drawer', 'data-reader-settings-drawer',
  'data-reader-library', 'data-reader-chapters', 'data-reader-content',
  'data-reader-topbar', 'data-reader-bottombar'
]) {
  assert.ok(html.includes(hook), `reader shell must include ${hook}`);
}

assert.ok(desktop.includes('src/styles/desktop/reader.css'), 'reader styles must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-hud.css'), 'reader HUD styles must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-appearance.css'), 'reader appearance styles must load independently');
assert.ok(desktop.includes('src/core/document/reader-hud.js'), 'reader HUD contract must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-hud.js'), 'reader HUD shell module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-library.js'), 'reader library module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-project-bridge.js'), 'reader project bridge must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-workspace.js'), 'reader workspace module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-import-wizard.js'), 'reader import wizard must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-import.css'), 'reader import styles must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-reading.js'), 'reader reading module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-tts.js'), 'reader TTS module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-settings.js'), 'reader settings module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-appearance-studio.js'), 'reader appearance studio must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-profile-settings.js'), 'reader profile settings module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-input-coordinator.js'), 'reader input coordinator must load independently');
assert.ok(desktop.includes('src/core/document/reader-layout.js'), 'reader layout core must load before the reading module');
assert.ok(desktop.includes('src/core/document/reader-transition.js'), 'reader transition adapter must load before the reading module');
assert.ok(desktop.includes('src/core/document/reader-navigation.js'), 'reader navigation core must load before navigation UI');
assert.ok(desktop.includes('src/core/document/reader-selection.js'), 'reader selection core must load before selection UI');
assert.ok(desktop.includes('src/core/document/reader-transfer-schema.js'), 'reader transfer schema must load before selection UI');
assert.ok(desktop.includes('src/desktop/shell/reader-navigation.js'), 'reader navigation module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-bookmarks.js'), 'reader bookmarks module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-selection.js'), 'reader selection module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-annotation-ui.js'), 'reader annotation UI module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-transfer-consumer.js'), 'reader target consumer module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-writer-transfer.js'), 'reader writer integration must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-writer-transfer.css'), 'reader writer integration styles must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-compendium-transfer.js'), 'reader compendium integration must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-compendium-transfer.css'), 'reader compendium integration styles must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-workflow-transfer.js'), 'reader workflow integration must load independently');
assert.ok(desktop.includes('src/styles/desktop/reader-workflow-transfer.css'), 'reader workflow integration styles must load independently');
assert.ok(bindings.includes("typeof initializeReaderWorkspace === 'function'"), 'missing workspace module must degrade gracefully');
assert.ok(css.includes('@layer reader-tokens'), 'reader theme tokens must have an explicit cascade layer');
assert.ok(css.includes('@media (max-width: 560px)'), 'reader shell must define a narrow-window layout');
for (const hook of [
  'data-reader-preference-scope', 'data-reader-letter-spacing', 'data-reader-page-margin',
  'data-reader-text-align', 'data-reader-page-transition', 'data-reader-reduced-motion'
]) {
  assert.ok(html.includes(hook), `reader settings must include ${hook}`);
}
assert.ok(html.includes('data-reader-appearance-profile'), 'reader settings must expose appearance profiles');
assert.ok(settings.includes('applyReaderAppearanceProfile'), 'reader settings must apply a named appearance profile');
assert.ok(settings.includes('appearanceProfileId'), 'reader settings must persist the selected appearance profile');
for (const section of ['scheme', 'paper', 'font', 'typography', 'page', 'motion', 'tts']) {
  assert.ok(html.includes(`data-reader-studio-tab="${section}"`), `appearance studio must expose the ${section} tab`);
  assert.ok(html.includes(`data-reader-studio-section="${section}"`), `appearance studio must expose the ${section} section`);
}
for (const hook of [
  'data-reader-quick-theme', 'data-reader-font-decrease', 'data-reader-font-increase',
  'data-reader-quick-font-family', 'data-reader-quick-layout', 'data-reader-quick-more',
  'data-reader-tts-toggle', 'data-reader-tts-stop', 'data-reader-tts-status',
  'data-reader-paper-material', 'data-reader-paper-shadow', 'data-reader-paper-vignette',
  'data-reader-appearance-undo', 'data-reader-appearance-save', 'data-reader-appearance-delete'
]) {
  assert.ok(html.includes(hook), `appearance studio must include ${hook}`);
}
for (const hook of ['data-reader-status-bar', 'data-reader-status-bar-mode', 'data-reader-status-field', 'data-reader-status-bar-auto-hide']) {
  assert.ok(html.includes(hook), `reader status bar must expose ${hook}`);
}
assert.ok(html.includes('value="cover"'), 'reader motion settings must expose the formal cover transition');
assert.ok(settings.includes('readerStatusBarState'), 'reader settings must keep stage status state separate from the controls');
assert.ok(appearanceStudio.includes('readerAppearanceStudioBeginSession') || appearanceStudio.includes('appearanceBeginSession'), 'appearance studio must capture a reversible session baseline');
assert.ok(appearanceStudio.includes('/api/reader/appearances'), 'appearance studio must persist user profiles through the local API');
assert.ok(appearanceCss.includes('data-reader-material="grain"'), 'appearance styles must provide the grain material');
assert.ok(appearanceCss.includes('data-reader-paper-shadow="false"'), 'appearance styles must support disabling paper shadow');
assert.ok(appearanceCss.includes('data-reader-vignette="false"'), 'appearance styles must support disabling the vignette');
assert.ok(appearanceCss.includes('assets/reader/paper-grain.svg'), 'appearance styles must use the local paper grain asset');
assert.ok(fs.existsSync(path.join(root, 'assets/reader/paper-grain.svg')), 'paper grain asset must be packaged locally');
assert.ok(read('docs/READER_ASSET_LICENSES.md').includes('paper-grain.svg'), 'paper grain asset must have a license record');
assert.ok(!/url\(\s*["']?https?:/i.test(appearanceCss), 'reader appearance styles must not load remote assets');
for (const hook of [
  'data-reader-import-dialog', 'data-reader-import-title', 'data-reader-import-chapters',
  'data-reader-import-encoding', 'data-reader-import-confirm', 'data-reader-font-help', 'data-reader-font-dialog',
  'data-reader-font-file', 'data-reader-font-list', 'data-reader-font-preview', 'data-reader-font-management-status'
]) {
  assert.ok(html.includes(hook), `reader import wizard must include ${hook}`);
}
assert.ok(bindings.includes("typeof initializeReaderImportWizard === 'function'"), 'reader bindings must initialize the import wizard');
assert.ok(importWizard.includes('/api/reader/import/file-preview-bytes'), 'reader import wizard must use the byte preview API');
assert.ok(importWizard.includes('/api/reader/import/confirm'), 'reader import wizard must confirm into the formal library');
assert.ok(html.includes('.epub') && html.includes('application/epub+zip'), 'reader import picker must accept EPUB files');
for (const hook of [
  'data-reader-search-form', 'data-reader-search-cancel', 'data-reader-search-results',
  'data-reader-bookmark-create', 'data-reader-bookmarks', 'data-reader-progress-slider',
  'data-reader-touch-prev', 'data-reader-touch-next'
]) {
  assert.ok(html.includes(hook), `reader navigation must include ${hook}`);
}
for (const hook of [
  'data-reader-selection-toggle', 'data-reader-selection-toolbar', 'data-reader-selection-copy', 'data-reader-transfer-dialog', 'data-reader-annotation-dialog',
  'data-reader-transfer-scope', 'data-reader-transfer-chapters', 'data-reader-transfer-destination',
  'data-reader-focus-toggle', 'data-reader-selection-highlight', 'data-reader-selection-underline',
  'data-reader-selection-note', 'data-reader-selection-bookmark', 'data-reader-annotations', 'data-reader-history'
]) {
  assert.ok(html.includes(hook), `reader transfer selection must include ${hook}`);
}
for (const hook of ['data-reader-tts-voice', 'data-reader-tts-rate', 'data-reader-tts-volume', 'data-reader-tts-paragraph-pause', 'data-reader-tts-auto-advance', 'data-reader-tts-timer', 'data-reader-tts-support-status']) {
  assert.ok(html.includes(hook), `reader TTS controls must include ${hook}`);
}
assert.ok(readerTts.includes('speechSynthesis'), 'reader TTS must use the local browser speech provider');
for (const state of ['idle', 'hidden', 'panel-open', 'selection-active']) {
  assert.ok(hudCss.includes(`data-reader-hud-state="${state}"`), `reader HUD styles must cover ${state}`);
}
assert.ok(html.includes('data-reader-hud-state="visible"'), 'reader shell must expose the initial HUD state');
assert.ok(html.includes('data-reader-focus-mode="false"'), 'reader shell must expose the initial focus mode');
assert.ok(settings.includes("readerState.preferenceScope === 'document'"), 'reader settings must support per-document overrides');
assert.ok(settings.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'reader settings must honor the system reduced-motion preference');
assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'reader themes must not load remote assets');
assert.ok(html.includes('<option value="curl">仿真翻页</option>'), 'curl transition must be available in the Reader settings');
assert.ok(appearanceCss.includes('data-reader-transition="curl"')
  && appearanceCss.includes('reader-page-curl-in-next')
  && appearanceCss.includes('reader-page-curl-out-next'), 'curl transition must have an implemented CSS animation path');
assert.ok(desktop.includes('src/vendor/page-flip-2.0.7/page-flip.browser.js')
  && desktop.includes('src/desktop/shell/reader-page-flip.js'), 'paged curl must load the vendored StPageFlip presentation adapter');
assert.ok(html.includes('data-reader-page-flip-engine="st-page-flip"'), 'Reader must identify the active page-flip engine for acceptance checks');
targetFragments.forEach((fragment, index) => {
  const destination = ['writer', 'compendium', 'workflow'][index];
  assert.ok(fragment.includes(`data-reader-source-bar="${destination}"`), `${destination} must expose the shared reader source bar`);
  assert.ok(fragment.includes('data-reader-source-use') && fragment.includes('data-reader-source-return'), `${destination} source bar must expose explicit use and return actions`);
});
assert.ok(!transferConsumer.includes('/api/reader/transfers'), 'targets must not enumerate unrelated transfer snapshots');
for (const hook of ['data-reader-writer-dialog', 'data-reader-writer-project', 'data-reader-writer-intent', 'data-reader-writer-sections', 'data-reader-writer-confirm', 'data-reader-writer-apply']) {
  assert.ok(targetFragments[0].includes(hook), `writer transfer preview must include ${hook}`);
}
for (const hook of ['data-reader-compendium-dialog', 'data-reader-compendium-cards', 'data-reader-compendium-confirm', 'data-reader-compendium-extract', 'data-reader-compendium-apply']) {
  assert.ok(targetFragments[1].includes(hook), `compendium transfer review must include ${hook}`);
}
for (const hook of ['data-reader-workflow-dialog', 'data-reader-workflow-project', 'data-reader-workflow-template', 'data-reader-workflow-confirm', 'data-reader-workflow-apply']) {
  assert.ok(targetFragments[2].includes(hook), `workflow transfer preview must include ${hook}`);
}
assert.ok(Buffer.byteLength(css, 'utf8') < 24 * 1024, 'reader stylesheet must remain below the 24 KiB shell budget');
assert.ok(Buffer.byteLength(importCss, 'utf8') < 24 * 1024, 'reader import stylesheet must remain below the 24 KiB shell budget');
assert.ok(Buffer.byteLength(appearanceCss, 'utf8') < 24 * 1024, 'reader appearance stylesheet must remain below the 24 KiB shell budget');
assert.ok(Buffer.byteLength(importWizard, 'utf8') < 20 * 1024, 'reader import wizard must remain below the F-12 soft budget');
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-workspace.js'), 'utf8') < 24 * 1024, 'reader workspace module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-reading.js'), 'utf8') < 24 * 1024, 'reader reading module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(settings, 'utf8') < 24 * 1024, 'reader settings module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(appearanceStudio, 'utf8') < 20 * 1024, 'reader appearance studio must remain below the F-12 soft budget');
assert.ok(Buffer.byteLength(readerTts, 'utf8') < 24 * 1024, 'reader TTS module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-navigation.js'), 'utf8') < 24 * 1024, 'reader navigation module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-selection.js'), 'utf8') < 24 * 1024, 'reader selection module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(transferConsumer, 'utf8') < 24 * 1024, 'reader target consumer module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(writerTransfer, 'utf8') < 24 * 1024, 'reader writer integration module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/styles/desktop/reader-writer-transfer.css'), 'utf8') < 24 * 1024, 'reader writer integration styles must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(compendiumTransfer, 'utf8') < 24 * 1024, 'reader compendium integration module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/styles/desktop/reader-compendium-transfer.css'), 'utf8') < 24 * 1024, 'reader compendium integration styles must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(workflowTransfer, 'utf8') < 24 * 1024, 'reader workflow integration module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/styles/desktop/reader-workflow-transfer.css'), 'utf8') < 24 * 1024, 'reader workflow integration styles must remain below the 24 KiB budget');

console.log('Reader shell structure tests passed.');
