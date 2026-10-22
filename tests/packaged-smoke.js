const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const exePath = process.env.DRAFTHARBOR_PACKAGED_EXE || path.join(root, 'release', 'win-unpacked', 'DraftHarbor.exe');

(async () => {
  await fs.access(exePath);
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-packaged-smoke-'));
  let electronApp = null;

  try {
    electronApp = await electron.launch({
      executablePath: exePath,
      args: [`--user-data-dir=${path.join(dataRoot, 'profile')}`],
      env: {
        ...process.env,
        DRAFTHARBOR_DATA_ROOT: dataRoot
      }
    });

    const window = await electronApp.firstWindow();
    const pageUrl = window.url();
    assert.ok(pageUrl.startsWith('draftharbor://app/desktop.html'), `loaded URL should start with draftharbor://app/desktop.html, got: ${pageUrl}`);

    await window.waitForSelector('#desktop-root', { timeout: 30000 });
    await window.waitForSelector('[data-workshop-mode="agent"]', { state: 'attached', timeout: 30000 });

    const profilePath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    assert.strictEqual(path.resolve(profilePath), path.join(dataRoot, 'profile'), 'packaged smoke must use an isolated browser profile');

    const listBefore = await window.evaluate(async () => {
      const response = await fetch('/api/list-projects');
      const json = await response.json();
      return { status: response.status, json };
    });
    assert.ok(listBefore.status === 200 && listBefore.json && listBefore.json.ok, 'packaged app should list projects');
    assert.ok(String(listBefore.json.projectSaveLocation || '').startsWith(path.join(dataRoot, 'projects')), 'packaged app should use test data root');

    const created = await window.evaluate(async () => {
      const response = await fetch('/api/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            name: 'Packaged Smoke Project',
            description: 'Created by packaged smoke test.'
          }
        })
      });
      const json = await response.json();
      return { status: response.status, json };
    });
    assert.ok(created.status === 200 && created.json && created.json.ok, `create-project failed: ${JSON.stringify(created.json)}`);
    const projectId = created.json.project.project.id;
    const sceneId = created.json.project.scenes[0].id;
    const chapterId = created.json.project.chapters[0].id;

    const saved = await window.evaluate(async (projectData) => {
      const p = projectData.project;
      p.sceneContents[projectData.sceneId] = 'Packaged persistence line.';
      p.scenes[0].title = 'Packaged Scene';
      p.currentSceneId = projectData.sceneId;
      p.currentChapterId = projectData.chapterId;
      const response = await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
      const json = await response.json();
      return { status: response.status, json };
    }, { project: created.json.project, sceneId, chapterId });
    assert.ok(saved.status === 200 && saved.json && saved.json.ok, `save-project failed: ${JSON.stringify(saved.json)}`);

    const reopened = await window.evaluate(async (pid) => {
      const response = await fetch(`/api/get-project?projectId=${encodeURIComponent(pid)}`);
      const json = await response.json();
      return { status: response.status, json };
    }, projectId);
    assert.ok(reopened.status === 200 && reopened.json && reopened.json.ok, 'saved project should reopen');
    assert.ok(
      Object.values(reopened.json.project.sceneContents || {}).some((content) => String(content).includes('Packaged persistence line.')),
      'saved project content should persist in packaged app data root'
    );

    // Open the isolated project through the packaged UI so this also verifies
    // that the new fragment, controller, stylesheet and revision module ship.
    await window.reload({ waitUntil: 'domcontentloaded' });
    await window.locator('.desktop-project-card').filter({ hasText: 'Packaged Smoke Project' }).click();
    const writer = window.locator('[data-native-writer]');
    const editor = window.locator('[data-native-scene-editor]');
    await window.waitForFunction(() => document.querySelector('[data-native-scene-editor]')?.value === 'Packaged persistence line.');
    assert.strictEqual(await writer.evaluate(node => node.classList.contains('is-literary-desk')), true, 'packaged projects should open in the literary desk');
    assert.strictEqual(await editor.evaluate(node => getComputedStyle(node).fontSize), '24px', 'packaged prose should use the actual 24px default');
    for (const mode of ['write', 'conceive', 'revise']) {
      assert.strictEqual(await window.locator(`[data-native-desk-mode="${mode}"]`).isVisible(), true, `packaged ${mode} mode should be reachable`);
    }
    await window.locator('[data-native-desk-mode="conceive"]').click();
    assert.strictEqual(await window.locator('[data-native-gen-task="beat"]').evaluate(node => node.classList.contains('is-active')), true, 'conceive should route to the real beat control');
    await window.locator('[data-native-desk-mode="write"]').click();
    assert.strictEqual(await window.locator('[data-native-gen-task="continue"]').evaluate(node => node.classList.contains('is-active')), true, 'write should route to the real continuation control');

    // Select exactly "Packaged" with native keyboard input. No model is called.
    await editor.focus();
    await window.keyboard.press('Control+Home');
    await window.keyboard.down('Shift');
    for (let index = 0; index < 'Packaged'.length; index += 1) await window.keyboard.press('ArrowRight');
    await window.keyboard.up('Shift');
    await window.locator('[data-native-desk-mode="revise"]').click();
    await window.locator('[data-native-panel="rewrite"]').waitFor({ state: 'visible' });
    await window.locator('[data-native-revision-layer]').waitFor({ state: 'visible' });
    assert.strictEqual(await window.locator('[data-native-revision-mark]').textContent(), 'Packaged', 'packaged revision highlight should retain the exact selection');
    assert.strictEqual(await window.locator('[data-native-revision-excerpt]').textContent(), 'Packaged', 'packaged revision context should match the highlighted original');
    await window.locator('[data-native-revision-locate]').click();
    assert.deepStrictEqual(await editor.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 8], 'locate should restore the same native selection');
    assert.strictEqual(await editor.inputValue(), 'Packaged persistence line.', 'opening revision must preserve the manuscript');

    const backup = await window.evaluate(async (projectData) => {
      const response = await fetch('/api/create-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...projectData,
          backupRequest: {
            reason: 'packaged-smoke',
            note: 'Packaged smoke backup.'
          }
        })
      });
      const json = await response.json();
      return { status: response.status, json };
    }, reopened.json.project);
    assert.ok(backup.status === 200 && backup.json && backup.json.ok, `save-local-backup failed: ${JSON.stringify(backup.json)}`);

    const backups = await window.evaluate(async (pid) => {
      const response = await fetch(`/api/list-backups?projectId=${encodeURIComponent(pid)}`);
      const json = await response.json();
      return { status: response.status, json };
    }, projectId);
    assert.ok(backups.status === 200 && backups.json && backups.json.ok, 'packaged app should list backups');
    assert.ok(backups.json.backups.some((item) => item.reason === 'packaged-smoke'), 'packaged backup should be visible');

    console.log('Packaged smoke test passed.');
  } catch (error) {
    console.error('Packaged smoke test failed:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      try { await electronApp.close(); } catch { /* ignore */ }
    }
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})();
