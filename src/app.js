let SEARCH = 'https://duckduckgo.com/?q=';
let engineName = 'DuckDuckGo';
const INTERNAL = new URL('internal.html', location.href).href;
const NEWTAB_BASE = INTERNAL + '?type=newtab';
const newtabUrl = () => NEWTAB_BASE + '&s=' + encodeURIComponent(SEARCH) + '&e=' + encodeURIComponent(engineName);
const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs'), indicator = $('indicator'), stage = $('stage'), urlInput = $('url');
const lock = $('lock'), starBtn = $('starBtn'), backBtn = $('back'), fwdBtn = $('forward'), reloadBtn = $('reload'), progress = $('progress'), menu = $('menu');

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

function mountWebview(t, url) {
  const el = t.el, img = el.querySelector('img');
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:browsing');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', url);
  t.wv = wv; t.sleeping = false;
  stage.appendChild(wv);
  wv.classList.toggle('active', t.id === activeId);

  wv.addEventListener('did-start-loading', () => { t.loading = true; sync(); });
  wv.addEventListener('did-stop-loading', () => { t.loading = false; el.classList.remove('loading'); sync(); });
  wv.addEventListener('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isInPage) { el.classList.remove('has-ico'); el.classList.toggle('loading', !e.url.startsWith(INTERNAL)); }
  });
  wv.addEventListener('dom-ready', () => {
    if (t.zoom) { try { wv.setZoomLevel(t.zoom); } catch {} }
    if (t.muted) { try { wv.setAudioMuted(true); } catch {} }
  });
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
  wv.addEventListener('media-started-playing', () => { t.audible = true; el.classList.add('audible'); });
  wv.addEventListener('media-paused', () => { t.audible = false; el.classList.remove('audible'); });
  wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('fs'));
  wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('fs'));
  return wv;
}

function newTab(url = newtabUrl(), focusBar = url.startsWith(NEWTAB_BASE), opts = {}) {
  const id = ++seq;
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.innerHTML = '<span class="tab-ico"><i class="spin"></i><img alt=""></span><span class="tab-title">New Tab</span>' +
    '<button class="tab-aud" aria-label="Mute tab"><svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path class="w" d="M15.5 9a4 4 0 0 1 0 6"/><path class="x" d="M16 9.5l5 5M21 9.5l-5 5"/></svg></button>' +
    '<button class="tab-close" aria-label="Close tab">' + CLOSE_ICON + '</button>';
  el.querySelector('img').onerror = () => el.classList.remove('has-ico');

  const t = { id, el, wv: null, title: 'New Tab', url, failed: null, loading: false, zoom: 0, pinned: false, audible: false, muted: false, sleeping: false, lastActive: Date.now() };
  let at = tabs.length;
  if (opts.afterActive) { const i = tabs.findIndex((x) => x.id === activeId); if (i >= 0) at = i + 1; }
  if (opts.afterId) { const i = tabs.findIndex((x) => x.id === opts.afterId); if (i >= 0) at = i + 1; }
  tabs.splice(at, 0, t);
  tabsEl.insertBefore(el, tabs[at + 1] ? tabs[at + 1].el : indicator);
  el.classList.add('entering');
  el.addEventListener('animationend', (e) => { if (e.target === el) { el.classList.remove('entering'); el.style.animation = 'none'; } });
  moveIndicator();

  el.addEventListener('click', () => activate(id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY, tabMenu(t)); });
  el.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  el.querySelector('.tab-aud').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(t); });
  el.addEventListener('dragstart', (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); el.classList.add('dragging'); });
  el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); });
  el.addEventListener('dragover', (e) => {
    if (dragId == null || dragId === id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    moveTab(dragId, id, isVertical() ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2);
  });

  mountWebview(t, url);
  activate(id);
  if (focusBar) urlInput.focus();
  saveSession();
  return t;
}

/* smooth reorder: remember where every tab was, move them, then slide each one from its old spot (FLIP) */
function flip(fn) {
  const before = new Map(tabs.map((t) => [t, t.el.getBoundingClientRect()]));
  fn();
  if (prefs.motion === 'off') return;
  tabs.forEach((t) => {
    const a = before.get(t), b = t.el.getBoundingClientRect();
    if (!a) return;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    t.el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  });
}

function moveTab(from, to, after) {
  const a = tabs.findIndex((t) => t.id === from);
  if (a < 0 || !tabs.some((t) => t.id === to)) return;
  const cur = tabs[a];
  const without = tabs.filter((t) => t !== cur);
  const i = without.findIndex((x) => x.id === to) + (after ? 1 : 0);
  if (tabs.indexOf(cur) === i) return;
  flip(() => {
    tabs.splice(a, 1);
    tabs.splice(i, 0, cur);
    tabsEl.insertBefore(cur.el, tabs[i + 1] ? tabs[i + 1].el : indicator);
  });
  moveIndicator(); saveSession();
}

function activate(id) {
  activeId = id;
  const cur = tabs.find((t) => t.id === id);
  if (cur) { cur.lastActive = Date.now(); if (cur.sleeping) wakeTab(cur); }
  tabs.forEach((t) => {
    t.el.classList.toggle('active', t.id === id);
    if (t.wv) t.wv.classList.toggle('active', t.id === id);
  });
  if (cur && cur.wv) { cur.wv.classList.remove('swap'); void cur.wv.offsetWidth; cur.wv.classList.add('swap'); }
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
  if (prefs.saveTabs && (t0.failed || !t0.url.startsWith(INTERNAL))) { closed.push({ u: t0.failed || (t0.sleeping ? t0.sleepUrl : t0.url), t: t0.title, ts: Date.now() }); if (closed.length > 20) closed.shift(); }
  if (tabs.length === 1) { saveSession(true); window.close(); return; }
  const [t] = tabs.splice(i, 1);
  if (id === activeId) activate(tabs[Math.min(i, tabs.length - 1)].id);
  t.el.style.setProperty('--tw', t.el.querySelector('.tab-title').offsetWidth + 'px');
  t.el.classList.add('closing');
  moveIndicator();
  setTimeout(() => { t.el.remove(); if (t.wv) t.wv.remove(); moveIndicator(); }, 230);
  saveSession();
}
function reopenTab() { const c = closed.pop(); if (c) newTab(c.u, true); saveSession(); }

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
  updateStar();
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
    bookmark: toggleBookmark,
    privacy: () => openPriv(true),
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
const DEFAULTS = { theme: 'dark', color: '#14213d', color2: '#6d28d9', style: 'solid', engine: 'duckduckgo', density: 'normal', motion: 'full', startup: 'restore', saveTabs: true, saveHist: true, saveDl: true, adblock: true, vpnAuto: false, sleep: '15', font: 'Urbanist', v: 2 };
let prefs = { ...DEFAULTS };
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('prefs') || 'null');
    if (p) { prefs = { ...DEFAULTS, ...p }; if ((p.v || 1) < 2) { prefs.startup = 'restore'; prefs.v = 2; } }
    else if (localStorage.getItem('theme') === 'light') prefs.theme = 'light';
  } catch {}
  if (prefs.motion === 'on') prefs.motion = 'full';
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
  markSeg($('engSeg'), prefs.engine); markSeg($('densSeg'), prefs.density); markSeg($('startSeg'), prefs.startup); markSeg($('motionSeg'), prefs.motion); markSeg($('sleepSeg'), String(prefs.sleep));
  $('customBox').hidden = prefs.theme !== 'custom';
  $('row2').hidden = prefs.style !== 'gradient';
  $('c1').value = prefs.color; $('c2').value = prefs.color2;
  document.querySelectorAll('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.c === prefs.color));
  $('preview').style.background = prefs.style === 'gradient' ? 'linear-gradient(135deg, ' + prefs.color + ', ' + prefs.color2 + ')' : prefs.color;
  document.querySelectorAll('.sw[data-pref]').forEach((b) => b.setAttribute('aria-checked', String(!!prefs[b.dataset.pref])));
  window.browsing.setFlags({ adblock: prefs.adblock, saveDl: prefs.saveDl, vpnAuto: prefs.vpnAuto, saveTabs: prefs.saveTabs });
  renderFonts(); applyFont();
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
$('sClear').onclick = async () => { await window.browsing.clearData(); reload(); };
$('sReset').onclick = () => { prefs = { ...DEFAULTS }; savePrefs(); applyDock('top'); applyAll(); };

const sEl = $('settings');
function openSettings(open) {
  toggleMenu(false);
  sEl.classList.toggle('on', open);
  sEl.setAttribute('aria-hidden', String(!open));
  if (open) { openHist(false); openSite(false); openPriv(false); $('sClose').focus(); refreshHome(); startMem(); } else stopMem();
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
  if (!document.startViewTransition || prefs.motion !== 'full') return fn();
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

/* ---------- Session: tabs are saved by the main process so they survive any way of closing ---------- */
let sesTimer = 0;
function sessionData() {
  return {
    urls: tabs.slice(0, 40).map((t) => { const u = t.failed || (t.sleeping ? t.sleepUrl : t.url) || ''; return { u: u.startsWith(INTERNAL) ? '' : u, p: !!t.pinned }; }),
    active: tabs.findIndex((t) => t.id === activeId),
    closed: closed.slice(-20),
  };
}
function saveSession(now) {
  clearTimeout(sesTimer);
  const run = () => { if (!prefs.saveTabs) window.browsing.sessionClear(); else window.browsing.sessionSave(sessionData()); };
  if (now) run(); else sesTimer = setTimeout(run, 300);
}
window.addEventListener('beforeunload', () => { if (prefs.saveTabs && tabs.length) window.browsing.sessionSaveSync(sessionData()); });
async function restoreSession() {
  let s = null;
  if (prefs.saveTabs) { try { s = await window.browsing.sessionLoad(); } catch {} }
  if (s && Array.isArray(s.closed)) s.closed.forEach((c) => closed.push(c));
  if (prefs.startup === 'restore' && s && Array.isArray(s.urls) && s.urls.length) {
    s.urls.slice(0, 40).forEach((x) => { const t = newTab(x.u || newtabUrl(), false); if (x.p) setPinned(t, true); });
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
function histSource() { return hTab === 'pages' ? bh : hTab === 'searches' ? sh : hTab === 'closed' ? closed.slice().reverse() : bm; }
function renderHist() {
  markSeg($('hTabs'), hTab);
  const q = hq.value.trim().toLowerCase();
  hList.textContent = '';
  const text = (x) => (hTab === 'searches' ? x.q : (x.u || '') + ' ' + (x.t || ''));
  const items = histSource().filter((x) => !q || text(x).toLowerCase().includes(q)).slice(0, 300);
  if (!items.length) {
    const e = document.createElement('div'); e.className = 'h-empty';
    e.textContent = hTab === 'bookmarks' ? 'No bookmarks yet. Press Ctrl+D on a page.' : hTab === 'closed' ? 'No recently closed tabs' : !prefs.saveHist ? 'History is off' : 'Nothing here';
    hList.appendChild(e); return;
  }
  let day = '';
  items.forEach((x) => {
    const dl = x.ts ? dayLabel(x.ts) : 'Earlier';
    if (dl !== day) { day = dl; const h = document.createElement('div'); h.className = 'h-day'; h.textContent = dl; hList.appendChild(h); }
    const row = document.createElement('div'), t = document.createElement('div'), b = document.createElement('b'), sp = document.createElement('span'), tm = document.createElement('div');
    row.className = 'h-row'; t.className = 'h-t'; tm.className = 'h-time';
    if (hTab === 'searches') { b.textContent = x.q; sp.textContent = 'Searched with ' + (x.e || 'search'); }
    else { let host = x.u; try { host = new URL(x.u).hostname; } catch {} b.textContent = x.t || host; sp.textContent = host; row.title = x.u; }
    tm.textContent = x.ts ? new Date(x.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
    t.append(b, sp);
    const rm = document.createElement('button'); rm.className = 'icon-btn'; rm.setAttribute('aria-label', 'Remove');
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    rm.onclick = (e) => {
      e.stopPropagation();
      const arr = hTab === 'pages' ? bh : hTab === 'searches' ? sh : hTab === 'closed' ? closed : bm;
      arr.splice(arr.indexOf(x), 1);
      if (hTab === 'bookmarks') saveBm(); else if (hTab === 'closed') saveSession(); else saveBh();
      renderHist(); updateStar();
    };
    row.onclick = () => {
      openHist(false);
      if (hTab === 'searches') navigate(x.q);
      else if (hTab === 'closed') { closed.splice(closed.indexOf(x), 1); newTab(x.u, true); saveSession(); }
      else navigate(x.u);
    };
    row.append(t, tm, rm); hList.appendChild(row);
  });
}
function openHist(on) {
  hp.classList.toggle('on', on);
  hp.setAttribute('aria-hidden', String(!on));
  if (on) { toggleMenu(false); openDl(false); openSite(false); privP.classList.remove('on'); sEl.classList.remove('on'); renderHist(); hq.focus(); }
}
$('hTabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { hTab = b.dataset.value; renderHist(); }));
hq.addEventListener('input', renderHist);
$('hClose').onclick = () => openHist(false);
hp.addEventListener('click', (e) => { if (e.target === hp) openHist(false); });
$('hClear').onclick = (e) => {
  const b = e.currentTarget;
  if (!hArm) { b.textContent = 'Click again to confirm'; hArm = setTimeout(() => { hArm = 0; b.textContent = 'Clear all'; }, 3000); return; }
  clearTimeout(hArm); hArm = 0; b.textContent = 'Clear all';
  clearTab(); renderHist(); toast('Cleared');
};
$('mHistory').onclick = () => openHist(true);
$('sHistView').onclick = () => openHist(true);
$('sHistClear').onclick = () => { clearHistory(); toast('History cleared'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openHist(false); openSite(false); openPriv(false); hideCtx(); } });

/* ---------- Privacy toggles ---------- */
document.querySelectorAll('.sw[data-pref]').forEach((b) => (b.onclick = () => change(b.dataset.pref, !prefs[b.dataset.pref])));

/* ---------- Privacy and VPN panel ---------- */
const vpnBtn = $('vpnBtn'), privP = $('privPanel'), vpnSw = $('vpnSw');
let vpnSt = { state: 'off', message: '', label: '' }, vpnPings = {};
let vpnInfo = { sel: 'auto', custom: '', servers: [], user: '', hasPass: false };
function renderVpn() {
  const st = vpnSt.state;
  vpnBtn.classList.toggle('on', st === 'on'); vpnBtn.classList.toggle('busy', st === 'connecting'); vpnBtn.classList.toggle('err', st === 'error');
  vpnBtn.setAttribute('aria-pressed', String(st === 'on'));
  vpnBtn.title = st === 'on' ? 'VPN on - ' + vpnSt.label + ' (click to disconnect, right-click for options)' : st === 'connecting' ? 'VPN connecting...' : st === 'error' ? 'VPN error - ' + vpnSt.message : 'VPN off - click to connect (right-click for options)';
  vpnSw.setAttribute('aria-checked', String(st === 'on'));
  $('vpnTitle').textContent = st === 'on' ? 'VPN is on' : st === 'connecting' ? 'Connecting...' : 'VPN is off';
  $('vpnMsg').textContent = st === 'on' ? 'Connected through ' + vpnSt.label : st === 'error' ? vpnSt.message : st === 'connecting' ? 'Please wait' : 'Your traffic is not routed through a VPN';
}
function renderServers() {
  const box = $('vpnList'), servers = vpnInfo.servers || [];
  box.textContent = '';
  const rows = [{ id: 'auto', cc: 'AUTO', name: 'Auto (fastest)', sub: 'Connects to the quickest available server' },
    ...servers.map((s) => ({ id: s.id, cc: s.country || '--', name: s.name, sub: s.city || s.server })),
    { id: 'custom', cc: '+', name: 'Custom server', sub: 'Use your own SOCKS5 or HTTP proxy' }];
  rows.forEach((r) => {
    const b = document.createElement('button'), rad = document.createElement('span'), cc = document.createElement('span');
    const vt = document.createElement('span'), nm = document.createElement('b'), sb = document.createElement('span'), ms = document.createElement('span');
    b.className = 'vitem' + (vpnInfo.sel === r.id ? ' on' : ''); rad.className = 'rad'; cc.className = 'cc'; vt.className = 'vt'; ms.className = 'ms';
    cc.textContent = r.cc; nm.textContent = r.name; sb.textContent = r.sub;
    if (r.id !== 'auto' && r.id !== 'custom' && r.id in vpnPings) ms.textContent = vpnPings[r.id] == null ? 'Offline' : vpnPings[r.id] + ' ms';
    vt.append(nm, sb); b.append(rad, cc, vt, ms);
    b.onclick = () => selectServer(r.id);
    box.appendChild(b);
  });
  if (!servers.some((s) => !s.id.startsWith('tor-'))) {
    const n = document.createElement('div'); n.className = 'vnote';
    n.textContent = 'No servers have been published yet. The Tor entries work when Tor is running on this PC. You can also use your own server.';
    box.appendChild(n);
  }
  const sel = servers.find((s) => s.id === vpnInfo.sel);
  $('vpnCreds').hidden = !(vpnInfo.sel === 'custom' || (sel && sel.login));
  $('vpnCustom').hidden = vpnInfo.sel !== 'custom';
}
function refreshVpn() {
  return window.browsing.vpnGet().then((r) => {
    vpnInfo = r; vpnSt = { state: r.state, message: r.message, label: r.label };
    $('vpnCustom').value = r.custom || ''; $('vpnUser').value = r.user || '';
    $('vpnPass').placeholder = r.hasPass ? 'Password saved (leave blank to keep)' : 'Password';
    renderServers(); renderVpn();
  });
}
async function selectServer(id) {
  vpnInfo.sel = id; renderServers();
  await window.browsing.vpnSelect({ sel: id, custom: $('vpnCustom').value });
  refreshVpn();
}
const vpnUsable = () => (vpnInfo.sel === 'custom' ? !!vpnInfo.custom : vpnInfo.sel === 'auto' ? (vpnInfo.servers || []).some((s) => !s.id.startsWith('tor-')) : true);
async function vpnToggle() {
  if (vpnSt.state === 'connecting') return;
  const on = vpnSt.state !== 'on';
  vpnSt = { ...vpnSt, state: on ? 'connecting' : 'off' }; renderVpn();
  vpnSt = await window.browsing.vpnToggle(on); renderVpn();
}
function openPriv(on) {
  privP.classList.toggle('on', on);
  privP.setAttribute('aria-hidden', String(!on));
  if (!on) return;
  toggleMenu(false); openDl(false); openSite(false); openHist(false); sEl.classList.remove('on'); stopMem();
  refreshVpn();
  window.browsing.adCount().then((n) => { $('abCount').textContent = n.toLocaleString() + ' blocked this session'; });
  window.browsing.vpnRefresh().then((l) => { vpnInfo.servers = l; renderServers(); return window.browsing.vpnPing(); }).then((p) => { vpnPings = p; renderServers(); }).catch(() => {});
}
window.browsing.onVpn((st) => { vpnSt = st; renderVpn(); });
vpnBtn.onclick = () => { if (vpnSt.state !== 'on' && !vpnUsable()) openPriv(true); else vpnToggle(); };
vpnBtn.oncontextmenu = (e) => { e.preventDefault(); openPriv(true); };
vpnSw.onclick = vpnToggle;
$('vpnSave').onclick = async () => {
  const r = await window.browsing.vpnSelect({ sel: vpnInfo.sel, custom: $('vpnCustom').value, user: $('vpnUser').value, pass: $('vpnPass').value || null });
  if (!r.ok) { toast(r.error); return; }
  $('vpnPass').value = ''; toast('Saved'); refreshVpn();
};
$('pvClose').onclick = () => openPriv(false);
privP.addEventListener('click', (e) => { if (e.target === privP) openPriv(false); });
$('mPriv').onclick = () => openPriv(true);
$('sOpenPriv').onclick = () => { openSettings(false); openPriv(true); };
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

/* ---------- Bookmarks ---------- */
let bm = [];
try { bm = JSON.parse(localStorage.getItem('bm') || '[]'); } catch {}
const saveBm = () => { try { localStorage.setItem('bm', JSON.stringify(bm.slice(0, 500))); } catch {} };
const curUrl = () => { const t = active(); return t ? t.failed || t.url : ''; };
function updateStar() {
  const u = curUrl(), ok = /^https?:/.test(u);
  starBtn.hidden = !ok;
  starBtn.classList.toggle('on', ok && bm.some((b) => b.u === u));
}
function toggleBookmark() {
  const t = active(), u = curUrl();
  if (!t || !/^https?:/.test(u)) return;
  const i = bm.findIndex((b) => b.u === u);
  if (i >= 0) { bm.splice(i, 1); toast('Bookmark removed'); } else { bm.unshift({ u, t: t.title, ts: Date.now() }); toast('Bookmarked'); }
  saveBm(); updateStar();
}
starBtn.onclick = toggleBookmark;
$('mBookmark').onclick = () => { toggleMenu(false); toggleBookmark(); };
function clearTab() {
  if (hTab === 'closed') { closed.length = 0; saveSession(); }
  else if (hTab === 'bookmarks') { bm = []; saveBm(); updateStar(); }
  else clearHistory();
}

/* ---------- Tab menu, mute, pin, sleep ---------- */
const ctxEl = $('ctx');
function showCtx(x, y, items) {
  ctxEl.textContent = '';
  items.forEach((it) => {
    if (it === '-') { const d = document.createElement('div'); d.className = 'sep'; ctxEl.appendChild(d); return; }
    const b = document.createElement('button');
    b.className = 'menu-item'; b.textContent = it.label; b.disabled = !!it.off;
    b.onclick = () => { hideCtx(); it.run(); };
    ctxEl.appendChild(b);
  });
  ctxEl.style.left = '0px'; ctxEl.style.top = '0px';
  const w = ctxEl.offsetWidth, h = ctxEl.offsetHeight;
  ctxEl.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
  ctxEl.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
  ctxEl.classList.add('on');
}
function hideCtx() { ctxEl.classList.remove('on'); }
document.addEventListener('click', hideCtx);
window.addEventListener('blur', hideCtx);
function tabMenu(t) {
  const others = tabs.filter((x) => x !== t), idx = tabs.indexOf(t);
  return [
    { label: 'Reload', run: () => { activate(t.id); reload(); } },
    { label: 'Duplicate', run: () => newTab(t.failed || (t.sleeping ? t.sleepUrl : t.url), false, { afterId: t.id }) },
    { label: t.pinned ? 'Unpin tab' : 'Pin tab', run: () => setPinned(t, !t.pinned) },
    { label: t.muted ? 'Unmute site' : 'Mute site', off: !(t.audible || t.muted), run: () => toggleMute(t) },
    '-',
    { label: 'Close', run: () => closeTab(t.id) },
    { label: 'Close other tabs', off: !others.length, run: () => { others.forEach((x) => closeTab(x.id)); activate(t.id); } },
    { label: 'Close tabs to the right', off: idx >= tabs.length - 1, run: () => { tabs.slice(idx + 1).forEach((x) => closeTab(x.id)); activate(t.id); } },
    '-',
    { label: 'Reopen closed tab', off: !closed.length, run: reopenTab },
  ];
}
function toggleMute(t) {
  t.muted = !t.muted;
  if (t.wv) { try { t.wv.setAudioMuted(t.muted); } catch {} }
  t.el.classList.toggle('muted', t.muted);
}
function setPinned(t, on) {
  flip(() => {
    t.pinned = on; t.el.classList.toggle('pinned', on);
    tabs.splice(tabs.indexOf(t), 1);
    tabs.splice(tabs.filter((x) => x.pinned).length, 0, t);
    tabs.forEach((x) => tabsEl.insertBefore(x.el, indicator));
  });
  moveIndicator(); saveSession();
}
function sleepTab(t) {
  if (!t.wv) return;
  t.sleepUrl = t.failed || t.url;
  try { t.wv.remove(); } catch {}
  t.wv = null; t.sleeping = true; t.audible = false; t.loading = false;
  t.el.classList.remove('audible', 'loading'); t.el.classList.add('sleeping');
}
function wakeTab(t) { t.el.classList.remove('sleeping'); mountWebview(t, t.sleepUrl); }
setInterval(() => {
  const mins = +prefs.sleep;
  if (!mins) return;
  const now = Date.now();
  tabs.forEach((t) => { if (t.id !== activeId && t.wv && !t.audible && !t.loading && !t.url.startsWith(INTERNAL) && now - t.lastActive > mins * 60000) sleepTab(t); });
}, 30000);

/* ---------- Memory readout ---------- */
let memTimer = 0;
async function updMem() {
  try {
    const mb = await window.browsing.memUsage(), n = tabs.filter((t) => t.sleeping).length;
    $('memText').textContent = 'Browsing is using ' + mb.toLocaleString() + ' MB' + (n ? ' - ' + n + ' tab' + (n > 1 ? 's' : '') + ' sleeping' : '');
  } catch {}
}
function startMem() { updMem(); clearInterval(memTimer); memTimer = setInterval(updMem, 3000); }
function stopMem() { clearInterval(memTimer); memTimer = 0; }

/* ---------- Home screen: stickers, wallpaper, fonts ---------- */
const readFile = async (f) => ({ name: f.name, data: await f.arrayBuffer() });
async function refreshHome() {
  const h = await window.browsing.homeGet();
  const list = $('stkList');
  list.textContent = '';
  h.stickers.forEach((s) => {
    const d = document.createElement('div'), im = document.createElement('img'), x = document.createElement('button');
    d.className = 'stk-th'; im.src = s.url; im.alt = '';
    x.className = 'icon-btn'; x.setAttribute('aria-label', 'Remove sticker'); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.onclick = async () => { await window.browsing.stickerRemove(s.id); refreshHome(); };
    d.append(im, x); list.appendChild(d);
  });
  $('wallDim').value = h.wall ? h.wall.dim : 35; $('wallDim').disabled = !h.wall; $('wallRemove').hidden = !h.wall;
}
$('stkAdd').onclick = () => $('stkFile').click();
$('stkFile').onchange = async (e) => {
  for (const f of e.target.files) { const r = await window.browsing.stickerAdd(await readFile(f)); if (!r.ok) { toast(r.error); break; } }
  e.target.value = ''; refreshHome();
};
$('stkArrange').onclick = () => { openSettings(false); newTab(newtabUrl() + '&edit=1', false, { afterActive: true }); };
$('wallAdd').onclick = () => $('wallFile').click();
$('wallFile').onchange = async (e) => {
  const f = e.target.files[0];
  if (f) { const r = await window.browsing.wallSet(await readFile(f)); if (!r.ok) toast(r.error); }
  e.target.value = ''; refreshHome();
};
$('wallRemove').onclick = async () => { await window.browsing.wallSet(null); refreshHome(); };
let wdT = 0;
$('wallDim').oninput = (e) => { clearTimeout(wdT); wdT = setTimeout(() => window.browsing.wallDim(+e.target.value), 200); };

const FONT_LIST = ['Urbanist', 'Inter', 'Poppins', 'Space Grotesk', 'DM Sans', 'Outfit', 'Nunito', 'Lora', 'Playfair Display', 'JetBrains Mono', 'System UI'];
let customFonts = [], fontApplied = null;
function renderFonts() {
  const box = $('fontChips');
  box.textContent = '';
  [...FONT_LIST, ...customFonts].forEach((f) => {
    const b = document.createElement('button');
    b.className = 'chip' + (prefs.font === f ? ' on' : ''); b.textContent = f;
    b.onclick = () => change('font', f);
    if (customFonts.includes(f)) { b.title = 'Right-click to remove this font'; b.oncontextmenu = (e) => { e.preventDefault(); removeFont(f); }; }
    box.appendChild(b);
  });
}
async function removeFont(f) {
  await window.browsing.fontRemove(f);
  customFonts = await window.browsing.fontsList();
  if (prefs.font === f) change('font', 'Urbanist'); else renderFonts();
}
function loadGoogleFont(f) {
  const id = 'gf-' + f.replace(/ /g, '-');
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
}
async function applyFont() {
  const f = prefs.font || 'Urbanist';
  if (f === fontApplied) return;
  fontApplied = f;
  const st = document.documentElement.style;
  if (f === 'Urbanist') { st.removeProperty('--font'); window.browsing.fontSet({ kind: 'default', family: f }); return; }
  if (f === 'System UI') { st.setProperty('--font', 'system-ui'); window.browsing.fontSet({ kind: 'system', family: f }); return; }
  if (FONT_LIST.includes(f)) { loadGoogleFont(f); st.setProperty('--font', '"' + f + '"'); window.browsing.fontSet({ kind: 'google', family: f }); return; }
  const d = await window.browsing.fontData(f);
  if (d) {
    try { const ff = new FontFace(f, 'url(' + d + ')'); await ff.load(); document.fonts.add(ff); st.setProperty('--font', '"' + f + '"'); window.browsing.fontSet({ kind: 'custom', family: f }); } catch {}
  }
}
$('fontAdd').onclick = () => $('fontFile').click();
$('fontFile').onchange = async (e) => {
  const f = e.target.files[0];
  if (f) {
    const r = await window.browsing.fontAdd(await readFile(f));
    if (!r.ok) toast(r.error); else { customFonts = await window.browsing.fontsList(); change('font', r.family); }
  }
  e.target.value = '';
};
window.browsing.fontsList().then((l) => { customFonts = l; renderFonts(); });

/* ---------- Start ---------- */
loadPrefs();
applyAll();
let savedDock = 'top';
try { savedDock = localStorage.getItem('dock') || 'top'; } catch {}
applyDock(savedDock);
restoreSession();
