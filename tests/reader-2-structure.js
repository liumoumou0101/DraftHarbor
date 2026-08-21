const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const bytes = (relativePath) => Buffer.byteLength(read(relativePath), 'utf8');
const lines = (relativePath) => read(relativePath).split(/\r?\n/).length;
const readerCoreFileBudget = 32 * 1024;

const readerShellModules = [
  'reader-library.js', 'reader-reading.js', 'reader-page-flip.js', 'reader-settings.js', 'reader-navigation.js',
  'reader-selection.js', 'reader-input-coordinator.js', 'reader-profile-settings.js', 'reader-bookmarks.js', 'reader-annotation-ui.js', 'reader-hud.js', 'reader-appearance-studio.js', 'reader-tts.js', 'reader-workspace.js', 'reader-import-wizard.js', 'reader-project-bridge.js'
];
readerShellModules.forEach((name) => {
  assert.ok(lines(`src/desktop/shell/${name}`) <= 1400, `${name} must remain under the global shell line gate`);
});
assert.ok(bytes('src/desktop/shell/reader-import-wizard.js') < 20 * 1024, 'new import wizard must remain below the F-12 soft size target');
assert.ok(bytes('src/styles/desktop/reader-import.css') < 20 * 1024, 'new import style layer must remain below the F-12 soft size target');
assert.ok(bytes('src/desktop/shell/reader.js') < 26 * 1024, 'legacy reader compatibility shell must stay below the temporary split gate');
assert.ok(bytes('src/desktop/shell/reader-project-bridge.js') < 20 * 1024, 'project projection bridge must remain independently bounded');
assert.ok(bytes('src/desktop/shell/reader-hud.js') < 20 * 1024, 'reader HUD shell must remain independently bounded');
assert.ok(bytes('src/desktop/shell/reader-appearance-studio.js') < 20 * 1024, 'reader appearance studio must remain independently bounded');
assert.ok(bytes('desktop/services/reader-project-library-service.js') < 20 * 1024, 'project library service must remain independently bounded');
assert.ok(bytes('src/styles/desktop/reader.css') < readerCoreFileBudget, 'reader foundation style layer must stay below the 32 KiB mature-core gate');
assert.ok(bytes('src/styles/desktop/reader-hud.css') < 16 * 1024, 'reader HUD style layer must remain independently bounded');
assert.ok(lines('desktop/fragments/reader.html') <= 400, 'reader fragment must remain a composition fragment');

const desktop = read('desktop.html');
const fragment = read('desktop/fragments/reader.html');
const service = read('desktop/services/reader-library-service.js');
const wizard = read('src/desktop/shell/reader-import-wizard.js');
assert.ok(service.includes('ReaderEpubAdapter.parseEpub'), 'Reader import service must use the EPUB adapter');
assert.ok(desktop.includes('reader-import.css') && desktop.includes('reader-import-wizard.js') && desktop.includes('reader-project-bridge.js') && desktop.includes('reader-appearance.css') && desktop.includes('reader-appearance-studio.js'), 'F-12 reader assets must be loaded independently');
assert.ok(desktop.includes('src/core/document/reader-preferences.js') && desktop.includes('src/core/document/reader-font-catalog.js') && desktop.includes('src/core/document/reader-annotation.js'), 'F-12.2 contracts must load independently');
assert.ok(desktop.includes('src/core/document/reader-transition.js'), 'F-12.6 transition adapter must load independently');
assert.ok(desktop.indexOf('page-flip.browser.js') < desktop.indexOf('reader-page-flip.js')
  && desktop.indexOf('reader-page-flip.js') < desktop.indexOf('reader-reading.js'), 'vendored StPageFlip and its adapter must load before Reader navigation');
assert.ok(fragment.includes('data-reader-page-flip-host'), 'Reader must expose an isolated page-flip presentation host');
assert.ok(desktop.includes('src/core/document/reader-tts.js'), 'F-12.11 TTS contract must load independently');
assert.ok(desktop.includes('reader-input-coordinator.js') && desktop.includes('reader-profile-settings.js'), 'F-12.6 shell modules must load independently');
assert.ok(desktop.includes('reader-annotation-ui.js'), 'F-12.7 annotation UI must load independently');
assert.ok(fragment.includes('data-reader-import-dialog') && fragment.includes('data-reader-font-dialog'), 'Reader dialogs must stay in the Reader fragment');
assert.ok(fragment.includes('.epub') && fragment.includes('application/epub+zip'), 'Reader import picker must accept EPUB files');
assert.ok(service.includes('previewBytesImport') && service.includes('sourcePath: \'\''), 'browser byte imports must be stored without path disclosure');
assert.ok(wizard.includes('/api/reader/import/correct') && wizard.includes('/api/reader/import/discard'), 'import wizard must own correction and discard lifecycle');
assert.ok(!wizard.includes('localStorage'), 'import wizard must not mirror正文 into localStorage');

console.log('Reader 2.0 structure tests passed.');
