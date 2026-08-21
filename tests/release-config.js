const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function fileExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

assert.strictEqual(pkg.main, 'desktop/main.js', 'Electron should start from the desktop main process');
assert.strictEqual(pkg.name, 'draftharbor-desktop', 'package name should use the independent DraftHarbor identity');
assert.strictEqual(pkg.license, 'GPL-3.0-or-later', 'package metadata should declare GPL-3.0-or-later');
assert.strictEqual(pkg.build.appId, 'io.github.liumoumou0101.draftharbor', 'Electron appId should not reuse the former project identity');
assert.strictEqual(pkg.build.productName, 'DraftHarbor', 'packaged product should be named DraftHarbor');
assert.ok(fileExists(pkg.main), 'desktop main process should exist');
assert.ok(!pkg.scripts['legacy-ui-test'], 'package scripts should not expose legacy-ui-test as a product script');
assert.ok(!String(pkg.scripts.test || '').includes('legacy'), 'npm test should not run legacy UI checks');
assert.ok(!String(pkg.scripts.smoke || '').includes('main.html'), 'smoke test should target the desktop entry, not main.html');
assert.ok(!String(pkg.scripts['backup-test'] || '').includes('backup-browser'), 'backup-test should not run the retired browser recovery UI');
assert.ok(String(pkg.scripts.unit || '').includes('tests/protocol-handler.js'), 'unit tests should cover the direct protocol handler path');

assert.ok(pkg.build, 'electron-builder config should exist');
assert.strictEqual(pkg.build.asar, true, 'production packages should keep application sources in an ASAR archive');
assert.strictEqual(pkg.build.publish, undefined, 'build config must not declare "never" as a fake publish provider');
assert.ok(String(pkg.scripts.dist || '').includes('--publish never'), 'dist must build locally without publishing before validation');

const files = pkg.build.files || [];
for (const required of ['desktop/**/*', 'src/**/*', 'desktop.html', 'package.json']) {
  assert.ok(files.includes(required), `build.files should include ${required}`);
}

assert.ok(!files.includes('main.html'), 'build.files should no longer require main.html as the legacy writer has been retired');

assert.ok(pkg.dependencies && pkg.dependencies.jszip, 'jszip is required at runtime by project package import/export');
assert.ok(!((pkg.devDependencies || {}).jszip), 'runtime jszip should not be dev-only');

const desktopMain = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
assert.ok(desktopMain.includes('draftharbor://app/desktop.html'), 'desktop main should load the desktop entry via the DraftHarbor protocol');
assert.ok(
  desktopMain.includes('protocol.registerSchemesAsPrivileged') && (desktopMain.includes('protocol.handle(\'draftharbor\'') || desktopMain.includes('protocol.handle("draftharbor"')),
  'desktop main should register and handle the DraftHarbor custom protocol'
);
assert.ok(!desktopMain.includes('http://127.0.0.1:8000/desktop.html'), 'desktop main must not load via hardcoded 127.0.0.1:8000 HTTP URL');
assert.ok(!desktopMain.includes('startDesktopServers'), 'desktop main must not call startDesktopServers');
assert.ok(!desktopMain.includes("isReachable('http://127.0.0.1:8000") && !desktopMain.includes('isReachable("http://127.0.0.1:8000'), 'desktop main must not check port 8000 reachability');
assert.ok(desktopMain.includes('createDesktopProtocolHandler'), 'desktop main should use createDesktopProtocolHandler for local API routing');

assert.ok(!desktopMain.includes('onBeforeRequest'), 'desktop main should not contain webRequest redirect shim for old updater port');

assert.ok(!fileExists('src/update-checker.js'), 'the inherited web updater should not be present');
assert.ok(!fileExists('main.html'), 'the inherited web application entry should not be present');
assert.ok(!fileExists('src/app.js'), 'the inherited Alpine application should not be present');
assert.ok(!fileExists('src/generation.js'), 'the inherited browser generation adapter should not be present');
assert.ok(!fileExists('tools/writingway-server.py'), 'the inherited Python application server should not be present');
assert.ok(!fileExists('tools/updater-server.py'), 'the inherited Python updater should not be present');
assert.ok(!fileExists('logo.png') && !fileExists('favicon.ico'), 'former project brand assets should not be present');

const localServer = fs.readFileSync(path.join(root, 'desktop/local-server.js'), 'utf8');
assert.ok(localServer.split(/\r?\n/).length <= 800, 'local-server.js should remain a composition layer instead of growing into a new monolith');
for (const modulePath of [
  'desktop/controllers/update-controller.js',
  'desktop/controllers/import-export-controller.js',
  'desktop/controllers/backup-controller.js',
  'desktop/controllers/generation-controller.js',
  'desktop/controllers/runtime-controller.js',
  'desktop/controllers/settings-controller.js',
  'desktop/controllers/project-controller.js',
  'desktop/controllers/knowledge-controller.js',
  'desktop/controllers/workshop-controller.js',
  'desktop/controllers/workflow-controller.js',
  'desktop/protocol/protocol-router.js',
  'desktop/protocol/http-test-adapter.js'
]) {
  assert.ok(fileExists(modulePath), `${modulePath} should keep its responsibility outside local-server.js`);
}
assert.ok(!localServer.includes('function createMockNodeRequest'), 'HTTP test adaptation should not live in local-server.js');
assert.ok(!localServer.includes('async function getUpdateDownloadUrl'), 'update behavior should not live in local-server.js');
assert.ok(!localServer.includes("parsedUrl.pathname === '/api/export-project-package'"), 'import/export routes should not live in local-server.js');
assert.ok(!localServer.includes("parsedUrl.pathname === '/api/restore-backup'"), 'backup routes should not live in local-server.js');
assert.ok(!localServer.includes("parsedUrl.pathname === '/api/settings/test-provider'"), 'generation provider routes should not live in local-server.js');
assert.ok(!localServer.includes('parsedUrl.pathname ==='), 'product API routes should be owned by controllers, not local-server.js');
assert.ok(!localServer.includes('const APP_PORT = 8000'), 'test HTTP adapter should not define a fixed app port');
assert.ok(!localServer.includes('const UPDATER_PORT = 8001'), 'test HTTP adapter should not define a fixed updater port');
const httpTestServer = fs.readFileSync(path.join(root, 'desktop/protocol/http-test-server.js'), 'utf8');
assert.ok(httpTestServer.includes('appUrl') && httpTestServer.includes('updaterUrl'), 'startDesktopServers should return dynamic test adapter URLs');

const desktopShellDir = path.join(root, 'src/desktop/shell');
const desktopShellFiles = listFiles(desktopShellDir);
const desktopShell = desktopShellFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
assert.ok(desktopShellFiles.length >= 10, 'desktop shell should be separated by product responsibility');
// Line gates apply to product shell modules. tests/**, audits, and unit
// fixtures are not the program body and are not counted here.
assert.ok(desktopShellFiles.every((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).length <= 1400), 'no desktop shell module should become a replacement monolith');
assert.ok(!fileExists('src/desktop/desktop-shell.js'), 'the former desktop shell monolith should stay retired');
assert.ok(
  !desktopShell.includes('main.html?runtime=desktop&embedded=writer'),
  'desktop shell should no longer reference the legacy writer iframe entry'
);
assert.ok(desktopShell.includes('data-desktop-theme') || desktopShell.includes('desktopTheme'), 'desktop shell should apply the global desktop theme');

const desktopHtml = fs.readFileSync(path.join(root, 'desktop.html'), 'utf8');
const desktopFragmentDir = path.join(root, 'desktop/fragments');
const desktopFragments = listFiles(desktopFragmentDir).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const desktopMarkup = `${desktopHtml}\n${desktopFragments}`;
assert.ok(desktopHtml.split(/\r?\n/).length <= 120, 'desktop.html should remain a small composition shell');
assert.ok(desktopHtml.includes('src/desktop/fragment-loader.js'), 'desktop.html should load view fragments before the desktop shell');
assert.ok(!desktopMarkup.includes('legacy-writer-frame'), 'desktop markup should not contain the legacy writer iframe');
assert.ok(!desktopMarkup.includes('data-native-open-legacy'), 'desktop markup should not contain the legacy writer button');
assert.ok(desktopMarkup.includes('data-settings-theme'), 'desktop markup should expose the desktop theme setting');
assert.ok(desktopMarkup.includes('data-settings-theme-choice="morandi-ink"'), 'desktop markup should include Morandi Ink as a selectable theme');
assert.ok(desktopMarkup.includes('data-settings-theme-choice="night-paper"'), 'desktop markup should include Night Paper as a selectable theme');
assert.ok(desktopMarkup.includes('data-settings-theme-choice="harbor-dusk"'), 'desktop markup should include Harbor Dusk as a selectable theme');
assert.ok(desktopMarkup.includes('data-settings-theme-choice="xuan-paper"'), 'desktop markup should include Xuan Paper as a selectable theme');
assert.ok(desktopMarkup.includes('data-native-paper-heading'), 'desktop markup should include the writer manuscript paper heading');
assert.ok(desktopMarkup.includes('data-native-paper-footer'), 'desktop markup should include the writer manuscript paper footer');
assert.ok(desktopMarkup.includes('data-native-copilot-greeting'), 'desktop markup should include the Copilot assistant brief');
assert.ok(desktopMarkup.includes('data-native-copilot-context-note'), 'desktop markup should include the Copilot context card');
assert.ok(desktopMarkup.includes('data-native-model-settings'), 'desktop markup should keep model controls in a collapsible settings section');
assert.ok(desktopHtml.includes('src/styles/desktop/desktop-writer-chrome.css'), 'desktop.html should load writer chrome after finishing');
assert.ok(desktopHtml.includes('src/styles/desktop/desktop-compendium-chrome.css'), 'desktop.html should load compendium chrome after writer chrome');
assert.ok(desktopHtml.includes('src/styles/desktop/desktop-workshop-chrome.css'), 'desktop.html should load workshop chrome after compendium chrome');
assert.ok(desktopHtml.includes('src/styles/desktop/desktop-recovery-chrome.css'), 'desktop.html should load recovery chrome after workshop chrome');
assert.ok(desktopHtml.includes('src/styles/desktop/desktop-settings-chrome.css'), 'desktop.html should load settings chrome after recovery chrome');
assert.ok(
  desktopHtml.indexOf('desktop-writer-chrome.css') < desktopHtml.indexOf('desktop-compendium-chrome.css'),
  'compendium chrome must load after writer chrome'
);
assert.ok(
  desktopHtml.indexOf('desktop-compendium-chrome.css') < desktopHtml.indexOf('desktop-workshop-chrome.css'),
  'workshop chrome must load after compendium chrome'
);
assert.ok(desktopHtml.includes('src/desktop/shell/writer-chrome.js'), 'desktop.html should load writer chrome after writer-prompts.js');
assert.ok(
  desktopHtml.indexOf('writer-prompts.js') < desktopHtml.indexOf('writer-chrome.js'),
  'writer-chrome.js must load after writer-prompts.js so it can wrap renderNativeRewrite'
);
const writerSidebarResize = fs.readFileSync(path.join(root, 'src/desktop/shell/writer-sidebar-resize.js'), 'utf8');
assert.ok(writerSidebarResize.includes('NATIVE_ASSISTANT_MIN_HEIGHT = 208'), 'writer dock drag floor should be 208');
assert.ok(desktopMarkup.includes('data-settings-cat-target="storage"'), 'settings should expose storage and maintenance as a first-class category');
assert.ok(desktopMarkup.includes('data-settings-section="storage"'), 'settings should include resolved project and backup locations');
assert.ok(desktopMarkup.includes('desktop-recovery-safe-actions'), 'recovery should present safe restore actions before destructive replacement');
assert.ok(desktopMarkup.includes('desktop-recovery-danger-zone'), 'recovery should isolate replace-original in a danger zone');
assert.ok(desktopMarkup.includes('稿湾') && desktopMarkup.includes('DraftHarbor'), 'desktop entry should expose the independent product identity');
for (const aiTaskScript of [
  'src/core/generation/ai-task-contract.js',
  'src/core/generation/ai-task-history.js',
  'src/core/generation/ai-task-runner.js'
]) {
  assert.ok(desktopHtml.includes(aiTaskScript), `desktop.html should load ${aiTaskScript}`);
}
assert.ok(
  desktopHtml.indexOf('ai-task-contract.js') < desktopHtml.indexOf('ai-task-history.js')
    && desktopHtml.indexOf('ai-task-history.js') < desktopHtml.indexOf('ai-task-runner.js')
    && desktopHtml.indexOf('ai-task-runner.js') < desktopHtml.indexOf('shell-bootstrap.js'),
  'AI task core modules should load before the desktop shell bootstrap'
);
assert.ok(desktopShell.includes('createAITaskRunner'), 'desktop rewrite flows should use the shared AI task runner');
assert.ok(desktopShell.includes('setSettingsCategory'), 'settings category navigation should switch focused panels instead of only scrolling');
const desktopStyleFiles = listFiles(path.join(root, 'src/styles/desktop'));
assert.ok(desktopStyleFiles.length >= 6, 'desktop styles should be split into ordered cascade layers');
assert.ok(desktopStyleFiles.every((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).length <= 2200), 'no desktop style layer should become a replacement monolith');
assert.ok(!fileExists('src/styles/desktop.css'), 'the former desktop stylesheet monolith should stay retired');
const settingsController = fs.readFileSync(path.join(root, 'desktop/controllers/settings-controller.js'), 'utf8');
assert.ok(settingsController.includes('storageLocations'), 'settings API should return resolved project and backup locations');

assert.ok(!fileExists('tests/run-legacy-ui-tests.js'), 'legacy UI test runner should be removed');
assert.ok(!fileExists('tests/backup-browser.js'), 'browser backup test should be removed');
assert.ok(!fileExists('tests/helpers/legacy-app.js'), 'legacy app test helper should be removed');
assert.ok(!fileExists('tests/helpers/legacy-cdn-routes.js'), 'legacy CDN test helper should be removed');

const retiredLegacyTestTargets = listFiles(path.join(root, 'tests'))
  .filter((file) => path.basename(file) !== 'release-config.js')
  .filter((file) => fs.readFileSync(file, 'utf8').includes('main.html'));
assert.deepStrictEqual(
  retiredLegacyTestTargets.map((file) => path.relative(root, file)),
  [],
  'tests should not target retired main.html runtime'
);

const fixedPortTestTargets = listFiles(path.join(root, 'tests'))
  .filter((file) => path.basename(file) !== 'release-config.js')
  .filter((file) => fs.readFileSync(file, 'utf8').includes('http://127.0.0.1:8000'));
assert.deepStrictEqual(
  fixedPortTestTargets.map((file) => path.relative(root, file)),
  [],
  'tests should use dynamic startDesktopServers() URLs instead of hardcoded 127.0.0.1:8000'
);

const startBat = fs.readFileSync(path.join(root, 'start.bat'), 'utf8');
assert.ok(!startBat.includes('main.html'), 'start.bat should not reference main.html');
assert.ok(!startBat.includes('8000'), 'start.bat should not bind or open the retired fixed web port');
assert.ok(startBat.includes('start-desktop-preview.cmd'), 'start.bat should delegate to the desktop preview launcher');

const desktopPreviewCmd = fs.readFileSync(path.join(root, 'start-desktop-preview.cmd'), 'utf8');
assert.ok(desktopPreviewCmd.includes('npm run desktop'), 'desktop preview launcher should start the Electron desktop app');
assert.ok(desktopPreviewCmd.includes('draftharbor://app/desktop.html'), 'desktop preview launcher should document the custom protocol desktop entry');
assert.ok(!desktopPreviewCmd.includes('main.html'), 'desktop preview launcher should not reference main.html');
assert.ok(!desktopPreviewCmd.includes('python -m http.server'), 'desktop preview launcher should not start a Python web server');
assert.ok(!desktopPreviewCmd.includes('localhost:8000'), 'desktop preview launcher should not open localhost:8000');

const startSh = fs.readFileSync(path.join(root, 'start.sh'), 'utf8');
assert.ok(!startSh.includes('main.html'), 'start.sh should not reference main.html');
assert.ok(!startSh.includes('localhost:8000'), 'start.sh should not open localhost:8000');
assert.ok(startSh.includes('npm run desktop'), 'start.sh should start the Electron desktop app');

console.log('Release configuration test passed.');
