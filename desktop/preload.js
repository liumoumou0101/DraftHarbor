const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('writingwayDesktop', {
  toggleFullscreen: () => ipcRenderer.invoke('draftharbor:toggle-fullscreen')
});
