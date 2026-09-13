const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const avoidance = require('../src/core/style/avoidance-rules');
function fixture(fail = false) {
    const snapshot = { styleGuardRules: [{ id: 'p', text: '旧项目规则', reason: '', scope: 'project', enabled: false }] };
    const settingsState = { settings: { globalStyleGuardRules: [{ id: 'g', text: '旧全局规则', reason: '', scope: 'global', enabled: true }] } };
    const controls = [{ disabled: false }];
    const elements = { scope: { value: 'project', focus() {} }, rules: { value: '', focus() {}, closest: () => ({}) }, status: { dataset: {} }, modal: { hidden: true, showModal() {}, close() {}, querySelectorAll: () => controls } };
    const requests = [];
    const context = vm.createContext({
        structuredClone, window: { DraftHarborAvoidanceRules: avoidance }, document: { activeElement: null },
        nativeEditorState: { snapshot }, settingsState, markNativeDirty() {}, setNativeSaveStatus() {},
        fetch: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            return { ok: !fail, json: async () => fail ? { ok: false, error: 'offline' } : { ok: true, settings: requests.at(-1) } };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/desktop/shell/style-guard.js'), 'utf8'), context);
    context.styleGuardElements = () => elements;
    context.renderStyleGuardRows = () => {};
    context.renderStyleGuardCount = () => {};
    context.openStyleGuard();
    const edit = code => vm.runInContext(code, context);
    return { context, snapshot, settingsState, controls, elements, requests, edit };
}
(async () => {
    const cancelled = fixture();
    cancelled.edit("styleGuardDraft.project[0].text = '未保存编辑'; styleGuardDraft.global[0].text = '全局草稿'");
    assert.strictEqual(cancelled.snapshot.styleGuardRules[0].text, '旧项目规则');
    cancelled.context.closeStyleGuard();
    assert.strictEqual(cancelled.settingsState.settings.globalStyleGuardRules[0].text, '旧全局规则');
    const saved = fixture();
    saved.edit("styleGuardDraft.project[0].text = '项目草稿'; styleGuardDraft.global[0].text = '全局草稿'");
    await saved.context.saveStyleGuard({ preventDefault() {} });
    assert.strictEqual(saved.snapshot.styleGuardRules[0].text, '项目草稿');
    assert.strictEqual(saved.snapshot.styleGuardRules[0].enabled, false, 'disabled rules must remain disabled');
    assert.strictEqual(saved.settingsState.settings.globalStyleGuardRules[0].text, '全局草稿');
    assert.strictEqual(saved.settingsState.settings.globalStyleGuardRules[0].scope, 'global');
    assert.strictEqual(saved.elements.modal.hidden, true);
    const failure = fixture(true);
    failure.edit("styleGuardDraft.project[0].text = '项目草稿'; styleGuardDraft.global[0].text = '全局草稿'");
    await failure.context.saveStyleGuard({ preventDefault() {} });
    assert.strictEqual(failure.snapshot.styleGuardRules[0].text, '旧项目规则', 'failed global save must not partially commit project edits');
    assert.strictEqual(failure.edit('styleGuardDraft.global[0].text'), '全局草稿');
    assert.strictEqual(failure.elements.modal.hidden, false);
    assert.strictEqual(failure.controls[0].disabled, false);
    const pendingImport = fixture();
    pendingImport.elements.rules.value = '尚未添加的批量规则';
    await pendingImport.context.saveStyleGuard({ preventDefault() {} });
    assert.strictEqual(pendingImport.requests.length, 0);
    assert.strictEqual(pendingImport.elements.modal.hidden, false);
    console.log('Style guard draft, save, cancellation and failure tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
