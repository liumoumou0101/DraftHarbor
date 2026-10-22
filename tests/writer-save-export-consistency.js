const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { projectToLegacySnapshot, legacySnapshotToProject } = require('../desktop/services/project-snapshot-adapter');

const source = name => fs.readFileSync(path.join(__dirname, '../src/desktop/shell', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const requests = [], downloads = [], statuses = [], timers = new Map();
  let timerId = 0;
  const editor = { value: '第一版' };
  const snapshot = { project: { id: 'p' }, chapters: [], scenes: [{ id: 's' }], sceneContents: { s: '旧稿' }, writerRevision: 'r1' };
  const state = { snapshot, activeSceneId: 's', dirty: true, isSaving: false, generation: {} };
  const context = vm.createContext({
    console: { error() {} }, URLSearchParams,
    nativeEditorState: state, nativeEditorElements: () => ({ editor, saveButton: {} }),
    currentProjectId: () => state.snapshot.project.id,
    window: {
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    },
    fetch: async (_url, options) => _url === '/api/settings'
      ? { ok: true, json: async () => ({ ok: true, settings: {} }) }
      : new Promise(resolve => requests.push({
      payload: JSON.parse(options.body),
      finish(status = 200) { resolve({ status, ok: status === 200, json: async () => ({ ok: status === 200, writerRevision: 'r' + (requests.length + 1) }) }); }
    })),
    loadReaderFromProjectSnapshot: async () => {}, loadProjectLibrary: async () => {},
    triggerDownload: url => downloads.push(url)
  });
  ['writer-core.js', 'writer-export.js', 'writer-prompts.js', 'writer-global-prompt.js'].forEach(name => vm.runInContext(source(name), context));
  context.flushNativeEditorFields = () => { snapshot.sceneContents.s = editor.value; };
  context.normalizeNativeOrders = () => {};
  context.updateNativeStats = () => {};
  context.setNativeSaveStatus = (message, tone) => statuses.push({ message, tone });
  const exportFile = kind => kind === 'package' ? context.downloadNativeProjectPackage() : context.window.downloadNativeExport('text');
  const fireTimer = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  return { context, state, editor, snapshot, requests, downloads, statuses, timers, exportFile, fireTimer };
}

async function run() {
  const failures = [];
  const test = async (name, fn) => {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message); }
  };
  await test('autosave schedules later input after a slow save', async () => {
    const e = fixture();
    const saving = e.context.saveNativeScene();
    e.editor.value = '保存期间的新输入';
    e.context.markNativeDirty();
    e.fireTimer();
    e.requests[0].finish();
    await saving;
    await tick();
    if (e.requests.length === 1) {
      assert.ok(e.timers.size, 'dirty content must retain a follow-up autosave');
      e.fireTimer();
      await tick();
    }
    assert.strictEqual(e.requests.length, 2);
    assert.strictEqual(e.requests[1].payload.sceneContents.s, '保存期间的新输入');
    assert.strictEqual(e.requests[1].payload.writerRevision, 'r2');
    e.requests[1].finish();
    await tick();
    assert.strictEqual(e.state.dirty, false);
  });
  for (const [field, value] of [
    ['directiveStack', { schemaVersion: 1, layers: [{ id: 'project_main', enabled: true, content: '新增项目指令', scopes: ['writer-prose'] }] }],
    ['promptHistory', [{ id: 'history-new', resultText: '需要持久化的新结果' }]],
    ['prompts', [{ id: 'prompt-new', content: '新模板' }]]
  ]) await test('concurrent save includes later ' + field, async () => {
    const e = fixture();
    const saving = e.context.saveNativeScene();
    e.snapshot[field] = value;
    e.state.dirty = true;
    const laterSaving = e.context.saveNativeScene();
    e.requests[0].finish();
    await saving;
    await tick();
    assert.strictEqual(e.requests.length, 2, 'a waiting caller must commit later persistent fields');
    assert.deepStrictEqual(e.requests[1].payload[field], value);
    e.requests[1].finish();
    assert.strictEqual(await laterSaving, true);
    assert.strictEqual(e.state.dirty, false);
  });
  await test('project directives survive both snapshot adapter directions', async () => {
    const directiveStack = { schemaVersion: 1, layers: [{ id: 'project_main', enabled: true, content: '保留项目指令', scopes: ['writer-prose'] }] };
    const project = legacySnapshotToProject({ project: { id: 'p', title: '测试作品' }, chapters: [{ id: 'ch' }], scenes: [{ id: 's', chapterId: 'ch', content: '正文' }], directiveStack });
    assert.strictEqual(project.directiveStack.layers[0]?.content, '保留项目指令');
    const reopened = projectToLegacySnapshot(project);
    assert.strictEqual(reopened.directiveStack?.layers[0]?.content, '保留项目指令');
  });
  await test('failed project directive save leaves the dialog open and keeps its error', async () => {
    const e = fixture();
    const status = { textContent: '' };
    let closed = false;
    e.context.nativeGlobalPromptElements = () => ({ enabled: { checked: false }, content: { value: '' }, projectEnabled: { checked: true }, projectContent: { value: '项目指令' }, status });
    e.context.settingsState = {};
    e.context.normalizeDesktopSettings = value => value;
    e.context.runtimeProviderConfig = () => ({});
    e.context.closeNativeGlobalPromptDialog = () => { closed = true; };
    const saving = e.context.saveNativeGlobalPrompt();
    await tick();
    e.requests[0].finish(409);
    await saving;
    assert.strictEqual(closed, false, 'a failed save must keep the editable directive form');
    assert.ok(status.textContent.includes('保存失败'));
    assert.strictEqual(e.statuses.at(-1).tone, 'error');
  });
  for (const kind of ['text', 'package']) {
    await test(kind + ' export waits for the save and any later input', async () => {
      const e = fixture();
      const saving = e.context.saveNativeScene();
      e.editor.value = '导出必须包含的新输入';
      e.state.dirty = true;
      const exporting = e.exportFile(kind);
      await tick();
      assert.strictEqual(e.downloads.length, 0, 'must not export while save is pending');
      e.requests[0].finish();
      await saving;
      await tick();
      assert.strictEqual(e.requests.length, 2);
      assert.strictEqual(e.requests[1].payload.sceneContents.s, '导出必须包含的新输入');
      assert.strictEqual(e.downloads.length, 0);
      e.requests[1].finish();
      await exporting;
      assert.strictEqual(e.downloads.length, 1);
      assert.strictEqual(e.state.dirty, false);
    });
    await test(kind + ' export preserves save failure and does not download', async () => {
      const e = fixture();
      const exporting = e.exportFile(kind);
      await tick();
      e.requests[0].finish(409);
      await exporting;
      assert.strictEqual(e.downloads.length, 0);
      assert.strictEqual(e.statuses.at(-1).tone, 'error');
      assert.ok(e.statuses.at(-1).message.includes('当前输入已保留'));
    });
  }
  await test('export detects edits even when dirty flag has not updated', async () => {
    const e = fixture();
    e.state.dirty = false;
    const exporting = e.exportFile('text');
    await tick();
    assert.strictEqual(e.requests.length, 1);
    e.requests[0].finish();
    await exporting;
    assert.strictEqual(e.downloads.length, 1);
  });
  await test('export does not download an unstable generation target', async () => {
    const e = fixture();
    e.state.generation.inProgress = true;
    const exporting = e.exportFile('text');
    await tick();
    assert.strictEqual(e.downloads.length, 0);
    assert.strictEqual(e.requests.length, 0);
    await exporting;
  });
  await test('export does not follow a save to a different opened project', async () => {
    const e = fixture();
    const exporting = e.exportFile('text');
    await tick();
    e.state.snapshot = { project: { id: 'q' }, scenes: [] };
    e.requests[0].finish();
    await exporting;
    assert.strictEqual(e.downloads.length, 0);
  });
  assert.deepStrictEqual(failures, [], 'save/export regressions: ' + failures.join(', '));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
