const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_, v) => cb(v));

contextBridge.exposeInMainWorld('browsing', {
  onShortcut: on('shortcut'),
  onOpenUrl: on('open-url'),
  onSearchText: on('search-text'),
  onUpdate: on('update'),
  onDownload: on('download'),
  setChrome: (o) => ipcRenderer.send('set-chrome', o),
  clearData: () => ipcRenderer.invoke('clear-data'),
  getVersion: () => ipcRenderer.invoke('app-version'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  showFile: (p) => ipcRenderer.send('show-file', p),
});
