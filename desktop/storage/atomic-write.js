const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

async function writeFileAtomic(filePath, content, encoding = 'utf8') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tempPath, content, encoding);
  await fs.rename(tempPath, filePath);
}

async function writeJsonAtomic(filePath, payload) {
  await writeFileAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic
};
