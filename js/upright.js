// Keep upright: iPhones ignore the "portrait only" setting for Home Screen apps, so when the phone
// turns sideways the app turns itself back (the page is counter-rotated; see html.upright-* in styles.css).
// Android follows the manifest's portrait setting on its own. Only on phones, only when installed,
// and it can be switched off in Settings → Preferences.
import { S } from './store.js';

const phone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 90: turned so the top of the phone is on the left; -90: on the right.
function angle() {
  if (typeof window.orientation === 'number') return window.orientation;
  const a = screen.orientation?.angle || 0;
  return a === 270 ? -90 : a;
}

export function applyUpright() {
  const a = S.settings.keepUpright !== false && phone() && installed() ? angle() : 0;
  const root = document.documentElement;
  root.classList.toggle('upright-l', a === 90);
  root.classList.toggle('upright-r', a === -90);
}

let installedOnce = false;
export function installUpright() {
  applyUpright();
  if (installedOnce) return;
  installedOnce = true;
  addEventListener('orientationchange', () => setTimeout(applyUpright, 60));
  screen.orientation?.addEventListener?.('change', applyUpright);
  addEventListener('resize', applyUpright);
}
