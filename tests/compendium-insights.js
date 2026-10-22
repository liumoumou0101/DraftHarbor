const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const helperPath = path.join(__dirname, '../src/core/knowledge/compendium-insights.js');
assert.ok(fs.existsSync(helperPath), 'the compendium insights helper must exist');
const Insights = require(helperPath);

function snapshot(scenes = [], extra = {}) {
    return { project: { id: 'project-a' }, chapters: [{ id: 'chapter-a', title: 'Opening', order: 0 }], scenes, ...extra };
}

function entry(extra = {}) {
    return { id: 'ann', projectId: 'project-a', title: 'Ann', type: 'character', aliases: ['Captain'], ...extra };
}

function freezeDeep(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}

function test(name, body) {
    body();
    console.log(`PASS ${name}`);
}

test('mentions use current prose with word boundaries and document order', () => {
    const project = snapshot([
        { id: 'later', chapterId: 'chapter-b', title: 'Later', order: 0, content: 'The Captain leaves.' },
        { id: 'false-positive', chapterId: 'chapter-a', order: 0, content: 'Annual planning and Anna.' },
        { id: 'first', chapterId: 'chapter-a', title: 'Arrival', order: 1, content: 'ANN arrives.' },
        { id: 'first', chapterId: 'chapter-a', title: 'Duplicate', order: 2, content: 'Ann again.' }
    ], { chapters: [{ id: 'chapter-b', title: 'Departure', order: 1 }, { id: 'chapter-a', title: 'Opening', order: 0 }] });
    const result = Insights.analyzeEntry(entry(), project);
    assert.deepStrictEqual(result.mentions.map(item => item.sceneId), ['first', 'later']);
    assert.deepStrictEqual(result.mentions.map(item => item.matchKind), ['text', 'text']);
    assert.strictEqual(result.mentions[0].chapterTitle, 'Opening');
    assert.strictEqual(result.mentions[0].sceneTitle, 'Arrival');
});

test('explicit and cast references are separate from textual matches and historical sources', () => {
    const selected = entry({ relatedSceneIds: ['linked', 'linked', 'deleted'], sourceReferences: [{ sceneId: 'history', excerpt: 'Ann was here.' }] });
    const result = Insights.analyzeEntry(selected, snapshot([
        { id: 'linked', content: 'Ann remains linked.', order: 0 },
        { id: 'cast', povCharacter: 'Captain', content: 'An unnamed viewpoint.', order: 1 },
        { id: 'participants', participants: ['Ann'], order: 2 },
        { id: 'history', content: 'The original name was removed.', order: 3 }
    ]));
    assert.deepStrictEqual(result.mentions.map(item => [item.sceneId, item.matchKind]), [['linked', 'explicit'], ['cast', 'cast'], ['participants', 'cast']]);
    assert.strictEqual(result.sources[0].excerpt, 'Ann was here.');
    assert.strictEqual(result.sources[0].sceneAvailable, true);
});

test('CJK names need two characters in prose while a single character can match exact cast', () => {
    const project = snapshot([{ id: 'text', content: '小林来到青城。', order: 0 }, { id: 'cast', characters: ['林'], order: 1 }]);
    assert.deepStrictEqual(Insights.analyzeEntry(entry({ title: '林', aliases: [] }), project).mentions.map(item => [item.sceneId, item.matchKind]), [['cast', 'cast']]);
    assert.deepStrictEqual(Insights.analyzeEntry(entry({ title: '小林', aliases: [] }), project).mentions.map(item => item.sceneId), ['text']);
});

test('snapshot content map overrides canonical content even when the current text is empty', () => {
    const project = snapshot([{ id: 'cleared', content: 'Ann was removed.' }, { id: 'current', content: 'Old text.' }], { sceneContents: { cleared: '', current: 'Ann is here.' } });
    assert.deepStrictEqual(Insights.analyzeEntry(entry(), project).mentions.map(item => item.sceneId), ['current']);
});

test('cross-project mismatches cannot expose scene text, related cards, or live source targets', () => {
    const selected = entry({ relatedSceneIds: ['same-id'], sourceReferences: [{ sceneId: 'same-id', chapterId: 'chapter-a', excerpt: 'Original evidence' }] });
    const project = snapshot([{ id: 'same-id', chapterId: 'chapter-a', content: 'Ann SECRET' }], { project: { id: 'project-b' }, compendium: [{ id: 'other', projectId: 'project-b', body: 'Ann SECRET' }] });
    const result = Insights.analyzeEntry(selected, project);
    assert.deepStrictEqual(result.mentions, []);
    assert.deepStrictEqual(result.related, []);
    assert.strictEqual(result.sources[0].sceneAvailable, false);
    assert.strictEqual(result.sources[0].chapterAvailable, false);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    const mixed = snapshot([{ id: 'foreign', projectId: 'project-b', content: 'Ann SECRET' }]);
    assert.deepStrictEqual(Insights.analyzeEntry(selected, mixed).mentions, []);
});

test('related cards expose computed reasons, exclude self, and keep project boundaries', () => {
    const selected = entry({ body: 'The Compass guides her.', tags: ['crew'] });
    const related = [selected,
        { id: 'compass', projectId: 'project-a', title: 'Compass', type: 'item', summary: 'A brass tool.' },
        { id: 'crew', projectId: 'project-a', title: 'Crew', type: 'organization', body: 'Ann founded the crew.' },
        { id: 'tagged', projectId: 'project-a', title: 'Port', type: 'location', tags: ['crew'] },
        { id: 'tagged', projectId: 'project-a', title: 'Duplicate', tags: ['crew'] },
        { id: 'foreign', projectId: 'project-b', title: 'Foreign', body: 'Ann SECRET' }
    ];
    const result = Insights.analyzeEntry(selected, snapshot([], { compendium: related }));
    assert.deepStrictEqual(result.related.map(item => [item.entryId, item.reason]), [['compass', 'mentions-entry'], ['crew', 'mentioned-by-entry'], ['tagged', 'shared-tag']]);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
});

test('sources preserve recorded evidence and expose unavailable scene references without invented titles', () => {
    const source = { kind: 'reader-transfer', documentId: 'doc-1', revisionId: 'rev-1', sectionId: 'section-2', envelopeId: 'env-1', sceneId: 'deleted', excerpt: '  Recorded\n evidence.  ', createdAt: '2026-01-01T00:00:00.000Z' };
    const result = Insights.analyzeEntry(entry({ sourceReferences: [source, { ...source }, null, {}] }), snapshot([]));
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].documentId, 'doc-1');
    assert.strictEqual(result.sources[0].excerpt, 'Recorded evidence.');
    assert.strictEqual(result.sources[0].createdAt, source.createdAt);
    assert.strictEqual(result.sources[0].sceneAvailable, false);
    assert.ok(result.sources[0].label.includes('reader-transfer'));
    assert.ok(result.sources[0].label.includes('doc-1'));
    assert.ok(!result.sources[0].label.includes('Opening'));
});

test('limits expose true totals and truncation flags instead of implying full results', () => {
    const project = snapshot(Array.from({ length: 55 }, (_, index) => ({ id: `s-${index}`, order: index, content: 'Ann appears.' })));
    const selected = entry({ tags: ['crew'], sourceReferences: Array.from({ length: 43 }, (_, index) => ({ envelopeId: `env-${index}`, excerpt: 'Evidence.' })) });
    const cards = Array.from({ length: 15 }, (_, index) => ({ id: `card-${index}`, title: `Card ${index}`, tags: ['crew'] }));
    const result = Insights.analyzeEntry(selected, project, cards);
    assert.deepStrictEqual([result.mentions.length, result.related.length, result.sources.length], [50, 12, 40]);
    assert.deepStrictEqual(result.totals, { mentions: 55, related: 15, sources: 43 });
    assert.deepStrictEqual(result.truncated, { mentions: true, related: true, sources: true });
});

test('excerpts stay bounded, include the match, and remain raw plain text for textContent rendering', () => {
    const text = `${'Before '.repeat(40)}Ann <img src=x onerror=alert(1)> ${'after '.repeat(40)}`;
    const result = Insights.excerpt(text, { terms: ['Ann'], maxLength: 70 });
    assert.ok(result.includes('Ann'));
    assert.ok(result.length <= 70);
    assert.strictEqual(Insights.excerpt('<script>alert(1)</script> & plain'), '<script>alert(1)</script> & plain');
    assert.strictEqual(Insights.excerpt(' a\n\t b '), 'a b');
    assert.strictEqual(Insights.excerpt('long', { maxLength: 0 }), '');
    assert.ok(Insights.excerpt('before Ann after', { terms: ['Ann'], maxLength: 2 }).length <= 2);
    assert.ok(!/[\uD800-\uDBFF]$/.test(Insights.excerpt('😀'.repeat(100), { maxLength: 17 })));
});

test('punctuation in names is literal and single-character prose names stay quiet', () => {
    const project = snapshot([{ id: 'literal', content: 'C++ and A.B' }, { id: 'false-positive', content: 'C++ish and AxB' }]);
    assert.deepStrictEqual(Insights.analyzeEntry(entry({ title: 'C++', aliases: ['A.B'] }), project).mentions.map(item => item.sceneId), ['literal']);
    assert.deepStrictEqual(Insights.analyzeEntry(entry({ title: 'A', aliases: [] }), snapshot([{ id: 'letter', content: 'A walks.' }])).mentions, []);
});

test('insights do not mutate frozen entries or snapshots and tolerate missing input', () => {
    const selected = freezeDeep(entry({ aliases: ['Captain'], sourceReferences: [{ sceneId: 's', excerpt: 'Old Ann.' }] }));
    const project = freezeDeep(snapshot([{ id: 's', chapterId: 'chapter-a', content: 'Ann arrives.' }], { compendium: [selected] }));
    const before = JSON.stringify({ selected, project });
    Insights.analyzeEntry(selected, project);
    assert.strictEqual(JSON.stringify({ selected, project }), before);
    assert.deepStrictEqual(Insights.analyzeEntry(null, null).totals, { mentions: 0, related: 0, sources: 0 });
    assert.strictEqual(Insights.isSummaryEntry({ type: 'note', tags: ['scene-summary'] }), true);
    assert.strictEqual(Insights.isSummaryEntry({ sourceReferences: [{ kind: 'summary' }] }), true);
    assert.strictEqual(Insights.isSummaryEntry({ type: 'note', tags: [] }), false);
});

test('the same API is available as a browser classic script', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(helperPath, 'utf8'), context);
    assert.strictEqual(typeof context.DraftHarborCompendiumInsights.analyzeEntry, 'function');
    assert.strictEqual(context.DraftHarborCompendiumInsights.excerpt('plain'), 'plain');
});

console.log('Compendium insights tests passed.');
