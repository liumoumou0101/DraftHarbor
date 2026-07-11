const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const projectService = require('../desktop/services/project-service');
const workshopService = require('../desktop/services/workshop-service');
const WorkshopSchema = require('../src/core/workshop/workshop-schema');
const WorkshopPrompt = require('../src/core/workshop/workshop-prompt');

(async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-workshop-test-'));
  let servers = null;
  try {
    await projectService.createProject(dataRoot, { id: 'workshop-project', title: 'Workshop Project' });

    const session = WorkshopSchema.createWorkshopSession({
      projectId: 'workshop-project',
      title: 'Brainstorm',
      messages: [{ role: 'user', content: 'hello' }]
    });
    const saved = await workshopService.saveSession(dataRoot, 'workshop-project', session);
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.session.messages.length, 1);

    const appended = await workshopService.appendMessage(dataRoot, 'workshop-project', session.id, {
      role: 'assistant',
      content: 'answer'
    });
    assert.strictEqual(appended.session.messages.length, 2);

    const prompt = WorkshopPrompt.buildWorkshopPrompt({
      project: {
        currentSceneId: 's1',
        compendium: [{ id: 'ada', title: 'Ada', body: 'Pilot.', alwaysInContext: true }],
        scenes: [{ id: 's1', title: 'Scene', summary: 'A summary.' }]
      },
      session: appended.session,
      message: 'Discuss @[Ada].'
    });
    assert.ok(prompt.messages.some((message) => message.content.includes('Pilot.')), 'workshop prompt should include project context');

    servers = await startDesktopServers({ appRoot: path.resolve(__dirname, '..'), dataRoot });
    const apiList = await fetch(servers.appUrl + '/api/workshop-sessions?projectId=workshop-project');
    const apiListBody = await apiList.json();
    assert.ok(apiList.ok && apiListBody.ok, 'workshop list API should return ok');
    assert.strictEqual(apiListBody.sessions.length, 1);

    const apiAppend = await fetch(servers.appUrl + '/api/workshop-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'workshop-project',
        sessionId: session.id,
        message: { role: 'user', content: 'next' }
      })
    });
    const apiAppendBody = await apiAppend.json();
    assert.ok(apiAppend.ok && apiAppendBody.ok, 'workshop append API should return ok');
    assert.strictEqual(apiAppendBody.session.messages.length, 3);

    console.log('Workshop service test passed.');
  } finally {
    if (servers) servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Workshop service test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
