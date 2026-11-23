const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  savePng: (dataUrl, suggested) => ipcRenderer.invoke('save-png', { dataUrl, suggested })
});
