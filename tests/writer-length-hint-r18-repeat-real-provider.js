/**
 * R18 篇幅三档复测：3 个成人向单拍 × brief/natural/expanded × 3 次
 * 思考开、无破限、走 PromptBuilder 现行拼装。角色均为 18+ 虚构成人。
 */
const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const PromptBuilder = require('../src/core/generation/prompt-builder');
const ProviderStream = require('../src/core/generation/provider-stream');

const DATA_ROOT = path.resolve(__dirname, '..');
const MAX_TOKENS = Math.max(1, Number(process.env.DH_MAX_TOKENS) || 4000);
const REPEATS = Math.max(1, Number(process.env.DH_REPEATS) || 3);
const STAMP = process.env.DH_STAMP || `20260813-r18-${MAX_TOKENS}t`;
const OUT_DIR = path.join(DATA_ROOT, '.ai_state', `writer-length-hint-r18-${STAMP}`);
const DESKTOP_DIR = path.join('C:', 'Users', '10937', 'Desktop', 'test', 'DeepSeek-V4-Pro-0813复测', `length-r18-${MAX_TOKENS}t`);
const HINTS = String(process.env.DH_HINTS || 'brief,natural,expanded')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item === 'brief' || item === 'natural' || item === 'expanded');
const CASE_IDS = String(process.env.DH_CASE_IDS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const EXPLICIT = ['插入', '阴茎', '阴道', '勃起', '抽送', '高潮', '乳头', '口交', '吞吐', '阴蒂', '精液'];

const CASES = [
  {
    id: 'window',
    name: '窗上进入',
    scene: '暴雨砸在落地窗上。套房只开了床头灯。林晚（28 岁）的衬衫已经被撕开，沈砚（30 岁）的手指刚从她身体里抽出来。她的背还抵着冰凉的玻璃。',
    beat: '只写这一拍：沈砚把林晚翻过去按在落地窗上从后面进入，她看见窗外的雨和自己的倒影，高潮时咬住他的手腕。不要写地毯上的口交，不要写事后抽烟，不要写下一场。角色均为自愿成年。',
    must: ['玻璃', '咬'],
    leak: ['口交', '抽烟', '被单', '明天']
  },
  {
    id: 'oral',
    name: '地毯口交',
    scene: '林晚顺着玻璃滑坐到地毯上。沈砚还站着，皮带解开，呼吸发沉。落地窗上全是她刚才呵出的雾。两个人都还没说话。',
    beat: '只写这一拍：林晚跪在地毯上含住他，写她的动作和他按在她头发里的手。写到他低喘、把她拉起来为止。不要写再次插入，不要写射在体内，不要写事后对话。角色均为自愿成年。',
    must: ['含', '地毯'],
    leak: ['再次进入', '射在', '抽烟', '睡觉']
  },
  {
    id: 'ride',
    name: '窗边骑乘',
    scene: '事后两人赤身裹着被单坐在窗边。烟灰缸里有一截还没灭的烟。沈砚问她明天会不会再消失。林晚把烟灰弹进去，没马上回答。',
    beat: '只写这一拍：林晚跨坐到他身上说「再做一次再回答」，主动骑乘到第二次高潮。不要写她回答明天去哪，不要写第三轮，不要写下楼离开。角色均为自愿成年。',
    must: ['跨坐', '高潮'],
    leak: ['离开', '下楼', '第三', '明天就走']
  }
];

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function looksLikeRefusal(text) {
  return /我无法|不能生成|无法提供|内容政策|作为 AI|这类内容|不适合/i.test(clean(text).slice(0, 800));
}

function isTruncated(finishReason) {
  return finishReason === 'length';
}

function analyze(text, spec, finishReason) {
  const body = clean(text);
  const mustHits = spec.must.filter((word) => body.includes(word));
  const leakHits = spec.leak.filter((word) => body.includes(word));
  const explicitHits = EXPLICIT.filter((word) => body.includes(word));
  const truncated = isTruncated(finishReason);
  const empty = body.length === 0;
  const refusalLike = looksLikeRefusal(body);
  return {
    chars: body.length,
    refusalLike,
    mustHits,
    mustScore: mustHits.length,
    leakHits,
    leakScore: leakHits.length,
    explicitScore: explicitHits.length,
    empty,
    truncated,
    finishReason: finishReason || '',
    complete: !empty && !refusalLike && !truncated,
    head: body.slice(0, 180)
  };
}

function buildPrompt(spec, hint) {
  return PromptBuilder.buildFictionPrompt({
    beat: spec.beat,
    sceneContext: spec.scene,
    options: {
      povCharacter: '林晚',
      pov: '第三人称限知',
      tense: 'past',
      lengthHint: hint,
      prosePrompt: '成人向情色小说：动作具体，允许露骨性描写，保留对话与心理。只输出正文。角色均为同意的成年虚构人物。'
    }
  });
}

async function streamOnce(prompt, runtime, maxTokens) {
  const started = Date.now();
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = '';
  let error = null;
  const tokenBudget = Number(maxTokens) || MAX_TOKENS;
  try {
    await ProviderStream.streamGeneration(prompt, (token, meta) => {
      if (meta && meta.type === 'usage') usage = meta.usage;
      else if (meta && meta.type === 'reasoning') reasoning += String(token || '');
      else if (meta && meta.type === 'finish') finishReason = meta.finishReason || '';
      else if (!meta || meta.type === 'content') content += String(token || '');
    }, {
      ...runtime,
      globalPrompt: '',
      enableThinking: true,
      maxTokens: tokenBudget,
      useProviderDefaults: false,
      includeUsage: true,
      firstResponseTimeoutMs: 300000,
      idleTimeoutMs: 300000
    });
  } catch (err) {
    error = { message: clean(err && err.message) };
  }
  return {
    durationMs: Date.now() - started,
    content,
    reasoningCharacters: reasoning.length,
    finishReason,
    truncated: isTruncated(finishReason),
    error,
    usage: usage ? {
      promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0)
    } : null
  };
}

function median(values) {
  const list = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
}

function mean(values) {
  const list = values.filter((n) => Number.isFinite(n));
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, n) => sum + n, 0) / list.length);
}

(async () => {
  await fs.mkdir(path.join(OUT_DIR, 'outputs'), { recursive: true });
  await fs.mkdir(DESKTOP_DIR, { recursive: true });

  const settings = await settingsService.readSettings(DATA_ROOT);
  const runtime = settingsService.runtimeProviderConfig(settings, {
    model: 'deepseek-v4-pro',
    enableThinking: true,
    maxTokens: MAX_TOKENS,
    useProviderDefaults: false
  });
  if (!runtime.apiKey) throw new Error('未找到 DeepSeek API 配置');

  const canary = await streamOnce({
    messages: [
      { role: 'system', content: '连通测试，只按用户要求返回。' },
      { role: 'user', content: '只返回字符串 LENGTH_R18_OK' }
    ]
  }, { ...runtime, enableThinking: false }, 256);
  if (canary.error || !String(canary.content || '').includes('LENGTH_R18_OK')) {
    throw new Error(`canary failed: ${canary.error ? canary.error.message : String(canary.content || '').slice(0, 160)}`);
  }
  const activeCases = CASE_IDS.length
    ? CASES.filter((spec) => CASE_IDS.includes(spec.id))
    : CASES;
  if (!activeCases.length) throw new Error(`没有匹配的题材：${CASE_IDS.join(',')}`);
  if (!HINTS.length) throw new Error('没有有效的篇幅档');

  console.log('=== R18 length hint repeat ===');
  console.log(`[PASS] canary ${canary.durationMs}ms maxTokens=${MAX_TOKENS} repeats=${REPEATS} cases=${activeCases.map((item) => item.id).join(',')}`);

  const rows = [];
  const total = activeCases.length * HINTS.length * REPEATS;
  let index = 0;
  for (const spec of activeCases) {
    for (const hint of HINTS) {
      for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
        index += 1;
        const label = `${spec.id}-${hint}-${repeat}`;
        console.log(`\n[${index}/${total}] ${label} ...`);
        let call = await streamOnce(buildPrompt(spec, hint), runtime, MAX_TOKENS);
        if ((call.error || !clean(call.content)) && !call.truncated) {
          console.log('  retry after empty/error');
          call = await streamOnce(buildPrompt(spec, hint), runtime, MAX_TOKENS);
        }
        const analysis = analyze(call.content || '', spec, call.finishReason);
        const row = {
          id: label,
          genre: spec.id,
          genreName: spec.name,
          hint,
          repeat,
          durationMs: call.durationMs,
          reasoningCharacters: call.reasoningCharacters,
          finishReason: call.finishReason || '',
          truncated: !!call.truncated,
          error: call.error,
          usage: call.usage,
          content: call.content || '',
          analysis
        };
        rows.push(row);
        await fs.writeFile(
          path.join(OUT_DIR, 'outputs', `${label}.md`),
          [
            `# ${label}`,
            '',
            `genre: ${spec.name}`,
            `hint: ${hint}`,
            `chars: ${analysis.chars}`,
            `finishReason: ${call.finishReason || ''}`,
            `truncated: ${analysis.truncated}`,
            `complete: ${analysis.complete}`,
            `explicit: ${analysis.explicitScore}`,
            `must: ${analysis.mustHits.join('、') || '无'}`,
            `leak: ${analysis.leakHits.join('、') || '无'}`,
            `refusal: ${analysis.refusalLike}`,
            `think: ${call.reasoningCharacters}`,
            `durationMs: ${call.durationMs}`,
            '',
            '## output',
            '',
            call.content || (call.error ? `ERROR: ${call.error.message}` : ''),
            ''
          ].join('\n'),
          'utf8'
        );
        console.log(
          `  -> chars=${analysis.chars} finish=${call.finishReason || 'n/a'} truncated=${analysis.truncated}`
          + ` complete=${analysis.complete} explicit=${analysis.explicitScore} must=${analysis.mustScore}/${spec.must.length}`
          + ` leak=${analysis.leakScore} refusal=${analysis.refusalLike} think=${call.reasoningCharacters} ${call.durationMs}ms`
          + (call.error ? ` ERROR=${call.error.message}` : '')
        );
      }
    }
  }

  const groups = [];
  for (const spec of activeCases) {
    for (const hint of HINTS) {
      const subset = rows.filter((row) => row.genre === spec.id && row.hint === hint);
      const complete = subset.filter((row) => row.analysis.complete);
      const chars = complete.map((row) => row.analysis.chars);
      groups.push({
        genre: spec.id,
        genreName: spec.name,
        hint,
        n: subset.length,
        completeN: complete.length,
        charsMedian: median(chars),
        charsMean: mean(chars),
        charsMin: chars.length ? Math.min(...chars) : 0,
        charsMax: chars.length ? Math.max(...chars) : 0,
        explicitMedian: median(complete.map((row) => row.analysis.explicitScore)),
        mustRate: complete.filter((row) => row.analysis.mustScore === spec.must.length).length,
        leakRate: complete.filter((row) => row.analysis.leakScore > 0).length,
        emptyRate: subset.filter((row) => row.analysis.empty).length,
        refusalRate: subset.filter((row) => row.analysis.refusalLike).length,
        truncatedRate: subset.filter((row) => row.analysis.truncated).length,
        durationMedian: median(subset.map((row) => row.durationMs))
      });
    }
  }

  const hintSummary = HINTS.map((hint) => {
    const subset = rows.filter((row) => row.hint === hint);
    const complete = subset.filter((row) => row.analysis.complete);
    const chars = complete.map((row) => row.analysis.chars);
    return {
      hint,
      n: subset.length,
      completeN: complete.length,
      charsMedian: median(chars),
      charsMean: mean(chars),
      explicitMedian: median(complete.map((row) => row.analysis.explicitScore)),
      leakRate: complete.filter((row) => row.analysis.leakScore > 0).length,
      mustAll: complete.filter((row) => {
        const spec = CASES.find((item) => item.id === row.genre);
        return row.analysis.mustScore === spec.must.length;
      }).length,
      emptyRate: subset.filter((row) => row.analysis.empty).length,
      refusalRate: subset.filter((row) => row.analysis.refusalLike).length,
      truncatedRate: subset.filter((row) => row.analysis.truncated).length,
      durationMedian: median(subset.map((row) => row.durationMs)),
      thinkMedian: median(subset.map((row) => row.reasoningCharacters))
    };
  });

  const report = [
    '# R18 篇幅三档复测（3 单拍 × 3 档）',
    '',
    `模型：\`deepseek-v4-pro\` · thinking=on · 无破限 · 现行 PromptBuilder · maxTokens=${MAX_TOKENS}`,
    '三拍：窗上进入 / 地毯口交 / 窗边骑乘。角色 18+ 虚构成人。',
    `共 ${rows.length} 次。字数/必写/越界只统计有效完成（非空、非拒、非 token 截断）。`,
    '',
    '## 三档总览',
    '',
    '| 篇幅 | n | 有效完成 | 截断 | 字数中位 | 字数均值 | 露骨中位 | 必写全中 | 越界 | 空/拒 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...hintSummary.map((item) => `| ${item.hint} | ${item.n} | ${item.completeN} | ${item.truncatedRate} | ${item.charsMedian} | ${item.charsMean} | ${item.explicitMedian} | ${item.mustAll}/${item.completeN} | ${item.leakRate} | ${item.emptyRate + item.refusalRate} |`),
    '',
    '## 分题材',
    '',
    '| 题材 | 篇幅 | 有效 | 截断 | 字数中位 | 最小-最大 | 露骨中位 | 必写全中 | 越界 |',
    '|---|---|---:|---:|---:|---|---:|---:|---:|',
    ...groups.map((item) => `| ${item.genreName} | ${item.hint} | ${item.completeN}/${item.n} | ${item.truncatedRate} | ${item.charsMedian} | ${item.charsMin}-${item.charsMax} | ${item.explicitMedian} | ${item.mustRate}/${item.completeN} | ${item.leakRate} |`),
    '',
    '## 读法',
    '',
    '- `finishReason=length` 记为截断，不算有效完成，也不进字数中位。',
    '- 越界=滑到口交后的插入、射在体内、离开、第三轮等下一拍。',
    '- 露骨词是词表命中，近义改写会漏计。',
    ''
  ];

  const metrics = {
    stamp: STAMP,
    rating: 'r18',
    model: 'deepseek-v4-pro',
    enableThinking: true,
    maxTokens: MAX_TOKENS,
    repeats: REPEATS,
    hintSummary,
    groups,
    rows: rows.map((row) => ({
      id: row.id,
      genre: row.genre,
      hint: row.hint,
      repeat: row.repeat,
      durationMs: row.durationMs,
      reasoningCharacters: row.reasoningCharacters,
      finishReason: row.finishReason,
      truncated: row.truncated,
      error: row.error,
      usage: row.usage,
      analysis: row.analysis
    }))
  };

  await fs.writeFile(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'REPORT.md'), report.join('\n'), 'utf8');
  await fs.writeFile(path.join(DESKTOP_DIR, 'REPORT.md'), report.join('\n'), 'utf8');
  await fs.writeFile(path.join(DESKTOP_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  console.log('\n=== R18 hint summary ===');
  for (const item of hintSummary) {
    console.log(`${item.hint} complete=${item.completeN}/${item.n} truncated=${item.truncatedRate} median=${item.charsMedian} explicit=${item.explicitMedian} leak=${item.leakRate} must=${item.mustAll}/${item.completeN} refuse=${item.refusalRate}`);
  }
  console.log(`\nReport: ${path.join(OUT_DIR, 'REPORT.md')}`);
})().catch((error) => {
  console.error('R18 length hint retest failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
