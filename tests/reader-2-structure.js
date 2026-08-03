const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const bytes = (relativePath) => Buffer.byteLength(read(relativePath), 'utf8');
const lines = (relativePath) => read(relativePath).split(/\r?\n/).length;

const readerShellModules = [
  'reader-library.js', 'reader-reading.js', 'reader-settings.js', 'reader-navigation.js',
  'reader-selection.js', 'reader-workspace.js', 'reader-import-wizard.js', 'reader-project-bridge.js'
];
readerShellModules.forEach((name) => {
  assert.ok(lines(`src/desktop/shell/${name}`) <= 1400, `${name} must remain under the global shell line gate`);
});
assert.ok(bytes('src/desktop/shell/reader-import-wizard.js') < 20 * 1024, 'new import wizard must remain below the F-12 soft size target');
assert.ok(bytes('src/styles/desktop/reader-import.css') < 20 * 1024, 'new import style layer must remain below the F-12 soft size target');
assert.ok(bytes('src/desktop/shell/reader.js') < 26 * 1024, 'legacy reader compatibility shell must stay below the temporary split gate');
assert.ok(bytes('src/desktop/shell/reader-project-bridge.js') < 20 * 1024, 'project projection bridge must remain independently bounded');
assert.ok(bytes('desktop/services/reader-project-library-service.js') < 20 * 1024, 'project library service must remain independently bounded');
assert.ok(bytes('src/styles/desktop/reader.css') < 24 * 1024, 'reader foundation style layer must stay below the hard shell gate');
assert.ok(lines('desktop/fragments/reader.html') <= 400, 'reader fragment must remain a composition fragment');

const desktop = read('desktop.html');
const fragment = read('desktop/fragments/reader.html');
const service = read('desktop/services/reader-library-service.js');
const wizard = read('src/desktop/shell/reader-import-wizard.js');
assert.ok(desktop.includes('reader-import.css') && desktop.includes('reader-import-wizard.js') && desktop.includes('reader-project-bridge.js'), 'F-12 reader assets must be loaded independently');
assert.ok(desktop.includes('src/core/document/reader-preferences.js') && desktop.includes('src/core/document/reader-font-catalog.js') && desktop.includes('src/core/document/reader-annotation.js'), 'F-12.2 contracts must load independently');
assert.ok(fragment.includes('data-reader-import-dialog') && fragment.includes('data-reader-font-dialog'), 'Reader dialogs must stay in the Reader fragment');
assert.ok(service.includes('previewBytesImport') && service.includes('sourcePath: \'\''), 'browser byte imports must be stored without path disclosure');
assert.ok(wizard.includes('/api/reader/import/correct') && wizard.includes('/api/reader/import/discard'), 'import wizard must own correction and discard lifecycle');
assert.ok(!wizard.includes('localStorage'), 'import wizard must not mirror正文 into localStorage');

console.log('Reader 2.0 structure tests passed.');
