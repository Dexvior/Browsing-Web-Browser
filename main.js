const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session, shell, clipboard, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const PARTITION = 'persist:browsing';
const OVERLAY = {
  dark: { color: '#000000', symbolColor: '#ffffff', height: 40 },
  light: { color: '#ffffff', symbolColor: '#000000', height: 40 },
};
let win, bounds = null;

if (!app.requestSingleInstanceLock()) app.quit();

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

/* ---------- remember window size and position ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  if (!win.isMaximized() && !win.isMinimized()) bounds = win.getBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, max: win.isMaximized() })); } catch {}
}
const onScreen = (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && screen.getAllDisplays().some((d) =>
  s.x >= d.bounds.x - 40 && s.x < d.bounds.x + d.bounds.width - 120 && s.y >= d.bounds.y - 10 && s.y < d.bounds.y + d.bounds.height - 120);

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1280,
    height: st.height || 800,
    ...(onScreen(st) ? { x: st.x, y: st.y } : {}),
    minWidth: 640,
    minHeight: 420,
    show: false,                       // no white flash: show once the first frame is ready
    title: 'Browsing',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: OVERLAY.dark,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  bounds = win.getBounds();
  if (st.max) win.maximize();
  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(saveState, 400); };
  win.on('resize', later); win.on('move', later); win.on('close', saveState);
  win.once('ready-to-show', () => win.show());

  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.preload = path.join(__dirname, 'guest-preload.js');
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

/* ---------- right-click menu for web pages ---------- */
function showContextMenu(contents, host, p) {
  const nav = contents.navigationHistory || contents;
  const t = [];
  if (p.linkURL) t.push(
    { label: 'Open link in new tab', click: () => host.send('open-url', p.linkURL) },
    { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
    { type: 'separator' });
  if (p.mediaType === 'image' && p.srcURL) t.push(
    { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
    { label: 'Save image as...', click: () => contents.downloadURL(p.srcURL) },
    { type: 'separator' });
  if (p.isEditable) t.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  else if (p.selectionText) t.push({ role: 'copy' },
    { label: 'Search for selection', click: () => host.send('search-text', p.selectionText) }, { type: 'separator' });
  t.push(
    { label: 'Back', enabled: nav.canGoBack(), click: () => nav.goBack() },
    { label: 'Forward', enabled: nav.canGoForward(), click: () => nav.goForward() },
    { label: 'Reload', click: () => contents.reload() },
    { type: 'separator' },
    { label: 'Inspect', click: () => contents.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(t).popup({ window: BrowserWindow.fromWebContents(contents) || win });
}

/* ---------- shortcuts, popup windows and right-click menu ---------- */
const sizeOf = (features, key) => { const m = new RegExp(key + '=(\\d+)').exec(features || ''); return m ? +m[1] : undefined; };

app.on('web-contents-created', (_, contents) => {
  const isMain = !win;                         // the main window's page is created before `win` is assigned
  const isGuest = contents.getType() === 'webview';
  const host = () => (isMain ? contents : isGuest ? contents.hostWebContents : win && win.webContents);

  if (isMain || isGuest) {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const ctrl = input.control || input.meta;
      let name = null;
      if (ctrl && !input.alt) {
        if (input.shift) {
          if (key === 't') name = 'reopen-tab';
          else if (key === 'tab') name = 'prev-tab';
          else if (key === '+') name = 'zoom-in';
        } else {
          name = { t: 'new-tab', w: 'close-tab', r: 'reload', l: 'focus-url', f: 'find', ',': 'settings',
            '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset', tab: 'next-tab' }[key] || null;
          if (!name && /^[1-9]$/.test(key)) name = 'tab-' + key;
        }
      }
      if (key === 'f5') name = 'reload';
      if (input.alt && key === 'arrowleft') name = 'back';
      if (input.alt && key === 'arrowright') name = 'forward';
      if (name && host()) { event.preventDefault(); host().send('shortcut', name); }
    });
  }

  if (!isMain) {
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key.toLowerCase() === 'f12') { event.preventDefault(); contents.toggleDevTools(); }
    });
    // Sign-in popups (Google, Apple, ...) must stay real windows so they can talk back to the page that opened them.
    // Plain links and window.open() without a popup size become new tabs.
    contents.setWindowOpenHandler(({ url, features, disposition }) => {
      const h = host();
      const popup = disposition === 'new-window' || (features && features.length > 0);
      if (!popup) { if (h) h.send('open-url', url); return { action: 'deny' }; }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: win,
          width: sizeOf(features, 'width') || 520,
          height: sizeOf(features, 'height') || 700,
          minWidth: 360,
          autoHideMenuBar: true,
          title: 'Browsing',
          icon: path.join(__dirname, 'build', 'icon.png'),
          backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
          webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'guest-preload.js') },
        },
      };
    });
    contents.on('context-menu', (_e, p) => { const h = host(); if (h) showContextMenu(contents, h, p); });
  }
});

/* ---------- IPC ---------- */
ipcMain.on('set-chrome', (_, o) => {
  const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!o || !ok(o.color) || !ok(o.symbol)) return;
  nativeTheme.themeSource = o.dark ? 'dark' : 'light';
  try { win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbol, height: 40 }); } catch {}
  win.setBackgroundColor(o.color);
});
ipcMain.handle('clear-data', async () => {
  const ses = session.fromPartition(PARTITION);
  // Keep localStorage so new-tab shortcuts survive.
  await ses.clearStorageData({ storages: ['cookies', 'indexdb', 'websql', 'cachestorage', 'serviceworkers', 'filesystem'] });
  await ses.clearCache();
  return true;
});
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('check-updates', async () => {
  if (!app.isPackaged) return 'dev';
  try {
    const r = await autoUpdater.checkForUpdates();
    return r && r.updateInfo && r.updateInfo.version !== app.getVersion() ? 'available' : 'latest';
  } catch { return 'error'; }
});
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());
ipcMain.on('show-file', (_, p) => { if (typeof p === 'string') shell.showItemInFolder(p); });

/* ---------- downloads drawer ---------- */
const downloads = new Map();   // id -> { item, info }
const dlFiles = new Map();     // id -> saved file path
let dlSeq = 0;
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, base + ' (' + i++ + ')' + ext);
  return p;
}
function setupDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const id = ++dlSeq;
    const file = uniquePath(app.getPath('downloads'), item.getFilename() || 'download');
    item.setSavePath(file);                       // saves straight to Downloads, like Chrome
    dlFiles.set(id, file);
    const info = (state) => ({ id, name: path.basename(file), total: item.getTotalBytes(), received: item.getReceivedBytes(), paused: item.isPaused(), state });
    downloads.set(id, { item, info });
    send('dl', { ...info('progressing'), type: 'start' });
    let last = 0;
    item.on('updated', (_ev, state) => {
      const now = Date.now();
      if (state === 'progressing' && now - last < 250) return;
      last = now;
      send('dl', { ...info(state), type: 'update' });
    });
    item.once('done', (_ev, state) => { send('dl', { ...info(state), type: 'done' }); downloads.delete(id); });
  });
}
ipcMain.on('dl-act', (_, act, id) => {
  const d = downloads.get(id), file = dlFiles.get(id);
  if (act === 'cancel' && d) d.item.cancel();
  else if (act === 'pause' && d && !d.item.isPaused()) { d.item.pause(); send('dl', { ...d.info('progressing'), type: 'update' }); }
  else if (act === 'resume' && d && d.item.isPaused()) { d.item.resume(); send('dl', { ...d.info('progressing'), type: 'update' }); }
  else if (act === 'open' && file) shell.openPath(file);
  else if (act === 'show' && file) shell.showItemInFolder(file);
  else if (act === 'folder') shell.openPath(app.getPath('downloads'));
});

/* ---------- permission prompts (camera, microphone, location, notifications, ...) ---------- */
const permFile = () => path.join(app.getPath('userData'), 'permissions.json');
let perms = {};
const savePerms = () => { try { fs.writeFileSync(permFile(), JSON.stringify(perms)); } catch {} };
const SILENT = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'speaker-selection', 'storage-access', 'top-level-storage-access']);
const ASK = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex']);
const pendingPerms = new Map();
let permSeq = 0;
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
function kindsOf(permission, details) {
  if (permission !== 'media') return [permission];
  const k = (details.mediaTypes || []).map((m) => (m === 'video' ? 'camera' : 'microphone'));
  return k.length ? k : ['camera'];
}
function setupPermissions(ses) {
  try { perms = JSON.parse(fs.readFileSync(permFile(), 'utf8')); } catch { perms = {}; }

  // What pages are told when they ask "do I already have permission?"
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (SILENT.has(permission)) return true;
    if (!ASK.has(permission)) return false;
    const o = originOf(requestingOrigin);
    const kind = permission === 'media' ? (details && details.mediaType === 'video' ? 'camera' : details && details.mediaType === 'audio' ? 'microphone' : null) : permission;
    const v = kind ? perms[o + '|' + kind] : null;
    if (v === 'allow') return true;
    if (v === 'block') return false;
    return permission !== 'notifications';       // unknown: pages may ask (notifications must be requested explicitly)
  });

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (SILENT.has(permission)) return callback(true);
    if (!ASK.has(permission)) return callback(false);
    const origin = originOf(details.requestingUrl || wc.getURL());
    const kinds = kindsOf(permission, details);
    const keys = kinds.map((k) => origin + '|' + k);
    if (keys.some((k) => perms[k] === 'block')) return callback(false);
    if (keys.every((k) => perms[k] === 'allow')) return callback(true);
    const h = wc.getType() === 'webview' ? wc.hostWebContents : (win && win.webContents);
    if (!h || !origin) return callback(false);
    const id = ++permSeq;
    pendingPerms.set(id, { callback, keys });
    h.send('perm-request', { id, host: new URL(origin).host, kinds });
    wc.once('destroyed', () => { if (pendingPerms.delete(id)) { try { h.send('perm-cancel', id); } catch {} } });
  });
}
ipcMain.on('perm-answer', (_, id, answer) => {
  const p = pendingPerms.get(id);
  if (!p) return;
  pendingPerms.delete(id);
  if (answer === 'always') { p.keys.forEach((k) => (perms[k] = 'allow')); savePerms(); p.callback(true); }
  else if (answer === 'once') p.callback(true);
  else if (answer === 'block') { p.keys.forEach((k) => (perms[k] = 'block')); savePerms(); p.callback(false); }
  else p.callback(false);
});
ipcMain.on('perm-reset', () => { perms = {}; savePerms(); });

/* ---------- automatic updates (GitHub Releases) ---------- */
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => send('update', { state: 'downloading', version: i.version }));
  autoUpdater.on('download-progress', (p) => send('update', { state: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update', { state: 'ready', version: i.version }));
  autoUpdater.on('error', () => send('update', { state: 'error' }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const ses = session.fromPartition(PARTITION);
  // Present a normal Chromium identity: same UA Electron would send, minus the Electron/app tokens.
  const ua = ses.getUserAgent().replace(/\s(Electron|browsing)\/\S+/gi, '');
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1] || '130';
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'sec-ch-ua') h[k] = '"Chromium";v="' + major + '", "Not?A_Brand";v="99", "Browsing";v="1"';
    }
    cb({ requestHeaders: h });
  });
  setupDownloads(ses);
  setupPermissions(ses);
  createWindow();
  setupUpdates();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
