/**
 * 篇幅三档复测：3 题材 × brief/natural/expanded × 3 次
 * 思考开、无破限、走 PromptBuilder 现行拼装。
 */
const fs = require('fs/promises');
const path = require('path');

const settingsService = require('../desktop/services/settings-service');
const PromptBuilder = require('../src/core/generation/prompt-builder');
const ProviderStream = require('../src/core/generation/provider-stream');

const DATA_ROOT = path.resolve(__dirname, '..');
const MAX_TOKENS = Math.max(1, Number(process.env.DH_MAX_TOKENS) || 4000);
const REPEATS = Math.max(1, Number(process.env.DH_REPEATS) || 3);
const STAMP = process.env.DH_STAMP || `20260813-length-${MAX_TOKENS}t`;
const OUT_DIR = path.join(DATA_ROOT, '.ai_state', `writer-length-hint-repeat-${STAMP}`);
const DESKTOP_DIR = path.join('C:', 'Users', '10937', 'Desktop', 'test', 'DeepSeek-V4-Pro-0813复测', `length-repeat-${MAX_TOKENS}t`);
const HINTS = ['brief', 'natural', 'expanded'];

const CASES = [
  {
    id: 'dialogue',
    name: '对白交锋',
    scene: '茶室只开一盏壁灯。林晚把没喝完的茶放下，杯沿磕在碟上，一声轻响。沈砚坐在对面，外套搭在椅背，手指转着打火机，却一直没点。窗外巷子里有人走过，脚步声远了，两个人还是没先开口。',
    beat: '只写这一拍：林晚问沈砚当年为什么不告而别，沈砚只说「那时候你不会信」。两人都没有起身，没有碰触。写完对峙里没说破的那一层就停，不要写和解，不要写下一场出门。',
    must: ['不告而别', '不会信'],
    leak: ['吻', '出门', '牵手', '拥抱']
  },
  {
    id: 'action',
    name: '动作场面',
    scene: '货仓铁门半开。林晚贴在集装箱阴影里，听见头顶行车轨道在响。沈砚在她身侧两步外，左手按着她肩，示意别动。前方过道里手电扫过地面，光圈停了一下，又往前挪。',
    beat: '只写这一拍：手电转到他们这边时，沈砚把林晚拽进侧面货架空隙，两个人贴着铁架屏住呼吸，光从缝里扫过去。不要写成打斗，不要写他们逃出货仓，不要写被抓住。',
    must: ['货架', '手电'],
    leak: ['开枪', '逃出', '抓住', '追出仓库']
  },
  {
    id: 'emotion',
    name: '情绪内心',
    scene: '旧城巷口的雨刚密起来。林晚站在关了门的糖铺檐下，伞还斜在肩头。沈砚从巷子那头走来，没打伞，塑料袋里是几罐啤酒。他在三步外停住，叫了她的名字。',
    beat: '只写这一拍：林晚把伞递过去，沈砚没接。她想起泡桐树下那次没说完的话，最终只问「你住附近？」。不要写进门，不要写拥抱或情事，不要写十年前的完整回忆。',
    must: ['伞', '附近'],
    leak: ['进门', '拥抱', '吻', '上床']
  }
];

function clean(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function looksLikeRefusal(text) {
  return /我无法|不能生成|无法提供|内容政策|作为 AI|这类内容/i.test(clean(text).slice(0, 800));
}

function isTruncated(finishReason) {
  return finishReason === 'length';
}

function analyze(text, spec, finishReason) {
  const body = clean(text);
  const mustHits = spec.must.filter((word) => body.includes(word));
  const leakHits = spec.leak.filter((word) => body.includes(word));
  const refusal = looksLikeRefusal(body);
  const truncated = isTruncated(finishReason);
  const empty = body.length === 0;
  return {
    chars: body.length,
    refusalLike: refusal,
    mustHits,
    mustScore: mustHits.length,
    leakHits,
    leakScore: leakHits.length,
    empty,
    truncated,
    finishReason: finishReason || '',
    complete: !empty && !refusal && !truncated,
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
      prosePrompt: '只输出小说正文。保持已有文风。'
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
    reasoningHead: reasoning.slice(0, 400),
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

  const canaryPrompt = {
    messages: [
      { role: 'system', content: '连通测试，只按用户要求返回。' },
      { role: 'user', content: '只返回字符串 LENGTH_REPEAT_OK' }
    ]
  };
  const canary = await streamOnce(canaryPrompt, { ...runtime, enableThinking: false }, 256);
  if (canary.error || !String(canary.content || '').includes('LENGTH_REPEAT_OK')) {
    throw new Error(`canary failed: ${canary.error ? canary.error.message : String(canary.content || '').slice(0, 160)}`);
  }
  console.log(`=== Length hint repeat retest ===`);
  console.log(`[PASS] canary ${canary.durationMs}ms`);

  const rows = [];
  const total = CASES.length * HINTS.length * REPEATS;
  let index = 0;
  for (const spec of CASES) {
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
          reasoningHead: call.reasoningHead,
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
            `repeat: ${repeat}`,
            `chars: ${analysis.chars}`,
            `finishReason: ${call.finishReason || ''}`,
            `truncated: ${analysis.truncated}`,
            `complete: ${analysis.complete}`,
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
          + ` complete=${analysis.complete} must=${analysis.mustScore}/${spec.must.length}`
          + ` leak=${analysis.leakScore} refusal=${analysis.refusalLike}`
          + ` think=${call.reasoningCharacters} ${call.durationMs}ms`
          + (call.error ? ` ERROR=${call.error.message}` : '')
        );
      }
    }
  }

  const groups = [];
  for (const spec of CASES) {
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
        mustRate: complete.filter((row) => row.analysis.mustScore === spec.must.length).length,
        leakRate: complete.filter((row) => row.analysis.leakScore > 0).length,
        emptyRate: subset.filter((row) => row.analysis.empty).length,
        refusalRate: subset.filter((row) => row.analysis.refusalLike).length,
        truncatedRate: subset.filter((row) => row.analysis.truncated).length,
        durationMedian: median(subset.map((row) => row.durationMs)),
        thinkMedian: median(subset.map((row) => row.reasoningCharacters))
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
    '# 篇幅三档复测（3 题材 × 3 次）',
    '',
    `模型：\`deepseek-v4-pro\` · thinking=on · 无破限 · 现行 PromptBuilder 拼装 · maxTokens=${MAX_TOKENS}`,
    `共 ${rows.length} 次。字数/必写/越界只统计有效完成（非空、非拒、非 token 截断）。`,
    '',
    '## 三档总览',
    '',
    '| 篇幅 | n | 有效完成 | 截断 | 字数中位 | 字数均值 | 必写全中 | 越界 | 空/拒 | 墙钟中位ms | 思考字中位 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...hintSummary.map((item) => `| ${item.hint} | ${item.n} | ${item.completeN} | ${item.truncatedRate} | ${item.charsMedian} | ${item.charsMean} | ${item.mustAll}/${item.completeN} | ${item.leakRate} | ${item.emptyRate + item.refusalRate} | ${item.durationMedian} | ${item.thinkMedian} |`),
    '',
    '## 分题材',
    '',
    '| 题材 | 篇幅 | 有效 | 截断 | 字数中位 | 最小-最大 | 必写全中 | 越界 | 墙钟中位ms |',
    '|---|---|---:|---:|---:|---|---:|---:|---:|',
    ...groups.map((item) => `| ${item.genreName} | ${item.hint} | ${item.completeN}/${item.n} | ${item.truncatedRate} | ${item.charsMedian} | ${item.charsMin}-${item.charsMax} | ${item.mustRate}/${item.completeN} | ${item.leakRate} | ${item.durationMedian} |`),
    '',
    '## 读法',
    '',
    '- `finishReason=length` 记为截断，不算有效完成，也不进字数中位。',
    '- 期望：brief 中位数 < natural < expanded，且越界不要随 expanded 明显变多。',
    '- 必写是本拍关键词；越界是下一拍情节。',
    '- 单次墙钟不作「思考税」结论。',
    ''
  ];

  const metrics = {
    stamp: STAMP,
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

  console.log('\n=== Hint summary ===');
  for (const item of hintSummary) {
    console.log(`${item.hint} complete=${item.completeN}/${item.n} truncated=${item.truncatedRate} median=${item.charsMedian} mean=${item.charsMean} leak=${item.leakRate} must=${item.mustAll}/${item.completeN}`);
  }
  console.log(`\nReport: ${path.join(OUT_DIR, 'REPORT.md')}`);
})().catch((error) => {
  console.error('Length hint repeat retest failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
