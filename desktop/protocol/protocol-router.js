const fsp = require('fs/promises');
const path = require('path');
const {
  createMockNodeRequest,
  createMockNodeResponse,
  mockResponseToFetchResponse,
  readFetchBodyStream,
  fetchHeadersToPlain
} = require('./http-test-adapter');

function jsonFetchResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function createProtocolRouter(dependencies) {
  const {
    backupRoot, projectSaveRoot, readSettings, writeSettings,
    handleAppApi, handleUpdaterApi
  } = dependencies;

  async function handleFolderAction(fetchRequest, context) {
    const { pathname, dataRoot, chooseBackupFolder, chooseProjectSaveFolder, openPath } = context;
    const readPayload = () => readFetchBodyStream(fetchRequest.body)
      .then((buffer) => buffer.length > 0 ? JSON.parse(buffer.toString('utf8')) : {})
      .catch(() => ({}));

    if (pathname === '/api/choose-backup-folder') {
      if (typeof chooseBackupFolder !== 'function') throw new Error('Folder picker is not available in this environment.');
      const payload = await readPayload();
      const selected = await chooseBackupFolder(payload.currentPath || await backupRoot(dataRoot));
      if (!selected) return { ok: true, canceled: true };
      const settings = await readSettings(dataRoot);
      settings.backupLocation = path.resolve(selected);
      await writeSettings(dataRoot, settings);
      await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
      return { ok: true, path: await backupRoot(dataRoot) };
    }
    if (pathname === '/api/open-backup-folder') {
      const target = await backupRoot(dataRoot);
      await fsp.mkdir(target, { recursive: true });
      if (typeof openPath !== 'function') throw new Error('Open folder is not available in this environment.');
      const result = await openPath(target);
      if (result) throw new Error(result);
      return { ok: true };
    }
    if (pathname === '/api/choose-project-save-folder') {
      if (typeof chooseProjectSaveFolder !== 'function') throw new Error('Folder picker is not available in this environment.');
      const payload = await readPayload();
      const selected = await chooseProjectSaveFolder(payload.currentPath || await projectSaveRoot(dataRoot));
      if (!selected) return { ok: true, canceled: true };
      const settings = await readSettings(dataRoot);
      settings.projectSaveLocation = path.resolve(selected);
      settings.backupLocation = '';
      await writeSettings(dataRoot, settings);
      await fsp.mkdir(await projectSaveRoot(dataRoot), { recursive: true });
      await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
      return { ok: true, path: await projectSaveRoot(dataRoot) };
    }
    if (pathname === '/api/open-project-save-folder') {
      const target = await projectSaveRoot(dataRoot);
      await fsp.mkdir(target, { recursive: true });
      if (typeof openPath !== 'function') throw new Error('Open folder is not available in this environment.');
      const result = await openPath(target);
      if (result) throw new Error(result);
      return { ok: true };
    }
    return null;
  }

  async function createDesktopProtocolHandler(context) {
    const { appRoot, dataRoot, chooseBackupFolder, chooseProjectSaveFolder, openPath, revealPath } = context;
    await fsp.mkdir(await projectSaveRoot(dataRoot), { recursive: true });
    await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
    await fsp.mkdir(path.join(dataRoot, 'project-backups'), { recursive: true });

    return async function protocolHandler(fetchRequest) {
      const fetchUrl = new URL(fetchRequest.url);
      const { pathname } = fetchUrl;
      const method = fetchRequest.method;
      if (method === 'POST' && ['/api/choose-backup-folder', '/api/open-backup-folder', '/api/choose-project-save-folder', '/api/open-project-save-folder'].includes(pathname)) {
        try {
          const result = await handleFolderAction(fetchRequest, { pathname, dataRoot, chooseBackupFolder, chooseProjectSaveFolder, openPath });
          if (result) return jsonFetchResponse(200, result);
        } catch (error) { return jsonFetchResponse(500, { ok: false, error: error.message }); }
      }

      const bodyBuffer = await readFetchBodyStream(fetchRequest.body);
      const request = createMockNodeRequest(method, pathname + (fetchUrl.search || ''), bodyBuffer, fetchHeadersToPlain(fetchRequest));
      const mockResponse = createMockNodeResponse();
      if (pathname.startsWith('/api/')) {
        const handled = await handleAppApi(request, mockResponse.response, appRoot, dataRoot, fetchUrl, { openPath, revealPath });
        return handled ? mockResponseToFetchResponse(mockResponse) : jsonFetchResponse(404, { ok: false, error: 'Not found' });
      }
      if (['/version', '/health', '/update/status', '/update/download', '/update/clear'].includes(pathname)) {
        await handleUpdaterApi(request, mockResponse.response, appRoot, dataRoot, fetchUrl);
        return mockResponseToFetchResponse(mockResponse);
      }
      return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    };
  }

  return { createDesktopProtocolHandler };
}

module.exports = { createProtocolRouter };
