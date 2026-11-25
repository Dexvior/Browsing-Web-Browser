const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_, v) => cb(v));
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const send = (ch) => (...a) => ipcRenderer.send(ch, ...a);

contextBridge.exposeInMainWorld('browsing', {
  onShortcut: on('shortcut'), onOpenUrl: on('open-url'), onSearchText: on('search-text'), onUpdate: on('update'),
  onDl: on('dl'), onPerm: on('perm-request'), onPermCancel: on('perm-cancel'), onVpn: on('vpn-status'), onNotify: on('notify'),
  setChrome: send('set-chrome'), setFlags: send('set-flags'), installUpdate: send('install-update'),
  dlAct: send('dl-act'), permAnswer: send('perm-answer'), permReset: send('perm-reset'), permSet: send('perm-set'), permForget: send('perm-forget-site'),
  clearData: call('clear-data'), getVersion: call('app-version'), checkUpdates: call('check-updates'),
  dlHistory: call('dl-history'), adCount: call('adblock-count'), permList: call('perm-list'),
  vpnGet: call('vpn-get'), vpnSave: call('vpn-save'), vpnToggle: call('vpn-toggle'),
});
