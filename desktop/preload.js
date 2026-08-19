const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftHarborDesktop', {
  toggleFullscreen: () => ipcRenderer.invoke('draftharbor:toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('draftharbor:set-fullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('draftharbor:is-fullscreen'),
  onFullscreenChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, on) => listener(on);
    ipcRenderer.on('draftharbor:fullscreen-changed', wrapped);
    return () => ipcRenderer.removeListener('draftharbor:fullscreen-changed', wrapped);
  }
});
