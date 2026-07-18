const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

async function writeFileAtomic(filePath, content, encoding = 'utf8') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, content, encoding);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await writeFileAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function cleanupAtomicTempFiles(rootPath) {
  const removed = [];
  const tempPattern = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

  async function visit(directory) {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && tempPattern.test(entry.name)) {
        await fs.rm(target, { force: true });
        removed.push(target);
      }
    }
  }

  await visit(rootPath);
  return removed;
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
  cleanupAtomicTempFiles
};
