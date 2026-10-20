// Scan feedback: a soft tick and a green flash the instant a barcode is read (Settings → Preferences).
// iPhones only allow sound after a tap, so the audio is unlocked on the first touch and kept awake.
// Web Audio on iPhone follows the silent switch.
import { S } from './store.js';

let ctx = null;
const on = () => S.settings.scanFeedback !== false;

function unlock() {
  if (!on()) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}
addEventListener('touchend', unlock, { capture: true, passive: true });
addEventListener('click', unlock, { capture: true });

export function scanTick() {
  if (!on() || !ctx || ctx.state !== 'running') return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(1900, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {}
}

export const scanFeedbackOn = on;
