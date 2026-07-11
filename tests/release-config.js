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
assert.strictEqual(pkg.build.asar, false, 'asar should stay disabled until an asar runtime verification exists');

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
assert.ok(!localServer.includes('const APP_PORT = 8000'), 'test HTTP adapter should not define a fixed app port');
assert.ok(!localServer.includes('const UPDATER_PORT = 8001'), 'test HTTP adapter should not define a fixed updater port');
assert.ok(localServer.includes('appUrl') && localServer.includes('updaterUrl'), 'startDesktopServers should return dynamic test adapter URLs');

const desktopShell = fs.readFileSync(path.join(root, 'src/desktop/desktop-shell.js'), 'utf8');
assert.ok(
  !desktopShell.includes('main.html?runtime=desktop&embedded=writer'),
  'desktop shell should no longer reference the legacy writer iframe entry'
);
assert.ok(desktopShell.includes('data-desktop-theme') || desktopShell.includes('desktopTheme'), 'desktop shell should apply the global desktop theme');

const desktopHtml = fs.readFileSync(path.join(root, 'desktop.html'), 'utf8');
assert.ok(!desktopHtml.includes('legacy-writer-frame'), 'desktop.html should not contain the legacy writer iframe');
assert.ok(!desktopHtml.includes('data-native-open-legacy'), 'desktop.html should not contain the legacy writer button');
assert.ok(desktopHtml.includes('data-settings-theme'), 'desktop.html should expose the desktop theme setting');
assert.ok(desktopHtml.includes('data-settings-theme-choice="morandi-ink"'), 'desktop.html should include Morandi Ink as a selectable theme');
assert.ok(desktopHtml.includes('data-native-paper-heading'), 'desktop.html should include the writer manuscript paper heading');
assert.ok(desktopHtml.includes('data-native-paper-footer'), 'desktop.html should include the writer manuscript paper footer');
assert.ok(desktopHtml.includes('data-native-copilot-greeting'), 'desktop.html should include the Copilot assistant brief');
assert.ok(desktopHtml.includes('data-native-copilot-context-note'), 'desktop.html should include the Copilot context card');
assert.ok(desktopHtml.includes('data-native-model-settings'), 'desktop.html should keep model controls in a collapsible settings section');
assert.ok(desktopHtml.includes('data-settings-cat-target="storage"'), 'settings should expose storage and maintenance as a first-class category');
assert.ok(desktopHtml.includes('data-settings-section="storage"'), 'settings should include resolved project and backup locations');
assert.ok(desktopHtml.includes('desktop-recovery-safe-actions'), 'recovery should present safe restore actions before destructive replacement');
assert.ok(desktopHtml.includes('desktop-recovery-danger-zone'), 'recovery should isolate replace-original in a danger zone');
assert.ok(desktopHtml.includes('稿湾') && desktopHtml.includes('DraftHarbor'), 'desktop entry should expose the independent product identity');
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
    && desktopHtml.indexOf('ai-task-runner.js') < desktopHtml.indexOf('desktop-shell.js'),
  'AI task core modules should load in dependency order before desktop-shell.js'
);
assert.ok(desktopShell.includes('createAITaskRunner'), 'desktop rewrite flows should use the shared AI task runner');
assert.ok(desktopShell.includes('setSettingsCategory'), 'settings category navigation should switch focused panels instead of only scrolling');
assert.ok(localServer.includes('storageLocations'), 'settings API should return resolved project and backup locations');

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
