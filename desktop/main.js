const { app, BrowserWindow, dialog, ipcMain, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { createDesktopProtocolHandler } = require('./local-server');

const rootDir = path.resolve(__dirname, '..');
const appUrl = 'draftharbor://app/desktop.html';
const appId = 'io.github.liumoumou0101.draftharbor';
const iconPath = path.join(__dirname, 'icon.ico');
const dataRootOverride = process.env.DRAFTHARBOR_DATA_ROOT ? path.resolve(process.env.DRAFTHARBOR_DATA_ROOT) : '';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'draftharbor', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

function setFullscreen(window, on) {
  if (!window || window.isDestroyed()) return false;
  window.setFullScreen(!!on);
  return window.isFullScreen();
}

function toggleFullscreen(window) {
  if (!window || window.isDestroyed()) return false;
  return setFullscreen(window, !window.isFullScreen());
}

function bindFullscreenEvents(window) {
  if (!window || window.isDestroyed()) return;
  window.on('enter-full-screen', () => {
    if (!window.isDestroyed()) window.webContents.send('draftharbor:fullscreen-changed', true);
  });
  window.on('leave-full-screen', () => {
    if (!window.isDestroyed()) window.webContents.send('draftharbor:fullscreen-changed', false);
  });
}

function serveFile(filePath) {
  const safePath = path.resolve(rootDir, filePath.startsWith('/') ? filePath.slice(1) : filePath);
  if (safePath !== rootDir && !safePath.startsWith(`${rootDir}${path.sep}`)) {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const data = fs.readFileSync(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' }
    });
  } catch {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    title: '稿湾 DraftHarbor',
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: '#14161b',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadURL(appUrl);

  window.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged && input.key === 'F12') {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'F11') {
      toggleFullscreen(window);
      event.preventDefault();
    }
  });
  bindFullscreenEvents(window);
}

app.whenReady().then(async () => {
  try {
    app.setName('DraftHarbor');
    app.setAppUserModelId(appId);

    const dataRoot = dataRootOverride || (app.isPackaged ? app.getPath('userData') : rootDir);

    const localProtocolHandler = await createDesktopProtocolHandler({
      appRoot: rootDir,
      dataRoot,
      chooseBackupFolder: async (currentPath) => {
        const result = await dialog.showOpenDialog({
          title: 'Choose backup folder',
          defaultPath: currentPath || app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory']
        });
        return result.canceled ? null : result.filePaths[0];
      },
      chooseProjectSaveFolder: async (currentPath) => {
        const result = await dialog.showOpenDialog({
          title: 'Choose project save folder',
          defaultPath: currentPath || app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory']
        });
        return result.canceled ? null : result.filePaths[0];
      },
      openPath: async (targetPath) => shell.openPath(targetPath),
      revealPath: async (targetPath) => {
        shell.showItemInFolder(targetPath);
        return '';
      }
    });

    protocol.handle('draftharbor', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') {
        return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
      let filePath = url.pathname;
      if (filePath === '/') filePath = '/desktop.html';
      if (filePath.startsWith('/api/') || filePath === '/version' || filePath === '/health' || filePath.startsWith('/update/')) {
        return localProtocolHandler(request);
      }
      return serveFile(filePath);
    });

    ipcMain.handle('draftharbor:toggle-fullscreen', (event) => {
      return toggleFullscreen(BrowserWindow.fromWebContents(event.sender));
    });
    ipcMain.handle('draftharbor:set-fullscreen', (event, on) => {
      return setFullscreen(BrowserWindow.fromWebContents(event.sender), on);
    });
    ipcMain.handle('draftharbor:is-fullscreen', (event) => {
      const current = BrowserWindow.fromWebContents(event.sender);
      return !!(current && !current.isDestroyed() && current.isFullScreen());
    });

    createWindow();
  } catch (error) {
    console.error(error);
    dialog.showErrorBox('稿湾启动失败', error.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
