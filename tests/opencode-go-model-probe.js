/**
 * One-shot live probe: can missing Go models speak Chat Completions?
 * Not part of npm test. Never prints the API key.
 */
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startDesktopServers } = require('../desktop/local-server');
const settingsService = require('../desktop/services/settings-service');

async function readLocalGoKey() {
  const fromEnv = String(process.env.OPENCODE_API_KEY || process.env.OPENCODE_GO_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const settings = await settingsService.readSettings(path.resolve(__dirname, '..'));
  const profiles = Array.isArray(settings.providerProfiles) ? settings.providerProfiles : [];
  const goProfile = profiles.find((item) => item && item.provider === 'opencode-go' && item.apiKey);
  const fallback = settings.providerSettings && settings.providerSettings.provider === 'opencode-go'
    ? settings.providerSettings.apiKey : '';
  return String((goProfile && goProfile.apiKey) || fallback || '').trim();
}

async function readSse(response) {
  const text = await response.text();
  return text.split(/\n/).map((line) => line.trim()).filter((line) => line.startsWith('data:')).map((line) => {
    try { return JSON.parse(line.slice(5).trim()); } catch (error) { return null; }
  }).filter(Boolean);
}

(async () => {
  const key = await readLocalGoKey();
  if (!key) {
    console.error('No OpenCode Go API key.');
    process.exit(2);
  }
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-go-probe-'));
  await settingsService.writeSettings(dataRoot, {
    providerSettings: { mode: 'api', provider: 'opencode-go', apiKey: key, model: 'glm-5.2' },
    modelCatalogPreferences: { hidePrivacyRiskModels: false }
  });
  const servers = await startDesktopServers({
    appRoot: path.resolve(__dirname, '..'),
    dataRoot,
    revealPath: async () => ''
  });
  const models = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['longcat-2.0', 'ox-alpha-free', 'mimo-v2.5', 'qwen3.6-plus', 'hy3'];
  try {
    for (const model of models) {
      const started = Date.now();
      const response = await fetch(`${servers.appUrl}/api/generation/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          enableThinking: false,
          includeUsage: true,
          maxTokens: 400,
          temperature: 0.1,
          confirmPrivacyRisk: true,
          firstResponseTimeoutMs: 60000,
          prompt: { messages: [{ role: 'user', content: 'Reply with exactly 7 and nothing else.' }] }
        })
      });
      const events = await readSse(response);
      const error = events.find((event) => event && event.type === 'error');
      const content = events.filter((event) => event && event.type === 'content').map((event) => event.token || '').join('');
      const reasoning = events.filter((event) => event && event.type === 'reasoning').map((event) => event.token || '').join('');
      const err = error && error.error
        ? String(error.error.message || error.error.code || JSON.stringify(error.error)).replace(/\s+/g, ' ').trim().slice(0, 220)
        : '';
      const types = events.map((event) => event && event.type).filter(Boolean).slice(0, 12).join(',');
      console.log(`${model} http=${response.status} ok=${response.ok && !error && content.trim().length > 0} reason=${reasoning.length} content=${content.length} ms=${Date.now() - started} types=${types || '-'} err=${err || '-'} preview=${content.replace(/\s+/g, ' ').trim().slice(0, 40)}`);
    }
  } finally {
    if (servers && typeof servers.close === 'function') servers.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
