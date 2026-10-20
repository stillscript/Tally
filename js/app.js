import '../version.js';
import { html, render, useEffect } from './preact.js';
import { S, useStore, init, emit, toast, saveMeta } from './store.js';
import { installCelebrations } from './ui/celebrate.js';
import { preloadScanner } from './scanner.js';
import { installUpright } from './upright.js';
import './feedback.js';
import { Today } from './ui/today.js';
import { Progress } from './ui/progress.js';
import { Settings } from './ui/settings.js';
import { Onboarding } from './ui/onboarding.js';
import { SheetHost } from './ui/host.js';
import { Icon } from './ui/icons.js';
import { openSheet, setTab } from './ui/nav.js';
import { InstallScreen, shouldShowInstall } from './ui/install.js';
import { todayKey, mealForTime } from './util.js';

function Toast() {
  const t = S.ui.toast;
  if (!t) return null;
  return html`<div class="toast" role="status" key=${t.id}>
    <span>${t.msg}</span>
    ${t.action && html`<button class="toast-action" onClick=${() => { t.action.fn(); S.ui.toast = null; emit(); }}>${t.action.label}</button>`}
  </div>`;
}

function TabBar() {
  const tab = S.ui.tab;
  const btn = (id, icon, label) => html`<button class=${'tab' + (tab === id ? ' on' : '')} onClick=${() => setTab(id)}
    aria-current=${tab === id ? 'page' : undefined}><${Icon} n=${icon} /><span>${label}</span></button>`;
  const date = () => (tab === 'today' ? S.ui.date : todayKey());
  return html`<nav class="tabbar" aria-label="Main">
    ${btn('today', 'today', 'Today')}
    <button class="tab" onClick=${() => openSheet('add', { meal: mealForTime(), date: date() })}><${Icon} n="search" /><span>Search</span></button>
    <button class="scan-fab" onClick=${() => openSheet('scanner', { meal: mealForTime(), date: date() })} aria-label="Scan a barcode">
      <${Icon} n="scan" size=${28} /></button>
    ${btn('progress', 'chart', 'Progress')}
    ${btn('settings', 'settings', 'Settings')}
  </nav>`;
}

function App() {
  useStore();
  useEffect(() => {
    document.body.classList.toggle('locked', S.ui.sheets.length > 0);
  });
  // Roll over to the new day if the app was left open overnight.
  useEffect(() => {
    let last = todayKey();
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const now = todayKey();
      if (now !== last) {
        if (S.ui.date === last) S.ui.date = now;
        last = now;
        emit();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // After an update installs, say so once and link to the version log.
  useEffect(() => {
    if (!S.ready || !S.profile) return;
    const now = self.TALLY_VERSION;
    const seen = S.meta.seenVersion;
    if (seen === now) return;
    saveMeta({ seenVersion: now });
    if (seen || S.entries.length) toast(`Updated to version ${now}`, { label: 'What’s new', fn: () => openSheet('whats-new') });
  }, [S.ready, !!S.profile]);
  useEffect(() => {
    if (S.profile) setTimeout(preloadScanner, 1500);
  }, [!!S.profile]);

  if (!S.ready) return html`<div class="splash"><img src="icons/icon.svg" alt="" width="64" height="64" /></div>`;
  // Opened in a browser tab: explain Home Screen install first (once; Settings can show it again).
  if (shouldShowInstall()) return html`<main class="screen"><${InstallScreen} /></main>`;
  if (!S.profile) return html`<main class="screen"><${Onboarding} /></main><${Toast} />`;

  const tab = S.ui.tab;
  return html`
    <main class="screen">
      ${tab === 'today' && html`<${Today} />`}
      ${tab === 'progress' && html`<${Progress} />`}
      ${tab === 'settings' && html`<${Settings} />`}
    </main>
    <${TabBar} />
    <${SheetHost} />
    <${Toast} />
  `;
}

installCelebrations();
init().then(installUpright);
render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // When an update you pushed finishes installing, offer a reload. Your data isn't touched:
  // it lives in on-device storage, separate from the app's files.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Tally was updated', { label: 'Reload', fn: () => location.reload() });
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
