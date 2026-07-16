function realisticReaderMarkdown() {
  const dialogue = Array.from({ length: 18 }, (_, index) => [
    `“潮位比昨天高了七码。”林舟把铜尺按在码头边缘，第 ${index + 1} 次确认刻度。`,
    `Mara answered in English, “The light is moving, but the tower is not.” 海风把最后一个音节吹散。`
  ]).flat();
  const longChapter = Array.from({ length: 96 }, (_, index) =>
    `长章记录 ${index + 1}：${'雾从防波堤外缓慢推来，灯塔的绿光在水面留下断续的刻度。'.repeat(4)}`
  );
  return [
    '# 第一章 雾港来信',
    '',
    '凌晨四点，港务钟只响了一次。林舟拆开那封没有寄件人的信，纸上残留着盐和烧焦的薰衣草气味。',
    '',
    ...dialogue,
    '',
    '# 第二章 漫长潮汐',
    '',
    ...longChapter.flatMap((paragraph) => [paragraph, '']),
    '# 第三章 Signal Room',
    '',
    'The brass mechanism had no gears, yet every needle pointed toward the drowned quarter of the city.',
    '',
    '中英混排用于验证 fallback font、letter spacing 与 justified text 在同一段落中的稳定性。',
    '',
    '```text',
    'BEACON 03 / TIDE 17.4 / STATUS UNKNOWN',
    'NEXT WINDOW: 04:20',
    '```',
    '',
    '# 尾声',
    '',
    '天亮时，雾没有散。码头尽头多出了一艘没有名字的船。'
  ].join('\n');
}

module.exports = { realisticReaderMarkdown };
