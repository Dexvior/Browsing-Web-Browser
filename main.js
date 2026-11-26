const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session, shell, clipboard, screen, net, safeStorage, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const tcp = require('net');
const { pathToFileURL } = require('url');

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
      if (key === 'f11') { event.preventDefault(); if (win) win.setFullScreen(!win.isFullScreen()); return; }
      if (ctrl && !input.alt) {
        if (input.shift) {
          if (key === 't') name = 'reopen-tab';
          else if (key === 'tab') name = 'prev-tab';
          else if (key === '+') name = 'zoom-in';
          else if (key === 'p') name = 'privacy';
        } else {
          name = { t: 'new-tab', w: 'close-tab', r: 'reload', l: 'focus-url', f: 'find', ',': 'settings', h: 'history', d: 'bookmark',
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
    if (vpnState.state === 'on') { try { contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch {} }
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

/* ---------- downloads (live list + saved history) ---------- */
const downloads = new Map();   // active downloads: id -> { item, info }
const dlFiles = new Map();     // id -> saved file path
let dlSeq = 0, dlHist = [];    // dlHist: newest first; written to disk only while "Save download history" is on
const dlHistFile = () => path.join(app.getPath('userData'), 'downloads.json');
const saveDlHist = () => { try { fs.writeFileSync(dlHistFile(), JSON.stringify(dlHist.slice(0, 500))); } catch {} };
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, base + ' (' + i++ + ')' + ext);
  return p;
}
function setupDownloads(ses) {
  try { dlHist = JSON.parse(fs.readFileSync(dlHistFile(), 'utf8')); } catch { dlHist = []; }
  dlHist.forEach((h) => { dlFiles.set(h.id, h.file); dlSeq = Math.max(dlSeq, h.id); });
  ses.on('will-download', (_e, item, wc) => {
    const id = ++dlSeq, ts = Date.now();
    const file = uniquePath(app.getPath('downloads'), item.getFilename() || 'download');
    item.setSavePath(file);                       // saves straight to Downloads, like Chrome
    dlFiles.set(id, file);
    const url = item.getURL();
    const page = wc && !wc.isDestroyed() ? wc.getURL() : '';
    const info = (state) => ({ id, name: path.basename(file), url, page, ts, total: item.getTotalBytes(), received: item.getReceivedBytes(), paused: item.isPaused(), state });
    downloads.set(id, { item, info });
    send('dl', { ...info('progressing'), type: 'start' });
    let last = 0;
    item.on('updated', (_ev, state) => {
      const now = Date.now();
      if (state === 'progressing' && now - last < 250) return;
      last = now;
      send('dl', { ...info(state), type: 'update' });
    });
    item.once('done', (_ev, state) => {
      const i = info(state);
      send('dl', { ...i, type: 'done' });
      downloads.delete(id);
      if (flags.saveDl) {                         // when the toggle is off nothing is written
        dlHist.unshift({ id, name: i.name, file, url, page, ts, total: i.total || i.received, state });
        dlHist = dlHist.slice(0, 500);
        saveDlHist();
      }
    });
  });
}
ipcMain.handle('dl-history', () => dlHist);
ipcMain.on('dl-act', (_, act, id) => {
  const d = downloads.get(id), file = dlFiles.get(id);
  if (act === 'cancel' && d) d.item.cancel();
  else if (act === 'pause' && d && !d.item.isPaused()) { d.item.pause(); send('dl', { ...d.info('progressing'), type: 'update' }); }
  else if (act === 'resume' && d && d.item.isPaused()) { d.item.resume(); send('dl', { ...d.info('progressing'), type: 'update' }); }
  else if ((act === 'open' || act === 'show') && file) {
    if (!fs.existsSync(file)) { send('notify', 'That file was moved or deleted'); return; }
    if (act === 'open') shell.openPath(file); else shell.showItemInFolder(file);
  }
  else if (act === 'folder') shell.openPath(app.getPath('downloads'));
  else if (act === 'forget') { dlHist = dlHist.filter((h) => h.id !== id); if (!d) dlFiles.delete(id); saveDlHist(); }
  else if (act === 'clear') { dlHist = []; saveDlHist(); for (const k of [...dlFiles.keys()]) if (!downloads.has(k)) dlFiles.delete(k); }
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
const SITE_KINDS = new Set(['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex']);
ipcMain.handle('perm-list', (_, origin) => {
  const out = {}, p = origin + '|';
  if (typeof origin === 'string') for (const k of Object.keys(perms)) if (k.startsWith(p)) out[k.slice(p.length)] = perms[k];
  return out;
});
ipcMain.on('perm-set', (_, origin, kind, value) => {
  if (typeof origin !== 'string' || !/^https?:\/\//.test(origin) || !SITE_KINDS.has(kind)) return;
  const key = origin + '|' + kind;
  if (value === 'allow' || value === 'block') perms[key] = value; else delete perms[key];
  savePerms();
});
ipcMain.on('perm-forget-site', (_, origin) => {
  if (typeof origin !== 'string') return;
  Object.keys(perms).forEach((k) => { if (k.startsWith(origin + '|')) delete perms[k]; });
  savePerms();
});

/* ---------- settings that main-process code needs (the app window is the source of truth) ---------- */
const flags = { adblock: true, saveDl: true, vpnAuto: false, saveTabs: true };
let autoDone = false;
ipcMain.on('flags', (e) => { e.returnValue = { adblock: flags.adblock }; });
ipcMain.on('set-flags', (_, f) => {
  if (!f) return;
  flags.adblock = !!f.adblock; flags.saveDl = !!f.saveDl; flags.vpnAuto = !!f.vpnAuto; flags.saveTabs = f.saveTabs !== false;
  if (flags.vpnAuto && !autoDone) { autoDone = true; vpnConnect(); }
});

/* ---------- built-in ad and tracker blocker (network level) ---------- */
let blockedCount = 0;
const AD_HOSTS = new Set(`doubleclick.net googlesyndication.com googleadservices.com adservice.google.com 2mdn.net
  google-analytics.com stats.g.doubleclick.net adsafeprotected.com moatads.com amazon-adsystem.com adnxs.com adsrvr.org
  rubiconproject.com pubmatic.com openx.net criteo.com criteo.net taboola.com outbrain.com smartadserver.com adform.net
  advertising.com media.net teads.tv casalemedia.com indexww.com lijit.com sharethrough.com 33across.com bidswitch.net
  contextweb.com yieldmo.com triplelift.com gumgum.com spotxchange.com springserve.com serving-sys.com flashtalking.com
  mathtag.com bluekai.com krxd.net demdex.net everesttech.net adroll.com quantserve.com quantcast.com scorecardresearch.com
  imrworldwide.com hotjar.com mouseflow.com crazyegg.com mixpanel.com popads.net propellerads.com exoclick.com juicyads.com
  trafficjunky.net adsterra.com revcontent.com mgid.com zedo.com adcolony.com applovin.com mopub.com inmobi.com smaato.net
  vungle.com chartboost.com ads-twitter.com analytics.twitter.com analytics.tiktok.com px.ads.linkedin.com clarity.ms
  bat.bing.com ads.yahoo.com analytics.yahoo.com ct.pinterest.com tr.snapchat.com pixel.facebook.com adtechus.com
  adbrite.com admob.com ad.gt zemanta.com rlcdn.com tapad.com agkn.com eyeota.com liadm.com id5-sync.com sitescout.com
  stackadapt.com nr-data.net hs-analytics.net`.split(/\s+/).filter(Boolean));
const hostCache = new Map();
function hostBlocked(host) {
  if (hostCache.has(host)) return hostCache.get(host);
  const parts = host.split('.');
  let r = false;
  for (let i = 0; i < parts.length - 1 && !r; i++) r = AD_HOSTS.has(parts.slice(i).join('.'));
  if (hostCache.size > 5000) hostCache.clear();
  hostCache.set(host, r);
  return r;
}
const YT_AD_PATHS = [/^\/pagead\//, /^\/api\/stats\/ads/, /^\/ptracking/];
function setupAdblock(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    if (!flags.adblock || d.resourceType === 'mainFrame') return cb({});
    let u;
    try { u = new URL(d.url); } catch { return cb({}); }
    const bad = hostBlocked(u.hostname) || (/(^|\.)youtube\.com$/.test(u.hostname) && YT_AD_PATHS.some((rx) => rx.test(u.pathname)));
    if (bad) blockedCount++;
    cb({ cancel: bad });
  });
}
ipcMain.handle('adblock-count', () => blockedCount);

/* ---------- built-in VPN (routes browser traffic through a server from the list, or your own) ---------- */
const vpnFile = () => path.join(app.getPath('userData'), 'vpn.json');
const serversCache = () => path.join(app.getPath('userData'), 'servers-cache.json');
// The list of servers is published in servers.json in the project's GitHub repository, so it can change without a new release.
const SERVERS_URL = 'https://raw.githubusercontent.com/Dexvior/Browsing-Web-Browser/main/servers.json';
const TOR = [
  { id: 'tor-browser', name: 'Tor (Tor Browser)', country: 'TOR', city: 'Needs Tor Browser to be open', server: 'socks5://127.0.0.1:9150', login: false },
  { id: 'tor-service', name: 'Tor (system service)', country: 'TOR', city: 'Needs the Tor service to be running', server: 'socks5://127.0.0.1:9050', login: false },
];
let vpn = { sel: 'auto', custom: '', creds: {} };          // creds[id] = { user, pass }, pass encrypted with the system's secure storage
let remoteServers = [], serversReady = Promise.resolve();
let curCreds = { user: '', pass: '' };
let vpnState = { state: 'off', message: '', label: '' };

function normServer(s) {
  s = (s || '').trim();
  if (!s) return '';
  if (!/^[a-z0-9]+:\/\//i.test(s)) s = 'http://' + s;
  return /^(socks5|socks4|http|https):\/\/[^\s/]+:\d{1,5}$/i.test(s) ? s : null;
}
const cleanServers = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 50).map((s) => ({
  id: String((s && (s.id || s.server)) || '').slice(0, 40), name: String((s && (s.name || s.server)) || '').slice(0, 40),
  country: String((s && s.country) || '').slice(0, 3).toUpperCase(), city: String((s && s.city) || '').slice(0, 40),
  server: normServer(s && s.server), login: !!(s && s.login),
})).filter((s) => s.id && s.server);
const allServers = () => [...remoteServers, ...TOR];
async function loadServers() {
  try { remoteServers = cleanServers(JSON.parse(fs.readFileSync(path.join(__dirname, 'servers.json'), 'utf8')).servers); } catch {}
  try { remoteServers = cleanServers(JSON.parse(fs.readFileSync(serversCache(), 'utf8'))); } catch {}
  try {
    const r = await net.fetch(SERVERS_URL, { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const list = cleanServers((await r.json()).servers); remoteServers = list; fs.writeFileSync(serversCache(), JSON.stringify(list)); }
  } catch {}
}
function loadVpn() { try { vpn = { ...vpn, ...JSON.parse(fs.readFileSync(vpnFile(), 'utf8')) }; } catch {} if (!vpn.creds) vpn.creds = {}; }
const saveVpn = () => { try { fs.writeFileSync(vpnFile(), JSON.stringify(vpn)); } catch {} };
const decryptPass = (enc) => { try { return enc ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : ''; } catch { return ''; } };
function setVpnState(state, message = '', label = '') { vpnState = { state, message, label }; send('vpn-status', vpnState); }
function webrtc(on) {
  webContents.getAllWebContents().forEach((w) => { try { w.setWebRTCIPHandlingPolicy(on ? 'disable_non_proxied_udp' : 'default'); } catch {} });
}
function pingOne(server, ms = 2500) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(server); } catch { return resolve(null); }
    const t0 = Date.now(), sock = tcp.connect({ host: u.hostname, port: +u.port || 80, timeout: ms });
    sock.once('connect', () => { sock.destroy(); resolve(Date.now() - t0); });
    sock.once('timeout', () => { sock.destroy(); resolve(null); });
    sock.once('error', () => resolve(null));
  });
}
async function effective() {
  await serversReady;
  if (vpn.sel === 'custom') { const s = normServer(vpn.custom); return s ? { id: 'custom', server: s, name: 'Custom server' } : { error: 'Enter your server first' }; }
  if (vpn.sel === 'auto') {
    if (!remoteServers.length) return { error: 'No servers are published yet. Pick Tor or add your own server.' };
    const res = await Promise.all(remoteServers.map(async (s) => ({ s, ms: await pingOne(s.server) })));
    const ok = res.filter((x) => x.ms != null).sort((a, b) => a.ms - b.ms);
    return ok.length ? { id: ok[0].s.id, server: ok[0].s.server, name: ok[0].s.name } : { error: 'No server responded' };
  }
  const s = allServers().find((x) => x.id === vpn.sel);
  return s ? { id: s.id, server: s.server, name: s.name } : { error: 'That server is no longer in the list' };
}
function probe(ses) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url: 'https://www.gstatic.com/generate_204', session: ses });
    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('timeout')); }, 9000);
    req.on('login', (info, cb) => { if (info.isProxy && curCreds.user) cb(curCreds.user, curCreds.pass); else cb(); });
    req.on('response', (res) => {
      clearTimeout(timer);
      res.on('data', () => {}); res.on('end', () => {});
      if (res.statusCode === 204 || res.statusCode === 200) resolve(); else reject(new Error('HTTP ' + res.statusCode));
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}
async function vpnConnect() {
  const ses = session.fromPartition(PARTITION);
  setVpnState('connecting');
  const eff = await effective();
  if (eff.error) { setVpnState('error', eff.error); return; }
  const c = vpn.creds[eff.id] || {};
  curCreds = { user: c.user || '', pass: decryptPass(c.pass) };
  await ses.setProxy({ proxyRules: eff.server, proxyBypassRules: '<local>' });
  await ses.closeAllConnections();
  try { await probe(ses); }
  catch { await vpnDisconnect(true); setVpnState('error', 'Could not reach the internet through ' + eff.name); return; }
  webrtc(true);
  setVpnState('on', '', eff.name);
}
async function vpnDisconnect(quiet) {
  const ses = session.fromPartition(PARTITION);
  await ses.setProxy({ mode: 'system' });
  await ses.closeAllConnections();
  webrtc(false);
  if (!quiet) setVpnState('off');
}
app.on('login', (event, _wc, _req, authInfo, callback) => {
  if (authInfo.isProxy && curCreds.user && vpnState.state !== 'off') { event.preventDefault(); callback(curCreds.user, curCreds.pass); }
});
ipcMain.handle('vpn-get', () => { const c = vpn.creds[vpn.sel] || {}; return { ...vpnState, sel: vpn.sel, custom: vpn.custom, servers: allServers(), user: c.user || '', hasPass: !!c.pass }; });
ipcMain.handle('vpn-refresh', async () => { serversReady = loadServers(); await serversReady; return allServers(); });
ipcMain.handle('vpn-ping', async () => { const out = {}; await Promise.all(allServers().map(async (s) => { out[s.id] = await pingOne(s.server); })); return out; });
ipcMain.handle('vpn-select', (_, o) => {
  if (!o) return { ok: false, error: 'Nothing selected' };
  const sel = String(o.sel || 'auto');
  if (sel !== 'auto' && sel !== 'custom' && !allServers().some((s) => s.id === sel)) return { ok: false, error: 'Unknown server' };
  if (sel === 'custom') {
    const n = normServer(o.custom);
    if (n === null) return { ok: false, error: 'Use a server like socks5://host:1080 or http://host:8080' };
    vpn.custom = n;
  }
  vpn.sel = sel;
  if (sel !== 'auto' && (typeof o.user === 'string' || typeof o.pass === 'string')) {
    const c = vpn.creds[sel] || (vpn.creds[sel] = { user: '', pass: '' });
    if (typeof o.user === 'string') c.user = o.user.trim();
    if (typeof o.pass === 'string') {
      if (o.pass === '') c.pass = '';
      else if (safeStorage.isEncryptionAvailable()) c.pass = safeStorage.encryptString(o.pass).toString('base64');
      else return { ok: false, error: 'Secure password storage is not available on this system' };
    }
  }
  saveVpn();
  return { ok: true };
});
ipcMain.handle('vpn-toggle', async (_, on) => { if (on) await vpnConnect(); else await vpnDisconnect(); return vpnState; });

/* ---------- tabs saved by the main process (survives any way of closing the window) ---------- */
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
function writeSession(d) {
  if (!flags.saveTabs || !d || !Array.isArray(d.urls)) return;
  const clean = {
    urls: d.urls.slice(0, 40).map((x) => ({ u: typeof x.u === 'string' ? x.u.slice(0, 2048) : '', p: !!x.p })),
    active: Number.isInteger(d.active) ? d.active : 0,
    closed: (Array.isArray(d.closed) ? d.closed : []).slice(-20).map((c) => ({ u: String(c.u || '').slice(0, 2048), t: String(c.t || '').slice(0, 200), ts: +c.ts || 0 })),
  };
  try { fs.writeFileSync(sessionFile(), JSON.stringify(clean)); } catch {}
}
ipcMain.on('session-save', (_, d) => writeSession(d));
ipcMain.on('session-save-sync', (e, d) => { writeSession(d); e.returnValue = true; });
ipcMain.on('session-clear', () => { try { fs.unlinkSync(sessionFile()); } catch {} });
ipcMain.handle('session-load', () => { try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch { return null; } });
ipcMain.handle('mem-usage', () => Math.round(app.getAppMetrics().reduce((a, m) => a + (m.memory ? m.memory.workingSetSize : 0), 0) / 1024));

/* ---------- home screen: stickers, wallpaper and fonts ---------- */
const homeFile = () => path.join(app.getPath('userData'), 'home.json');
let home = { stickers: [], wall: null, fonts: [], font: { kind: 'default', family: 'Urbanist' } };
function loadHome() { try { home = { ...home, ...JSON.parse(fs.readFileSync(homeFile(), 'utf8')) }; } catch {} }
const saveHome = () => { try { fs.writeFileSync(homeFile(), JSON.stringify(home)); } catch {} };
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const FONT_MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function saveUpload(sub, name, data, ok, maxMB) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!ok(ext)) return { error: 'That file type is not supported' };
  const buf = Buffer.from(data || []);
  if (!buf.length || buf.length > maxMB * 1048576) return { error: 'The file is too large (max ' + maxMB + ' MB)' };
  const dir = path.join(app.getPath('userData'), sub);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, rid() + ext);
  fs.writeFileSync(file, buf);
  return { file };
}
const rm = (f) => { try { fs.unlinkSync(f); } catch {} };
const dataUrl = (f) => { try { return 'data:' + (FONT_MIME[path.extname(f)] || 'font/ttf') + ';base64,' + fs.readFileSync(f).toString('base64'); } catch { return ''; } };
function fontView() {
  const f = home.font || {};
  if (f.kind === 'custom') { const c = home.fonts.find((x) => x.family === f.family); const d = c ? dataUrl(c.file) : ''; if (d) return { kind: 'custom', family: f.family, dataUrl: d }; }
  return f.kind === 'google' || f.kind === 'system' ? { kind: f.kind, family: f.family } : { kind: 'default', family: 'Urbanist' };
}
ipcMain.handle('home-get', () => ({
  stickers: home.stickers.map((s) => ({ id: s.id, url: pathToFileURL(s.file).href, x: s.x, y: s.y, w: s.w, r: s.r, z: s.z })),
  wall: home.wall ? { url: pathToFileURL(home.wall.file).href, dim: home.wall.dim } : null,
  font: fontView(),
}));
ipcMain.handle('sticker-add', (_, o) => {
  if (!o) return { ok: false, error: 'No file' };
  if (home.stickers.length >= 12) return { ok: false, error: 'You can have up to 12 stickers' };
  const r = saveUpload('stickers', o.name, o.data, (e) => IMG_EXT.has(e), 8);
  if (r.error) return { ok: false, error: r.error };
  const n = home.stickers.length;
  home.stickers.push({ id: rid(), file: r.file, x: 25 + ((n * 11) % 50), y: 30 + ((n * 17) % 40), w: 14, r: 0, z: n });
  saveHome();
  return { ok: true };
});
ipcMain.handle('sticker-remove', (_, id) => {
  const i = home.stickers.findIndex((s) => s.id === id);
  if (i >= 0) { rm(home.stickers[i].file); home.stickers.splice(i, 1); saveHome(); }
  return true;
});
ipcMain.handle('home-save-stickers', (_, list) => {
  if (!Array.isArray(list)) return false;
  const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  list.forEach((u) => {
    const s = u && home.stickers.find((x) => x.id === u.id);
    if (s) { s.x = num(u.x, 0, 100, s.x); s.y = num(u.y, 0, 100, s.y); s.w = num(u.w, 3, 80, s.w); s.r = num(u.r, -360, 360, s.r); s.z = num(u.z, 0, 999, s.z); }
  });
  saveHome();
  return true;
});
ipcMain.handle('wall-set', (_, o) => {
  if (!o) { if (home.wall) rm(home.wall.file); home.wall = null; saveHome(); return { ok: true }; }
  const r = saveUpload('wall', o.name, o.data, (e) => IMG_EXT.has(e), 15);
  if (r.error) return { ok: false, error: r.error };
  const dim = home.wall ? home.wall.dim : 35;
  if (home.wall) rm(home.wall.file);
  home.wall = { file: r.file, dim };
  saveHome();
  return { ok: true };
});
ipcMain.on('wall-dim', (_, v) => { if (home.wall && Number.isFinite(v)) { home.wall.dim = Math.min(80, Math.max(0, v)); saveHome(); } });
ipcMain.handle('font-add', (_, o) => {
  if (!o) return { ok: false, error: 'No file' };
  if (home.fonts.length >= 8) return { ok: false, error: 'You can upload up to 8 fonts' };
  const r = saveUpload('fonts', o.name, o.data, (e) => e in FONT_MIME, 5);
  if (r.error) return { ok: false, error: r.error };
  let family = String(o.name).replace(/\.[^.]+$/, '').replace(/[^\w \-]/g, '').trim().slice(0, 40) || 'Custom font';
  while (home.fonts.some((f) => f.family === family)) family += ' 2';
  home.fonts.push({ family, file: r.file });
  saveHome();
  return { ok: true, family };
});
ipcMain.handle('fonts-list', () => home.fonts.map((f) => f.family));
ipcMain.handle('font-data', (_, family) => { const f = home.fonts.find((x) => x.family === family); return f ? dataUrl(f.file) : ''; });
ipcMain.handle('font-remove', (_, family) => {
  const i = home.fonts.findIndex((x) => x.family === family);
  if (i >= 0) { rm(home.fonts[i].file); home.fonts.splice(i, 1); if (home.font.family === family) home.font = { kind: 'default', family: 'Urbanist' }; saveHome(); }
  return true;
});
ipcMain.on('font-set', (_, o) => {
  if (!o || typeof o.family !== 'string') return;
  const kind = ['default', 'google', 'system', 'custom'].includes(o.kind) ? o.kind : 'default';
  home.font = { kind, family: o.family.slice(0, 60) };
  saveHome();
});

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
  setupAdblock(ses);
  loadVpn();
  loadHome();
  serversReady = loadServers();
  createWindow();
  setupUpdates();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
