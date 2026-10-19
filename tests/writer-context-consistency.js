const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resolver = require('../src/core/context/context-resolver');

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this._value = ''; }
  set value(value) { this._value = this.tag === 'select' && !this.children.some(option => option.value === value) ? '' : value; }
  get value() { return this._value; }
  appendChild(child) { this.children.push(child); if (this.tag === 'select' && this.children.length === 1) this._value = child.value; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren() { this.children = []; }
  addEventListener() {}
}
const source = name => fs.readFileSync(path.join(__dirname, '../src/desktop/shell', name), 'utf8');
function fixture() {
  const entry = { id: 'person', type: 'character', title: '林舟', content: '地图修复师', alwaysInContext: true };
  const scene = { id: 's', chapterId: 'ch', title: '来信', summary: '旧场景摘要' };
  const snapshot = { project: { id: 'p' }, chapters: [{ id: 'ch', title: '第一章', summary: '旧章节摘要' }], scenes: [scene], sceneContents: { s: '原句' }, compendium: [entry] };
  const state = { snapshot, activeSceneId: 's', generation: {}, context: { compendiumIds: [], compendiumTags: [], chapterModes: { ch: 'full' }, sceneModes: { s: 'summary' } }, searchQuery: '原句', searchMatchPositions: [{ start: 0, end: 2 }], searchMatchIndex: 0 };
  const elements = { contextCompendium: new Element(), contextCompendiumTags: new Element(), contextChapters: new Element(), contextScenes: new Element(), contextSummary: new Element(), replace: { value: '新句' }, editor: { value: '原句' } };
  const context = vm.createContext({ nativeEditorState: state, nativeEditorElements: () => elements, compendiumState: { entries: [entry] }, document: { createElement: tag => new Element(tag) }, window: { DraftHarborContextResolver: resolver } });
  ['writer-core.js', 'writer-prompts.js'].forEach(name => vm.runInContext(source(name), context));
  context.flushNativeEditorFields = () => {};
  context.renderNativeEditor = () => {};
  context.markNativeDirty = () => {};
  return { context, snapshot, elements };
}
const failures = [];
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message); }
}
test('context redraw preserves selected chapter and scene reference modes', () => {
  const e = fixture();
  e.context.renderNativeContext();
  e.context.renderNativeContext();
  assert.strictEqual(e.elements.contextChapters.children[0].children[0].value, 'full');
  assert.strictEqual(e.elements.contextScenes.children[0].children[0].value, 'summary');
});
test('context summary explains automatically included references', () => {
  const e = fixture();
  e.context.renderNativeContext();
  assert.ok(e.elements.contextSummary.textContent.includes('林舟'));
  assert.ok(e.elements.contextSummary.textContent.includes('自动') || e.elements.contextSummary.textContent.includes('常驻'));
});
for (const scope of ['all', 'current']) test(scope + ' replace invalidates both levels of summary', () => {
  const e = fixture();
  e.context.replaceNativeText(scope);
  assert.strictEqual(e.snapshot.sceneContents.s, '新句');
  assert.strictEqual(e.snapshot.scenes[0].summaryStale, true);
  assert.strictEqual(e.snapshot.chapters[0].summaryStale, true);
  const resolved = resolver.resolveContext({ project: { ...e.snapshot, scenes: [...e.snapshot.scenes, { id: 'next', chapterId: 'ch' }] }, selection: { currentSceneId: 'next' } });
  assert.strictEqual(resolved.sceneSummaries.length, 0, 'old summaries must not reenter automatic context');
});
assert.deepStrictEqual(failures, [], failures.join(', '));
