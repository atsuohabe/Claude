const { contextBridge, ipcRenderer } = require('electron');
const version = ipcRenderer.sendSync('app:version');

contextBridge.exposeInMainWorld('electronAPI', { version });
