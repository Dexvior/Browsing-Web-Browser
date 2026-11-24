const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_, v) => cb(v));

contextBridge.exposeInMainWorld('browsing', {
  onShortcut: on('shortcut'),
  onOpenUrl: on('open-url'),
  onSearchText: on('search-text'),
  onUpdate: on('update'),
  onDl: on('dl'),
  onPerm: on('perm-request'),
  onPermCancel: on('perm-cancel'),
  dlAct: (act, id) => ipcRenderer.send('dl-act', act, id),
  permAnswer: (id, a) => ipcRenderer.send('perm-answer', id, a),
  permReset: () => ipcRenderer.send('perm-reset'),
  setChrome: (o) => ipcRenderer.send('set-chrome', o),
  clearData: () => ipcRenderer.invoke('clear-data'),
  getVersion: () => ipcRenderer.invoke('app-version'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
});
