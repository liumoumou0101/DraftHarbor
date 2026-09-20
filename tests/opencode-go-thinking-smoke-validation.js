const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');

// Importing the verifier must never read credentials or contact a provider.
const script = path.join(__dirname, 'opencode-go-thinking-smoke.js');
const imported = spawnSync(process.execPath, ['-e', `
  require(${JSON.stringify(path.join(__dirname, '../desktop/services/settings-service'))}).readSettings = async () => process.exit(77);
  global.fetch = async () => process.exit(78);
  require(${JSON.stringify(script)});
`], {
  encoding: 'utf8',
  env: { ...process.env, OPENCODE_API_KEY: '', OPENCODE_GO_API_KEY: '' }
});
assert.strictEqual(imported.status, 0, 'loading smoke validation must not read keys or start live calls');

const { evaluateGeneration, assertSmokeCalls, redact } = require('./opencode-go-thinking-smoke');
const content = { type: 'content', token: '323' };
const finish = { type: 'finish', meta: { finishReason: 'stop' } };
const done = { type: 'done' };
const success = [content, finish, done];
for (const reason of ['stop', 'end_turn', 'stop_sequence']) {
  assert.strictEqual(evaluateGeneration({ ok: true, status: 200 }, [content, { type: 'finish', meta: { finishReason: reason } }, done]).ok, true);
}

const failures = [
  ['HTTP failure', { ok: false, status: 429 }, success],
  ['provider error', { ok: true, status: 200 }, [...success, { type: 'error', error: { message: 'unavailable' } }]],
  ['reasoning only', { ok: true, status: 200 }, [{ type: 'reasoning', token: 'working' }, finish, done]],
  ['whitespace only', { ok: true, status: 200 }, [{ type: 'content', token: ' \n ' }, finish, done]],
  ['truncated', { ok: true, status: 200 }, [content, { type: 'finish', meta: { finishReason: 'length' } }, done]],
  ['filtered', { ok: true, status: 200 }, [content, { type: 'finish', meta: { finishReason: 'content_filter' } }, done]],
  ['missing finish', { ok: true, status: 200 }, [content, done]],
  ['missing done', { ok: true, status: 200 }, [content, finish]],
  ['earlier failed finish', { ok: true, status: 200 }, [content, { type: 'finish', meta: { finishReason: 'length' } }, finish, done]]
];
for (const [label, response, events] of failures) {
  const result = evaluateGeneration(response, events);
  assert.strictEqual(result.ok, false, label);
  assert.throws(() => assertSmokeCalls([{ label, ...result }]), undefined, `${label} must fail the acceptance run`);
}
assert.throws(() => assertSmokeCalls([]), /No smoke calls/);
assert.doesNotThrow(() => assertSmokeCalls([{ label: 'valid', ...evaluateGeneration({ ok: true, status: 200 }, success) }]));
assert.strictEqual(redact('test-key test-key', 'test-key'), '[redacted] [redacted]');

const offline = spawnSync(process.execPath, ['-e', `
  require(${JSON.stringify(path.join(__dirname, '../desktop/services/settings-service'))}).readSettings = async () => process.exit(77);
  global.fetch = async () => process.exit(78);
  process.argv = [process.execPath, ${JSON.stringify(script)}];
  require('module')._load(${JSON.stringify(script)}, null, true);
`], { encoding: 'utf8', env: { ...process.env, OPENCODE_API_KEY: '', OPENCODE_GO_API_KEY: '' } });
assert.strictEqual(offline.status, 0);
assert.match(offline.stdout, /--live/);
assert.doesNotMatch(offline.stdout, /smoke passed/);

async function runMockedLive(eventsForModel) {
  const output = [];
  const reports = [];
  let closed = false;
  const fixtureKey = 'fixture-key-not-real';
  const module = { exports: {} };
  const localRequire = createRequire(script);
  const sandboxRequire = (id) => {
    if (id === 'fs/promises') return {
      mkdtemp: async () => path.join(require('os').tmpdir(), 'draftharbor-go-think-mock'),
      mkdir: async () => {},
      writeFile: async (_, data) => reports.push(data)
    };
    if (id === '../desktop/local-server') return { startDesktopServers: async () => ({ appUrl: 'http://mock.local', close: async () => { closed = true; } }) };
    if (id === '../desktop/services/settings-service') return { writeSettings: async () => {} };
    return localRequire(id);
  };
  sandboxRequire.main = module;
  const processStub = { env: { OPENCODE_GO_API_KEY: fixtureKey }, argv: ['node', script, '--live'], exitCode: 0 };
  const sandbox = {
    module, require: sandboxRequire, __dirname, process: processStub,
    console: { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) },
    fetch: async (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'minimax-m3' }] }));
      assert.strictEqual(url, 'http://mock.local/api/generation/stream');
      const body = JSON.parse(init.body);
      const events = eventsForModel(body, fixtureKey);
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }
  };
  await vm.runInNewContext(fs.readFileSync(script, 'utf8'), sandbox, { filename: script });
  assert.ok(closed, 'the local server must close even on validation failure');
  assert.ok(!output.join('\n').includes(fixtureKey), 'console output must redact the key');
  assert.ok(!reports.join('\n').includes(fixtureKey), 'report output must redact the key');
  return { code: processStub.exitCode, output: output.join('\n') };
}

(async () => {
  for (const [label, events] of [
    ['all provider calls fail', (_, key) => [{ type: 'error', error: { message: `unavailable ${key} ${key}` } }]],
    ['all calls only reason', () => [{ type: 'reasoning', token: 'thinking' }, finish, done]],
    ['all calls truncate', () => [content, { type: 'finish', meta: { finishReason: 'length' } }, done]],
    ['all calls disconnect', () => [content, finish]]
  ]) {
    const result = await runMockedLive(events);
    assert.strictEqual(result.code, 1, label);
    assert.doesNotMatch(result.output, /smoke passed/, label);
  }
  const valid = await runMockedLive((body) => [
    ...(body.model === 'kimi-k2.7-code' ? [{ type: 'reasoning', token: 'thinking' }] : []),
    ...success
  ]);
  assert.strictEqual(valid.code, 0);
  assert.match(valid.output, /smoke passed/);
  console.log('OpenCode Go smoke validation tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
