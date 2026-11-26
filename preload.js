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
  vpnGet: call('vpn-get'), vpnSelect: call('vpn-select'), vpnToggle: call('vpn-toggle'), vpnPing: call('vpn-ping'), vpnRefresh: call('vpn-refresh'),
  sessionSave: send('session-save'), sessionClear: send('session-clear'), sessionLoad: call('session-load'),
  sessionSaveSync: (d) => ipcRenderer.sendSync('session-save-sync', d), memUsage: call('mem-usage'),
  homeGet: call('home-get'), stickerAdd: call('sticker-add'), stickerRemove: call('sticker-remove'), wallSet: call('wall-set'), wallDim: send('wall-dim'),
  fontAdd: call('font-add'), fontsList: call('fonts-list'), fontData: call('font-data'), fontRemove: call('font-remove'), fontSet: send('font-set'),
});
