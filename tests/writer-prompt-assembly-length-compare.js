/**
 * 稿湾写作拼装 × 长度约束对照
 * 思考开、无破限。测的是「一块块写」：已有正文 + 只写本拍。
 */
const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const PromptBuilder = require('../src/core/generation/prompt-builder');
const ProviderStream = require('../src/core/generation/provider-stream');

const DATA_ROOT = path.resolve(__dirname, '..');
const STAMP = '20260813-assembly';
const OUT_DIR = path.join(DATA_ROOT, '.ai_state', `writer-assembly-length-${STAMP}`);
const DESKTOP_DIR = path.join('C:', 'Users', '10937', 'Desktop', 'test', 'DeepSeek-V4-Pro-0813复测', 'assembly-length');

const SCENE_SO_FAR = [
  '沈砚没有开灯。他站在她身后，暴雨像要把玻璃敲碎，水痕一道道从窗上淌下来，像某种黏稠的暗河。林晚从玻璃反光里看见他的轮廓，西装肩线湿成深黑，雨水顺着他额发滴进领口。她没有回头，只是把湿透的外套从肩上剥下来，扔在地上。',
  '',
  '“你叫我来，就为了在这里淋雨？”沈砚的声音很低，尾音被雷声搅散。',
  '',
  '“你也可以走。”林晚说，嗓子发紧，“没人留你。”',
  '',
  '她听见他迈了一步。回头时，他已经逼到面前。他扣住她的手腕，把她抵在落地窗上，低头吻下来。这个吻又狠又急。她的衬衫前襟被撕开，几颗扣子弹落在地毯上。他的手探进裙底，两根手指拨开湿缝，直接插了进去。林晚弓起腰，一声短促的呜咽从齿间漏出来。'
].join('\n');

const BEAT = [
  '只写这一拍：沈砚把林晚按在落地窗上从后面进入。',
  '写她看见窗外的雨和自己的倒影，高潮时咬住他的手腕。',
  '不要写地毯上的口交、不要写事后抽烟、不要写下一场。',
  '保持已有文风，第三人称林晚限知，有一两句对话。'
].join('');

const PROSE = '成人向情色小说：感官密集、动作具体、允许露骨性描写；保留角色心理与对白。只输出正文。';

const CLOSERS = {
  current: 'Continue in the same language as the beat. Write the next 2-3 paragraphs:',
  langOnly: 'Continue in the same language as the beat.',
  beatStop: [
    '接着「当前正文」往下写，语言和文风与已有正文、本拍一致。',
    '只完成本拍（BEAT TO EXPAND）里点到的事，写完即停。',
    '不要用固定段数卡死篇幅；也不要提前写下一段或事后。'
  ].join(''),
  charBand: [
    '接着「当前正文」往下写，语言和文风与已有正文、本拍一致。',
    '本拍软目标 450–800 字。覆盖本拍全部动作后，在自然段末停下。',
    '不要提前写下一段或事后。字数是软目标，不是硬截断。'
  ].join('')
};

const VARIANTS = [
  { id: 'A-current', name: '现行拼装 + 2-3 段', assembly: 'full', closer: 'current' },
  { id: 'B-lang-only', name: '现行拼装 + 只跟语言', assembly: 'full', closer: 'langOnly' },
  { id: 'C-beat-stop', name: '现行拼装 + 写完本拍即停', assembly: 'full', closer: 'beatStop' },
  { id: 'D-char-band', name: '现行拼装 + 软字数带', assembly: 'full', closer: 'charBand' },
  { id: 'E-stripped', name: '精简拼装 + 写完本拍即停', assembly: 'stripped', closer: 'beatStop' }
];

const MUST = ['玻璃', '雨', '咬', '手腕'];
const ENTER = ['进入', '顶', '插', '进去'];
const LEAK = ['口交', '吞吐', '含住', '抽烟', '烟', '被单'];

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function analyze(text) {
  const body = clean(text);
  const mustHits = MUST.filter((w) => body.includes(w));
  const enterHits = ENTER.filter((w) => body.includes(w));
  const leakHits = LEAK.filter((w) => body.includes(w));
  const refusal = /我无法|不能生成|无法提供|内容政策|作为 AI/i.test(body.slice(0, 800));
  const inBand = body.length >= 350 && body.length <= 1100;
  let score = 0;
  if (!refusal) score += 30;
  score += mustHits.length * 8;
  if (enterHits.length) score += 12;
  score -= leakHits.length * 12;
  if (inBand) score += 20;
  else if (body.length < 250) score -= 15;
  else if (body.length > 1600) score -= 10;
  if (body.length >= 400 && body.length <= 900) score += 8;
  return {
    chars: body.length,
    refusalLike: refusal,
    mustHits,
    mustScore: mustHits.length,
    enterHits,
    leakHits,
    leakScore: leakHits.length,
    inBand,
    compositeScore: score,
    head: body.slice(0, 220)
  };
}

function buildVariantPrompt(variant) {
  if (variant.assembly === 'stripped') {
    return {
      messages: [
        {
          role: 'system',
          content: '你是共同作者。从林晚第三人称限知、过去时接着已有正文写。保持文风与事实连续。只输出小说正文。'
        },
        {
          role: 'user',
          content: [
            `当前正文：\n${SCENE_SO_FAR}`,
            `本拍：\n${BEAT}`,
            CLOSERS[variant.closer]
          ].join('\n\n')
        }
      ]
    };
  }
  const prompt = PromptBuilder.buildFictionPrompt({
    beat: BEAT,
    sceneContext: SCENE_SO_FAR,
    options: {
      povCharacter: '林晚',
      pov: '第三人称限知',
      tense: 'past',
      prosePrompt: PROSE
    }
  });
  prompt.messages = prompt.messages.map((m) => ({
    ...m,
    content: String(m.content || '').replace(
      'Continue in the same language as the beat. Write the next 2-3 paragraphs:',
      CLOSERS[variant.closer]
    )
  }));
  return prompt;
}

async function streamOnce(label, prompt, config) {
  const started = Date.now();
  let content = '';
  let reasoning = '';
  let usage = null;
  let error = null;
  try {
    await ProviderStream.streamGeneration(prompt, (token, meta) => {
      if (meta && meta.type === 'usage') usage = meta.usage;
      else if (meta && meta.type === 'reasoning') reasoning += String(token || '');
      else if (meta && meta.type === 'finish') { /* ignore */ }
      else content += String(token || '');
    }, {
      ...config,
      globalPrompt: '',
      enableThinking: true,
      maxTokens: 4000,
      useProviderDefaults: false,
      includeUsage: true,
      firstResponseTimeoutMs: 300000,
      idleTimeoutMs: 300000
    });
  } catch (err) {
    error = { message: clean(err && err.message) };
  }
  return {
    label,
    durationMs: Date.now() - started,
    content,
    reasoning,
    reasoningCharacters: reasoning.length,
    error,
    usage: usage ? {
      promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0)
    } : null
  };
}

(async () => {
  await fs.mkdir(path.join(OUT_DIR, 'outputs'), { recursive: true });
  await fs.mkdir(DESKTOP_DIR, { recursive: true });

  const settings = await settingsService.readSettings(DATA_ROOT);
  const runtime = settingsService.runtimeProviderConfig(settings, {
    model: 'deepseek-v4-pro',
    enableThinking: true,
    maxTokens: 4000,
    useProviderDefaults: false
  });
  if (!runtime.apiKey) throw new Error('未找到 DeepSeek API 配置');

  console.log('=== Writer assembly / length closer compare ===');
  const results = [];
  for (let i = 0; i < VARIANTS.length; i += 1) {
    const variant = VARIANTS[i];
    const prompt = buildVariantPrompt(variant);
    console.log(`\n[${i + 1}/${VARIANTS.length}] ${variant.id} ${variant.name} ...`);
    const call = await streamOnce(variant.id, prompt, runtime);
    const analysis = analyze(call.content || '');
    const row = {
      ...variant,
      closerText: CLOSERS[variant.closer],
      userHead: clean(prompt.messages[prompt.messages.length - 1].content).slice(-220),
      durationMs: call.durationMs,
      reasoningCharacters: call.reasoningCharacters,
      reasoningHead: (call.reasoning || '').slice(0, 500),
      error: call.error,
      usage: call.usage,
      content: call.content || '',
      analysis
    };
    results.push(row);
    await fs.writeFile(
      path.join(OUT_DIR, 'outputs', `${variant.id}.md`),
      [
        `# ${variant.id} · ${variant.name}`,
        '',
        `score: ${analysis.compositeScore}`,
        `chars: ${analysis.chars}`,
        `must: ${analysis.mustHits.join('、') || '无'}`,
        `leak: ${analysis.leakHits.join('、') || '无'}`,
        `inBand: ${analysis.inBand}`,
        `think: ${call.reasoningCharacters}`,
        `durationMs: ${call.durationMs}`,
        '',
        '## closer',
        '',
        CLOSERS[variant.closer],
        '',
        '## reasoning head',
        '',
        (call.reasoning || '').slice(0, 700) || '（无）',
        '',
        '## output',
        '',
        call.content || (call.error ? `ERROR: ${call.error.message}` : ''),
        ''
      ].join('\n'),
      'utf8'
    );
    console.log(
      `  -> score=${analysis.compositeScore} chars=${analysis.chars} must=${analysis.mustScore}`
      + ` leak=${analysis.leakScore} inBand=${analysis.inBand} think=${call.reasoningCharacters} ${call.durationMs}ms`
    );
  }

  const ranking = [...results].sort((a, b) => {
    if (b.analysis.compositeScore !== a.analysis.compositeScore) {
      return b.analysis.compositeScore - a.analysis.compositeScore;
    }
    return a.analysis.leakScore - b.analysis.leakScore;
  }).map((item, index) => ({
    rank: index + 1,
    id: item.id,
    name: item.name,
    score: item.analysis.compositeScore,
    chars: item.analysis.chars,
    must: item.analysis.mustHits.join('、'),
    leak: item.analysis.leakHits.join('、') || '无',
    inBand: item.analysis.inBand,
    think: item.reasoningCharacters,
    durationMs: item.durationMs
  }));

  const report = [
    '# 稿湾写作拼装 / 长度约束对照',
    '',
    '思考开 · 无破限 · 已有正文 + 只写「窗上后入」这一拍。',
    '',
    '## 排行',
    '',
    '| 名次 | ID | 名称 | 综合 | 字数 | 必写命中 | 越界 | 字数带 | 思考字 | 耗时ms |',
    '|---:|---|---|---:|---:|---|---|---|---:|---:|',
    ...ranking.map((r) => `| ${r.rank} | ${r.id} | ${r.name} | ${r.score} | ${r.chars} | ${r.must || '无'} | ${r.leak} | ${r.inBand ? '是' : '否'} | ${r.think} | ${r.durationMs} |`),
    '',
    '## 读法',
    '',
    '- 必写：玻璃 / 雨 / 咬 / 手腕；另需有进入类动作。',
    '- 越界：口交 / 吞吐 / 含住 / 烟 / 被单（说明没停在本拍）。',
    '- 字数带：350–1100，一块块写的合理区间。',
    '',
    '## 各变体摘录',
    ''
  ];
  for (const item of results) {
    report.push(`### ${item.id} · ${item.name}`, '');
    report.push(`- 综合 **${item.analysis.compositeScore}** · ${item.analysis.chars} 字 · 越界 ${item.analysis.leakHits.join('、') || '无'} · ${item.durationMs}ms`);
    report.push('', item.analysis.head || '（空）', '', '---', '');
  }

  const payload = {
    stamp: STAMP,
    startedNote: 'thinking on, no jailbreak, single-beat continuation',
    beat: BEAT,
    ranking,
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      assembly: r.assembly,
      closer: r.closer,
      closerText: r.closerText,
      durationMs: r.durationMs,
      reasoningCharacters: r.reasoningCharacters,
      reasoningHead: r.reasoningHead,
      error: r.error,
      usage: r.usage,
      analysis: r.analysis
    }))
  };

  await fs.writeFile(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'ranking.json'), `${JSON.stringify(ranking, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'REPORT.md'), report.join('\n'), 'utf8');
  await fs.writeFile(path.join(DESKTOP_DIR, 'REPORT.md'), report.join('\n'), 'utf8');
  await fs.writeFile(path.join(DESKTOP_DIR, 'ranking.json'), `${JSON.stringify(ranking, null, 2)}\n`, 'utf8');

  console.log('\n=== Ranking ===');
  for (const r of ranking) {
    console.log(`#${r.rank} ${r.id} score=${r.score} chars=${r.chars} leak=${r.leak} inBand=${r.inBand}`);
  }
  console.log(`\nReport: ${path.join(OUT_DIR, 'REPORT.md')}`);
})().catch((error) => {
  console.error('Assembly length compare failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
