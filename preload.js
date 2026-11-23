const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browsing', {
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_, name) => cb(name)),
  onOpenUrl: (cb) => ipcRenderer.on('open-url', (_, url) => cb(url)),
  setTheme: (mode) => ipcRenderer.send('set-theme', mode),
  clearData: () => ipcRenderer.invoke('clear-data'),
});
