import { html, render, useEffect } from './preact.js';
import { S, useStore, init, emit } from './store.js';
import { preloadScanner } from './scanner.js';
import { Today } from './ui/today.js';
import { Progress } from './ui/progress.js';
import { Settings } from './ui/settings.js';
import { Onboarding } from './ui/onboarding.js';
import { SheetHost } from './ui/host.js';
import { Icon } from './ui/icons.js';
import { openSheet, setTab } from './ui/nav.js';
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
  useEffect(() => {
    if (S.profile) setTimeout(preloadScanner, 1500);
  }, [!!S.profile]);

  if (!S.ready) return html`<div class="splash"><img src="icons/icon.svg" alt="" width="64" height="64" /></div>`;
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

init();
render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
