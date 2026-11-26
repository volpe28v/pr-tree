const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  getGhToken: () => ipcRenderer.invoke('get-gh-token'),
});
