// First-open screen when Tally runs in a browser tab instead of from the Home Screen.
// The Home Screen version opens full screen, works offline, and keeps its data: iPhone
// browsers can clear storage for websites you haven't visited in a while, and the
// Home Screen app keeps its own storage, separate from Safari.
import { html, useState } from '../preact.js';
import { S, emit } from '../store.js';
import { Icon } from './icons.js';

const KEY = 'tally.installSeen';
let deferredPrompt = null; // Android/Chrome lets us show the install dialog ourselves

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  emit();
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

let seenThisSession = false;
export function shouldShowInstall() {
  if (isStandalone() || seenThisSession) return false;
  try { return localStorage.getItem(KEY) !== '1'; } catch { return true; }
}
function markSeen() {
  seenThisSession = true;
  try { localStorage.setItem(KEY, '1'); } catch {}
  emit();
}
// Settings can bring the screen back.
export function showInstallAgain() {
  seenThisSession = false;
  try { localStorage.removeItem(KEY); } catch {}
  emit();
}

const Step = ({ n, children }) => html`<li><span class="step-n">${n}</span><span>${children}</span></li>`;

export function InstallScreen() {
  const [installing, setInstalling] = useState(false);
  const p = platform();
  const hasData = !!S.profile;

  async function install() {
    if (!deferredPrompt) return;
    setInstalling(true);
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null;
    setInstalling(false);
    markSeen();
  }

  return html`<div class="install">
    <img src="icons/icon.svg" width="64" height="64" alt="" />
    <h1>${p === 'desktop' ? 'Tally is made for your phone' : 'Add Tally to your Home Screen'}</h1>
    <p class="lead">${p === 'desktop'
      ? 'Open this page on your phone and add it to your Home Screen. That’s the recommended way to use Tally.'
      : 'This is the recommended way to use Tally. It opens like a regular app, works offline, and keeps your data safe.'}</p>

    ${p === 'ios' && html`<ol class="install-steps">
      <${Step} n="1">Tap the <b>Share</b> button <${Icon} n="share" size=${18} className="inline-icon" /> in Safari. If you don’t see it, tap <b>•••</b> first.<//>
      <${Step} n="2">Scroll down and tap <b>Add to Home Screen</b> <${Icon} n="addbox" size=${18} className="inline-icon" />.<//>
      <${Step} n="3">Tap <b>Add</b>, then open Tally from your Home Screen.<//>
    </ol>`}
    ${p === 'ios-other' && html`<ol class="install-steps">
      <${Step} n="1">Open this page in <b>Safari</b> (copy the link, or use your browser’s “Open in Safari”).<//>
      <${Step} n="2">Tap <b>Share</b> <${Icon} n="share" size=${18} className="inline-icon" />, then <b>Add to Home Screen</b>.<//>
      <${Step} n="3">Open Tally from your Home Screen.<//>
    </ol>`}
    ${p === 'android' && (deferredPrompt
      ? html`<button class="btn primary block big" onClick=${install} disabled=${installing}>Install Tally</button>`
      : html`<ol class="install-steps">
          <${Step} n="1">Tap the <b>⋮</b> menu in Chrome.<//>
          <${Step} n="2">Tap <b>Install app</b> (or <b>Add to Home screen</b>).<//>
          <${Step} n="3">Open Tally from your Home Screen.<//>
        </ol>`)}

    <div class="install-why">
      <${Icon} n="info" size=${18} />
      <p>Your log is saved on your phone, not online. Browsers can clear data from websites you haven’t opened in a while,
        but the Home Screen app keeps it. ${hasData
          ? html`<b>You already have data here:</b> before switching, use Settings → Export backup, then Restore it in the Home Screen app.`
          : 'Add it first, then set up inside the Home Screen app.'}</p>
    </div>

    <button class="btn link" onClick=${markSeen}>${p === 'desktop' ? 'Continue here' : 'Continue in the browser for now'}</button>
  </div>`;
}
