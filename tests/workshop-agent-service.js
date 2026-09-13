const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createWorkshopAgentService } = require('../desktop/services/workshop-agent-service');
const editModule = require('../desktop/services/workshop-edit-service');
const projectService = require('../desktop/services/project-service');
const workshopService = require('../desktop/services/workshop-service');
const compendiumService = require('../desktop/services/compendium-service');
const ProviderStream = require('../src/core/generation/provider-stream');

const clone = (value) => JSON.parse(JSON.stringify(value));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const call = (tool, args = {}) => ({ tool, args });
const finish = (answer = '已根据项目内容整理建议。') => call('final', { answer });
const sceneRead = () => call('read_scene', { sceneId: 's1' });
const sceneStage = (patch = { summary: '新摘要' }) => call('stage_scene', { sceneId: 's1', patch, reason: '与已读正文一致' });
const settings = { providerSettings: { mode: 'api', provider: 'openai', model: 'offline-test-model', endpoint: 'https://provider.invalid/v1/chat/completions', apiKey: 'test-secret-key' }, compendiumAgent: { enabled: false } };
const basePayload = { projectId: 'p1', sessionId: 'session1', message: '分析这个场景并给出建议。', currentSceneId: 's1' };
let passed = 0;

function fixture(sequence = [finish()], overrides = {}) {
  const data = {
    project: { id: 'p1', title: '测试项目', chapters: [{ id: 'c1', title: '第一章' }], scenes: [{ id: 's1', chapterId: 'c1', title: '相遇', content: '莉亚在港口发现了遗失的钥匙。', summary: '旧摘要', updatedAt: '2026-01-01T00:00:00Z' }] },
    entries: [{ id: 'e1', projectId: 'p1', title: '莉亚', type: 'character', body: '港口的领航员。', summary: '', tags: [], characterProfile: { role: '领航员' } }],
    sessions: [{ id: 'session1', projectId: 'p1', messages: [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回答' }], directiveContract: { enabled: true, content: '保持因果清楚。' } }],
    prompts: [], configs: [], previews: [], applies: [], undos: [], providerCalls: 0
  };
  const fakeEdit = {
    async preview(root, input) {
      data.previews.push(clone({ root, input }));
      return { proposalId: 'proposal1', projectId: input.projectId, sessionId: input.sessionId, changes: input.changes.map((change) => {
        const before = change.kind === 'scene.update' ? data.project.scenes[0] : change.kind === 'compendium.update' ? data.entries[0] : null;
        return { ...change, before, after: { ...before, ...(change.patch || change.entry), id: before ? before.id : 'created1' } };
      }) };
    },
    async apply(root, input) { data.applies.push(clone({ root, input })); return { receiptId: 'receipt1', proposalId: input.proposal.proposalId, status: 'applied' }; },
    async undo(root, input) { data.undos.push(clone({ root, input })); return { ...input.receipt, status: 'undone' }; }
  };
  const dependencies = {
    settingsService: { readSettings: async () => clone(settings) },
    readProjectContext: async (_root, { sessionId }) => ({ project: clone(data.project), entries: clone(data.entries), session: clone(data.sessions.find((item) => item.id === sessionId) || null) }),
    workshopEditService: fakeEdit, editModule,
    streamGeneration: async (prompt, emit, config) => {
      data.prompts.push(clone(prompt.messages)); data.configs.push(config);
      const item = sequence[data.providerCalls++];
      if (typeof item === 'function') return item(prompt, emit, config);
      assert.ok(item, 'test provider received an unexpected extra round');
      emit(JSON.stringify(item), { type: 'content' }); emit('', { type: 'finish', finishReason: 'stop' });
    }, ...overrides
  };
  return { service: createWorkshopAgentService(dependencies), data, fakeEdit };
}

async function completed(service, id, root = 'test-library') {
  const deadline = Date.now() + 3000;
  let run;
  do {
    run = service.getRun(root, id).run;
    if (run.status !== 'running') return run;
    await wait(2);
  } while (Date.now() < deadline);
  throw new Error(`test run did not finish: ${JSON.stringify(run)}`);
}
async function runSequence(sequence, overrides) {
  const f = fixture(sequence, overrides);
  const started = await f.service.start('test-library', basePayload);
  return { ...f, run: await completed(f.service, started.run.id) };
}
async function test(label, fn) { await fn(); passed += 1; console.log(`PASS ${label}`); }

(async () => {
  await test('current runtime model works with compendium agent disabled; full answer/history remain isolated', async () => {
    const f = fixture([call('project_outline'), call('search_scenes', { query: '钥匙' }), sceneRead(), sceneStage(), finish('《相遇》的摘要应突出钥匙这一线索。')]);
    const initial = await f.service.start('test-library', basePayload);
    assert.strictEqual(initial.run.status, 'running');
    assert.strictEqual(f.data.providerCalls, 0, 'start returns before provider work');
    const run = await completed(f.service, initial.run.id);
    assert.strictEqual(run.status, 'completed');
    assert.strictEqual(run.steps.length, 5);
    assert.strictEqual(run.answer, '《相遇》的摘要应突出钥匙这一线索。');
    assert.strictEqual(run.proposal.changes[0].before.summary, '旧摘要');
    assert.strictEqual(run.proposal.changes[0].after.summary, '新摘要');
    assert.strictEqual(f.data.applies.length, 0, 'stage/final never write');
    assert.strictEqual(f.data.previews[0].input.changes[0].expectedRevision, editModule.revisionForScene(f.data.project.scenes[0]));
    assert.strictEqual(f.data.configs[0].model, 'offline-test-model');
    assert.strictEqual(f.data.prompts[0].filter((m) => m.content === basePayload.message).length, 1);
    assert.ok(f.data.prompts[0].some((m) => m.content === '之前的回答'));
    assert.ok(!JSON.stringify(run).includes('test-secret-key'));
    assert.ok(!JSON.stringify(f.data.prompts).includes('test-secret-key'));
    run.proposal.changes[0].after.summary = 'client tamper';
    await f.service.apply('test-library', run.id);
    assert.strictEqual(f.data.applies[0].input.proposal.changes[0].after.summary, '新摘要');
  });
  await test('entry search/read/update/create use project-bound records and preserve staged profile fields', async () => {
    const f = await runSequence([
      call('search_entries', { query: '领航员' }), call('read_entry', { entryId: 'e1' }),
      call('stage_entry_update', { entryId: 'e1', patch: { characterProfile: { goal: '找到钥匙' } }, reason: '线索目标' }),
      call('stage_entry_update', { entryId: 'e1', patch: { characterProfile: { voice: '简短' } }, reason: '人物语气' }),
      call('stage_entry_create', { entry: { title: '钥匙', type: 'item', body: '在港口发现。' }, reason: '记录正文物品' }), finish()
    ]);
    assert.strictEqual(f.run.status, 'completed');
    assert.strictEqual(f.run.proposal.changes.length, 2);
    const change = f.data.previews[0].input.changes[0];
    assert.deepStrictEqual(change.patch.characterProfile, { goal: '找到钥匙', voice: '简短' });
    assert.strictEqual(change.expectedRevision, editModule.revisionForEntry(f.data.entries[0]));
    assert.strictEqual(f.run.proposal.changes[1].targetId, 'created1');
  });
  await test('legacy prose directives stay content guidance instead of polluting the JSON response contract', async () => {
    const f = fixture([finish()], { settingsService: { readSettings: async () => ({
      ...settings, globalPrompt: { enabled: true, content: 'GLOBAL：只输出正文，采用第三人称。' },
      directiveStack: { mode: 'parity', userGlobal: { enabled: true, content: 'GLOBAL：只输出正文，采用第三人称。', scopes: ['workshop-chat', 'writer-prose'] } }
    }) } });
    f.data.project.directiveStack = { layers: [{ id: 'project-rule', enabled: true, content: 'PROJECT：保留港口背景。', scopes: ['workshop-chat'] }] };
    const initial = await f.service.start('test-library', basePayload);
    assert.strictEqual((await completed(f.service, initial.run.id)).status, 'completed');
    const config = f.data.configs[0];
    assert.strictEqual(config.taskKind, 'workshop-agent'); assert.strictEqual(config.directiveStackMode, 'scoped');
    const prompt = { messages: f.data.prompts[0] };
    const messages = ProviderStream.prepareDirectiveMessages(prompt.messages, prompt, config).messages;
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    assert.ok(!system.includes('GLOBAL：')); assert.ok(!system.includes('PROJECT：'));
    const guidance = messages.find((message) => message.role === 'user' && message.content.includes('本讨论的创作约定'));
    assert.ok(guidance.content.includes('GLOBAL：')); assert.ok(guidance.content.includes('PROJECT：'));
    assert.ok(guidance.content.includes('保持因果清楚。')); assert.ok(guidance.content.includes('不能改变本轮工具 JSON'));
  });
  await test('updates require full read, not search snippets', async () => {
    const f = await runSequence([call('search_scenes', { query: '钥匙' }), sceneStage()]);
    assert.strictEqual(f.run.status, 'failed'); assert.match(f.run.error, /完整阅读/);
    assert.strictEqual(f.data.previews.length, 0);
  });
  await test('foreign scene and card targets are refused', async () => {
    for (const entry of [call('read_scene', { sceneId: 'foreign' }), call('read_entry', { entryId: 'foreign' })]) {
      const f = fixture([entry]);
      f.data.entries.push({ id: 'foreign', projectId: 'p2', body: 'must not read' });
      const start = await f.service.start('test-library', basePayload);
      const run = await completed(f.service, start.run.id);
      assert.strictEqual(run.status, 'failed'); assert.match(run.error, /不属于/);
    }
  });
  await test('strict tool envelopes, context fields and nested patch fields reject unsupported capabilities', async () => {
    const cases = [
      call('exec', { command: 'noop' }), { tool: 'final', args: { answer: 'x' }, projectId: 'p2' },
      call('read_scene', { sceneId: 's1', projectId: 'p2' }), call('project_outline', { path: '../x' }),
      call('search_entries', { query: '莉亚', url: 'https://invalid.test' }),
      sceneStage({ content: '正文', id: 'foreign' }),
      call('stage_entry_create', { entry: { title: 'x', projectId: 'p2' }, reason: 'x' }),
      call('stage_entry_create', { entry: { title: 'x', characterProfile: { exec: 'x' } }, reason: 'x' }),
      call('stage_entry_create', { entry: { title: 'x', tags: [12] }, reason: 'x' })
    ];
    for (const entry of cases) {
      const f = await runSequence([sceneRead(), entry]);
      assert.strictEqual(f.run.status, 'failed', JSON.stringify(entry));
      assert.strictEqual(f.data.previews.length, 0);
    }
  });
  await test('malformed JSON and truncated final never produce a preview', async () => {
    for (const emitResponse of [
      (_p, emit) => emit('{bad', { type: 'content' }),
      (_p, emit) => { emit(JSON.stringify(finish()), { type: 'content' }); emit('', { type: 'finish', finishReason: 'length' }); }
    ]) {
      const f = await runSequence([sceneRead(), sceneStage(), emitResponse]);
      assert.strictEqual(f.run.status, 'failed'); assert.strictEqual(f.data.previews.length, 0);
    }
  });
  await test('parallel starts reserve a session before asynchronous local reads', async () => {
    const gate = deferred();
    const f = fixture([finish()], { settingsService: { readSettings: async () => { await gate.promise; return settings; } } });
    const first = f.service.start('test-library', basePayload);
    await assert.rejects(f.service.start('test-library', basePayload), { statusCode: 409 });
    gate.resolve(); const started = await first; await completed(f.service, started.run.id);
  });
  await test('running cancellation aborts provider, blocks late output and permits a new same-session run', async () => {
    const entered = deferred(); const late = deferred(); let cancelledSignal;
    const f = fixture([async (_p, emit, config) => { cancelledSignal = config.signal; entered.resolve(); await late.promise; emit(JSON.stringify(sceneStage()), { type: 'content' }); }, finish('新会话结果')]);
    const initial = await f.service.start('test-library', basePayload); await entered.promise;
    assert.strictEqual(f.service.cancel('test-library', initial.run.id).run.status, 'cancelled');
    assert.ok(cancelledSignal.aborted);
    const second = await f.service.start('test-library', basePayload);
    assert.strictEqual((await completed(f.service, second.run.id)).answer, '新会话结果');
    late.resolve(); await wait(10);
    assert.strictEqual(f.service.getRun('test-library', initial.run.id).run.status, 'cancelled');
    assert.strictEqual(f.data.previews.length, 0);
  });
  await test('cancel before deferred execution never starts the provider', async () => {
    const f = fixture(); const initial = await f.service.start('test-library', basePayload);
    f.service.cancel('test-library', initial.run.id); await wait(10);
    assert.strictEqual(f.data.providerCalls, 0);
  });
  await test('cancel completed proposal keeps readable result but permanently disables apply', async () => {
    const f = await runSequence([sceneRead(), sceneStage(), finish()]);
    const cancelled = f.service.cancel('test-library', f.run.id).run;
    assert.strictEqual(cancelled.status, 'cancelled'); assert.ok(cancelled.proposal);
    await assert.rejects(f.service.apply('test-library', f.run.id), { statusCode: 409 });
    assert.strictEqual(f.data.applies.length, 0);
  });
  await test('timeout releases a provider that ignores abort', async () => {
    let signal;
    const f = await runSequence([(_p, _e, config) => { signal = config.signal; return new Promise(() => {}); }], { limits: { timeoutMs: 20 } });
    assert.strictEqual(f.run.status, 'failed'); assert.match(f.run.error, /超时/); assert.ok(signal.aborted);
  });
  await test('timeout while preparing a preview prevents late completion from reviving the task', async () => {
    const gate = deferred(); const entered = deferred();
    const f = fixture([sceneRead(), sceneStage(), finish()], { limits: { timeoutMs: 30 } });
    const original = f.fakeEdit.preview;
    f.fakeEdit.preview = async (...args) => { entered.resolve(); await gate.promise; return original(...args); };
    const initial = await f.service.start('test-library', basePayload); await entered.promise;
    const failed = await completed(f.service, initial.run.id);
    assert.strictEqual(failed.status, 'failed'); assert.match(failed.error, /超时/);
    gate.resolve(); await wait(10);
    const late = f.service.getRun('test-library', initial.run.id).run;
    assert.strictEqual(late.status, 'failed'); assert.strictEqual(late.proposal, undefined);
    await assert.rejects(f.service.apply('test-library', initial.run.id), { statusCode: 409 });
  });
  await test('step, output and change-count bounds fail closed', async () => {
    const maxStep = await runSequence([call('project_outline')], { limits: { maxSteps: 1 } });
    assert.match(maxStep.run.error, /步骤上限/);
    const maxOutput = await runSequence([(_p, emit) => emit('x'.repeat(101), { type: 'reasoning' })], { limits: { maxOutputChars: 100 } });
    assert.match(maxOutput.run.error, /输出/);
    const maxChanges = await runSequence([
      call('stage_entry_create', { entry: { title: '1' }, reason: 'x' }),
      call('stage_entry_create', { entry: { title: '2' }, reason: 'x' })
    ], { limits: { maxChanges: 1 } });
    assert.match(maxChanges.run.error, /改动数量/);
    assert.strictEqual(maxChanges.data.previews.length, 0);
  });
  await test('oversized source never grants permission to overwrite a partially read target', async () => {
    const f = fixture([sceneRead()], { limits: { maxRecordChars: 100 } });
    f.data.project.scenes[0].content = '正文'.repeat(200);
    const initial = await f.service.start('test-library', basePayload);
    assert.match((await completed(f.service, initial.run.id)).error, /完整阅读上限/);
  });
  await test('run IDs are bound to data root for reads and every action', async () => {
    const f = await runSequence([sceneRead(), sceneStage(), finish()]);
    assert.throws(() => f.service.getRun('other-library', f.run.id), { statusCode: 404 });
    assert.throws(() => f.service.cancel('other-library', f.run.id), { statusCode: 404 });
    await assert.rejects(f.service.apply('other-library', f.run.id), { statusCode: 404 });
    await assert.rejects(f.service.undo('other-library', f.run.id), { statusCode: 404 });
    assert.strictEqual(f.data.applies.length, 0);
  });
  await test('apply and undo are idempotent while awaiting a write and after it; cancel cannot interrupt writes', async () => {
    const gate = deferred(); let applyCalls = 0;
    const f = fixture([sceneRead(), sceneStage(), finish()]);
    f.fakeEdit.apply = async () => { applyCalls += 1; await gate.promise; return { receiptId: 'receipt1', proposalId: 'proposal1', status: 'applied' }; };
    const initial = await f.service.start('test-library', basePayload); await completed(f.service, initial.run.id);
    const first = f.service.apply('test-library', initial.run.id);
    const second = f.service.apply('test-library', initial.run.id);
    assert.strictEqual(f.service.getRun('test-library', initial.run.id).run.status, 'applying');
    assert.throws(() => f.service.cancel('test-library', initial.run.id), { statusCode: 409 });
    await assert.rejects(f.service.undo('test-library', initial.run.id), { statusCode: 409 });
    gate.resolve(); assert.deepStrictEqual(await first, await second);
    await f.service.apply('test-library', initial.run.id); assert.strictEqual(applyCalls, 1);
    const undone = await f.service.undo('test-library', initial.run.id);
    assert.strictEqual(undone.run.status, 'undone');
    await f.service.undo('test-library', initial.run.id); assert.strictEqual(f.data.undos.length, 1);
    await assert.rejects(f.service.apply('test-library', initial.run.id), { statusCode: 409 });
  });
  await test('a stale write keeps its preview and reports conflict instead of applied', async () => {
    const f = await runSequence([sceneRead(), sceneStage(), finish()]);
    f.fakeEdit.apply = async () => { throw Object.assign(new Error('target changed'), { statusCode: 409 }); };
    await assert.rejects(f.service.apply('test-library', f.run.id), { statusCode: 409 });
    const run = f.service.getRun('test-library', f.run.id).run;
    assert.strictEqual(run.status, 'completed'); assert.match(run.error, /建议已过期/); assert.ok(run.proposal);
  });
  await test('expired and bounded terminal runs cannot be reused', async () => {
    let time = Date.now(); const f = fixture([finish(), finish()], { now: () => time, limits: { ttlMs: 10, maxRuns: 1 } });
    const first = await f.service.start('test-library', basePayload); await completed(f.service, first.run.id);
    time += 11; assert.throws(() => f.service.getRun('test-library', first.run.id), { statusCode: 404 });
    const second = await f.service.start('test-library', basePayload); await completed(f.service, second.run.id);
    assert.strictEqual(f.service.getRun('test-library', second.run.id).run.status, 'completed');
  });
  await test('missing/mismatched session and current scene fail before provider invocation', async () => {
    for (const payload of [{ ...basePayload, sessionId: 'foreign' }, { ...basePayload, currentSceneId: 'foreign' }]) {
      const f = fixture(); await assert.rejects(f.service.start('test-library', payload)); assert.strictEqual(f.data.providerCalls, 0);
    }
  });
  await test('provider errors do not expose credentials', async () => {
    const f = await runSequence([() => { throw new Error('failed with test-secret-key at test-library'); }]);
    assert.strictEqual(f.run.status, 'failed'); assert.ok(!f.run.error.includes('test-secret-key')); assert.ok(!f.run.error.includes('test-library'));
  });
  await test('real project preview/apply/undo preserves scope and rejects intervening writer edits', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-agent-service-'));
    try {
      const created = await projectService.createProject(root, { id: 'agent-real', title: '真实临时项目' });
      const project = created.project;
      const session = (await workshopService.saveSession(root, project.id, { id: 'session-real', projectId: project.id, title: '离线讨论' })).session;
      const scene = project.scenes[0];
      assert.ok(scene, 'new project has an initial scene');
      const cards = (await compendiumService.saveEntry(root, project.id, { title: '测试人物', type: 'character', body: '原始资料' })).entry;
      const sequence = [
        call('read_scene', { sceneId: scene.id }), call('stage_scene', { sceneId: scene.id, patch: { content: '新的场景正文。', summary: '新的摘要。' }, reason: '依据用户讨论目标' }),
        call('read_entry', { entryId: cards.id }), call('stage_entry_update', { entryId: cards.id, patch: { body: '更新后的资料' }, reason: '同步设定' }), finish('正文和资料已形成待确认建议。')
      ];
      let round = 0;
      const service = createWorkshopAgentService({ settingsService: { readSettings: async () => settings }, streamGeneration: async (_prompt, emit) => emit(JSON.stringify(sequence[round++]), { type: 'content' }) });
      const initial = await service.start(root, { projectId: project.id, sessionId: session.id, message: '修改正文和人物资料', currentSceneId: scene.id });
      const run = await completed(service, initial.run.id, root);
      assert.strictEqual(run.status, 'completed', run.error);
      assert.strictEqual((await projectService.openProject(root, project.id)).project.scenes[0].content, scene.content);
      const applied = await service.apply(root, run.id); assert.strictEqual(applied.run.status, 'applied');
      assert.strictEqual((await projectService.openProject(root, project.id)).project.scenes[0].content, '新的场景正文。');
      assert.strictEqual((await compendiumService.listEntries(root, project.id)).entries[0].body, '更新后的资料');
      await service.undo(root, run.id);
      assert.strictEqual((await projectService.openProject(root, project.id)).project.scenes[0].content, scene.content);
      assert.strictEqual((await compendiumService.listEntries(root, project.id)).entries[0].body, '原始资料');
      round = 0;
      const next = await service.start(root, { projectId: project.id, sessionId: session.id, message: '再次提议' });
      await completed(service, next.run.id, root);
      await compendiumService.saveEntry(root, project.id, { ...(await compendiumService.listEntries(root, project.id)).entries[0], body: '用户后续手动编辑' });
      await assert.rejects(service.apply(root, next.run.id), { statusCode: 409 });
      assert.strictEqual((await projectService.openProject(root, project.id)).project.scenes[0].content, scene.content, 'failed batch must not partially change scene');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  console.log(`Workshop agent service: ${passed} groups passed (injected provider only).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
