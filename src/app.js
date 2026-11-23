const SEARCH = 'https://duckduckgo.com/?q=';
const INTERNAL = new URL('internal.html', location.href).href;
const NEWTAB = INTERNAL + '?type=newtab';
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
function newTab(url = NEWTAB, focusBar = url === NEWTAB) {
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
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem('theme', mode); } catch {}
  window.browsing.setTheme(mode);
  markSeg($('themeSeg'), mode);
}
$('theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
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

/* ---------- Start ---------- */
let saved = 'dark';
try { saved = localStorage.getItem('theme') || 'dark'; } catch {}
applyTheme(saved);
let savedDock = 'top';
try { savedDock = localStorage.getItem('dock') || 'top'; } catch {}
applyDock(savedDock);
newTab();
