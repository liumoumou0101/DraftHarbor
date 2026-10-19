const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../src/desktop/shell/writer-prompts.js'), 'utf8');

async function run() {
  for (const name of ['loadPrompts', 'loadRewritePrompts', 'loadSummaryPrompts']) {
    for (const fail of [false, true]) {
      let finish;
      const snapshot = { project: { id: 'a' }, prompts: [{ id: 'a' }] };
      const nativeEditorState = { snapshot, rewrite: {} };
      const promptState = { prompts: [{ id: 'a' }], selectedId: 'a' };
      const rewritePromptState = { prompts: [{ id: 'a' }], selectedId: 'a' };
      const summaryPromptState = { prompts: [{ id: 'a' }], selectedId: 'a' };
      const c = vm.createContext({
        window: {}, console: { warn() {} }, URLSearchParams,
        nativeEditorState, promptState, rewritePromptState, summaryPromptState,
        currentProjectId: () => nativeEditorState.snapshot.project.id,
        fetch: async () => new Promise(resolve => { finish = () => resolve({ ok: !fail, status: fail ? 500 : 200, json: async () => ({ ok: !fail, prompts: [{ id: 'late-a' }] }) }); })
      });
      vm.runInContext(source, c);
      c.renderNativeGeneration = () => {};
      c.renderRewriteSavedPrompts = () => {};
      c.renderSummaryPromptTemplates = () => {};
      const loading = c[name]();
      // A new snapshot of the same project also invalidates a previous request.
      nativeEditorState.snapshot = { project: { id: 'a' }, prompts: [{ id: 'fresh-a' }] };
      [promptState, rewritePromptState, summaryPromptState].forEach(state => { state.prompts = [{ id: 'fresh-a' }]; state.selectedId = 'fresh-a'; });
      finish();
      await loading;
      assert.strictEqual(nativeEditorState.snapshot.prompts[0].id, 'fresh-a');
      for (const state of [promptState, rewritePromptState, summaryPromptState]) {
        assert.strictEqual(state.prompts[0].id, 'fresh-a', name + ' must ignore stale ' + (fail ? 'failure' : 'success'));
        assert.strictEqual(state.selectedId, 'fresh-a');
      }
      console.log('PASS ' + name + ' ignores stale ' + (fail ? 'failure' : 'success'));
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
