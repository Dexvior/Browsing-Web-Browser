const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session } = require('electron');
const path = require('path');

const PARTITION = 'persist:browsing';
const OVERLAY = {
  dark: { color: '#000000', symbolColor: '#ffffff', height: 40 },
  light: { color: '#ffffff', symbolColor: '#000000', height: 40 },
};
let win;

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 420,
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
  // Every web page gets a locked-down preload that fills in standard Chrome objects.
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.preload = path.join(__dirname, 'guest-preload.js');
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// Keyboard shortcuts work even while a web page has focus.
app.on('web-contents-created', (_, contents) => {
  const isGuest = contents.getType() === 'webview';
  const host = () => (isGuest ? contents.hostWebContents : contents);

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    let name = null;

    if (ctrl && !input.shift && !input.alt) {
      name = { t: 'new-tab', w: 'close-tab', r: 'reload', l: 'focus-url', ',': 'settings' }[key] || null;
    }
    if (ctrl && key === 'tab') name = input.shift ? 'prev-tab' : 'next-tab';
    if (key === 'f5') name = 'reload';
    if (input.alt && key === 'arrowleft') name = 'back';
    if (input.alt && key === 'arrowright') name = 'forward';

    if (name && host()) {
      event.preventDefault();
      host().send('shortcut', name);
    }
  });

  if (isGuest) {
    contents.setWindowOpenHandler(({ url }) => {
      if (host()) host().send('open-url', url);
      return { action: 'deny' };
    });
  }
});

ipcMain.on('set-theme', (_, mode) => {
  if (mode !== 'dark' && mode !== 'light') return;
  nativeTheme.themeSource = mode;
  try { win.setTitleBarOverlay(OVERLAY[mode]); } catch {}
  win.setBackgroundColor(OVERLAY[mode].color);
});

ipcMain.on('set-chrome', (_, o) => {
  const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!o || !ok(o.color) || !ok(o.symbol)) return;
  nativeTheme.themeSource = o.dark ? 'dark' : 'light';
  try { win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbol, height: 40 }); } catch {}
  win.setBackgroundColor(o.color);
});

ipcMain.handle('clear-data', async () => {
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData({ storages: ['cookies', 'indexdb', 'websql', 'cachestorage', 'serviceworkers', 'filesystem'] });
  await ses.clearCache();
  return true;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const ses = session.fromPartition(PARTITION);
  // Present a normal Chromium identity: same UA Electron would send, minus the Electron/app tokens.
  const ua = ses.getUserAgent().replace(/\s(Electron|browsing)\/\S+/gi, '');
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;
  // Keep the Client Hints header consistent with the UA (no "Electron" brand).
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1] || '130';
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'sec-ch-ua') h[k] = '"Chromium";v="' + major + '", "Not?A_Brand";v="99", "Browsing";v="1"';
    }
    cb({ requestHeaders: h });
  });
  createWindow();
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => app.quit());
