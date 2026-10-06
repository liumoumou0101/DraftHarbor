const assert = require('assert');
const Layout = require('../src/core/document/reader-layout');

assert.strictEqual(Layout.effectiveLayoutMode('flow', 1200), 'flow');
assert.strictEqual(Layout.effectiveLayoutMode('single-page', 1200), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 920), 'double-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 700), 'double-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 420), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 920), 'illustrated');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 700), 'single-page', 'illustrated mode must retain usable text and image widths, using compact viewing below a full spread');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 420), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 600), 'single-page', 'illustrated mode needs wider pages than an explicit text spread');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 920), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 700), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('single-page', 920, { viewportHeight: 180 }), 'flow');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 920, { viewportHeight: 180 }), 'flow');

const defaultTypography = { fontSize: 18, pageMargin: 48, textWidth: 760, gap: 28 };
assert.strictEqual(Layout.effectiveLayoutMode('auto', 834, defaultTypography), 'single-page', 'a 960px window must not squeeze the default text into a spread');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 1154, defaultTypography), 'double-page', 'a 1280px window has room for a comfortable spread');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 1154, { ...defaultTypography, fontSize: 28 }), 'single-page', 'larger text needs wider lines before auto chooses a spread');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 1154, { ...defaultTypography, pageMargin: 120 }), 'single-page', 'auto must account for the width occupied by page margins');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 834, defaultTypography), 'double-page', 'an explicit double-page request can use shorter readable lines');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 534, defaultTypography), 'single-page', 'explicit spreads still need a usable text column');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 834, { ...defaultTypography, fontSize: 32, pageMargin: 80 }), 'single-page', 'explicit spreads must fall back when typography leaves too little text width');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 920, { ...defaultTypography, fontSize: 48, pageMargin: 80 }), 'single-page', 'illustrated mode must also fall back when large text and margins exceed its minimum page width');

const laptopSpread = Layout.pagedGeometry({
  viewportWidth: 1280, viewportHeight: 720, effectiveMode: 'double-page', gap: 28
});
assert.ok(laptopSpread.pageWidth >= 220, 'laptop double-page must keep a usable page width');
assert.ok(laptopSpread.pageHeight >= 500, 'laptop double-page should still fill most of the stage height');

const twoKSpread = Layout.pagedGeometry({
  viewportWidth: 2560, viewportHeight: 1440, effectiveMode: 'double-page', gap: 28
});
assert.ok(twoKSpread.spreadMax <= 1800, '2K default double-page spread must not grow without a text-width cap');
assert.strictEqual(twoKSpread.pageHeight, 1440, '2K double-page must use the available reading height');

const twoKSingle = Layout.pagedGeometry({
  viewportWidth: 2560, viewportHeight: 1440, effectiveMode: 'single-page', gap: 28
});
assert.ok(twoKSingle.pageWidth <= 980, '2K single-page width stays capped');

for (const effectiveMode of ['single-page', 'double-page', 'illustrated']) {
  const narrow = Layout.pagedGeometry({ viewportWidth: 2560, viewportHeight: 1440, effectiveMode, textWidth: 620, pageMargin: 48 });
  const wide = Layout.pagedGeometry({ viewportWidth: 2560, viewportHeight: 1440, effectiveMode, textWidth: 980, pageMargin: 48 });
  assert.strictEqual(narrow.pageWidth, 718, 'page width includes the requested 620px text column, two margins and borders');
  assert.strictEqual(wide.pageWidth, 1078, 'larger text width must enlarge every paginated layout when space allows');
  assert.strictEqual(wide.spreadMax, effectiveMode === 'single-page' ? 1078 : 2184, 'deck width must match its pages and spine');
}
const compactSpread = Layout.pagedGeometry({ viewportWidth: 834, viewportHeight: 500, effectiveMode: 'double-page', textWidth: 980, pageMargin: 48 });
assert.strictEqual(compactSpread.pageWidth, 403, 'text width is a maximum, never a reason to overflow the viewport');
assert.strictEqual(compactSpread.spreadMax, 834);
assert.ok(Layout.pagedGeometry({ viewportWidth: 240, effectiveMode: 'single-page' }).pageWidth <= 240, 'a single page must fit even a very narrow viewport');

const twoKCapacity = Layout.estimatePageCapacity({
  pageWidth: twoKSpread.pageWidth,
  pageHeight: twoKSpread.pageHeight,
  fontSize: 20,
  lineHeight: 1.8,
  pageMargin: 48,
  paragraphSpacing: 1.05
});
const twoKLineBox = 20 * 1.8;
const twoKUsable = twoKSpread.pageHeight - 96;
const twoKFillRatio = twoKCapacity / Math.max(1, Math.floor(twoKUsable / twoKLineBox) * Math.floor((twoKSpread.pageWidth - 96) / 20));
assert.ok(twoKCapacity >= 720, `2K 20px pages must hold a full leaf, got ${twoKCapacity}`);
assert.ok(twoKFillRatio >= 0.7, `2K capacity should fill most of the leaf, got ${twoKFillRatio.toFixed(2)}`);

const chapter = {
  chapterId: 'long',
  blocks: [
    { blockId: 'heading', type: 'heading', text: '长章' },
    { blockId: 'long-block', type: 'paragraph', text: '甲'.repeat(1000) },
    { blockId: 'ending', type: 'paragraph', text: '结尾' }
  ]
};
const pages = Layout.buildReaderPages(chapter, { capacity: 128 });
assert.ok(pages.length >= 8, 'long blocks must split across pages');
assert.ok(pages.every((page, index) => page.pageIndex === index && page.segments.length), 'pages must be ordered and non-empty');
const pageIndex = Layout.pageIndexForLocator(pages, { blockId: 'long-block', offset: 512 });
const pagePosition = Layout.locatorPositionForPage(pages, pageIndex);
assert.strictEqual(pagePosition.blockId, 'long-block');
assert.ok(pagePosition.offset <= 512, 'page position must not follow the requested locator');
assert.strictEqual(Layout.buildReaderPages({ blocks: [] }, { capacity: 128 }).length, 1, 'empty chapters retain one empty page');

const endingChapter = { chapterId: 'ending-chapter', blocks: [
  { blockId: 'before-ending', type: 'paragraph', text: '开头'.repeat(80) },
  { blockId: 'long-ending', type: 'paragraph', text: '末段'.repeat(1000) }
] };
for (const capacity of [128, 200, 3000]) {
  const endPages = Layout.buildReaderPages(endingChapter, { capacity });
  const endPage = Layout.pageIndexForLocator(endPages, { blockId: 'long-ending', offset: 2000 });
  assert.strictEqual(endPage, endPages.length - 1, 'an exclusive document-end locator must resolve to the final page');
  const split = endPages.findIndex((page, index) => index > 0 && page.segments[0].blockId === 'long-ending');
  if (split > 0) {
    const boundary = endPages[split].segments[0];
    assert.strictEqual(Layout.pageIndexForLocator(endPages, { blockId: boundary.blockId, offset: boundary.startOffset }), split, 'ordinary page boundaries must still select the following page');
  }
}
const emptyTailPages = Layout.buildReaderPages({ blocks: [
  { blockId: 'body', text: '字'.repeat(300) }, { blockId: 'empty-tail', text: '' }
] }, { capacity: 128 });
assert.strictEqual(Layout.pageIndexForLocator(emptyTailPages, { blockId: 'empty-tail', offset: 0 }), emptyTailPages.length - 1, 'an empty final block must retain its page');
assert.strictEqual(Layout.pageIndexForLocator(pages, { blockId: 'long-block', offset: 1000 }), pages.findLastIndex(page => page.segments.some(segment => segment.blockId === 'long-block')), 'a block-end locator must not jump to another following block');
assert.strictEqual(Layout.pageIndexForLocator(pages, { blockId: 'missing', offset: 1000 }), 0, 'unknown blocks retain the existing safe fallback');

const windowRange = Layout.flowWindowForAnchor(1000, 500);
assert.ok(windowRange.start <= 500 && windowRange.end > 500);
assert.ok(windowRange.end - windowRange.start <= 73, 'flow DOM window must stay bounded');
assert.deepStrictEqual(Layout.flowWindowForAnchor(3, 2), { start: 0, end: 3 });

const baseKey = Layout.layoutCacheKey({
  revisionId: 'r1', chapterId: 'c1', requestedMode: 'auto', effectiveMode: 'double-page',
  viewportWidth: 1200, viewportHeight: 800, actualFontFamily: 'Microsoft YaHei', fontSize: 18,
  lineHeight: 1.8, letterSpacing: 0, paragraphSpacing: 1.05, pageMargin: 48, textAlign: 'start', indent: true
});
assert.notStrictEqual(baseKey, Layout.layoutCacheKey(JSON.parse(baseKey.replace('"r1"', '"r2"'))), 'revision must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), viewportWidth: 1000 }), 'viewport must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), actualFontFamily: 'SimSun' }), 'actual font must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), fontCatalogVersion: 2 }), 'font catalog changes must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), fontWeight: 700 }), 'font weight changes must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), bookSpine: 44 }), 'book spine changes must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), textWidth: 320 }), 'text width changes must invalidate pagination cache');
assert.notStrictEqual(baseKey, Layout.layoutCacheKey({ ...JSON.parse(baseKey), pageHeight: 500 }), 'changing chrome insets must invalidate pagination even when the viewport is unchanged');

const qualityText = '你好，世界。English words stay together，下一句继续！😀混合文本；“引用内容”结束。'.repeat(5);
const qualityPages = Layout.buildReaderPages({ blocks: [{ blockId: 'quality', type: 'paragraph', text: qualityText }] }, {
  capacity: 64, orphanLines: 2, widowLines: 2
});
const qualitySegments = qualityPages.flatMap((page) => page.segments);
assert.strictEqual(qualitySegments.map((segment) => qualityText.slice(segment.startOffset, segment.endOffset)).join(''), qualityText, 'mixed Chinese/English/emoji pagination must preserve every UTF-16 unit');
assert.ok(qualitySegments.every((segment) => {
  const startsAtLowSurrogate = qualityText.charCodeAt(segment.startOffset) >= 0xDC00 && qualityText.charCodeAt(segment.startOffset) <= 0xDFFF;
  const endsBeforeLowSurrogate = segment.endOffset < qualityText.length && qualityText.charCodeAt(segment.endOffset) >= 0xDC00 && qualityText.charCodeAt(segment.endOffset) <= 0xDFFF;
  return !startsAtLowSurrogate && !endsBeforeLowSurrogate;
}), 'pagination must not split an emoji surrogate pair');
assert.ok(qualitySegments.slice(1).every((segment) => !'，。！？；：、)]）】》」』”’'.includes(qualityText[segment.startOffset])), 'pages must not start with closing punctuation');
assert.ok(Layout.preferredBreakOffset('alpha beta gamma', 8, 0) <= 6, 'English words should prefer a natural whitespace break');
assert.ok(Layout.fittedBreakOffset('alpha beta gamma', 8, 0) <= 6, 'measured pagination must never extend beyond the fitted English line');
assert.ok(Layout.fittedBreakOffset('你好，世界', 2, 0) <= 2, 'measured pagination must never exceed the browser-fitted offset');
assert.ok(!'，。！？；：、)]）】》」』”’'.includes('你好，世界'[Layout.fittedBreakOffset('你好，世界', 2, 0)]), 'measured pages must not begin with closing punctuation');
const familyEmoji = '甲👨‍👩‍👧‍👦乙'.repeat(24);
const familyPages = Layout.buildReaderPages({ blocks: [{ blockId: 'family', type: 'paragraph', text: familyEmoji }] }, { capacity: 64 });
const familySegments = familyPages.flatMap((page) => page.segments);
assert.strictEqual(familySegments.map((segment) => familyEmoji.slice(segment.startOffset, segment.endOffset)).join(''), familyEmoji, 'grapheme-aware pagination must preserve joined emoji');
assert.ok(familySegments.slice(1).every((segment) => !['\u200d', '\ufe0f'].includes(familyEmoji[segment.startOffset])), 'pages must not begin inside a joined emoji grapheme');

const millionChapter = { blocks: Array.from({ length: 1000 }, (_, index) => ({ blockId: `b${index}`, type: 'paragraph', text: '字'.repeat(1000) })) };
const startedAt = Date.now();
const millionPages = Layout.buildReaderPages(millionChapter, { capacity: 1600 });
assert.ok(millionPages.length > 600);
assert.ok(Date.now() - startedAt < 1500, 'million-character pagination model must stay within its CPU budget');

console.log('Reader layout tests passed.');
