let SEARCH = 'https://duckduckgo.com/?q=';
let engineName = 'DuckDuckGo';
const INTERNAL = new URL('internal.html', location.href).href;
const NEWTAB_BASE = INTERNAL + '?type=newtab';
const newtabUrl = () => NEWTAB_BASE + '&s=' + encodeURIComponent(SEARCH) + '&e=' + encodeURIComponent(engineName);
const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs'), indicator = $('indicator'), stage = $('stage'), urlInput = $('url');
const lock = $('lock'), backBtn = $('back'), fwdBtn = $('forward'), reloadBtn = $('reload'), progress = $('progress'), menu = $('menu');

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
const isVertical = () => { const d = document.getElementById('app').dataset.dock; return d === 'left' || d === 'right'; };
let dragId = null;

function newTab(url = newtabUrl(), focusBar = url.startsWith(NEWTAB_BASE), opts = {}) {
  const id = ++seq;
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.innerHTML = '<span class="tab-ico"><i class="spin"></i><img alt=""></span><span class="tab-title">New Tab</span><button class="tab-close" aria-label="Close tab">' + CLOSE_ICON + '</button>';
  const img = el.querySelector('img');
  img.onerror = () => el.classList.remove('has-ico');
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:browsing');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', url);

  const t = { id, el, wv, title: 'New Tab', url, failed: null, loading: false, zoom: 0 };
  let at = tabs.length;
  if (opts.afterActive) { const i = tabs.findIndex((x) => x.id === activeId); if (i >= 0) at = i + 1; }
  tabs.splice(at, 0, t);
  tabsEl.insertBefore(el, tabs[at + 1] ? tabs[at + 1].el : indicator);
  stage.appendChild(wv);
  el.classList.add('entering');
  el.addEventListener('animationend', (e) => { if (e.target === el) el.classList.remove('entering'); });
  moveIndicator();

  el.addEventListener('click', () => activate(id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
  el.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  el.addEventListener('dragstart', (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); el.classList.add('dragging'); });
  el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); });
  el.addEventListener('dragover', (e) => {
    if (dragId == null || dragId === id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    moveTab(dragId, id, isVertical() ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2);
  });

  wv.addEventListener('did-start-loading', () => { t.loading = true; sync(); });
  wv.addEventListener('did-stop-loading', () => { t.loading = false; el.classList.remove('loading'); sync(); });
  wv.addEventListener('did-start-navigation', (e) => { if (e.isMainFrame && !e.isInPage) { el.classList.remove('has-ico'); el.classList.toggle('loading', !e.url.startsWith(INTERNAL)); } });
  wv.addEventListener('dom-ready', () => { if (t.zoom) { try { wv.setZoomLevel(t.zoom); } catch {} } });
  wv.addEventListener('page-title-updated', (e) => { t.title = e.title; renderTitle(t); retitle(t.url, e.title); });
  wv.addEventListener('page-favicon-updated', (e) => { const f = e.favicons && e.favicons[0]; if (f) { img.src = f; el.classList.add('has-ico'); } });
  wv.addEventListener('did-navigate', (e) => {
    t.url = e.url;
    logSearchFrom(e.url);
    if (!e.url.startsWith(INTERNAL)) { t.failed = null; visit(e.url); }
    wv.classList.remove('fade'); void wv.offsetWidth; wv.classList.add('fade');
    sync(); saveSession();
  });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { t.url = e.url; sync(); saveSession(); } });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3 || e.validatedURL.startsWith(INTERNAL)) return;
    t.failed = e.validatedURL;
    const p = new URLSearchParams({ type: 'error', u: e.validatedURL, d: e.errorDescription });
    wv.loadURL(INTERNAL + '?' + p.toString()).catch(() => {});
  });
  wv.addEventListener('found-in-page', (e) => {
    if (t.id === activeId && e.result.finalUpdate) findCnt.textContent = e.result.matches ? e.result.activeMatchOrdinal + ' / ' + e.result.matches : 'No results';
  });

  activate(id);
  if (focusBar) urlInput.focus();
  saveSession();
  return t;
}

function moveTab(from, to, after) {
  const a = tabs.findIndex((t) => t.id === from);
  if (a < 0 || !tabs.some((t) => t.id === to)) return;
  const [t] = tabs.splice(a, 1);
  const i = tabs.findIndex((x) => x.id === to) + (after ? 1 : 0);
  tabs.splice(i, 0, t);
  tabsEl.insertBefore(t.el, tabs[i + 1] ? tabs[i + 1].el : indicator);
  moveIndicator(); saveSession();
}

function activate(id) {
  activeId = id;
  tabs.forEach((t) => {
    t.el.classList.toggle('active', t.id === id);
    t.wv.classList.toggle('active', t.id === id);
  });
  sync();
  moveIndicator();
  saveSession();
  const t = active();
  if (t && document.activeElement !== urlInput) { try { t.wv.focus(); } catch {} }
}

const closed = [];
function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t0 = tabs[i];
  if (prefs.saveTabs && (t0.failed || !t0.url.startsWith(INTERNAL))) { closed.push(t0.failed || t0.url); if (closed.length > 15) closed.shift(); }
  if (tabs.length === 1) { window.close(); return; }
  const [t] = tabs.splice(i, 1);
  if (id === activeId) activate(tabs[Math.min(i, tabs.length - 1)].id);
  t.el.style.setProperty('--tw', t.el.querySelector('.tab-title').offsetWidth + 'px');
  t.el.classList.add('closing');
  moveIndicator();
  setTimeout(() => { t.el.remove(); t.wv.remove(); moveIndicator(); }, 230);
  saveSession();
}
function reopenTab() { const u = closed.pop(); if (u) newTab(u, false); }

function cycle(dir) {
  const i = tabs.findIndex((t) => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function renderTitle(t) { t.el.querySelector('.tab-title').textContent = t.title || 'New Tab'; }

let indP = 0, indS = 0, indRaf = 0, indLast = 0, indSnap = true, indKeep = 0;
function moveIndicator(snap) {
  if (snap === true) indSnap = true;
  indKeep = performance.now() + 400;            // keep following while tabs animate
  if (!indRaf) { indLast = performance.now(); indRaf = requestAnimationFrame(stepIndicator); }
}
function stepIndicator(now) {
  indRaf = 0;
  const t = active();
  if (!t) return;
  const v = document.getElementById('app').dataset.dock;
  const vert = v === 'left' || v === 'right';
  const tp = vert ? t.el.offsetTop : t.el.offsetLeft, ts = vert ? t.el.offsetHeight : t.el.offsetWidth;
  const k = indSnap ? 1 : 1 - Math.exp(-Math.min(64, now - indLast) / 55);
  indLast = now; indSnap = false;
  indP += (tp - indP) * k; indS += (ts - indS) * k;
  const done = Math.abs(tp - indP) < 0.4 && Math.abs(ts - indS) < 0.4;
  if (done && now > indKeep) { indP = tp; indS = ts; }
  if (vert) { indicator.style.width = '2px'; indicator.style.height = indS + 'px'; indicator.style.transform = 'translateY(' + indP + 'px)'; }
  else { indicator.style.height = '2px'; indicator.style.width = indS + 'px'; indicator.style.transform = 'translateX(' + indP + 'px)'; }
  if (!done || now <= indKeep) indRaf = requestAnimationFrame(stepIndicator);
}
new ResizeObserver(() => moveIndicator()).observe(tabsEl);

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
  const u = displayUrl(t);
  if (document.activeElement !== urlInput) urlInput.value = u;
  lock.dataset.s = !u ? '' : u.startsWith('https:') ? 'secure' : u.startsWith('http:') ? 'insecure' : '';
  const busy = t.loading && !t.url.startsWith(INTERNAL);
  progress.classList.toggle('on', busy);
  reloadBtn.classList.toggle('loading', busy);
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
urlInput.addEventListener('input', buildSugg);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugg.classList.contains('on')) return;
    e.preventDefault();
    si += e.key === 'ArrowDown' ? 1 : -1;
    if (si >= sg.length) si = -1;
    if (si < -1) si = sg.length - 1;
    renderSugg();
  } else if (e.key === 'Enter') {
    if (si >= 0 && sg[si]) pick(sg[si]);
    else { hideSugg(); navigate(urlInput.value); urlInput.blur(); }
  } else if (e.key === 'Escape') {
    hideSugg(); urlInput.value = displayUrl(active()); urlInput.blur();
  }
});
urlInput.addEventListener('blur', () => { hideSugg(); sync(); });

/* ---------- Theme ---------- */
function applyTheme(mode) { fx(() => { prefs.theme = mode; savePrefs(); applyAll(); }); }
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
    'reopen-tab': reopenTab,
    history: () => openHist(true),
    find: () => openFind(true),
    'zoom-in': () => zoom(1),
    'zoom-out': () => zoom(-1),
    'zoom-reset': () => zoom(0),
  };
  const m = /^tab-(\d)$/.exec(name);
  if (m) { const i = m[1] === '9' ? tabs.length - 1 : +m[1] - 1; if (tabs[i]) activate(tabs[i].id); return; }
  if (actions[name]) actions[name]();
});
window.browsing.onOpenUrl((url) => newTab(url, false, { afterActive: true }));

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
  moveIndicator(true);
  setTimeout(() => moveIndicator(true), 60);
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
const DEFAULTS = { theme: 'dark', color: '#14213d', color2: '#6d28d9', style: 'solid', engine: 'duckduckgo', density: 'normal', motion: 'on', startup: 'new', saveTabs: true, saveHist: true, saveDl: true, adblock: true, vpnAuto: false };
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
  markSeg($('engSeg'), prefs.engine); markSeg($('densSeg'), prefs.density); markSeg($('startSeg'), prefs.startup);
  $('customBox').hidden = prefs.theme !== 'custom';
  $('row2').hidden = prefs.style !== 'gradient';
  $('c1').value = prefs.color; $('c2').value = prefs.color2;
  $('swMotion').setAttribute('aria-checked', String(prefs.motion === 'off'));
  document.querySelectorAll('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.c === prefs.color));
  $('preview').style.background = prefs.style === 'gradient' ? 'linear-gradient(135deg, ' + prefs.color + ', ' + prefs.color2 + ')' : prefs.color;
  document.querySelectorAll('.sw[data-pref]').forEach((b) => b.setAttribute('aria-checked', String(!!prefs[b.dataset.pref])));
  window.browsing.setFlags({ adblock: prefs.adblock, saveDl: prefs.saveDl, vpnAuto: prefs.vpnAuto });
  moveIndicator();
}
function applyAll() { applyAppearance(); applyPrefs(); }
const change = (k, v) => { const go = () => { prefs[k] = v; savePrefs(); if (k === 'saveTabs' && !v) { closed.length = 0; try { localStorage.removeItem('session'); } catch {} } applyAll(); }; if (k === 'theme') fx(go); else go(); };

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
  if (open) { openHist(false); openSite(false); $('sClose').focus(); refreshExtras(); }
}
$('settingsBtn').onclick = (e) => { e.stopPropagation(); openSettings(true); };
$('mSettings').onclick = () => openSettings(true);
$('sClose').onclick = () => openSettings(false);
sEl.addEventListener('click', (e) => { if (e.target === sEl) openSettings(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });

/* ---------- Theme reveal (circle grows from where you clicked) ---------- */
let lastPt = { x: innerWidth - 80, y: 24 };
document.addEventListener('pointerdown', (e) => { lastPt = { x: e.clientX, y: e.clientY }; }, true);
function fx(fn) {
  if (!document.startViewTransition || prefs.motion === 'off') return fn();
  const { x, y } = lastPt;
  const tr = document.startViewTransition(fn);
  tr.ready.then(() => {
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.animate(
      { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}

/* ---------- History and address bar suggestions ---------- */
let hist = [];
try { hist = JSON.parse(localStorage.getItem('history') || '[]'); } catch {}
let histTimer = 0;
const saveHist = () => { clearTimeout(histTimer); histTimer = setTimeout(() => { try { localStorage.setItem('history', JSON.stringify(hist)); } catch {} }, 800); };
function visit(u) {
  if (!prefs.saveHist || !/^https?:/i.test(u)) return;
  logVisit(u);
  const h = hist.find((x) => x.u === u);
  if (h) { h.c++; h.d = Date.now(); hist.splice(hist.indexOf(h), 1); hist.unshift(h); }
  else { hist.unshift({ u, t: '', c: 1, d: Date.now() }); if (hist.length > 500) hist.pop(); }
  saveHist();
}
function retitle(u, title) {
  if (!prefs.saveHist || !title || title === u) return;
  const h = hist.find((x) => x.u === u);
  if (h) { h.t = title; saveHist(); }
  if (bh[0] && bh[0].u === u && !bh[0].t) { bh[0].t = title; saveBh(); }
}

const sugg = $('sugg');
let sg = [], si = -1;
function buildSugg() {
  const raw = urlInput.value.trim(), q = raw.toLowerCase(), t = active();
  if (!q || (t && urlInput.value === displayUrl(t))) return hideSugg();
  const hits = hist.map((h) => {
    const u = h.u.replace(/^https?:\/\/(www\.)?/, '').toLowerCase(), ti = h.t.toLowerCase();
    const s = u.startsWith(q) ? 4 : ti.startsWith(q) ? 3 : u.includes(q) ? 2 : ti.includes(q) ? 1 : 0;
    return { h, s: s ? s * 100 + Math.min(h.c, 20) : 0 };
  }).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 5);
  sg = [{ kind: 'q', u: raw }, ...hits.map((x) => ({ kind: 'h', u: x.h.u, t: x.h.t }))];
  si = -1;
  renderSugg();
}
function renderSugg() {
  sugg.textContent = '';
  sg.forEach((s, i) => {
    const row = document.createElement('div'), b = document.createElement('b'), sp = document.createElement('span');
    row.className = 'sg' + (i === si ? ' sel' : '');
    if (s.kind === 'q') { b.textContent = s.u; sp.textContent = 'Search with ' + engineName; }
    else { b.textContent = s.t || s.u.replace(/^https?:\/\//, ''); sp.textContent = s.u.replace(/^https?:\/\//, ''); }
    row.append(b, sp);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(s); });
    sugg.appendChild(row);
  });
  sugg.classList.add('on');
}
function hideSugg() { sugg.classList.remove('on'); si = -1; }
function pick(s) { hideSugg(); urlInput.blur(); navigate(s.u); }

/* ---------- Find in page ---------- */
const findEl = $('find'), findIn = $('findIn'), findCnt = $('findCnt');
function openFind(on) {
  findEl.classList.toggle('on', on);
  if (on) { toggleMenu(false); findIn.focus(); findIn.select(); return; }
  const t = active();
  try { t.wv.stopFindInPage('clearSelection'); t.wv.focus(); } catch {}
  findCnt.textContent = '';
}
function doFind(fwd, next) {
  const t = active(), q = findIn.value;
  try {
    if (q) t.wv.findInPage(q, { forward: fwd, findNext: next });
    else { t.wv.stopFindInPage('clearSelection'); findCnt.textContent = ''; }
  } catch {}
}
findIn.addEventListener('input', () => doFind(true, false));
findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFind(!e.shiftKey, true); if (e.key === 'Escape') openFind(false); });
$('fPrev').onclick = () => doFind(false, true);
$('fNext').onclick = () => doFind(true, true);
$('fClose').onclick = () => openFind(false);
$('mFind').onclick = () => openFind(true);

/* ---------- Zoom ---------- */
const zoomP = $('zoomP');
let zTimer = 0;
function zoom(dir) {
  const t = active();
  if (!t) return;
  t.zoom = dir === 0 ? 0 : Math.max(-3, Math.min(5, t.zoom + dir * 0.5));
  try { t.wv.setZoomLevel(t.zoom); } catch {}
  zoomP.textContent = Math.round(Math.pow(1.2, t.zoom) * 100) + '%';
  zoomP.classList.add('on');
  clearTimeout(zTimer);
  zTimer = setTimeout(() => zoomP.classList.remove('on'), 1200);
}

/* ---------- Toasts, downloads, updates ---------- */
const toasts = $('toasts');
function toast(msg, action, onAction, ttl) {
  const el = document.createElement('div'), s = document.createElement('span');
  el.className = 'toast'; s.textContent = msg; el.appendChild(s);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (action) { const b = document.createElement('button'); b.textContent = action; b.onclick = () => { onAction(); close(); }; el.appendChild(b); }
  toasts.appendChild(el);
  if (ttl !== 0) setTimeout(close, ttl || 6000);
}
let version = '', updMsg = '';
const verText = $('verText');
const showVer = () => { verText.textContent = 'Version ' + version + (updMsg ? ' - ' + updMsg : ''); };
window.browsing.getVersion().then((v) => { version = v; showVer(); });
window.browsing.onUpdate((u) => {
  if (u.state === 'downloading') updMsg = 'Downloading ' + u.version + '...';
  if (u.state === 'progress') updMsg = 'Downloading ' + u.percent + '%';
  if (u.state === 'error') updMsg = 'Update check failed';
  if (u.state === 'ready') { updMsg = u.version + ' is ready, restart to apply'; toast('Browsing ' + u.version + ' is ready', 'Restart', () => window.browsing.installUpdate(), 0); }
  showVer();
});
$('sUpd').onclick = async () => {
  updMsg = 'Checking...'; showVer();
  const r = await window.browsing.checkUpdates();
  updMsg = { available: 'Update found, downloading...', latest: 'You are up to date', dev: 'Updates work in the installed app', error: 'Could not check for updates' }[r] || '';
  showVer();
};
window.browsing.onSearchText((q) => newTab(SEARCH + encodeURIComponent(q), false, { afterActive: true }));

/* ---------- Session restore ---------- */
let sesTimer = 0;
function saveSession() {
  clearTimeout(sesTimer);
  sesTimer = setTimeout(() => {
    if (!prefs.saveTabs) { try { localStorage.removeItem('session'); } catch {} return; }
    const urls = tabs.map((t) => t.failed || (t.url.startsWith(INTERNAL) ? '' : t.url));
    try { localStorage.setItem('session', JSON.stringify({ urls, active: tabs.findIndex((t) => t.id === activeId) })); } catch {}
  }, 400);
}
function restoreSession() {
  let s = null;
  if (prefs.startup === 'restore' && prefs.saveTabs) { try { s = JSON.parse(localStorage.getItem('session') || 'null'); } catch {} }
  if (s && Array.isArray(s.urls) && s.urls.length) {
    s.urls.slice(0, 30).forEach((u) => newTab(typeof u === 'string' && u ? u : newtabUrl(), false));
    const a = tabs[s.active];
    if (a) activate(a.id);
  } else newTab();
}

/* ---------- Downloads: live list + saved history ---------- */
const dlBtn = $('dlBtn'), dlp = $('dlp'), dlList = $('dlList');
let dls = [], dlAuto = 0, dlHover = false;
const fmtB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
const pctOf = (d) => (d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : -1);
const FILE_TYPES = {
  image: 'png jpg jpeg gif webp svg bmp avif ico heic', video: 'mp4 mkv webm mov avi m4v', audio: 'mp3 wav flac ogg m4a aac',
  archive: 'zip rar 7z tar gz bz2 xz', document: 'pdf doc docx xls xlsx ppt pptx txt rtf csv epub md', app: 'exe msi apk dmg pkg deb appimage',
};
function typeOf(name) {
  const e = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  for (const k in FILE_TYPES) if (FILE_TYPES[k].split(' ').includes(e)) return k;
  return 'file';
}
const TYPE_LABEL = { image: 'Image', video: 'Video', audio: 'Audio', archive: 'Archive', document: 'Document', app: 'Program', file: 'File' };
const TYPE_ICON = {
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l5-5 4 4 2-2 3 3"/>',
  video: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M10.5 9.5v5l4-2.5z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  archive: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 5v6M10 9h4M10 13h4M10 16h4"/>',
  document: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/>',
  app: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16M7 7h.01"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
};
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
function srcHost(d) {
  for (const u of [d.url, d.page]) { try { const x = new URL(u); if (/^https?:$/.test(x.protocol)) return x.hostname; } catch {} }
  return 'unknown source';
}
function dlStatus(d) {
  if (d.state === 'completed') return 'Done';
  if (d.state === 'cancelled') return 'Canceled';
  if (d.state === 'interrupted') return 'Failed';
  const p = pctOf(d);
  const base = p >= 0 ? fmtB(d.received) + ' of ' + fmtB(d.total) + ' - ' + p + '%' : fmtB(d.received) + ' downloaded';
  return d.paused ? 'Paused - ' + base : base;
}
const DL_ICON = {
  cancel: '<path d="M6 6l12 12M18 6L6 18"/>', remove: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M9 5v14M15 5v14"/>', resume: '<path d="M8 5l11 7-11 7z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  show: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
function dlAct(act, id, label) {
  const b = document.createElement('button');
  b.className = 'icon-btn'; b.dataset.act = act; b.dataset.id = id; b.title = label; b.setAttribute('aria-label', label);
  b.innerHTML = '<svg viewBox="0 0 24 24">' + DL_ICON[act] + '</svg>';
  return b;
}
function renderDl() {
  const live = dls.filter((d) => d.state === 'progressing'), known = live.filter((d) => d.total > 0);
  dlBtn.classList.toggle('active', live.length > 0);
  dlBtn.classList.toggle('indet', live.length > 0 && known.length === 0);
  dlBtn.style.setProperty('--p', known.length ? Math.round(known.reduce((a, d) => a + pctOf(d), 0) / known.length) : 0);
  dlList.textContent = '';
  if (!dls.length) {
    const e = document.createElement('div'); e.className = 'dl-empty';
    e.textContent = prefs.saveDl ? 'No downloads yet' : 'Download history is off';
    dlList.appendChild(e); return;
  }
  dls.forEach((d) => {
    const type = typeOf(d.name);
    const row = document.createElement('div'), ico = document.createElement('div'), meta = document.createElement('div');
    row.className = 'dl-row'; ico.className = 'dl-ico'; meta.className = 'dl-meta'; row.title = d.url || d.name;
    ico.innerHTML = '<svg viewBox="0 0 24 24">' + TYPE_ICON[type] + '</svg>';
    const nm = document.createElement('b'), st = document.createElement('span'), sub = document.createElement('span');
    nm.textContent = d.name;
    st.textContent = TYPE_LABEL[type] + (d.state === 'progressing' ? ' - ' : (d.total || d.received) ? ' - ' + fmtB(d.total || d.received) + ' - ' : ' - ') + dlStatus(d);
    sub.className = 'dl-sub'; sub.textContent = when(d.ts) + ' - ' + srcHost(d);
    meta.append(nm, st, sub);
    if (d.state === 'progressing') {
      const bar = document.createElement('div'), i = document.createElement('i');
      bar.className = 'dl-bar' + (pctOf(d) < 0 ? ' indet' : ''); i.style.width = Math.max(pctOf(d), 0) + '%'; bar.appendChild(i); meta.appendChild(bar);
    }
    const acts = document.createElement('div'); acts.className = 'dl-acts';
    if (d.state === 'progressing') acts.append(dlAct(d.paused ? 'resume' : 'pause', d.id, d.paused ? 'Resume' : 'Pause'), dlAct('cancel', d.id, 'Cancel download'));
    else if (d.state === 'completed') acts.append(dlAct('open', d.id, 'Open file'), dlAct('show', d.id, 'Show in folder'), dlAct('remove', d.id, 'Remove from list'));
    else acts.append(dlAct('remove', d.id, 'Remove from list'));
    row.append(ico, meta, acts); dlList.appendChild(row);
  });
}
function openDl(on, auto) {
  clearTimeout(dlAuto);
  if (on) { toggleMenu(false); openSite(false); }
  dlp.classList.toggle('on', on);
  if (on && auto) dlAuto = setTimeout(() => { if (!dlHover) openDl(false); }, 6000);
}
function clearDlHistory() { dls = dls.filter((d) => d.state === 'progressing'); window.browsing.dlAct('clear', 0); renderDl(); }
dlList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = +b.dataset.id, act = b.dataset.act;
  if (act === 'remove') { dls = dls.filter((d) => d.id !== id); window.browsing.dlAct('forget', id); renderDl(); } else window.browsing.dlAct(act, id);
});
$('dlFolder').onclick = () => window.browsing.dlAct('folder', 0);
$('dlClear').onclick = clearDlHistory;
$('sDlClear').onclick = () => { clearDlHistory(); toast('Download history cleared'); };
dlBtn.onclick = (e) => { e.stopPropagation(); openDl(!dlp.classList.contains('on')); };
dlp.addEventListener('click', (e) => e.stopPropagation());
dlp.addEventListener('mouseenter', () => { dlHover = true; clearTimeout(dlAuto); });
dlp.addEventListener('mouseleave', () => { dlHover = false; });
document.addEventListener('click', () => openDl(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDl(false); });
window.browsing.onDl((d) => {
  let x = dls.find((i) => i.id === d.id);
  if (!x) { x = { id: d.id }; dls.unshift(x); }
  Object.assign(x, { name: d.name, total: d.total, received: d.received, paused: d.paused, ts: d.ts, url: d.url, page: d.page });
  x.state = d.type === 'done' ? d.state : d.state === 'interrupted' ? 'interrupted' : 'progressing';
  renderDl();
  if (d.type === 'start') { dlBtn.classList.remove('pop'); void dlBtn.offsetWidth; dlBtn.classList.add('pop'); openDl(true, true); }
  if (d.type === 'done' && dlp.classList.contains('on') && !dlHover) { clearTimeout(dlAuto); dlAuto = setTimeout(() => { if (!dlHover) openDl(false); }, 5000); }
});
window.browsing.dlHistory().then((list) => {
  const have = new Set(dls.map((d) => d.id));
  list.forEach((h) => { if (!have.has(h.id)) dls.push({ id: h.id, name: h.name, total: h.total, received: h.total, state: h.state, ts: h.ts, url: h.url, page: h.page }); });
  dls.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  renderDl();
});
window.browsing.onNotify((m) => toast(m));
renderDl();

/* ---------- Permission prompts ---------- */
const permEl = $('perm'), pTitle = $('pTitle'), pList = $('pList');
const PERM_TXT = {
  camera: ['Use your camera', 'M4 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM15 11l5-3v8l-5-3'],
  microphone: ['Use your microphone', 'M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3'],
  geolocation: ['Know your location', 'M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  notifications: ['Show notifications', 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0'],
  'clipboard-read': ['See text and images you copy', 'M9 4h6v3H9zM7 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1'],
  midi: ['Use your MIDI devices', 'M5 8h14M5 12h14M5 16h14M9 8v8M15 8v8'],
  midiSysex: ['Fully control your MIDI devices', 'M5 8h14M5 12h14M5 16h14M9 8v8M15 8v8'],
};
let permQ = [], permCur = null;
function nextPerm() {
  if (permCur || !permQ.length) return;
  permCur = permQ.shift();
  pTitle.textContent = permCur.host + ' wants to';
  pList.textContent = '';
  permCur.kinds.forEach((k) => {
    const [txt, d] = PERM_TXT[k] || [k, 'M12 12h.01'];
    const li = document.createElement('li'), sp = document.createElement('span');
    li.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; sp.textContent = txt; li.appendChild(sp); pList.appendChild(li);
  });
  permEl.classList.add('on');
}
function answerPerm(a) {
  if (!permCur) return;
  window.browsing.permAnswer(permCur.id, a);
  permCur = null; permEl.classList.remove('on');
  setTimeout(nextPerm, 250);
}
window.browsing.onPerm((r) => { permQ.push(r); nextPerm(); });
window.browsing.onPermCancel((id) => {
  permQ = permQ.filter((r) => r.id !== id);
  if (permCur && permCur.id === id) { permCur = null; permEl.classList.remove('on'); setTimeout(nextPerm, 250); }
});
$('pAllow').onclick = () => answerPerm('always');
$('pOnce').onclick = () => answerPerm('once');
$('pBlock').onclick = () => answerPerm('block');
$('pX').onclick = () => answerPerm('dismiss');
$('sPerm').onclick = () => { window.browsing.permReset(); toast('Site permissions reset'); };

/* ---------- Browsing and search history (kept only while "Save search and browsing history" is on) ---------- */
let bh = [], sh = [], bhTimer = 0;
try { bh = JSON.parse(localStorage.getItem('bh') || '[]'); sh = JSON.parse(localStorage.getItem('sh') || '[]'); } catch {}
function saveBh() {
  clearTimeout(bhTimer);
  bhTimer = setTimeout(() => { try { localStorage.setItem('bh', JSON.stringify(bh)); localStorage.setItem('sh', JSON.stringify(sh)); } catch {} }, 600);
}
function logVisit(u) {
  if (!prefs.saveHist) return;
  const now = Date.now();
  if (bh[0] && bh[0].u === u && now - bh[0].ts < 10000) return;
  bh.unshift({ u, t: '', ts: now });
  if (bh.length > 3000) bh.length = 3000;
  saveBh();
}
function logSearchFrom(url) {
  if (!prefs.saveHist) return;
  try {
    const x = new URL(url);
    for (const k in ENGINES) {
      const tpl = new URL(ENGINES[k][1]);
      if (x.hostname !== tpl.hostname || x.pathname !== tpl.pathname) continue;
      const q = x.searchParams.get('q'), now = Date.now();
      if (!q || (sh[0] && sh[0].q === q && now - sh[0].ts < 300000)) return;
      sh.unshift({ q, ts: now, e: ENGINES[k][0] });
      if (sh.length > 1000) sh.length = 1000;
      saveBh();
      return;
    }
  } catch {}
}
function clearHistory() {
  bh = []; sh = []; hist = [];
  clearTimeout(bhTimer); clearTimeout(histTimer);
  try { localStorage.removeItem('bh'); localStorage.removeItem('sh'); localStorage.removeItem('history'); } catch {}
}

/* ---------- History panel ---------- */
const hp = $('histPanel'), hList = $('hList'), hq = $('hq');
let hTab = 'pages', hArm = 0;
const dayLabel = (ts) => {
  const d = new Date(ts), n = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
function renderHist() {
  markSeg($('hTabs'), hTab);
  const q = hq.value.trim().toLowerCase();
  hList.textContent = '';
  const items = (hTab === 'pages' ? bh : sh).filter((x) => !q || (hTab === 'pages' ? x.u + ' ' + x.t : x.q).toLowerCase().includes(q)).slice(0, 300);
  if (!items.length) {
    const e = document.createElement('div'); e.className = 'h-empty';
    e.textContent = !prefs.saveHist && !(hTab === 'pages' ? bh : sh).length ? 'History is off' : 'Nothing here';
    hList.appendChild(e); return;
  }
  let day = '';
  items.forEach((x) => {
    const dl = dayLabel(x.ts);
    if (dl !== day) { day = dl; const h = document.createElement('div'); h.className = 'h-day'; h.textContent = dl; hList.appendChild(h); }
    const row = document.createElement('div'), t = document.createElement('div'), b = document.createElement('b'), sp = document.createElement('span'), tm = document.createElement('div');
    row.className = 'h-row'; t.className = 'h-t'; tm.className = 'h-time';
    if (hTab === 'pages') {
      let host = x.u; try { host = new URL(x.u).hostname; } catch {}
      b.textContent = x.t || host; sp.textContent = host; row.title = x.u;
    } else { b.textContent = x.q; sp.textContent = 'Searched with ' + (x.e || 'search'); }
    tm.textContent = new Date(x.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    t.append(b, sp);
    const rm = document.createElement('button'); rm.className = 'icon-btn'; rm.setAttribute('aria-label', 'Remove from history');
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    rm.onclick = (e) => { e.stopPropagation(); (hTab === 'pages' ? bh : sh).splice((hTab === 'pages' ? bh : sh).indexOf(x), 1); saveBh(); renderHist(); };
    row.onclick = () => { openHist(false); navigate(hTab === 'pages' ? x.u : x.q); };
    row.append(t, tm, rm); hList.appendChild(row);
  });
}
function openHist(on) {
  hp.classList.toggle('on', on);
  hp.setAttribute('aria-hidden', String(!on));
  if (on) { toggleMenu(false); openDl(false); openSite(false); sEl.classList.remove('on'); renderHist(); hq.focus(); }
}
$('hTabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { hTab = b.dataset.value; renderHist(); }));
hq.addEventListener('input', renderHist);
$('hClose').onclick = () => openHist(false);
hp.addEventListener('click', (e) => { if (e.target === hp) openHist(false); });
$('hClear').onclick = (e) => {
  const b = e.currentTarget;
  if (!hArm) { b.textContent = 'Click again to confirm'; hArm = setTimeout(() => { hArm = 0; b.textContent = 'Clear all'; }, 3000); return; }
  clearTimeout(hArm); hArm = 0; b.textContent = 'Clear all';
  clearHistory(); renderHist(); toast('History cleared');
};
$('mHistory').onclick = () => openHist(true);
$('sHistView').onclick = () => openHist(true);
$('sHistClear').onclick = () => { clearHistory(); toast('History cleared'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openHist(false); openSite(false); } });

/* ---------- Privacy toggles ---------- */
document.querySelectorAll('.sw[data-pref]').forEach((b) => (b.onclick = () => change(b.dataset.pref, !prefs[b.dataset.pref])));

/* ---------- Built-in VPN ---------- */
const vpnBtn = $('vpnBtn');
let vpnSt = { state: 'off', message: '', server: '' };
function renderVpn() {
  const st = vpnSt.state;
  vpnBtn.classList.toggle('on', st === 'on'); vpnBtn.classList.toggle('busy', st === 'connecting'); vpnBtn.classList.toggle('err', st === 'error');
  vpnBtn.setAttribute('aria-pressed', String(st === 'on'));
  vpnBtn.title = st === 'on' ? 'VPN on - ' + vpnSt.server + ' (click to disconnect)' : st === 'connecting' ? 'VPN connecting...' : st === 'error' ? 'VPN error - ' + vpnSt.message : 'VPN off - click to connect';
  $('vpnMsg').textContent = st === 'on' ? 'Connected through ' + vpnSt.server : st === 'connecting' ? 'Connecting...' : st === 'error' ? vpnSt.message : 'Off';
  $('vpnGo').textContent = st === 'on' ? 'Disconnect' : 'Connect';
}
function fillVpn(r) {
  $('vpnServer').value = r.server || ''; $('vpnUser').value = r.user || '';
  $('vpnPass').placeholder = r.hasPass ? 'Password saved (leave blank to keep)' : 'Password (optional)';
}
function refreshVpn() { return window.browsing.vpnGet().then((r) => { vpnSt = r; fillVpn(r); renderVpn(); }); }
async function vpnToggle() {
  if (vpnSt.state === 'connecting') return;
  if (vpnSt.state !== 'on' && !vpnSt.server) { openSettings(true); toast('Add a server to use the VPN'); setTimeout(() => $('vpnServer').focus(), 350); return; }
  vpnSt = { ...vpnSt, state: vpnSt.state === 'on' ? 'off' : 'connecting' }; renderVpn();
  vpnSt = await window.browsing.vpnToggle(vpnSt.state !== 'off'); renderVpn();
}
window.browsing.onVpn((st) => { vpnSt = { ...vpnSt, ...st }; renderVpn(); });
vpnBtn.onclick = vpnToggle;
$('vpnGo').onclick = vpnToggle;
$('vpnSave').onclick = async () => {
  const r = await window.browsing.vpnSave({ server: $('vpnServer').value, user: $('vpnUser').value, pass: $('vpnPass').value || null });
  if (!r.ok) { $('vpnMsg').textContent = r.error; return; }
  $('vpnPass').value = ''; toast('VPN settings saved'); refreshVpn();
};
function refreshExtras() {
  window.browsing.adCount().then((n) => { $('abCount').textContent = n.toLocaleString() + ' blocked this session'; });
  refreshVpn();
}
refreshVpn();

/* ---------- Site information and permissions ---------- */
const siteP = $('sitep');
const SP_LABEL = { camera: 'Camera', microphone: 'Microphone', geolocation: 'Location', notifications: 'Notifications', 'clipboard-read': 'Clipboard', midi: 'MIDI devices' };
let spOrigin = '';
async function openSite(on) {
  if (!on) { siteP.classList.remove('on'); return; }
  const t = active();
  let o;
  try { o = new URL(t && (t.failed || t.url)); } catch { return; }
  if (!/^https?:$/.test(o.protocol)) return;
  toggleMenu(false); openDl(false);
  spOrigin = o.origin;
  $('spHost').textContent = o.host;
  $('spConn').textContent = o.protocol === 'https:' ? 'Connection is secure' : 'Connection is not secure';
  const cur = await window.browsing.permList(spOrigin);
  const list = $('spList');
  list.textContent = '';
  Object.keys(SP_LABEL).forEach((k) => {
    const row = document.createElement('div'), lab = document.createElement('span'), seg = document.createElement('div');
    row.className = 'sp-row'; seg.className = 'seg';
    row.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24"><path d="' + PERM_TXT[k][1] + '"/></svg>');
    lab.textContent = SP_LABEL[k];
    [['ask', 'Ask'], ['allow', 'Allowed'], ['block', 'Blocked']].forEach(([v, text]) => {
      const b = document.createElement('button'); b.dataset.value = v; b.textContent = text;
      b.onclick = () => { window.browsing.permSet(spOrigin, k, v); markSeg(seg, v); };
      seg.appendChild(b);
    });
    row.append(lab, seg); list.appendChild(row);
    markSeg(seg, cur[k] || 'ask');
  });
  siteP.classList.add('on');
}
$('lock').onclick = (e) => { e.stopPropagation(); openSite(!siteP.classList.contains('on')); };
siteP.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => openSite(false));
$('spReset').onclick = () => { window.browsing.permForget(spOrigin); openSite(false); toast('Permissions reset for this site'); };

/* ---------- Start ---------- */
loadPrefs();
applyAll();
let savedDock = 'top';
try { savedDock = localStorage.getItem('dock') || 'top'; } catch {}
applyDock(savedDock);
restoreSession();
