const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../src/desktop/shell/writer-core.js'), 'utf8');

function fixture() {
  const editor = { value: 'Submitted text.' };
  const saveButton = { disabled: false };
  const snapshot = { project: { id: 'p', title: 'P' }, scenes: [{ id: 's' }], chapters: [], sceneContents: { s: 'Saved text.' }, writerRevision: 'old-revision' };
  const state = { snapshot, activeSceneId: 's', dirty: true, isSaving: false };
  const requests = [], statuses = [];
  const context = vm.createContext({
    window: {}, console: { error() {} }, nativeEditorState: state,
    nativeEditorElements: () => ({ editor, saveButton }),
    setNativeSaveStatus: (message, tone) => statuses.push({ message, tone }),
    loadReaderFromProjectSnapshot: async () => {}, loadProjectLibrary: async () => {},
    fetch: async (_url, options) => new Promise(resolve => requests.push({
      payload: JSON.parse(options.body),
      finish: (status = 200) => resolve({ ok: status === 200, status, json: async () => ({ ok: status === 200, writerRevision: 'new-revision' }) })
    }))
  });
  vm.runInContext(source, context);
  context.setNativeSaveStatus = (message, tone) => statuses.push({ message, tone });
  context.flushNativeEditorFields = () => { state.snapshot.sceneContents[state.activeSceneId] = editor.value; };
  context.normalizeNativeOrders = () => {};
  context.currentNativeScene = () => state.snapshot.scenes.find(scene => scene.id === state.activeSceneId);
  return { context, state, snapshot, editor, saveButton, requests, statuses };
}

(async () => {
  let env = fixture();
  let pending = env.context.saveNativeScene();
  assert.strictEqual(env.requests[0].payload.writerRevision, 'old-revision');
  await env.context.saveNativeScene();
  assert.strictEqual(env.requests.length, 1, 'saving twice must not submit twice');
  env.requests[0].finish();
  assert.strictEqual(await pending, true);
  assert.strictEqual(env.snapshot.writerRevision, 'new-revision');
  assert.strictEqual(env.state.dirty, false);
  assert.strictEqual(env.saveButton.disabled, false);

  env = fixture();
  pending = env.context.saveNativeScene();
  env.editor.value = 'New input while saving.';
  env.requests[0].finish();
  await pending;
  assert.strictEqual(env.state.dirty, true);
  assert.strictEqual(env.snapshot.sceneContents.s, 'New input while saving.');
  assert.strictEqual(env.snapshot.writerRevision, 'new-revision', 'later input must use the saved version on its next save');

  env = fixture();
  pending = env.context.saveNativeScene();
  env.requests[0].finish(409);
  assert.strictEqual(await pending, false);
  assert.strictEqual(env.snapshot.writerRevision, 'old-revision');
  assert.strictEqual(env.editor.value, 'Submitted text.');
  assert.strictEqual(env.state.dirty, true);
  assert.ok(env.statuses.at(-1).message.includes('当前输入已保留'));
  assert.strictEqual(env.saveButton.disabled, false);

  env = fixture();
  pending = env.context.saveNativeScene();
  env.state.snapshot = { project: { id: 'q' }, scenes: [{ id: 'q-scene' }], sceneContents: {} };
  env.state.isSaving = true;
  env.requests[0].finish();
  assert.strictEqual(await pending, false);
  assert.strictEqual(env.state.isSaving, true, 'an old finally must not unlock a new project save');
  assert.strictEqual(env.state.snapshot.writerRevision, undefined);
  assert.strictEqual(env.state.dirty, true);
  console.log('Writer save state tests passed (4 cases).');
})().catch(error => { console.error(error); process.exitCode = 1; });
