const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftHarborDesktop', {
  toggleFullscreen: () => ipcRenderer.invoke('draftharbor:toggle-fullscreen')
});
