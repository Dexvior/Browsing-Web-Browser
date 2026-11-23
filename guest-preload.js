// Gives pages the standard Chrome objects that Electron leaves empty.
const { webFrame } = require('electron');
if (location.protocol === 'https:' || location.protocol === 'http:') {
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
