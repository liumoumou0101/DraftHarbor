const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const projects = require('../desktop/services/project-service');
const cards = require('../desktop/services/compendium-service');
const workshop = require('../desktop/services/workshop-service');
const { startDesktopServers } = require('../desktop/local-server');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-workshop-write-'));
  let servers;
  try {
    const created = await projects.createProject(dataRoot, { id: 'write-project', title: 'Local writing' });
    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    const api = async (route, body) => {
      const response = await fetch(servers.appUrl + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
      return { status: response.status, ...(await response.json()) };
    };
    const opened = await api('/api/get-project?projectId=write-project');
    assert.ok(opened.project.writerRevision, 'the editor must receive its server writer version');
    const old = structuredClone(opened.project);
    const sceneId = created.project.scenes[0].id;
    opened.project.sceneContents[sceneId] = 'A new scene body.';
    const card = await cards.saveEntry(dataRoot, created.project.id, { title: 'Keep this card', body: 'Independent data.' });
    await workshop.saveSession(dataRoot, created.project.id, { id: 'session-a', title: 'Keep this discussion', messages: [{ role: 'user', content: 'Independent discussion.' }] });
    const saved = await api('/api/save-project', opened.project);
    assert.strictEqual(saved.status, 200);
    assert.ok(saved.writerRevision && saved.writerRevision !== old.writerRevision);
    const current = (await projects.openProject(dataRoot, created.project.id)).project;
    assert.strictEqual(current.compendium[0].id, card.entry.id);
    assert.strictEqual(current.workshopSessions[0].id, 'session-a');
    old.sceneContents[sceneId] = 'Stale overwrite.';
    const conflict = await api('/api/save-project', old);
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual((await projects.openProject(dataRoot, created.project.id)).project.scenes[0].content, 'A new scene body.');

    await Promise.all(Array.from({ length: 8 }, (_, index) => workshop.appendMessage(dataRoot, created.project.id, 'session-a', { role: 'user', content: `Concurrent message ${index}` })));
    assert.strictEqual((await workshop.listSessions(dataRoot, created.project.id)).sessions[0].messages.length, 9);
    const store = require('../desktop/storage/workshop-store');
    const projectPath = require('../desktop/storage/library-paths').projectDir(dataRoot, created.project.id);
    await fs.writeFile(store.sessionsPath(projectPath), '{corrupted');
    await assert.rejects(workshop.saveSession(dataRoot, created.project.id, { id: 'must-not-replace' }));
    assert.strictEqual(await fs.readFile(store.sessionsPath(projectPath), 'utf8'), '{corrupted');
    console.log('Workshop write integration tests passed (version protocol, dedicated stores, concurrent messages, corrupt-file protection).');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
