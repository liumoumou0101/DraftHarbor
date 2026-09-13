const assert = require('assert');
const { INDENT, formatManuscript } = require('../src/core/document/manuscript-format');

function format(text, options) {
    return formatManuscript(text, options).text;
}

assert.strictEqual(format(''), '', 'empty text stays empty');
assert.strictEqual(format('   \n\n  '), '', 'whitespace-only text collapses to empty');
assert.strictEqual(formatManuscript('').changed, false, 'empty text is not a change');

const messy = '她走进雨里,街灯亮着...\n\n他说:"走吧."';
const cleaned = format(messy);
assert.strictEqual(
    cleaned,
    `${INDENT}她走进雨里，街灯亮着……\n${INDENT}他说：“走吧。”`,
    'web-novel format should indent, convert punctuation, and drop extra blank lines'
);
assert.strictEqual(format(cleaned), cleaned, 'formatting should be idempotent');
assert.strictEqual(formatManuscript(messy).paragraphCount, 2, 'blank-separated blocks become two paragraphs');

assert.strictEqual(
    format('她走进雨里。\n街灯亮着。'),
    `${INDENT}她走进雨里。\n${INDENT}街灯亮着。`,
    'complete lines stay separate paragraphs'
);

assert.strictEqual(
    format('她走进雨里，街灯亮着，远处传来\n一声汽笛。'),
    `${INDENT}她走进雨里，街灯亮着，远处传来一声汽笛。`,
    'hard-wrapped CJK lines should join without inserting a space'
);

assert.strictEqual(
    format('Hello world. This is a test\nof wrapping.'),
    `${INDENT}Hello world. This is a test of wrapping.`,
    'hard-wrapped Latin lines should join with a single space'
);

assert.strictEqual(
    format('她走进雨里。\n\n***\n\n街灯亮着。'),
    `${INDENT}她走进雨里。\n***\n${INDENT}街灯亮着。`,
    'scene breaks stay unindented and do not merge into neighboring paragraphs'
);

assert.strictEqual(
    format('# 第一章\n她走进雨里。'),
    `# 第一章\n${INDENT}她走进雨里。`,
    'markdown headings stay unindented'
);

assert.strictEqual(
    format('第12章\n她走进雨里。'),
    `第12章\n${INDENT}她走进雨里。`,
    'Chinese chapter titles stay unindented'
);

assert.strictEqual(
    format('他说：\n「今晚不要出门。」'),
    `${INDENT}他说：\n${INDENT}「今晚不要出门。」`,
    'dialogue after a colon starts a new indented paragraph'
);

assert.strictEqual(
    format('见 https://example.com/a.b 再走.\n看 3.14 与 1,000.'),
    `${INDENT}见 https://example.com/a.b 再走。\n${INDENT}看 3.14 与 1,000.`,
    'URLs and numbers keep ASCII dots and commas'
);

assert.strictEqual(
    format('她 走 进 雨 里。'),
    `${INDENT}她走进雨里。`,
    'spaces between CJK letters are removed'
);

assert.strictEqual(
    format('　　她走进雨里。\n　　街灯亮着。'),
    `${INDENT}她走进雨里。\n${INDENT}街灯亮着。`,
    'existing fullwidth indents are normalized rather than stacked'
);

assert.strictEqual(
    format('她说: "走吧!"'),
    `${INDENT}她说：“走吧！”`,
    'spaces around converted quotes and punctuation are removed'
);

assert.ok(formatManuscript(messy).changed, 'messy source should report a change');
assert.strictEqual(formatManuscript(cleaned).changed, false, 'already formatted text should report no change');

assert.strictEqual(
    format('她走进雨里。\n\n街灯亮着。', { blankLines: 1 }),
    `${INDENT}她走进雨里。\n\n${INDENT}街灯亮着。`,
    'optional blank line between paragraphs remains available'
);

assert.strictEqual(
    format('Keep commas, please.', { punctuation: true }),
    `${INDENT}Keep commas, please.`,
    'ASCII prose without CJK neighbors keeps halfwidth punctuation'
);

assert.strictEqual(
    format('她走进雨里。', { indent: false }),
    '她走进雨里。',
    'indent can be disabled'
);

console.log('Manuscript format test passed.');
