const workshopStore = require('../storage/workshop-store');
const projectService = require('./project-service');
const WorkshopSchema = require('../../src/core/workshop/workshop-schema');

async function ensureProject(dataRoot, projectId) {
  if (!projectId) throw new Error('projectId is required');
  await projectService.projectLocation(dataRoot, projectId);
}

async function listSessions(dataRoot, projectId) {
  await ensureProject(dataRoot, projectId);
  return {
    ok: true,
    sessions: await workshopStore.listSessions(dataRoot, projectId)
  };
}

async function saveSession(dataRoot, projectId, sessionInput = {}) {
  await ensureProject(dataRoot, projectId);
  return {
    ok: true,
    session: await workshopStore.saveSession(dataRoot, projectId, sessionInput)
  };
}

async function appendMessage(dataRoot, projectId, sessionId, messageInput = {}) {
  await ensureProject(dataRoot, projectId);
  const sessions = await workshopStore.listSessions(dataRoot, projectId);
  let session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    session = WorkshopSchema.createWorkshopSession({
      id: sessionId || undefined,
      projectId,
      title: '新对话'
    });
  }
  session.messages = [...(session.messages || []), WorkshopSchema.createWorkshopMessage(messageInput)];
  session.updatedAt = new Date().toISOString();
  return {
    ok: true,
    session: await workshopStore.saveSession(dataRoot, projectId, session)
  };
}

async function deleteSession(dataRoot, projectId, sessionId) {
  await ensureProject(dataRoot, projectId);
  if (!sessionId) throw new Error('sessionId is required');
  return {
    ok: true,
    ...await workshopStore.deleteSession(dataRoot, projectId, sessionId)
  };
}

module.exports = {
  listSessions,
  saveSession,
  appendMessage,
  deleteSession
};
