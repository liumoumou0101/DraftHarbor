const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('desktop/fragments/reader.html');
const desktop = read('desktop.html');
const bindings = read('src/desktop/shell/shell-bindings.js');
const css = read('src/styles/desktop/reader.css');
const settings = read('src/desktop/shell/reader-settings.js');
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
assert.ok(desktop.includes('src/desktop/shell/reader-library.js'), 'reader library module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-workspace.js'), 'reader workspace module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-reading.js'), 'reader reading module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-settings.js'), 'reader settings module must load independently');
assert.ok(desktop.includes('src/core/document/reader-layout.js'), 'reader layout core must load before the reading module');
assert.ok(desktop.includes('src/core/document/reader-navigation.js'), 'reader navigation core must load before navigation UI');
assert.ok(desktop.includes('src/core/document/reader-selection.js'), 'reader selection core must load before selection UI');
assert.ok(desktop.includes('src/core/document/reader-transfer-schema.js'), 'reader transfer schema must load before selection UI');
assert.ok(desktop.includes('src/desktop/shell/reader-navigation.js'), 'reader navigation module must load independently');
assert.ok(desktop.includes('src/desktop/shell/reader-selection.js'), 'reader selection module must load independently');
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
for (const hook of [
  'data-reader-search-form', 'data-reader-search-cancel', 'data-reader-search-results',
  'data-reader-bookmark-create', 'data-reader-bookmarks', 'data-reader-progress-slider',
  'data-reader-touch-prev', 'data-reader-touch-next'
]) {
  assert.ok(html.includes(hook), `reader navigation must include ${hook}`);
}
for (const hook of [
  'data-reader-selection-toggle', 'data-reader-selection-toolbar', 'data-reader-transfer-dialog',
  'data-reader-transfer-scope', 'data-reader-transfer-chapters', 'data-reader-transfer-destination'
]) {
  assert.ok(html.includes(hook), `reader transfer selection must include ${hook}`);
}
assert.ok(settings.includes("readerState.preferenceScope === 'document'"), 'reader settings must support per-document overrides');
assert.ok(settings.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'reader settings must honor the system reduced-motion preference');
assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'reader themes must not load remote assets');
assert.ok(!settings.includes('canvas') && !settings.includes('Canvas'), 'curl must remain deferred without a canvas authority path');
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
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-workspace.js'), 'utf8') < 24 * 1024, 'reader workspace module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(read('src/desktop/shell/reader-reading.js'), 'utf8') < 24 * 1024, 'reader reading module must remain below the 24 KiB budget');
assert.ok(Buffer.byteLength(settings, 'utf8') < 24 * 1024, 'reader settings module must remain below the 24 KiB budget');
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
