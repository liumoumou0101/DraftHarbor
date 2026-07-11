const path = require('path');
const fs = require('fs/promises');
const { normalizeDesktopSettings } = require('../../src/core/settings/settings-schema');
const { writeJsonAtomic } = require('./atomic-write');

function settingsPath(dataRoot) {
  return path.join(dataRoot, '.writingway-settings.json');
}

async function readSettings(dataRoot) {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(dataRoot), 'utf8'));
    return normalizeDesktopSettings(raw);
  } catch {
    return normalizeDesktopSettings();
  }
}

async function writeSettings(dataRoot, settingsInput) {
  const settings = normalizeDesktopSettings({
    ...(settingsInput || {}),
    updatedAt: new Date().toISOString()
  });
  await writeJsonAtomic(settingsPath(dataRoot), settings);
  return settings;
}

module.exports = {
  settingsPath,
  readSettings,
  writeSettings
};
