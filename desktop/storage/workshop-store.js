const path = require('path');
const fs = require('fs/promises');
const { writeJsonAtomic } = require('./atomic-write');
const { projectDir } = require('./library-paths');
const WorkshopSchema = require('../../src/core/workshop/workshop-schema');

function workshopDir(projectPath) {
  return path.join(projectPath, 'workshop');
}

function sessionsPath(projectPath) {
  return path.join(workshopDir(projectPath), 'sessions.json');
}

async function readSessions(projectPath, projectId = '') {
  try {
    const sessions = JSON.parse(await fs.readFile(sessionsPath(projectPath), 'utf8'));
    return WorkshopSchema.normalizeWorkshopSessions(sessions, projectId);
  } catch {
    return [];
  }
}

async function writeSessions(projectPath, sessions, projectId = '') {
  await fs.mkdir(workshopDir(projectPath), { recursive: true });
  const normalized = WorkshopSchema.normalizeWorkshopSessions(sessions, projectId);
  await writeJsonAtomic(sessionsPath(projectPath), normalized);
  return normalized;
}

async function listSessions(dataRoot, projectId) {
  return readSessions(projectDir(dataRoot, projectId), projectId);
}

async function saveSession(dataRoot, projectId, sessionInput = {}) {
  const projectPath = projectDir(dataRoot, projectId);
  const sessions = await readSessions(projectPath, projectId);
  const now = new Date().toISOString();
  const incoming = WorkshopSchema.createWorkshopSession({
    ...sessionInput,
    projectId,
    updatedAt: now
  });
  const index = sessions.findIndex((session) => session.id === incoming.id);
  if (index >= 0) {
    sessions[index] = {
      ...sessions[index],
      ...incoming,
      createdAt: sessions[index].createdAt || incoming.createdAt,
      updatedAt: now
    };
  } else {
    sessions.push(incoming);
  }
  const saved = await writeSessions(projectPath, sessions, projectId);
  return saved.find((session) => session.id === incoming.id);
}

async function deleteSession(dataRoot, projectId, sessionId) {
  const projectPath = projectDir(dataRoot, projectId);
  const sessions = await readSessions(projectPath, projectId);
  const next = sessions.filter((session) => session.id !== sessionId);
  await writeSessions(projectPath, next, projectId);
  return { deleted: sessions.length - next.length };
}

module.exports = {
  sessionsPath,
  readSessions,
  writeSessions,
  listSessions,
  saveSession,
  deleteSession
};
