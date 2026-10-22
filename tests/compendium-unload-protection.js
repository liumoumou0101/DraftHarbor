const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../src/desktop/shell/writer-bindings.js'), 'utf8');

function fixture() {
  const listeners = new Map();
  const state = {
    nativeEditorState: { dirty: false, isSaving: false },
    compendiumState: { dirty: false },
    compendiumEditorSession: { saves: new Set(), creating: null, deleting: null },
    compendiumRewriteState: { saving: false },
    compendiumExtractionState: { saving: false },
    compendiumDrawState: { saving: false },
    compendiumAgentState: { applying: false }
  };
  const context = vm.createContext({
    ...state,
    window: { addEventListener(name, callback) { listeners.set(name, callback); } },
    document: { querySelector: () => null, addEventListener() {} },
    nativeEditorElements: () => ({ specialButtons: [], panelTabs: [], assistantGroupTabs: [] }),
    renderNativeEditor() {}
  });
  vm.runInContext(source, context);
  context.bindNativeEditor();
  return { state, attemptClose() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.get('beforeunload')(event);
    return event.defaultPrevented;
  } };
}

const pendingCases = [
  ['writer draft', state => { state.nativeEditorState.dirty = true; }],
  ['writer save', state => { state.nativeEditorState.isSaving = true; }],
  ['compendium draft', state => { state.compendiumState.dirty = true; }],
  ['compendium save', state => { state.compendiumEditorSession.saves.add({}); }],
  ['compendium creation', state => { state.compendiumEditorSession.creating = {}; }],
  ['compendium deletion', state => { state.compendiumEditorSession.deleting = {}; }],
  ['rewrite save', state => { state.compendiumRewriteState.saving = true; }],
  ['extraction save', state => { state.compendiumExtractionState.saving = true; }],
  ['draw save', state => { state.compendiumDrawState.saving = true; }],
  ['agent apply', state => { state.compendiumAgentState.applying = true; }]
];

const unprotected = [];
for (const [name, mutate] of pendingCases) {
  const env = fixture();
  assert.strictEqual(env.attemptClose(), false, 'a clean editor may close');
  mutate(env.state);
  if (!env.attemptClose()) unprotected.push(name);
}
assert.deepStrictEqual(unprotected, [], 'pending drafts and compendium writes must stop window close');
const settled = fixture();
settled.state.compendiumEditorSession.saves.add({});
assert.strictEqual(settled.attemptClose(), true);
settled.state.compendiumEditorSession.saves.clear();
assert.strictEqual(settled.attemptClose(), false, 'finishing a write must release close protection');
console.log(`Compendium unload protection tests passed (${pendingCases.length + 1} cases, no browser or provider requests).`);
