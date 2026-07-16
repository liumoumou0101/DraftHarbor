const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`command timed out: ${path.basename(command)}`));
    }, options.timeout || 180000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

(async () => {
  const releaseFiles = await fs.readdir(path.join(root, 'release'));
  const setupName = releaseFiles
    .filter((name) => /^DraftHarbor Setup .*\.exe$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .at(-1);
  assert.ok(setupName, 'NSIS setup executable was not found');
  const setupPath = path.join(root, 'release', setupName);
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draftharbor-installed-smoke-'));
  try {
    await run(setupPath, ['/S', `/D=${installDir}`], { timeout: 180000 });
    const installedExe = path.join(installDir, 'DraftHarbor.exe');
    await fs.access(installedExe);
    await run(process.execPath, [path.join(__dirname, 'packaged-smoke.js')], {
      env: { ...process.env, DRAFTHARBOR_PACKAGED_EXE: installedExe }, timeout: 180000
    });
    console.log(`Installed smoke test passed: ${setupName}`);
  } finally {
    const entries = await fs.readdir(installDir).catch(() => []);
    const uninstaller = entries.find((name) => /^Uninstall .*\.exe$/i.test(name));
    if (uninstaller) await run(path.join(installDir, uninstaller), ['/S'], { timeout: 180000 }).catch(() => {});
    await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error('Installed smoke test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
