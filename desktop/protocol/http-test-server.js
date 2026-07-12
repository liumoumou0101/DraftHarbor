const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const HOST = '127.0.0.1';

function createHttpTestServer(dependencies) {
  const { projectSaveRoot, backupRoot, readJsonPayload, readSettings, writeSettings, jsonResponse, handleAppApi, serveStatic, handleUpdaterApi } = dependencies;

function createServer(port, requestHandler) {
  const server = http.createServer((request, response) => {
    const parsedUrl = new URL(request.url, `http://${HOST}:${port}`);
    requestHandler(request, response, parsedUrl).catch((error) => {
      console.error(error);
      if (!response.headersSent) {
        jsonResponse(response, 500, { ok: false, error: error.message });
      } else {
        response.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function startDesktopServers({ appRoot, dataRoot, chooseBackupFolder, chooseProjectSaveFolder, openPath, revealPath, appPort, updaterPort }) {
  await fsp.mkdir(await projectSaveRoot(dataRoot), { recursive: true });
  await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
  await fsp.mkdir(path.join(dataRoot, 'project-backups'), { recursive: true });

  const resolvedAppPort = Number(appPort) || 0;
  const resolvedUpdaterPort = Number(updaterPort) || 0;

  const appServer = await createServer(resolvedAppPort, async (request, response, parsedUrl) => {
    if (request.method === 'POST' && parsedUrl.pathname === '/api/choose-backup-folder') {
      try {
        if (typeof chooseBackupFolder !== 'function') throw new Error('Folder picker is not available in this environment.');
        const payload = await readJsonPayload(request).catch(() => ({}));
        const selected = await chooseBackupFolder(payload.currentPath || await backupRoot(dataRoot));
        if (!selected) {
          jsonResponse(response, 200, { ok: true, canceled: true });
          return;
        }
        const settings = await readSettings(dataRoot);
        settings.backupLocation = path.resolve(selected);
        await writeSettings(dataRoot, settings);
        await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
        jsonResponse(response, 200, { ok: true, path: await backupRoot(dataRoot) });
      } catch (error) {
        jsonResponse(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && parsedUrl.pathname === '/api/open-backup-folder') {
      try {
        const target = await backupRoot(dataRoot);
        await fsp.mkdir(target, { recursive: true });
        if (typeof openPath !== 'function') throw new Error('Open folder is not available in this environment.');
        const result = await openPath(target);
        if (result) throw new Error(result);
        jsonResponse(response, 200, { ok: true });
      } catch (error) {
        jsonResponse(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && parsedUrl.pathname === '/api/choose-project-save-folder') {
      try {
        if (typeof chooseProjectSaveFolder !== 'function') throw new Error('Folder picker is not available in this environment.');
        const payload = await readJsonPayload(request).catch(() => ({}));
        const selected = await chooseProjectSaveFolder(payload.currentPath || await projectSaveRoot(dataRoot));
        if (!selected) {
          jsonResponse(response, 200, { ok: true, canceled: true });
          return;
        }
        const settings = await readSettings(dataRoot);
        settings.projectSaveLocation = path.resolve(selected);
        settings.backupLocation = '';
        await writeSettings(dataRoot, settings);
        await fsp.mkdir(await projectSaveRoot(dataRoot), { recursive: true });
        await fsp.mkdir(await backupRoot(dataRoot), { recursive: true });
        jsonResponse(response, 200, { ok: true, path: await projectSaveRoot(dataRoot) });
      } catch (error) {
        jsonResponse(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && parsedUrl.pathname === '/api/open-project-save-folder') {
      try {
        const target = await projectSaveRoot(dataRoot);
        await fsp.mkdir(target, { recursive: true });
        if (typeof openPath !== 'function') throw new Error('Open folder is not available in this environment.');
        const result = await openPath(target);
        if (result) throw new Error(result);
        jsonResponse(response, 200, { ok: true });
      } catch (error) {
        jsonResponse(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (await handleAppApi(request, response, appRoot, dataRoot, parsedUrl, { openPath, revealPath })) {
      return;
    }
    await serveStatic(request, response, appRoot, parsedUrl);
  });

  const updaterServer = await createServer(resolvedUpdaterPort, async (request, response, parsedUrl) => {
    await handleUpdaterApi(request, response, appRoot, dataRoot, parsedUrl);
  });

  const actualAppPort = appServer.address().port;
  const actualUpdaterPort = updaterServer.address().port;
  const appUrl = `http://${HOST}:${actualAppPort}`;
  const apiBaseUrl = appUrl;
  const updaterUrl = `http://${HOST}:${actualUpdaterPort}`;

  return {
    appServer,
    updaterServer,
    appUrl,
    apiBaseUrl,
    updaterUrl,
    appPort: actualAppPort,
    updaterPort: actualUpdaterPort,
    close() {
      appServer.close();
      updaterServer.close();
    },
    [Symbol.dispose]() {
      appServer.close();
      updaterServer.close();
    }
  };
}

  return { startDesktopServers };
}

module.exports = { createHttpTestServer };
