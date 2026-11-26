// Runs inside every web page. Fills in standard Chrome objects and, when the ad blocker is on,
// hides leftover ad containers and trims ad data from YouTube's player response.
const { webFrame, ipcRenderer, contextBridge } = require('electron');

let flags = { adblock: false };
try { flags = ipcRenderer.sendSync('flags') || flags; } catch {}

const AD_CSS = [
  '.adsbygoogle', 'ins.adsbygoogle', '[id^="google_ads_iframe"]', '[id^="div-gpt-ad"]', '[data-google-container-id]',
  'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="adservice.google"]',
  '#masthead-ad', '#player-ads', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
  'ytd-promoted-sparkles-web-renderer', 'ytd-display-ad-renderer', 'ytd-companion-slot-renderer', '.ytp-ad-overlay-container',
].join(',') + '{display:none!important}';

const YT_SCRIPT = `(() => {
  if (window.__browsingAd) return; window.__browsingAd = true;
  const prune = (o) => { if (o && typeof o === 'object') { delete o.adPlacements; delete o.playerAds; delete o.adSlots; if (o.playerResponse) prune(o.playerResponse); } return o; };
  let v;
  try { Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => v, set: (x) => { v = prune(x); } }); } catch (e) {}
  const pj = JSON.parse; JSON.parse = function () { return prune(pj.apply(this, arguments)); };
  const rj = Response.prototype.json; Response.prototype.json = function () { return rj.apply(this, arguments).then(prune); };
})();`;

if (location.protocol === 'https:' || location.protocol === 'http:') {
  if (flags.adblock) {
    try { webFrame.insertCSS(AD_CSS); } catch {}
    if (/(^|\.)youtube\.com$/.test(location.hostname)) webFrame.executeJavaScript(YT_SCRIPT);
  }
  webFrame.executeJavaScript(`(() => {
    const c = window.chrome || (window.chrome = {});
    if (c.app && c.loadTimes) return;
    const n = () => {};
    c.app = { isInstalled: false, getDetails: n, getIsInstalled: n, installState: n, runningState: n,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    c.runtime = c.runtime || { connect: n, sendMessage: n,
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' }, PlatformOs: { WIN: 'win', LINUX: 'linux', MAC: 'mac' } };
    c.csi = () => ({ onloadT: Date.now(), startE: Math.round(performance.timeOrigin), pageT: performance.now(), tran: 15 });
    c.loadTimes = () => { const t = performance.timing;
      return { requestTime: t.navigationStart / 1000, startLoadTime: t.navigationStart / 1000, commitLoadTime: t.responseStart / 1000,
        finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000, finishLoadTime: t.loadEventEnd / 1000,
        firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true,
        wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }; };
  })();`);
}

// Only the app's own home screen (src/internal.html) can read or arrange stickers, wallpaper and the chosen font.
if (location.protocol === 'file:' && /\/src\/internal\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('browsingHome', {
    get: () => ipcRenderer.invoke('home-get'),
    saveStickers: (list) => ipcRenderer.invoke('home-save-stickers', list),
    remove: (id) => ipcRenderer.invoke('sticker-remove', id),
  });
}
