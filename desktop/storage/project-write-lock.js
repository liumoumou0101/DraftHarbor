const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const locks = new Map();
const owners = new AsyncLocalStorage();

// Project snapshots, dedicated stores and Agent edits share one transaction
// boundary. Nested calls (including backup reads) retain the owning transaction.
async function withProjectWriteLock(projectPath, task) {
  const resolved = path.resolve(projectPath);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const inherited = owners.getStore();
  const owner = inherited && inherited.get(key);
  if (owner && owner.active) return task();
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const token = previous.then(() => gate);
  locks.set(key, token);
  await previous;
  const currentOwner = { active: true };
  const context = new Map(inherited || []);
  context.set(key, currentOwner);
  try {
    return await owners.run(context, task);
  } finally {
    currentOwner.active = false;
    release();
    if (locks.get(key) === token) locks.delete(key);
  }
}

module.exports = { withProjectWriteLock };
