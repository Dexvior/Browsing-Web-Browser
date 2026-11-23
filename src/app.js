let SEARCH = 'https://duckduckgo.com/?q=';
let engineName = 'DuckDuckGo';
const INTERNAL = new URL('internal.html', location.href).href;
const NEWTAB_BASE = INTERNAL + '?type=newtab';
const newtabUrl = () => NEWTAB_BASE + '&s=' + encodeURIComponent(SEARCH) + '&e=' + encodeURIComponent(engineName);
const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs'), indicator = $('indicator'), stage = $('stage'), urlInput = $('url');
const backBtn = $('back'), fwdBtn = $('forward'), reloadBtn = $('reload'), progress = $('progress'), menu = $('menu');

let tabs = [], activeId = null, seq = 0;
const active = () => tabs.find((t) => t.id === activeId);

/* ---------- Smart URL / search detection ---------- */
function resolveInput(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?|file|about):/i.test(v)) return v;
  const hostLike = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#].*)?$/i;
  if (!/\s/.test(v) && hostLike.test(v)) return (/^(localhost|\d)/i.test(v) ? 'http://' : 'https://') + v;
  return SEARCH + encodeURIComponent(v);
}

/* ---------- Tabs ---------- */
function newTab(url = newtabUrl(), focusBar = url.startsWith(NEWTAB_BASE)) {
  const id = ++seq;
  const el = document.createElement('div');
  el.className = 'tab';
  el.innerHTML = '<span class="tab-title">New Tab</span><button class="tab-close" aria-label="Close tab">' + CLOSE_ICON + '</button>';
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:browsing');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', url);

  const t = { id, el, wv, title: 'New Tab', url, failed: null, loading: false };
  tabs.push(t);
  tabsEl.insertBefore(el, indicator);
  stage.appendChild(wv);

  el.addEventListener('click', () => activate(id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
  el.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });

  wv.addEventListener('did-start-loading', () => { t.loading = true; sync(); });
  wv.addEventListener('did-stop-loading', () => { t.loading = false; sync(); });
  wv.addEventListener('page-title-updated', (e) => { t.title = e.title; renderTitle(t); });
  wv.addEventListener('did-navigate', (e) => {
    t.url = e.url;
    if (!e.url.startsWith(INTERNAL)) t.failed = null;
    wv.classList.remove('fade'); void wv.offsetWidth; wv.classList.add('fade');
    sync();
  });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { t.url = e.url; sync(); } });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3 || e.validatedURL.startsWith(INTERNAL)) return;
    t.failed = e.validatedURL;
    const p = new URLSearchParams({ type: 'error', u: e.validatedURL, d: e.errorDescription });
    wv.loadURL(INTERNAL + '?' + p.toString()).catch(() => {});
  });

  activate(id);
  if (focusBar) { urlInput.focus(); }
  return t;
}

function activate(id) {
  activeId = id;
  tabs.forEach((t) => {
    t.el.classList.toggle('active', t.id === id);
    t.wv.classList.toggle('active', t.id === id);
  });
  sync();
  moveIndicator();
  const t = active();
  if (t && document.activeElement !== urlInput) { try { t.wv.focus(); } catch {} }
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (tabs.length === 1) { window.close(); return; }
  const [t] = tabs.splice(i, 1);
  if (id === activeId) activate(tabs[Math.min(i, tabs.length - 1)].id);
  t.el.classList.add('closing');
  setTimeout(() => { t.el.remove(); t.wv.remove(); moveIndicator(); }, 160);
}

function cycle(dir) {
  const i = tabs.findIndex((t) => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function renderTitle(t) { t.el.querySelector('.tab-title').textContent = t.title || 'New Tab'; }

function moveIndicator() {
  const t = active();
  if (!t) return;
  const d = document.getElementById('app').dataset.dock;
  if (d === 'left' || d === 'right') {
    indicator.style.width = '2px';
    indicator.style.height = t.el.offsetHeight + 'px';
    indicator.style.transform = 'translateY(' + t.el.offsetTop + 'px)';
  } else {
    indicator.style.height = '2px';
    indicator.style.width = t.el.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + t.el.offsetLeft + 'px)';
  }
}
new ResizeObserver(moveIndicator).observe(tabsEl);

/* ---------- Navigation ---------- */
function displayUrl(t) {
  if (t.failed) return t.failed;
  return t.url.startsWith(INTERNAL) ? '' : t.url;
}

function sync() {
  const t = active();
  if (!t) return;
  try { backBtn.disabled = !t.wv.canGoBack(); fwdBtn.disabled = !t.wv.canGoForward(); }
  catch { backBtn.disabled = true; fwdBtn.disabled = true; }
  if (document.activeElement !== urlInput) urlInput.value = displayUrl(t);
  progress.classList.toggle('on', t.loading);
  reloadBtn.classList.toggle('loading', t.loading);
  renderTitle(t);
}

function navigate(input) {
  const url = resolveInput(input);
  const t = active();
  if (!url || !t) return;
  try { t.wv.loadURL(url).catch(() => {}); } catch { t.wv.setAttribute('src', url); }
}

function reload() {
  const t = active();
  if (!t) return;
  if (t.failed) return navigate(t.failed);
  try { t.wv.reload(); } catch {}
}

const goBack = () => { const t = active(); try { if (t.wv.canGoBack()) t.wv.goBack(); } catch {} };
const goForward = () => { const t = active(); try { if (t.wv.canGoForward()) t.wv.goForward(); } catch {} };

backBtn.onclick = goBack;
fwdBtn.onclick = goForward;
reloadBtn.onclick = reload;
$('newTab').onclick = () => newTab();

urlInput.addEventListener('focus', () => urlInput.select());
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigate(urlInput.value); urlInput.blur(); }
  if (e.key === 'Escape') { urlInput.value = displayUrl(active()); urlInput.blur(); }
});
urlInput.addEventListener('blur', sync);

/* ---------- Theme ---------- */
function applyTheme(mode) { prefs.theme = mode; savePrefs(); applyAll(); }
$('theme').onclick = () => applyTheme(prefs.theme === 'dark' ? 'light' : 'dark');
$('themeSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => applyTheme(b.dataset.value)));
$('dockSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => applyDock(b.dataset.value)));

/* ---------- Menu ---------- */
const toggleMenu = (open) => menu.classList.toggle('open', open);
$('menuBtn').onclick = (e) => { e.stopPropagation(); toggleMenu(!menu.classList.contains('open')); };
menu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => toggleMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });
window.addEventListener('blur', () => toggleMenu(false));
$('mNewTab').onclick = () => { toggleMenu(false); newTab(); };
$('mClear').onclick = async () => { await window.browsing.clearData(); toggleMenu(false); reload(); };

/* ---------- Shortcuts from main process ---------- */
window.browsing.onShortcut((name) => {
  const actions = {
    'new-tab': () => newTab(),
    'close-tab': () => closeTab(activeId),
    reload,
    'focus-url': () => urlInput.focus(),
    'next-tab': () => cycle(1),
    'prev-tab': () => cycle(-1),
    back: goBack,
    forward: goForward,
    settings: () => openSettings(true),
  };
  if (actions[name]) actions[name]();
});
window.browsing.onOpenUrl((url) => newTab(url, false));

/* ---------- Tab bar docking ---------- */
const appEl = $('app'), overlay = $('dockOverlay'), grip = $('grip');
const DOCKS = ['top', 'bottom', 'left', 'right'];

function markSeg(seg, value) {
  const btns = [...seg.querySelectorAll('button')];
  seg.style.setProperty('--n', btns.length);
  btns.forEach((b, i) => {
    const on = b.dataset.value === value;
    b.classList.toggle('on', on);
    if (on) seg.style.setProperty('--i', i);
  });
}

function applyDock(d) {
  if (!DOCKS.includes(d)) d = 'top';
  appEl.dataset.dock = d;
  try { localStorage.setItem('dock', d); } catch {}
  markSeg($('dockSeg'), d);
  moveIndicator();
  setTimeout(moveIndicator, 60);
}

let dragging = false, startX = 0, startY = 0, zone = null;
function zoneAt(x, y) {
  const w = innerWidth, h = innerHeight;
  const d = { left: x / w, right: (w - x) / w, top: y / h, bottom: (h - y) / h };
  return Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
}
function onDrag(e) {
  if (!dragging) return;
  zone = zoneAt(e.clientX, e.clientY);
  overlay.querySelectorAll('.zone').forEach((z) => z.classList.toggle('hot', z.dataset.z === zone));
}
function endDrag(apply, e) {
  if (!dragging) return;
  dragging = false;
  overlay.classList.remove('on');
  document.body.classList.remove('dragging');
  const moved = e && Math.hypot(e.clientX - startX, e.clientY - startY) > 8;
  if (apply && moved && zone) applyDock(zone);
  zone = null;
}
grip.addEventListener('pointerdown', (e) => {
  dragging = true; startX = e.clientX; startY = e.clientY;
  grip.setPointerCapture(e.pointerId);
  overlay.classList.add('on');
  document.body.classList.add('dragging');
  toggleMenu(false);
  onDrag(e);
});
grip.addEventListener('pointermove', onDrag);
grip.addEventListener('pointerup', (e) => endDrag(true, e));
grip.addEventListener('pointercancel', () => endDrag(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(false); });

/* ---------- Settings ---------- */
const ENGINES = {
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
  google: ['Google', 'https://www.google.com/search?q='],
  bing: ['Bing', 'https://www.bing.com/search?q='],
  brave: ['Brave', 'https://search.brave.com/search?q='],
};
const SWATCHES = ['#0b3d91', '#5b21b6', '#0f766e', '#15803d', '#b91c1c', '#b45309'];
const DEFAULTS = { theme: 'dark', color: '#14213d', color2: '#6d28d9', style: 'solid', engine: 'duckduckgo', density: 'normal', motion: 'on' };
let prefs = { ...DEFAULTS };
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('prefs') || 'null');
    if (p) prefs = { ...DEFAULTS, ...p };
    else if (localStorage.getItem('theme') === 'light') prefs.theme = 'light';
  } catch {}
  if (!isHex(prefs.color)) prefs.color = DEFAULTS.color;
  if (!isHex(prefs.color2)) prefs.color2 = DEFAULTS.color2;
  if (!ENGINES[prefs.engine]) prefs.engine = 'duckduckgo';
}
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch {} };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mixHex = (a, b) => '#' + rgb(a).map((v, i) => Math.round((v + rgb(b)[i]) / 2).toString(16).padStart(2, '0')).join('');

function applyAppearance() {
  const r = document.documentElement, st = r.style;
  ['--bg', '--fg', '--muted', '--border', '--hover', '--press', '--chrome'].forEach((k) => st.removeProperty(k));
  let color, symbol, dark;
  if (prefs.theme === 'custom') {
    const grad = prefs.style === 'gradient';
    const avg = grad ? mixHex(prefs.color, prefs.color2) : prefs.color;
    dark = lum(avg) < 0.179;                       // pick white or black text for best contrast
    const fg = dark ? '#ffffff' : '#000000';
    const m = (n) => 'color-mix(in srgb, ' + fg + ' ' + n + '%, ' + prefs.color + ')';
    st.setProperty('--bg', prefs.color); st.setProperty('--fg', fg);
    st.setProperty('--muted', m(62)); st.setProperty('--border', m(22));
    st.setProperty('--hover', m(10)); st.setProperty('--press', m(16));
    st.setProperty('--chrome', grad ? 'linear-gradient(135deg, ' + prefs.color + ', ' + prefs.color2 + ')' : prefs.color);
    r.dataset.custom = '1'; color = avg; symbol = fg;
  } else {
    delete r.dataset.custom;
    dark = prefs.theme !== 'light'; color = dark ? '#000000' : '#ffffff'; symbol = dark ? '#ffffff' : '#000000';
  }
  r.dataset.theme = dark ? 'dark' : 'light';
  window.browsing.setChrome({ color, symbol, dark });
}

function applyPrefs() {
  const r = document.documentElement, [name, tpl] = ENGINES[prefs.engine];
  SEARCH = tpl; engineName = name;
  urlInput.placeholder = 'Search with ' + name + ' or enter an address';
  r.dataset.density = prefs.density; r.dataset.motion = prefs.motion;
  markSeg($('themeSeg'), prefs.theme); markSeg($('styleSeg'), prefs.style);
  markSeg($('engSeg'), prefs.engine); markSeg($('densSeg'), prefs.density);
  $('customBox').hidden = prefs.theme !== 'custom';
  $('row2').hidden = prefs.style !== 'gradient';
  $('c1').value = prefs.color; $('c2').value = prefs.color2;
  $('swMotion').setAttribute('aria-checked', String(prefs.motion === 'off'));
  document.querySelectorAll('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.c === prefs.color));
  $('preview').style.background = prefs.style === 'gradient' ? 'linear-gradient(135deg, ' + prefs.color + ', ' + prefs.color2 + ')' : prefs.color;
  moveIndicator();
}
function applyAll() { applyAppearance(); applyPrefs(); }
const change = (k, v) => { prefs[k] = v; savePrefs(); applyAll(); };

$('swatches').innerHTML = SWATCHES.map((c) => '<button data-c="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>').join('');
$('swatches').onclick = (e) => { const b = e.target.closest('button'); if (b) change('color', b.dataset.c); };
$('c1').oninput = (e) => change('color', e.target.value);
$('c2').oninput = (e) => change('color2', e.target.value);
document.querySelectorAll('.seg[data-pref]').forEach((seg) =>
  seg.querySelectorAll('button').forEach((b) => (b.onclick = () => change(seg.dataset.pref, b.dataset.value))));
$('swMotion').onclick = () => change('motion', prefs.motion === 'off' ? 'on' : 'off');
$('sClear').onclick = async () => { await window.browsing.clearData(); reload(); };
$('sReset').onclick = () => { prefs = { ...DEFAULTS }; savePrefs(); applyDock('top'); applyAll(); };

const sEl = $('settings');
function openSettings(open) {
  toggleMenu(false);
  sEl.classList.toggle('on', open);
  sEl.setAttribute('aria-hidden', String(!open));
  if (open) $('sClose').focus();
}
$('settingsBtn').onclick = (e) => { e.stopPropagation(); openSettings(true); };
$('mSettings').onclick = () => openSettings(true);
$('sClose').onclick = () => openSettings(false);
sEl.addEventListener('click', (e) => { if (e.target === sEl) openSettings(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });

/* ---------- Start ---------- */
loadPrefs();
applyAll();
let savedDock = 'top';
try { savedDock = localStorage.getItem('dock') || 'top'; } catch {}
applyDock(savedDock);
newTab();
