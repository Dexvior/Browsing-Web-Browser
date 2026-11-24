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
  Menu.buildFromTemplate(t).popup({ window: win });
}

/* ---------- shortcuts that work even while a web page has focus ---------- */
app.on('web-contents-created', (_, contents) => {
  const isGuest = contents.getType() === 'webview';
  const host = () => (isGuest ? contents.hostWebContents : contents);

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
    if (key === 'f12' && isGuest) { event.preventDefault(); contents.toggleDevTools(); return; }

    if (name && host()) { event.preventDefault(); host().send('shortcut', name); }
  });

  if (isGuest) {
    contents.setWindowOpenHandler(({ url }) => { if (host()) host().send('open-url', url); return { action: 'deny' }; });
    contents.on('context-menu', (_e, p) => { if (host()) showContextMenu(contents, host(), p); });
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
  ses.on('will-download', (_e, item) => {
    item.once('done', (_e2, state) => { if (state === 'completed') send('download', { name: item.getFilename(), path: item.getSavePath() }); });
  });
  createWindow();
  setupUpdates();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
