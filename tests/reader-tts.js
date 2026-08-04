const assert = require('assert');
const Tts = require('../src/core/document/reader-tts');

assert.deepStrictEqual(Tts.normalizeReaderTtsSettings({ rate: 3, volume: -1, paragraphPauseMs: 5000, timerMinutes: 17 }), {
  schemaVersion: 1, voiceName: '', rate: 2, volume: 0, paragraphPauseMs: 3000,
  autoAdvance: true, timerMinutes: 0, maxChunkChars: 240
});

const sample = '第一句。第二句！这是一个较长的段落，用于验证朗读队列会在安全边界拆分文本，并且不会拆开中文或 emoji。🙂'.repeat(3);
const chunks = Tts.splitReaderTtsText(sample, 80);
assert.ok(chunks.length >= 3);
assert.strictEqual(chunks.map((chunk) => chunk.text).join(''), sample);
chunks.forEach((chunk) => assert.ok(chunk.endOffset > chunk.startOffset));

const queue = Tts.createReaderTtsQueue({ chapterId: 'chapter-1', blocks: [
  { blockId: 'block-1', type: 'paragraph', text: '已经读过。接着读这里。' },
  { blockId: 'block-2', type: 'paragraph', text: '下一段。' }
] }, { blockId: 'block-1', offset: 5 }, { maxChunkChars: 80 });
assert.deepStrictEqual(queue.map((item) => item.text), ['接着读这里。', '下一段。']);
assert.strictEqual(queue[0].startOffset, 5);

const paused = Tts.transitionReaderTts({ status: 'speaking', settings: { rate: 1.2 } }, 'pause');
assert.strictEqual(paused.status, 'paused');
assert.strictEqual(paused.settings.rate, 1.2);
assert.strictEqual(Tts.transitionReaderTts(paused, 'resume').status, 'speaking');
assert.strictEqual(Tts.transitionReaderTts(paused, 'stop').status, 'stopped');

console.log('Reader TTS tests passed.');
