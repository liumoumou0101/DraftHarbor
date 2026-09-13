const assert = require('assert');
const { createController } = require('../desktop/controllers/workshop-controller');

function fixture(overrides = {}) {
  const calls = [];
  const run = { id: 'run1', projectId: 'project1', sessionId: 'session1', status: 'completed', answer: '答复', steps: [] };
  const service = Object.fromEntries(['start', 'getRun', 'cancel', 'apply', 'undo'].map((method) => [method, async (...args) => {
    calls.push({ method, args }); return { ok: true, run: { ...run, status: method === 'apply' ? 'applied' : method === 'undo' ? 'undone' : run.status } };
  }]));
  const controller = createController({
    workshopService: { listSessions: async () => ({ ok: true, sessions: [{ id: 'old-session' }] }) },
    workshopAgentService: service,
    projectService: { openProject: async (root, projectId) => { calls.push({ method: 'openProject', args: [root, projectId] }); return { project: { id: projectId, title: '已刷新项目' } }; } },
    projectToLegacySnapshot: (project) => ({ name: project.title, project: { id: project.id } }),
    readJsonPayload: async (request) => request.payload,
    jsonResponse: (response, status, body) => Object.assign(response, { status, body }),
    ...overrides
  });
  return { calls, service, async request(method, url, payload = {}) {
    const response = {};
    const handled = await controller({ method, payload }, response, 'app-root', 'data-root', new URL(url, 'http://local.test'));
    return { handled, ...response };
  } };
}

(async () => {
  let groups = 0;
  async function test(label, fn) { await fn(); groups += 1; console.log(`PASS ${label}`); }
  await test('start accepts only the initial bound context and model message', async () => {
    const f = fixture();
    const response = await f.request('POST', '/api/workshop-agent/start', {
      projectId: 'project1', sessionId: 'session1', message: '分析正文', currentSceneId: 'scene1',
      dataRoot: 'foreign', proposal: { changes: ['malicious'] }, runId: 'foreign', limits: { maxSteps: 999 }
    });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(f.calls, [{ method: 'start', args: ['data-root', { projectId: 'project1', sessionId: 'session1', message: '分析正文', currentSceneId: 'scene1' }] }]);
  });
  await test('all mutation endpoints use only the run ID and server root', async () => {
    for (const method of ['cancel', 'apply', 'undo']) {
      const f = fixture();
      const response = await f.request('POST', `/api/workshop-agent/${method}`, { runId: 'run1', projectId: 'foreign', sessionId: 'foreign', dataRoot: 'foreign', proposal: { changes: ['bad'] }, receipt: { receiptId: 'bad' } });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(f.calls[0], { method, args: ['data-root', 'run1'] });
      if (method !== 'cancel') {
        assert.deepStrictEqual(f.calls[1], { method: 'openProject', args: ['data-root', 'project1'] });
        assert.deepStrictEqual(response.body.projectSnapshot, { name: '已刷新项目', project: { id: 'project1' } });
      }
    }
  });
  await test('poll GET binds query run ID without accepting alternate project or root', async () => {
    const f = fixture();
    const response = await f.request('GET', '/api/workshop-agent/run?runId=run1&projectId=foreign');
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(f.calls, [{ method: 'getRun', args: ['data-root', 'run1'] }]);
  });
  await test('committed edit stays successful if the project refresh fails', async () => {
    const f = fixture({ projectService: { openProject: async () => { throw new Error('disk temporarily unavailable'); } } });
    const response = await f.request('POST', '/api/workshop-agent/apply', { runId: 'run1' });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.run.status, 'applied');
    assert.ok(response.body.refreshError); assert.strictEqual(response.body.projectSnapshot, undefined);
  });
  await test('expired and stale responses retain actionable HTTP status', async () => {
    for (const code of [400, 404, 409, 429]) {
      const f = fixture({ workshopAgentService: { getRun: async () => { throw Object.assign(new Error('可读错误'), { statusCode: code }); } } });
      const response = await f.request('GET', '/api/workshop-agent/run?runId=old');
      assert.strictEqual(response.status, code); assert.deepStrictEqual(response.body, { ok: false, error: '可读错误' });
    }
  });
  await test('storage conflicts become action-specific Chinese guidance', async () => {
    for (const [action, expected] of [['start', /刷新讨论/], ['apply', /建议已过期/], ['undo', /后续编辑不会被覆盖/]]) {
      const f = fixture({ workshopAgentService: { [action]: async () => { throw Object.assign(new Error('target changed'), { statusCode: 409 }); } } });
      const response = await f.request('POST', `/api/workshop-agent/${action}`, { runId: 'run1' });
      assert.strictEqual(response.status, 409); assert.match(response.body.error, expected);
    }
  });
  await test('unsupported HTTP methods and unavailable service cannot invoke writes', async () => {
    const f = fixture();
    for (const [method, url] of [['GET', '/api/workshop-agent/apply'], ['POST', '/api/workshop-agent/run']]) {
      assert.strictEqual((await f.request(method, url)).status, 405);
    }
    assert.deepStrictEqual(f.calls, []);
    assert.strictEqual((await fixture({ workshopAgentService: null }).request('POST', '/api/workshop-agent/start')).status, 503);
  });
  await test('invalid JSON object and run ID inputs return a client error before service calls', async () => {
    const f = fixture();
    assert.strictEqual((await f.request('POST', '/api/workshop-agent/start', null)).status, 400);
    assert.strictEqual((await f.request('POST', '/api/workshop-agent/apply', { runId: {} })).status, 400);
    assert.strictEqual((await f.request('GET', '/api/workshop-agent/run')).status, 400);
    assert.deepStrictEqual(f.calls, []);
  });
  await test('ordinary discussion APIs keep their existing behavior and unknown paths fall through', async () => {
    const f = fixture();
    const legacy = await f.request('GET', '/api/workshop-sessions?projectId=project1');
    assert.strictEqual(legacy.status, 200); assert.strictEqual(legacy.body.sessions[0].id, 'old-session');
    assert.strictEqual((await f.request('POST', '/api/unknown')).handled, false);
  });
  console.log(`Workshop agent controller: ${groups} groups passed.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
