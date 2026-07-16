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
      env: {
        ...process.env,
        DRAFTHARBOR_DATA_ROOT: dataRoot
      }
    });

    const window = await electronApp.firstWindow();
    const pageUrl = window.url();
    assert.ok(pageUrl.startsWith('draftharbor://app/desktop.html'), `loaded URL should start with draftharbor://app/desktop.html, got: ${pageUrl}`);

    await window.waitForSelector('#desktop-root', { timeout: 30000 });

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
    process.exit(1);
  } finally {
    if (electronApp) {
      try { await electronApp.close(); } catch { /* ignore */ }
    }
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})();
