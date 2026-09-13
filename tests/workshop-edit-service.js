const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectStore = require('../desktop/storage/project-file-store');
const compendiumStore = require('../desktop/storage/compendium-store');
const workshopStore = require('../desktop/storage/workshop-store');
const paths = require('../desktop/storage/library-paths');
const { createWorkshopEditService, revisionForScene, revisionForEntry } = require('../desktop/services/workshop-edit-service');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(root, projectId = 'project-a') {
  const project = (await projectStore.createProject(root, {
    id: projectId, title: 'Agent fixture', updatedAt: '2026-09-13T00:00:00.000Z',
    chapters: [{ id: 'chapter-a', title: 'A', summary: 'Original chapter summary', sceneIds: ['scene-a', 'scene-b'] }],
    scenes: [{ id: 'scene-a', chapterId: 'chapter-a', title: 'Scene A', content: 'Original A', summary: 'Summary A' },
      { id: 'scene-b', chapterId: 'chapter-a', title: 'Scene B', content: 'Original B' }]
  })).project;
  const entry = await compendiumStore.saveEntry(root, projectId, {
    id: 'entry-a', type: 'character', title: 'Card A', body: 'Original card',
    sourceReferences: [{ kind: 'reader', sceneId: 'scene-a', excerpt: 'Evidence', createdAt: '2026-09-13T00:00:00.000Z' }],
    relatedSceneIds: ['scene-a'], imageUrl: 'cover.png', order: 4, characterProfile: { voice: 'Soft' }
  });
  await workshopStore.saveSession(root, projectId, { id: 'session-a', title: 'Discussion' });
  return { project, entry, scene: project.scenes.find((scene) => scene.id === 'scene-a'), projectId, sessionId: 'session-a' };
}

function sceneChange(scene, patch = { content: 'Agent A' }) {
  return { kind: 'scene.update', sceneId: scene.id, expectedRevision: revisionForScene(scene), patch, reason: 'Requested edit' };
}

function entryChange(entry, patch = { body: 'Agent card' }) {
  return { kind: 'compendium.update', entryId: entry.id, expectedRevision: revisionForEntry(entry), patch };
}

function args(f, extra) { return { projectId: f.projectId, sessionId: f.sessionId, ...extra }; }
async function opened(root, f) { return projectStore.openProject(root, f.projectId); }
async function entries(root, f) { return compendiumStore.listEntries(root, f.projectId); }

const cases = [
  ['ordinary project saves preserve dedicated stores, while explicit restores replace them', async (root, f) => {
    const stale = f.project;
    const projectPath = paths.projectDir(root, f.projectId);
    const promptPath = path.join(projectPath, 'prompts', 'prompts.json');
    await fs.writeFile(promptPath, JSON.stringify([{ id: 'new-prompt', projectId: f.projectId, name: 'Dedicated prompt' }]));
    const before = await Promise.all(['compendium/entries.json', 'prompts/prompts.json', 'workshop/sessions.json'].map((name) => fs.readFile(path.join(projectPath, name), 'utf8')));
    const saved = await projectStore.saveProject(root, { ...stale, scenes: stale.scenes.map((scene) => ({ ...scene, content: 'Ordinary writer' })) });
    const after = await Promise.all(['compendium/entries.json', 'prompts/prompts.json', 'workshop/sessions.json'].map((name) => fs.readFile(path.join(projectPath, name), 'utf8')));
    assert.deepStrictEqual(after, before);
    assert.strictEqual(saved.project.compendium.length, 1);
    assert.strictEqual(saved.project.workshopSessions.length, 1);
    await projectStore.saveProject(root, stale, { replaceDedicatedStores: true });
    assert.deepStrictEqual(await entries(root, f), []);
    assert.deepStrictEqual((await opened(root, f)).workshopSessions, []);
  }],
  ['writer revisions reject stale whole snapshots and ignore dedicated card/session edits', async (root, f) => {
    const before = await opened(root, f);
    await compendiumStore.saveEntry(root, f.projectId, { id: 'entry-a', title: 'Dedicated change' });
    await workshopStore.saveSession(root, f.projectId, { id: 'session-new', title: 'New discussion' });
    assert.strictEqual((await opened(root, f)).writerRevision, before.writerRevision);
    const next = await projectStore.saveProject(root, { ...before, title: 'New title' });
    assert.notStrictEqual(next.writerRevision, before.writerRevision);
    assert.strictEqual(next.writerRevision, (await opened(root, f)).writerRevision);
    await assert.rejects(projectStore.saveProject(root, { ...before, title: 'Stale title' }), { name: 'ProjectConflictError', statusCode: 409 });
    await assert.rejects(projectStore.saveProject(root, { ...before, writerRevision: undefined }, { expectedWriterRevision: before.writerRevision }), { statusCode: 409 });
    assert.strictEqual((await opened(root, f)).title, 'New title');
  }],
  ['preview is read-only; mixed apply is persistent, preserves metadata, and advances writer version', async (root, f) => {
    let backupCount = 0;
    const service = createWorkshopEditService({ createBackup: async (dataRoot, projectId) => {
      backupCount += 1;
      const snapshot = await projectStore.openProject(dataRoot, projectId);
      assert.strictEqual(snapshot.scenes[0].content, 'Original A');
      return { backup: { backupId: 'backup-a' } };
    } });
    const changes = [sceneChange(f.scene, { content: 'Agent A', summary: 'Agent summary' }),
      entryChange(f.entry, { body: 'Agent card', characterProfile: { goal: 'New goal' } }),
      { kind: 'compendium.create', entry: { title: 'Created card', type: 'note', body: 'New body' } }];
    const proposal = await service.preview(root, args(f, { changes }));
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
    assert.strictEqual((await entries(root, f)).length, 1);
    const receipt = await service.apply(root, args(f, { proposal }));
    assert.strictEqual(receipt.status, 'applied');
    assert.strictEqual(backupCount, 1);
    assert.deepStrictEqual(receipt.backup, { backupId: 'backup-a' });
    const current = await opened(root, f);
    assert.strictEqual(current.scenes[0].content, 'Agent A');
    assert.strictEqual(current.scenes[0].summary, 'Agent summary');
    assert.strictEqual(current.scenes[0].summaryStale, false);
    assert.notStrictEqual(current.writerRevision, f.project.writerRevision);
    const changedEntry = (await entries(root, f)).find((entry) => entry.id === f.entry.id);
    for (const field of ['sourceReferences', 'relatedSceneIds', 'imageUrl', 'order']) assert.deepStrictEqual(changedEntry[field], f.entry[field]);
    assert.strictEqual(changedEntry.characterProfile.voice, 'Soft');
    assert.strictEqual(changedEntry.characterProfile.goal, 'New goal');
    assert.ok(Date.parse(changedEntry.updatedAt) > Date.parse(f.entry.updatedAt));
  }],
  ['scene edits advance project freshness and invalidate current chapter summaries on apply and undo', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene)] }));
    const receipt = await service.apply(root, args(f, { proposal }));
    const current = await opened(root, f);
    assert.ok(Date.parse(current.updatedAt) > Date.parse(f.project.updatedAt));
    assert.strictEqual(current.scenes[0].summaryStale, true);
    assert.strictEqual(current.chapters[0].summaryStale, true);
    current.chapters[0].summary = 'Regenerated from Agent A';
    current.chapters[0].summaryStale = false;
    current.chapters[0].title = 'User renamed chapter';
    await projectStore.saveProject(root, current);
    await service.undo(root, args(f, { receipt }));
    const undone = await opened(root, f);
    assert.ok(Date.parse(undone.updatedAt) > Date.parse(current.updatedAt));
    assert.strictEqual(undone.chapters[0].summary, 'Regenerated from Agent A', 'undo must preserve later chapter work');
    assert.strictEqual(undone.chapters[0].title, 'User renamed chapter');
    assert.strictEqual(undone.chapters[0].summaryStale, true, 'a summary describing the applied text is stale after undo');
    assert.strictEqual(undone.scenes[0].content, 'Original A');
  }],
  ['apply uses the stored proposal and remains idempotent across service restart and caller tampering', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), { kind: 'compendium.create', entry: { title: 'Only once', body: 'Body' } }] }));
    proposal.changes[0].after.content = 'Tampered body';
    proposal.changes.push({ kind: 'scene.delete', sceneId: 'scene-b' });
    const first = await service.apply(root, args(f, { proposal }));
    const duplicate = await createWorkshopEditService().apply(root, args(f, { proposal }));
    assert.deepStrictEqual(duplicate, first);
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Agent A');
    assert.strictEqual((await entries(root, f)).filter((entry) => entry.title === 'Only once').length, 1);
  }],
  ['one stale member rejects the entire mixed batch before backup or any write', async (root, f) => {
    let backups = 0;
    const service = createWorkshopEditService({ createBackup: async () => { backups += 1; } });
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), entryChange(f.entry), { kind: 'compendium.create', entry: { title: 'Never created' } }] }));
    await compendiumStore.saveEntry(root, f.projectId, { id: f.entry.id, body: 'User changed card' });
    await assert.rejects(service.apply(root, args(f, { proposal })), { statusCode: 409 });
    assert.strictEqual(backups, 0);
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
    assert.strictEqual((await entries(root, f)).length, 1);
    assert.strictEqual((await entries(root, f))[0].body, 'User changed card');
  }],
  ['undo restores only touched records, preserves unrelated work and is idempotent', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), entryChange(f.entry), { kind: 'compendium.create', entry: { title: 'Temporary' } }] }));
    const receipt = await service.apply(root, args(f, { proposal }));
    await compendiumStore.saveEntry(root, f.projectId, { id: 'unrelated', title: 'User card' });
    const current = await opened(root, f);
    current.scenes[1].content = 'Unrelated scene edit';
    await projectStore.saveProject(root, current);
    const undone = await service.undo(root, args(f, { receipt: { ...receipt, changes: [] } }));
    assert.strictEqual(undone.status, 'undone');
    assert.deepStrictEqual(await createWorkshopEditService().undo(root, args(f, { receipt })), undone);
    assert.strictEqual((await service.apply(root, args(f, { proposal }))).status, 'undone', 'retrying an undone proposal must not reapply it');
    const final = await opened(root, f);
    assert.strictEqual(final.scenes[0].content, 'Original A');
    assert.strictEqual(final.scenes[1].content, 'Unrelated scene edit');
    const cards = await entries(root, f);
    assert.strictEqual(cards.length, 2);
    assert.strictEqual(cards.find((entry) => entry.id === f.entry.id).body, 'Original card');
    assert.strictEqual(cards.find((entry) => entry.id === 'unrelated').title, 'User card');
  }],
  ['undo refuses to overwrite a changed existing record or delete a changed created card', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), { kind: 'compendium.create', entry: { title: 'New card' } }] }));
    const receipt = await service.apply(root, args(f, { proposal }));
    const id = receipt.changes[1].entryId;
    await compendiumStore.saveEntry(root, f.projectId, { id, body: 'User expanded this card' });
    await assert.rejects(service.undo(root, args(f, { receipt })), { statusCode: 409 });
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Agent A', 'undo must not partly restore scenes when any card conflicts');
    assert.strictEqual((await entries(root, f)).find((entry) => entry.id === id).body, 'User expanded this card');
  }],
  ['whole saves and card writes wait behind the complete Agent backup/commit transaction', async (root, f) => {
    await fixture(root, 'project-b');
    const entered = deferred();
    const resume = deferred();
    const service = createWorkshopEditService({ createBackup: async () => { entered.resolve(); await resume.promise; return { backupId: 'held' }; } });
    const stale = await opened(root, f);
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), entryChange(f.entry)] }));
    const applying = service.apply(root, args(f, { proposal }));
    await entered.promise;
    let ordinaryDone = false;
    let cardDone = false;
    const ordinary = projectStore.saveProject(root, { ...stale, title: 'Stale writer snapshot' }).then(() => { ordinaryDone = true; return null; }, (error) => { ordinaryDone = true; return error; });
    const card = compendiumStore.saveEntry(root, f.projectId, { id: 'concurrent', title: 'Concurrent card' }).then((value) => { cardDone = true; return value; });
    const other = await projectStore.openProject(root, 'project-b');
    await projectStore.saveProject(root, { ...other, title: 'Other project progresses' });
    assert.strictEqual(ordinaryDone, false);
    assert.strictEqual(cardDone, false);
    resume.resolve();
    await applying;
    assert.strictEqual((await ordinary).statusCode, 409);
    await card;
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Agent A');
    assert.strictEqual((await entries(root, f)).find((entry) => entry.id === 'concurrent').title, 'Concurrent card');
  }],
  ['failed backups make no changes and release the project lock', async (root, f) => {
    const service = createWorkshopEditService({ createBackup: async () => { throw new Error('Backup unavailable'); } });
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene)] }));
    await assert.rejects(service.apply(root, args(f, { proposal })), /Backup unavailable/);
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
    assert.strictEqual((await createWorkshopEditService().apply(root, args(f, { proposal }))).status, 'applied');
  }],
  ['a mid-batch file failure rolls back every target and a later retry applies once', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), entryChange(f.entry), { kind: 'compendium.create', entry: { title: 'Retry once' } }] }));
    const originalRename = fs.rename;
    let failed = false;
    fs.rename = async (from, to) => {
      if (!failed && to === compendiumStore.entriesPath(paths.projectDir(root, f.projectId))) {
        failed = true;
        throw Object.assign(new Error('Injected disk failure'), { code: 'EIO' });
      }
      return originalRename(from, to);
    };
    try { await assert.rejects(service.apply(root, args(f, { proposal })), /complete batch was rolled back/); }
    finally { fs.rename = originalRename; }
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
    assert.strictEqual((await entries(root, f)).length, 1);
    assert.strictEqual((await entries(root, f))[0].body, 'Original card');
    const receipt = await service.apply(root, args(f, { proposal }));
    assert.strictEqual(receipt.status, 'applied');
    assert.strictEqual((await entries(root, f)).filter((entry) => entry.title === 'Retry once').length, 1);
  }],
  ['a failed undo restores the applied batch and can be retried safely', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene), entryChange(f.entry)] }));
    const receipt = await service.apply(root, args(f, { proposal }));
    const originalRename = fs.rename;
    let failed = false;
    fs.rename = async (from, to) => {
      if (!failed && to === compendiumStore.entriesPath(paths.projectDir(root, f.projectId))) {
        failed = true;
        throw Object.assign(new Error('Injected undo disk failure'), { code: 'EIO' });
      }
      return originalRename(from, to);
    };
    try { await assert.rejects(service.undo(root, args(f, { receipt })), /complete batch was rolled back/); }
    finally { fs.rename = originalRename; }
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Agent A');
    assert.strictEqual((await entries(root, f))[0].body, 'Agent card');
    assert.strictEqual((await service.undo(root, args(f, { receipt }))).status, 'undone');
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
  }],
  ['an interrupted journal blocks ambiguous retries instead of duplicating creations or claiming success', async (root, f) => {
    const service = createWorkshopEditService();
    const proposal = await service.preview(root, args(f, { changes: [{ kind: 'compendium.create', entry: { title: 'One creation' } }] }));
    const receipt = await service.apply(root, args(f, { proposal }));
    const target = path.join(paths.projectDir(root, f.projectId), 'workshop', 'edits', 'receipts', `${receipt.receiptId}.json`);
    const persisted = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.ok(persisted.files[0].before.includes('Original card'), 'the durable journal must retain original bytes for recovery');
    await fs.writeFile(target, JSON.stringify({ ...persisted, status: 'applying' }));
    await assert.rejects(createWorkshopEditService().apply(root, args(f, { proposal })), { statusCode: 409 });
    await assert.rejects(service.undo(root, args(f, { receipt })), { statusCode: 409 });
    assert.strictEqual((await entries(root, f)).filter((entry) => entry.title === 'One creation').length, 1);
  }],
  ['project/session ownership, paths, unsupported operations and unknown fields are rejected', async (root, f) => {
    const service = createWorkshopEditService();
    await fixture(root, 'project-b');
    const invalid = [
      { kind: 'scene.delete', sceneId: f.scene.id },
      { ...sceneChange(f.scene), sceneId: '../scene-a' },
      { ...sceneChange(f.scene), patch: { title: 'Forbidden' } },
      { ...sceneChange(f.scene), projectId: 'project-b' },
      { ...sceneChange(f.scene), expectedRevision: undefined },
      { kind: 'compendium.create', entry: { id: 'arbitrary-id', title: 'Forbidden' } },
      { kind: 'compendium.create', entry: { title: 'Forbidden', sourceReferences: [] } },
      { ...entryChange(f.entry), patch: { characterProfile: { __unexpected: 'x' } } },
      { ...entryChange(f.entry), patch: { tags: 'not an array' } }
    ];
    for (const change of invalid) await assert.rejects(service.preview(root, args(f, { changes: [change] })), { statusCode: 400 });
    await assert.rejects(service.preview(root, args(f, { changes: [sceneChange(f.scene), sceneChange(f.scene)] })), { statusCode: 400 });
    await assert.rejects(service.preview(root, args(f, { projectId: '../project-a', changes: [sceneChange(f.scene)] })), { statusCode: 400 });
    await assert.rejects(service.preview(root, args(f, { sessionId: 'missing', changes: [sceneChange(f.scene)] })), { statusCode: 409 });
    const proposal = await service.preview(root, args(f, { changes: [sceneChange(f.scene)] }));
    await workshopStore.saveSession(root, f.projectId, { id: 'session-b', title: 'Other session' });
    await assert.rejects(service.apply(root, args(f, { sessionId: 'session-b', proposal })), { statusCode: 400 });
    await workshopStore.deleteSession(root, f.projectId, f.sessionId);
    await assert.rejects(service.apply(root, args(f, { proposal })), { statusCode: 409 });
    assert.strictEqual((await opened(root, f)).scenes[0].content, 'Original A');
  }],
  ['corrupted cards abort before a proposal or whole-project save can overwrite them', async (root, f) => {
    const target = compendiumStore.entriesPath(paths.projectDir(root, f.projectId));
    await fs.writeFile(target, '{bad json');
    await assert.rejects(createWorkshopEditService().preview(root, args(f, { changes: [sceneChange(f.scene)] })), SyntaxError);
    await assert.rejects(projectStore.saveProject(root, f.project), SyntaxError);
    assert.strictEqual(await fs.readFile(target, 'utf8'), '{bad json');
  }]
];

(async () => {
  for (const [name, run] of cases) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workshop-edit-'));
    let watchdog;
    try {
      const f = await fixture(root);
      await Promise.race([run(root, f), new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 15000); })]);
      console.log(`PASS ${name}`);
    } finally {
      clearTimeout(watchdog);
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  console.log(`Workshop edit service tests passed (${cases.length} cases; isolated files, no providers).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
