const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectService = require('../desktop/services/project-service');
const service = require('../desktop/services/compendium-service');
const agent = require('../desktop/services/compendium-agent-service');
const store = require('../desktop/storage/compendium-store');
const paths = require('../desktop/storage/library-paths');
const { createDesktopProtocolHandler } = require('../desktop/local-server');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function api(handler, pathname, body) {
  const response = await handler(new Request(`draftharbor://app${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }));
  return { status: response.status, payload: await response.json() };
}

const cases = [
  ['partial saves preserve omitted card metadata while explicit clears remain supported', async (root, projectId) => {
    const original = (await service.saveEntry(root, projectId, {
      id: 'source-card', type: 'character', title: 'Original title', body: 'Original body', order: 4,
      imageUrl: 'images/card.png', relatedSceneIds: ['scene-a'],
      sourceReferences: [{ kind: 'reader-transfer', envelopeId: 'source-envelope', sceneId: 'scene-a', excerpt: 'Source evidence.' }],
      characterProfile: { goal: 'Find the source', voice: 'Quiet' }
    })).entry;
    const changed = (await service.saveEntry(root, projectId, { id: original.id, title: 'Edited title' })).entry;
    assert.strictEqual(changed.title, 'Edited title');
    for (const field of ['type', 'body', 'createdAt', 'sourceReferences', 'relatedSceneIds', 'imageUrl', 'order', 'characterProfile']) {
      assert.deepStrictEqual(changed[field], original[field], `omitting ${field} must not replace it with schema defaults`);
    }
    const cleared = (await service.saveEntriesBatch(root, projectId, [{
      id: original.id, sourceReferences: [], relatedSceneIds: [], imageUrl: '', order: 0
    }])).entries[0];
    assert.deepStrictEqual(cleared.sourceReferences, []);
    assert.deepStrictEqual(cleared.relatedSceneIds, []);
    assert.strictEqual(cleared.imageUrl, '');
    assert.strictEqual(cleared.order, 0);
    assert.strictEqual(cleared.title, changed.title);
  }],
  ['concurrent successful saves retain every card and merge different fields of the same card', async (root, projectId) => {
    const replies = await Promise.all(Array.from({ length: 12 }, (_, index) => service.saveEntry(root, projectId, {
      id: `parallel-${index}`, type: 'note', title: `Card ${index}`
    })));
    const entries = (await service.listEntries(root, projectId)).entries;
    assert.strictEqual(replies.length, 12);
    assert.strictEqual(entries.length, 12, 'all twelve acknowledged creations must exist on disk');
    await Promise.all([
      service.saveEntry(root, projectId, { id: 'parallel-0', title: 'Concurrent title' }),
      service.saveEntry(root, projectId, { id: 'parallel-0', body: 'Concurrent body' })
    ]);
    const updated = (await service.listEntries(root, projectId)).entries.find(entry => entry.id === 'parallel-0');
    assert.strictEqual(updated.title, 'Concurrent title');
    assert.strictEqual(updated.body, 'Concurrent body');
  }],
  ['optional expectedUpdatedAt rejects stale and deleted cards, with an atomic batch rollback', async (root, projectId) => {
    const first = (await service.saveEntry(root, projectId, { id: 'versioned', title: 'Before' })).entry;
    const changed = (await service.saveEntry(root, projectId, { id: first.id, title: 'After', expectedUpdatedAt: first.updatedAt })).entry;
    assert.ok(Date.parse(changed.updatedAt) > Date.parse(first.updatedAt));
    await assert.rejects(service.saveEntry(root, projectId, { ...first, title: 'Stale full card', expectedUpdatedAt: first.updatedAt }), { name: 'CompendiumConflictError' });
    await assert.rejects(service.saveEntriesBatch(root, projectId, [
      { id: 'should-not-commit', title: 'Atomic batch' },
      { id: first.id, title: 'Stale batch update', expectedUpdatedAt: first.updatedAt }
    ]), { name: 'CompendiumConflictError' });
    const entries = (await service.listEntries(root, projectId)).entries;
    assert.strictEqual(entries.length, 1, 'a later conflict must roll back earlier entries in the same batch');
    assert.strictEqual(entries[0].title, 'After');
    assert.strictEqual(Object.hasOwn(entries[0], 'expectedUpdatedAt'), false, 'the precondition is not persisted as card data');
    await service.deleteEntry(root, projectId, first.id);
    await assert.rejects(service.saveEntry(root, projectId, { ...changed, expectedUpdatedAt: changed.updatedAt }), { name: 'CompendiumConflictError' });
    assert.strictEqual((await service.listEntries(root, projectId)).entries.length, 0, 'a stale save must not recreate a deleted card');
    await service.saveEntry(root, projectId, { id: 'new-with-precondition', expectedUpdatedAt: '', title: 'New card' });
  }],
  ['updatedAt remains strictly monotonic when the clock repeats or moves backward', async (root, projectId) => {
    let entry = (await service.saveEntry(root, projectId, { id: 'clock', title: 'Clock' })).entry;
    const originalNow = Date.now;
    Date.now = () => 1;
    try {
      for (let index = 0; index < 3; index += 1) {
        const next = (await service.saveEntry(root, projectId, { id: entry.id, summary: `Update ${index}`, expectedUpdatedAt: entry.updatedAt })).entry;
        assert.ok(Date.parse(next.updatedAt) > Date.parse(entry.updatedAt));
        entry = next;
      }
    } finally { Date.now = originalNow; }
  }],
  ['agent backup and commit share the lock with ordinary saves, batches, deletes and other agent applies', async (root, projectId) => {
    const seeded = (await service.saveEntriesBatch(root, projectId, [
      { id: 'a', title: 'A', summary: 'Old A', body: 'A body' },
      { id: 'b', title: 'B', summary: 'Old B' },
      { id: 'delete-me', title: 'Delete me' }
    ])).entries;
    const snapshot = (await agent.readSnapshot(root, projectId, ['a'])).snapshot.entries[0];
    const enteredBackup = deferred();
    const finishBackup = deferred();
    let backupEntries;
    const applying = agent.applyOperations(root, projectId, [{ entryId: 'a', baseRevision: snapshot.revision, patch: { summary: 'AI A' } }], {
      beforeWrite: async () => {
        backupEntries = (await service.listEntries(root, projectId)).entries;
        enteredBackup.resolve();
        await finishBackup.promise;
        return { backupId: 'isolated-backup' };
      }
    });
    await enteredBackup.promise;
    let finished = 0;
    let secondBackupCalls = 0;
    const pending = [
      service.saveEntry(root, projectId, { id: 'b', summary: 'Concurrent B', expectedUpdatedAt: seeded[1].updatedAt }),
      service.saveEntriesBatch(root, projectId, [{ id: 'batch-1', title: 'Batch 1' }, { id: 'batch-2', title: 'Batch 2' }]),
      service.deleteEntry(root, projectId, 'delete-me'),
      service.saveEntry(root, projectId, { ...seeded[0], body: 'Stale full card', expectedUpdatedAt: seeded[0].updatedAt }),
      agent.applyOperations(root, projectId, [{ entryId: 'a', baseRevision: snapshot.revision, patch: { summary: 'Stale AI' } }], {
        beforeWrite: async () => { secondBackupCalls += 1; }
      })
    ].map(promise => promise.then(value => { finished += 1; return { ok: true, value }; }, error => { finished += 1; return { ok: false, error }; }));
    try {
      await projectService.createProject(root, { id: 'independent-project', title: 'Independent' });
      await service.saveEntry(root, 'independent-project', { title: 'Another project can still save' });
      assert.strictEqual(finished, 0, 'same-project operations must wait while the backup is pending');
      assert.strictEqual(backupEntries.find(entry => entry.id === 'a').summary, 'Old A');
      assert.strictEqual(backupEntries.find(entry => entry.id === 'b').summary, 'Old B');
    } finally { finishBackup.resolve(); }
    const applied = await applying;
    const results = await Promise.all(pending);
    assert.ok(results.slice(0, 3).every(result => result.ok));
    assert.ok(results.slice(3).every(result => !result.ok && result.error.name === 'CompendiumConflictError'));
    assert.strictEqual(secondBackupCalls, 0, 'a queued stale AI operation must fail before backup');
    assert.ok(Date.parse(applied.entries[0].updatedAt) > Date.parse(seeded[0].updatedAt), 'AI applies also advance the ordinary-save precondition');
    const entries = (await service.listEntries(root, projectId)).entries;
    assert.strictEqual(entries.find(entry => entry.id === 'a').summary, 'AI A');
    assert.strictEqual(entries.find(entry => entry.id === 'a').body, 'A body');
    assert.strictEqual(entries.find(entry => entry.id === 'b').summary, 'Concurrent B');
    assert.strictEqual(entries.some(entry => entry.id === 'delete-me'), false);
    assert.ok(entries.some(entry => entry.id === 'batch-1') && entries.some(entry => entry.id === 'batch-2'));
  }],
  ['a failed backup leaves AI edits unapplied and releases the transaction for the next save', async (root, projectId) => {
    const entry = (await service.saveEntry(root, projectId, { id: 'a', summary: 'Before' })).entry;
    const snapshot = (await agent.readSnapshot(root, projectId, [entry.id])).snapshot.entries[0];
    await assert.rejects(agent.applyOperations(root, projectId, [{ entryId: entry.id, baseRevision: snapshot.revision, patch: { summary: 'Must not persist' } }], {
      beforeWrite: async () => { throw new Error('simulated backup failure'); }
    }), /simulated backup failure/);
    assert.deepStrictEqual((await service.listEntries(root, projectId)).entries[0], entry);
    await service.saveEntry(root, projectId, { id: entry.id, summary: 'After recovery', expectedUpdatedAt: entry.updatedAt });
    assert.strictEqual((await service.listEntries(root, projectId)).entries[0].summary, 'After recovery');
  }],
  ['only a missing file is treated as empty; corruption and permission failures block writes', async (root, projectId) => {
    const projectPath = paths.projectDir(root, projectId);
    const file = store.entriesPath(projectPath);
    assert.deepStrictEqual(await store.readEntries(projectPath, projectId), []);
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (const invalid of ['{ broken json', '{}', '[null]']) {
      await fs.writeFile(file, invalid);
      await assert.rejects(service.listEntries(root, projectId));
      await assert.rejects(service.saveEntry(root, projectId, { title: 'Must not replace damaged data' }));
      assert.strictEqual(await fs.readFile(file, 'utf8'), invalid);
    }
    await fs.writeFile(file, '[]');
    const originalReadFile = fs.readFile;
    fs.readFile = async (target, ...args) => {
      if (path.resolve(String(target)) === path.resolve(file)) throw Object.assign(new Error('simulated access denied'), { code: 'EACCES' });
      return originalReadFile(target, ...args);
    };
    try {
      await assert.rejects(service.listEntries(root, projectId), { code: 'EACCES' });
      await assert.rejects(service.saveEntry(root, projectId, { title: 'Must not overwrite unreadable data' }), { code: 'EACCES' });
    } finally { fs.readFile = originalReadFile; }
    assert.strictEqual(await fs.readFile(file, 'utf8'), '[]');
    await service.saveEntry(root, projectId, { title: 'Recovered' });
  }],
  ['the save and agent APIs return HTTP 409 for stale versions without changing stored cards', async (root, projectId) => {
    const handler = await createDesktopProtocolHandler({ appRoot: path.resolve(__dirname, '..'), dataRoot: root });
    const entry = (await service.saveEntry(root, projectId, { id: 'api', title: 'Before', summary: 'Before' })).entry;
    const snapshot = (await agent.readSnapshot(root, projectId, [entry.id])).snapshot.entries[0];
    const changed = await api(handler, '/api/compendium', { projectId, entry: { id: entry.id, title: 'Current', expectedUpdatedAt: entry.updatedAt } });
    assert.strictEqual(changed.status, 200);
    const stale = await api(handler, '/api/compendium', { projectId, entry: { ...entry, title: 'Stale', expectedUpdatedAt: entry.updatedAt } });
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(stale.payload.ok, false);
    const staleAgent = await api(handler, '/api/compendium-agent/apply', { projectId, operations: [{ entryId: entry.id, baseRevision: snapshot.revision, patch: { summary: 'Stale AI' } }] });
    assert.strictEqual(staleAgent.status, 409);
    assert.strictEqual((await service.listEntries(root, projectId)).entries[0].title, 'Current');
    assert.strictEqual((await service.listEntries(root, projectId)).entries[0].summary, 'Before');
  }]
];

(async () => {
  const prefix = path.join(os.tmpdir(), 'draftharbor-compendium-transactions-');
  const dataRoot = await fs.mkdtemp(prefix);
  if (!path.resolve(dataRoot).startsWith(path.resolve(prefix))) throw new Error('Unexpected disposable test path');
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const [name, run] = cases[index];
      const projectId = `transaction-${index}`;
      await projectService.createProject(dataRoot, { id: projectId, title: name });
      let timer;
      try {
        await Promise.race([run(dataRoot, projectId), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 10000);
        })]);
      } finally { clearTimeout(timer); }
      console.log(`PASS ${name}`);
    }
    console.log(`Compendium transaction tests passed (${cases.length} cases, isolated storage and local protocol only).`);
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
