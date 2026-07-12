const fsp = require('fs/promises');
const path = require('path');

const REPO_OWNER = 'liumoumou0101';
const REPO_NAME = 'DraftHarbor';
const BRANCH = 'main';

function createUpdateController({ runCommand, requestJson, downloadFile, writeJsonAtomic, pathExists, jsonResponse, corsHeaders }) {
  function runGit(rootDir, args) {
    return runCommand('git', args, { cwd: rootDir, timeout: 10000 })
      .then(({ stdout }) => stdout.trim())
      .catch(() => '');
  }

  async function getLocalVersion(rootDir) {
    const [commit, commitDate, branch, upstream, status] = await Promise.all([
      runGit(rootDir, ['rev-parse', 'HEAD']),
      runGit(rootDir, ['show', '-s', '--format=%cI', 'HEAD']),
      runGit(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(rootDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      runGit(rootDir, ['status', '--porcelain'])
    ]);
    return { commit: commit || null, commitDate: commitDate || null, branch: branch || null, upstream: upstream || null, dirty: Boolean(status) };
  }

  async function getUpdateDownloadUrl() {
    const releasesUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    try {
      const data = await requestJson(releasesUrl);
      const zipAsset = (data.assets || []).find((asset) => String(asset.name || '').endsWith('.zip'));
      if (zipAsset && zipAsset.browser_download_url) return { url: zipAsset.browser_download_url, source: 'release' };
      if (data.zipball_url) return { url: data.zipball_url, source: 'release' };
    } catch {
      // Fall through to the branch archive when GitHub is unreachable.
    }
    return { url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip`, source: 'archive' };
  }

  async function downloadUpdate(dataRoot) {
    const updateDir = path.join(dataRoot, '.update');
    const latestZip = path.join(updateDir, 'latest.zip');
    const readyJson = path.join(updateDir, 'ready.json');
    await fsp.mkdir(updateDir, { recursive: true });
    const { url, source } = await getUpdateDownloadUrl();
    const downloaded = await downloadFile(url, latestZip, { 'User-Agent': 'DraftHarbor-Updater/1.0' });
    const stats = await fsp.stat(latestZip);
    if (stats.size < 1000) throw new Error('Download failed: File too small or empty');
    await writeJsonAtomic(readyJson, { downloaded_at: String(stats.mtimeMs), source, url, size: downloaded });
    return 'Downloaded. Restart to apply.';
  }

  async function clearUpdate(dataRoot) {
    const updateDir = path.join(dataRoot, '.update');
    await fsp.rm(path.join(updateDir, 'ready.json'), { force: true });
    await fsp.rm(path.join(updateDir, 'latest.zip'), { force: true });
    await fsp.rm(path.join(updateDir, 'extract'), { recursive: true, force: true });
  }

  async function handleUpdaterApi(request, response, appRoot, dataRoot, parsedUrl) {
    if (request.method === 'OPTIONS') { response.writeHead(200, corsHeaders()); response.end(); return; }
    if (request.method === 'GET' && parsedUrl.pathname === '/version') { jsonResponse(response, 200, await getLocalVersion(appRoot), true); return; }
    if (request.method === 'GET' && parsedUrl.pathname === '/health') { jsonResponse(response, 200, { ok: true, service: 'draftharbor-desktop-updater' }, true); return; }
    if (request.method === 'GET' && parsedUrl.pathname === '/update/status') {
      const ready = await pathExists(path.join(dataRoot, '.update', 'ready.json')) && await pathExists(path.join(dataRoot, '.update', 'latest.zip'));
      jsonResponse(response, 200, { ready }, true); return;
    }
    if (request.method === 'POST' && parsedUrl.pathname === '/update/download') {
      try { jsonResponse(response, 200, { ok: true, message: await downloadUpdate(dataRoot) }, true); }
      catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }, true); }
      return;
    }
    if (request.method === 'POST' && parsedUrl.pathname === '/update/clear') {
      try { await clearUpdate(dataRoot); jsonResponse(response, 200, { ok: true, message: 'Update files cleared' }, true); }
      catch (error) { jsonResponse(response, 500, { ok: false, error: error.message }, true); }
      return;
    }
    jsonResponse(response, 404, { error: 'Not found' }, true);
  }

  return { handleUpdaterApi, getLocalVersion };
}

module.exports = { createUpdateController };
