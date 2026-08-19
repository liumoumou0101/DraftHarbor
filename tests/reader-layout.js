const assert = require('assert');
const Layout = require('../src/core/document/reader-layout');

assert.strictEqual(Layout.effectiveLayoutMode('flow', 1200), 'flow');
assert.strictEqual(Layout.effectiveLayoutMode('single-page', 1200), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 920), 'double-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 700), 'double-page');
assert.strictEqual(Layout.effectiveLayoutMode('double-page', 420), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 920), 'illustrated');
assert.strictEqual(Layout.effectiveLayoutMode('illustrated', 420), 'single-page');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 920), 'double-page');
assert.strictEqual(Layout.effectiveLayoutMode('auto', 700), 'single-page');

const laptopSpread = Layout.pagedGeometry({
  viewportWidth: 1280, viewportHeight: 720, effectiveMode: 'double-page', gap: 28
});
assert.ok(laptopSpread.pageWidth >= 220, 'laptop double-page must keep a usable page width');
assert.ok(laptopSpread.pageHeight >= 500, 'laptop double-page should still fill most of the stage height');

const twoKSpread = Layout.pagedGeometry({
  viewportWidth: 2560, viewportHeight: 1440, effectiveMode: 'double-page', gap: 28
});
assert.ok(twoKSpread.spreadMax <= 1680, '2K double-page spread must not grow without a cap');
assert.ok(twoKSpread.pageHeight < 1300, '2K double-page height must follow a book proportion instead of the full window');
assert.ok(twoKSpread.pageHeight / twoKSpread.pageWidth < 1.5, '2K pages should stay near a book aspect');

const twoKSingle = Layout.pagedGeometry({
  viewportWidth: 2560, viewportHeight: 1440, effectiveMode: 'single-page', gap: 28
});
assert.ok(twoKSingle.pageWidth <= 980, '2K single-page width stays capped');

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

const millionChapter = { blocks: Array.from({ length: 1000 }, (_, index) => ({ blockId: `b${index}`, type: 'paragraph', text: '字'.repeat(1000) })) };
const startedAt = Date.now();
const millionPages = Layout.buildReaderPages(millionChapter, { capacity: 1600 });
assert.ok(millionPages.length > 600);
assert.ok(Date.now() - startedAt < 1500, 'million-character pagination model must stay within its CPU budget');

console.log('Reader layout tests passed.');
