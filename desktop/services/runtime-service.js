const { execFile } = require('child_process');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const LLAMA_RELEASE_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';


function runtimePlatform() {
  const platformMap = {
    darwin: 'macos',
    win32: 'windows'
  };
  const archMap = {
    x64: 'x64',
    arm64: 'arm64'
  };
  return {
    platformId: platformMap[process.platform] || process.platform,
    arch: archMap[process.arch] || process.arch
  };
}

function llamaServerFilename() {
  return runtimePlatform().platformId === 'windows' ? 'llama-server.exe' : 'llama-server';
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findGgufModels(rootDir) {
  const modelsDir = path.join(rootDir, 'models');
  try {
    const entries = await fsp.readdir(modelsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function llamaInstallChoices(platformId, arch) {
  if (!['windows', 'linux', 'macos'].includes(platformId) || !['x64', 'arm64'].includes(arch)) {
    return [];
  }

  const choices = [
    { id: 'cpu', label: 'CPU', description: 'Runs on the CPU. Slowest, but works on most systems.' }
  ];

  if (platformId === 'windows' && arch === 'x64') {
    choices.push({
      id: 'cuda',
      label: 'NVIDIA GPU (CUDA)',
      description: 'Use this if you have an NVIDIA GPU with CUDA drivers installed.'
    });
  }

  return choices;
}

async function runtimeInfo(dataRoot) {
  const { platformId, arch } = runtimePlatform();
  const ggufModels = await findGgufModels(dataRoot);
  const llamaPath = path.join(dataRoot, 'llama', llamaServerFilename());
  const hasLlamaServer = await pathExists(llamaPath);
  const installChoices = llamaInstallChoices(platformId, arch);

  return {
    ok: true,
    platform: platformId,
    arch,
    hasGGUFModels: ggufModels.length > 0,
    ggufModels,
    hasLlamaServer,
    llamaServerPath: path.relative(dataRoot, llamaPath).replace(/\\/g, '/'),
    localAIAvailable: hasLlamaServer && ggufModels.length > 0,
    llamaSetupRecommended: ggufModels.length > 0 && !hasLlamaServer && installChoices.length > 0,
    llamaInstallChoices: installChoices
  };
}

function requestJson(url) {
  return downloadBuffer(url, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DraftHarbor/1.0'
  }).then((buffer) => JSON.parse(buffer.toString('utf8')));
}

function downloadBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers }, (response) => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadBuffer(nextUrl, headers).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(120000, () => {
      request.destroy(new Error('Download timed out'));
    });
    request.on('error', reject);
  });
}

async function downloadFile(url, destination, headers = {}) {
  const buffer = await downloadBuffer(url, headers);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, buffer);
  return buffer.length;
}

function selectLlamaAsset(assets, platformId, arch, variant) {
  const excludedGpuTerms = ['vulkan', 'rocm', 'openvino', 'sycl', 'hip'];
  const scored = [];

  for (const asset of assets) {
    const name = String(asset.name || '').toLowerCase();
    if (!name || !(name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz'))) {
      continue;
    }

    let score = 0;
    if (platformId === 'windows') {
      if (!name.includes('win') || !name.includes(arch)) continue;
      score += 20;
      if (variant === 'cuda') {
        if (!name.includes('cuda')) continue;
        score += 20;
        if (name.includes('cudart')) score += 5;
      } else {
        if (name.includes('cuda') || excludedGpuTerms.some((term) => name.includes(term))) continue;
        score += 10;
      }
    } else if (platformId === 'linux') {
      if (!['ubuntu', 'linux'].some((term) => name.includes(term)) || !name.includes(arch)) continue;
      if (variant !== 'cpu') continue;
      if (excludedGpuTerms.some((term) => name.includes(term))) continue;
      score += 30;
    } else if (platformId === 'macos') {
      if (!name.includes('macos') || !name.includes(arch)) continue;
      if (variant !== 'cpu') continue;
      score += 30;
    } else {
      continue;
    }

    if (name.includes('server')) score += 3;
    if (name.endsWith('.zip')) score += 1;
    scored.push({ score, asset });
  }

  if (scored.length === 0) {
    throw new Error(`Could not find a llama.cpp asset for ${platformId}/${arch} (${variant}).`);
  }

  scored.sort((a, b) => b.score - a.score || String(a.asset.name).length - String(b.asset.name).length);
  return scored[0].asset;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function extractArchive(archivePath, targetDir) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'draftharbor-llama-'));
  try {
    await runCommand('tar', ['-xf', archivePath, '-C', tempDir]);
    const entries = (await fsp.readdir(tempDir)).filter((entry) => entry !== '__MACOSX');
    const sourceRoot = entries.length === 1 && (await fsp.stat(path.join(tempDir, entries[0]))).isDirectory()
      ? path.join(tempDir, entries[0])
      : tempDir;

    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.mkdir(targetDir, { recursive: true });

    for (const entry of await fsp.readdir(sourceRoot)) {
      await fsp.cp(path.join(sourceRoot, entry), path.join(targetDir, entry), { recursive: true });
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function ensureLlamaServerExecutable(dataRoot) {
  const llamaDir = path.join(dataRoot, 'llama');
  const executableName = llamaServerFilename();
  const target = path.join(llamaDir, executableName);
  if (!(await pathExists(target))) {
    const stack = [llamaDir];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (entry.name === executableName) {
          await fsp.copyFile(entryPath, target);
          break;
        }
      }
    }
  }

  if (!(await pathExists(target))) {
    throw new Error('llama-server executable was not found after extraction.');
  }

  if (runtimePlatform().platformId !== 'windows') {
    await fsp.chmod(target, 0o755);
  }
}

async function installLlamaCpp(dataRoot, variant) {
  const info = await runtimeInfo(dataRoot);
  const supportedVariants = new Set(info.llamaInstallChoices.map((choice) => choice.id));
  if (!supportedVariants.has(variant)) {
    throw new Error(`Unsupported install choice: ${variant}`);
  }

  const release = await requestJson(LLAMA_RELEASE_API);
  const asset = selectLlamaAsset(release.assets || [], info.platform, info.arch, variant);
  const assetName = String(asset.name || '');
  const assetUrl = String(asset.browser_download_url || '');
  if (!assetName || !assetUrl) {
    throw new Error('Selected llama.cpp release asset is missing download metadata.');
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'draftharbor-llama-download-'));
  try {
    const archivePath = path.join(tempDir, assetName);
    await downloadFile(assetUrl, archivePath, { 'User-Agent': 'DraftHarbor/1.0' });
    await extractArchive(archivePath, path.join(dataRoot, 'llama'));
    await ensureLlamaServerExecutable(dataRoot);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    installed: true,
    assetName,
    platform: info.platform,
    arch: info.arch,
    variant,
    llamaServerPath: path.join('llama', llamaServerFilename()).replace(/\\/g, '/'),
    requiresRestart: true
  };
}

module.exports = { runtimeInfo, installLlamaCpp, pathExists, requestJson, downloadFile, runCommand };
