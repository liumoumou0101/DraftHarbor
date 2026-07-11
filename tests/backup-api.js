const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');

let APP_URL = '';

function snapshot(projectId, name, sceneText, exportedAt) {
    const chapterId = `${projectId}-chapter-1`;
    const sceneId = `${projectId}-scene-1`;
    return {
        version: '2.1-backup-test',
        exportedAt,
        project: {
            id: projectId,
            name,
            created: exportedAt,
            modified: exportedAt
        },
        chapters: [{
            id: chapterId,
            projectId,
            title: 'Chapter 1',
            order: 0,
            created: exportedAt,
            modified: exportedAt
        }],
        scenes: [{
            id: sceneId,
            projectId,
            chapterId,
            title: 'Scene 1',
            order: 0,
            created: exportedAt,
            modified: exportedAt
        }],
        sceneContents: {
            [sceneId]: sceneText
        },
        compendium: [],
        prompts: [],
        codex: [],
        promptHistory: [],
        workshopSessions: []
    };
}

async function api(pathname, options = {}) {
    assert.ok(APP_URL, 'APP_URL should be set from startDesktopServers() before API calls');
    const response = await fetch(`${APP_URL}${pathname}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const body = await response.json().catch(() => ({}));
    assert.ok(response.ok && body.ok, `${pathname} failed: ${response.status} ${JSON.stringify(body)}`);
    return body;
}

async function createBackup(payload, requestOptions) {
    return api('/api/create-backup', {
        method: 'POST',
        body: JSON.stringify({
            ...payload,
            backupRequest: requestOptions
        })
    });
}

(async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-backup-api-'));
    let servers = null;

    try {
        servers = await startDesktopServers({
            appRoot: path.resolve(__dirname, '..'),
            dataRoot,
            chooseBackupFolder: null,
            chooseProjectSaveFolder: null,
            openPath: null
        });
        APP_URL = servers.appUrl;

        const projectId = `backup-test-${Date.now()}`;
        const baseTime = Date.parse('2026-06-23T00:00:00.000Z');

        const first = await createBackup(
            snapshot(projectId, 'Backup API Test', 'first stable draft', new Date(baseTime).toISOString()),
            { reason: 'manual', note: 'stable draft', retention: { mode: 'count', count: 10 } }
        );
        assert.ok(first.backupId, 'first backup should return an id');

        let list = await api(`/api/list-backups?projectId=${encodeURIComponent(projectId)}`);
        assert.strictEqual(list.backupLocation, path.join(dataRoot, 'projects', 'backups'), 'default backup location should live under the project library');
        assert.strictEqual(list.backups.length, 1, 'one backup should be listed after first create');
        assert.strictEqual(list.backups[0].pinned, false, 'new backups should not be pinned by default');
        assert.strictEqual(list.backups[0].note, 'stable draft', 'backup note should be preserved');
        assert.strictEqual(list.backups[0].health, 'ok', 'valid backups should report healthy status');
        assert.ok(list.backups[0].size > 0, 'backup summary should include file size');

        const corruptPath = path.join(dataRoot, 'project-backups', projectId, 'broken-backup.json');
        await fs.mkdir(path.dirname(corruptPath), { recursive: true });
        await fs.writeFile(corruptPath, '{broken json', 'utf8');
        list = await api(`/api/list-backups?projectId=${encodeURIComponent(projectId)}`);
        const corruptSummary = list.backups.find(backup => backup.id === 'broken-backup.json');
        assert.ok(corruptSummary, 'corrupt backup files should still appear in the list');
        assert.strictEqual(corruptSummary.health, 'invalid', 'corrupt backup files should be marked invalid');
        assert.ok(corruptSummary.healthMessage, 'invalid backups should include a health message');
        await fs.rm(corruptPath, { force: true });

        const pinned = await api('/api/update-backup', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, pinned: true })
        });
        assert.strictEqual(pinned.backup.pinned, true, 'update-backup should pin a backup');

        const noted = await api('/api/update-backup', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, note: 'edited important version' })
        });
        assert.strictEqual(noted.backup.note, 'edited important version', 'update-backup should edit a backup note');
        assert.strictEqual(noted.backup.pinned, true, 'editing a note should not clear the pinned flag');

        for (let i = 1; i <= 3; i++) {
            await createBackup(
                snapshot(projectId, 'Backup API Test', `revision ${i}`, new Date(baseTime + i * 1000).toISOString()),
                { reason: 'manual', note: `revision ${i}`, retention: { mode: 'count', count: 1 } }
            );
        }

        list = await api(`/api/list-backups?projectId=${encodeURIComponent(projectId)}`);
        const ids = list.backups.map(backup => backup.id);
        assert.ok(ids.includes(first.backupId), 'pinned backup should survive retention pruning');
        assert.strictEqual(list.backups.filter(backup => !backup.pinned).length, 1, 'retention count should apply to unpinned backups');
        assert.strictEqual(list.backups.length, 2, 'list should include pinned backups plus retained unpinned backups');

        const pinnedData = await api(`/api/get-backup?projectId=${encodeURIComponent(projectId)}&backupId=${encodeURIComponent(first.backupId)}`);
        assert.strictEqual(pinnedData.backup.backupMeta.pinned, true, 'pinned flag should be stored in backup metadata');
        assert.deepStrictEqual(Object.values(pinnedData.backup.sceneContents), ['first stable draft'], 'pinned backup contents should remain readable');

        await api('/api/save-project', {
            method: 'POST',
            body: JSON.stringify(snapshot(projectId, 'Backup API Test', 'current changed draft', new Date(baseTime + 5000).toISOString()))
        });
        const diff = await api(`/api/backup-diff?projectId=${encodeURIComponent(projectId)}&backupId=${encodeURIComponent(first.backupId)}`);
        assert.strictEqual(diff.hasCurrentProject, true, 'backup diff should detect current project directory');
        assert.strictEqual(diff.diff.changed, 1, 'backup diff should report changed scene text');

        const restored = await api('/api/restore-backup', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, mode: 'replace' })
        });
        assert.strictEqual(restored.projectId, projectId, 'replace restore should keep original project id');
        assert.ok(restored.preRestoreBackup && restored.preRestoreBackup.backupId, 'replace restore should create a pre-restore snapshot');
        const restoredProject = await api(`/api/get-project?projectId=${encodeURIComponent(projectId)}`);
        assert.deepStrictEqual(Object.values(restoredProject.project.sceneContents), ['first stable draft'], 'replace restore should restore backup text');

        await api('/api/save-project', {
            method: 'POST',
            body: JSON.stringify(snapshot(projectId, 'Backup API Test', 'scene changed again', new Date(baseTime + 6000).toISOString()))
        });
        const backupSceneId = pinnedData.backup.scenes[0].id;
        const sceneRestore = await api('/api/restore-backup-scene', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, sceneId: backupSceneId })
        });
        assert.ok(sceneRestore.preRestoreBackup && sceneRestore.preRestoreBackup.backupId, 'scene restore should create a pre-restore snapshot');
        const sceneRestoredProject = await api(`/api/get-project?projectId=${encodeURIComponent(projectId)}`);
        assert.deepStrictEqual(Object.values(sceneRestoredProject.project.sceneContents), ['first stable draft'], 'scene restore should restore only the selected scene text');

        const recovered = await api('/api/restore-backup', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, mode: 'new-project' })
        });
        assert.notStrictEqual(recovered.projectId, projectId, 'new-project restore should create a new project id');
        const recoveredProject = await api(`/api/get-project?projectId=${encodeURIComponent(recovered.projectId)}`);
        assert.match(recoveredProject.project.project.name, /Recovered/, 'new-project restore should rename the recovered project');
        assert.deepStrictEqual(Object.values(recoveredProject.project.sceneContents), ['first stable draft'], 'new-project restore should keep backup contents');

        const unpinned = await api('/api/update-backup', {
            method: 'POST',
            body: JSON.stringify({ projectId, backupId: first.backupId, pinned: false })
        });
        assert.strictEqual(unpinned.backup.pinned, false, 'update-backup should unpin a backup');

        await api('/api/cleanup-backups', {
            method: 'POST',
            body: JSON.stringify({ scope: 'project', projectId })
        });
        list = await api(`/api/list-backups?projectId=${encodeURIComponent(projectId)}`);
        assert.strictEqual(list.backups.length, 0, 'explicit project cleanup should delete all backups');

        console.log('Backup API test passed.');
    } finally {
        if (servers) servers.close();
        await fs.rm(dataRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error('Backup API test failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
