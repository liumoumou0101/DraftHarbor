const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projectStore = require('../desktop/storage/project-file-store');
const compendiumStore = require('../desktop/storage/compendium-store');
const workshopStore = require('../desktop/storage/workshop-store');
const paths = require('../desktop/storage/library-paths');
const { readWorkshopProjectContext } = require('../desktop/storage/workshop-project-reader');
const { createWorkshopEditService, revisionForScene } = require('../desktop/services/workshop-edit-service');
const { createWorkshopAgentService } = require('../desktop/services/workshop-agent-service');

const projectId = 'reader-boundary';
const sessionId = 'session-boundary';
let passed = 0;
let skipped = 0;
let modeledFileLinks = 0;

async function fixture(root) {
  const created = await projectStore.createProject(root, { id: projectId, title: 'Boundary project' });
  await compendiumStore.saveEntry(root, projectId, { id: 'card', title: 'Local card', body: 'Local card body' });
  await workshopStore.saveSession(root, projectId, { id: sessionId, title: 'Local session', messages: [{ role: 'user', content: 'Local history' }] });
  return { projectPath: created.projectPath, sceneId: created.project.scenes[0].id };
}

async function linkOut(root, logical, directory) {
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside, { recursive: true });
  const target = path.join(outside, path.basename(logical));
  await fs.rename(logical, target);
  try { await fs.symlink(target, logical, directory ? 'junction' : 'file'); }
  catch (error) {
    await fs.rename(target, logical);
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
  return target;
}

async function rejectBeforeRead(root, forbidden) {
  const originalRead = fs.readFile;
  const reads = [];
  fs.readFile = async (target, ...rest) => { reads.push(path.resolve(String(target))); return originalRead(target, ...rest); };
  try { await assert.rejects(readWorkshopProjectContext(root, { projectId, sessionId }), /symbolic link|junction/); }
  finally { fs.readFile = originalRead; }
  assert.strictEqual(reads.some((target) => target === forbidden || target.startsWith(`${forbidden}${path.sep}`)), false, 'the unsafe target must be rejected before any content read');
}

async function test(name, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-agent-boundary-'));
  try {
    const result = await run(root, await fixture(root));
    if (result === false) { skipped += 1; console.log(`SKIP ${name} (host does not permit native file symlinks)`); }
    else { passed += 1; console.log(`PASS ${name}`); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

(async () => {
  await test('normal project reads preserve scene revisions and discussion history', async (root) => {
    const safe = await readWorkshopProjectContext(root, { projectId, sessionId });
    const ordinary = await projectStore.openProject(root, projectId);
    assert.strictEqual(safe.project.writerRevision, ordinary.writerRevision);
    assert.strictEqual(revisionForScene(safe.project.scenes[0]), revisionForScene(ordinary.scenes[0]));
    assert.strictEqual(safe.entries[0].body, 'Local card body');
    assert.strictEqual(safe.session.messages[0].content, 'Local history');
  });
  await test('project-root junction cannot expose an outside project', async (root, f) => {
    const linked = await linkOut(root, f.projectPath, true);
    if (!linked) return false;
    assert.strictEqual((await projectStore.openProject(root, projectId)).id, projectId, 'legacy loader follows the junction');
    await rejectBeforeRead(root, f.projectPath);
  });
  await test('scene-directory junction cannot expose outside Markdown', async (root, f) => {
    const logical = paths.scenesDir(f.projectPath);
    const linked = await linkOut(root, logical, true);
    if (!linked) return false;
    await fs.writeFile(paths.sceneMarkdownPath(f.projectPath, f.sceneId), 'EXTERNAL SCENE CONTENT');
    assert.strictEqual((await projectStore.openProject(root, projectId)).scenes[0].content, 'EXTERNAL SCENE CONTENT');
    await rejectBeforeRead(root, logical);
  });
  await test('compendium-directory junction cannot expose outside card bodies', async (root, f) => {
    const logical = path.join(f.projectPath, 'compendium');
    if (!await linkOut(root, logical, true)) return false;
    assert.strictEqual((await compendiumStore.listEntries(root, projectId))[0].body, 'Local card body', 'legacy card loader follows the junction');
    await rejectBeforeRead(root, logical);
  });
  for (const [name, resolve] of [
    ['scene Markdown', (f) => paths.sceneMarkdownPath(f.projectPath, f.sceneId)],
    ['card entries', (f) => compendiumStore.entriesPath(f.projectPath)],
    ['discussion history', (f) => workshopStore.sessionsPath(f.projectPath)],
    ['project manifest', (f) => paths.manifestPath(f.projectPath)]
  ]) {
    await test(`${name} file symlink is rejected before reading`, async (root, f) => {
      const logical = resolve(f);
      if (await linkOut(root, logical, false)) await rejectBeforeRead(root, logical);
      else {
        // Windows without Developer Mode cannot create file symlinks. Keep the
        // file-specific no-read assertion with the same lstat state Node emits;
        // the directory/junction cases above exercise native links end to end.
        modeledFileLinks += 1;
        const originalStat = fs.lstat;
        fs.lstat = async (target, ...rest) => {
          const stat = await originalStat(target, ...rest);
          return path.resolve(String(target)) === logical ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat;
        };
        try { await rejectBeforeRead(root, logical); }
        finally { fs.lstat = originalStat; }
      }
    });
  }
  await test('unneeded prompt/workflow stores are never read by the Agent', async (root, f) => {
    const logical = path.join(f.projectPath, 'prompts');
    if (!await linkOut(root, logical, true)) return false;
    const originalRead = fs.readFile;
    const reads = [];
    fs.readFile = async (target, ...rest) => { reads.push(String(target)); return originalRead(target, ...rest); };
    try {
      const safe = await readWorkshopProjectContext(root, { projectId, sessionId });
      assert.strictEqual(safe.project.id, projectId);
    } finally { fs.readFile = originalRead; }
    assert.strictEqual(reads.some((target) => target.includes(`${path.sep}prompts${path.sep}`) || target.includes(`${path.sep}workflows${path.sep}`)), false);
  });
  await test('apply rechecks the read boundary when links change after preview', async (root, f) => {
    const service = createWorkshopEditService();
    const safe = await readWorkshopProjectContext(root, { projectId, sessionId });
    const scene = safe.project.scenes[0];
    const proposal = await service.preview(root, { projectId, sessionId, changes: [{ kind: 'scene.update', sceneId: scene.id, expectedRevision: revisionForScene(scene), patch: { content: 'Agent edit' } }] });
    const logical = paths.scenesDir(f.projectPath);
    const linked = await linkOut(root, logical, true);
    if (!linked) return false;
    await assert.rejects(service.apply(root, { projectId, sessionId, proposal }), /symbolic link|junction/);
    assert.strictEqual(await fs.readFile(path.join(linked, `${scene.id}.md`), 'utf8'), scene.content);
  });
  await test('real Agent start rejects linked source directories before invoking any provider', async (root, f) => {
    if (!await linkOut(root, paths.scenesDir(f.projectPath), true)) return false;
    let providerCalls = 0;
    const service = createWorkshopAgentService({
      settingsService: { readSettings: async () => ({}) },
      streamGeneration: async () => { providerCalls += 1; throw new Error('Provider must not run'); }
    });
    await assert.rejects(service.start(root, { projectId, sessionId, currentSceneId: f.sceneId, message: 'Read this scene' }), /symbolic link|junction/);
    assert.strictEqual(providerCalls, 0);
  });
  await test('foreign project identities in card/session files are rejected before normalization', async (root, f) => {
    const cardPath = compendiumStore.entriesPath(f.projectPath);
    const original = await fs.readFile(cardPath, 'utf8');
    await fs.writeFile(cardPath, JSON.stringify([{ id: 'foreign', projectId: 'other-project', title: 'Foreign card' }]));
    await assert.rejects(readWorkshopProjectContext(root, { projectId, sessionId }), /another project/);
    await fs.writeFile(cardPath, original);
    await fs.writeFile(workshopStore.sessionsPath(f.projectPath), JSON.stringify([{ id: sessionId, projectId: 'other-project', title: 'Foreign session' }]));
    await assert.rejects(readWorkshopProjectContext(root, { projectId, sessionId }), /another project/);
  });
  for (const directory of ['prompts', 'workflows']) {
    await test(`apply blocks linked ${directory} before invoking the full-project backup`, async (root, f) => {
      let backupCalls = 0;
      const service = createWorkshopEditService({ createBackup: async () => { backupCalls += 1; return { backupId: 'unexpected' }; } });
      const safe = await readWorkshopProjectContext(root, { projectId, sessionId });
      const scene = safe.project.scenes[0];
      const proposal = await service.preview(root, { projectId, sessionId, changes: [{ kind: 'scene.update', sceneId: scene.id, expectedRevision: revisionForScene(scene), patch: { content: 'Never applied' } }] });
      if (!await linkOut(root, path.join(f.projectPath, directory), true)) return false;
      await assert.rejects(service.apply(root, { projectId, sessionId, proposal }), /symbolic link|junction/);
      assert.strictEqual(backupCalls, 0);
      assert.strictEqual(await fs.readFile(paths.sceneMarkdownPath(f.projectPath, scene.id), 'utf8'), scene.content);
    });
  }
  console.log(`Workshop project reader tests passed (${passed} cases${skipped ? `, ${skipped} native link cases skipped` : ''}; ${modeledFileLinks} file-link cases use lstat fixtures because this Windows host denies file symlink creation; no providers).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
