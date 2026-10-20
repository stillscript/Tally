// Small celebrations for wins that matter on a cut, kept rare enough to stay rewarding:
//  • big burst + message when today's protein target is reached (once a day by nature)
//  • medium burst when the fiber goal is reached
//  • a quick sparkle for a protein-packed food (≥15 g protein and ≥9 g per 100 kcal)
// Holidays swap in seasonal colors, shapes and words. Turn off in Settings → Preferences.
import { S, hooks, dayTotals } from '../store.js';
import { todayKey, hash } from '../util.js';

// Default confetti uses your theme's accent plus the macro colors.
const tokenColors = () => {
  const cs = getComputedStyle(document.documentElement);
  return ['--accent', '--protein', '--carbs', '--fat'].map(v => cs.getPropertyValue(v).trim()).filter(Boolean);
};
const BASE = { name: 'default', colors: null, shapes: [], word: '' };

function nthWeekday(year, month, weekday, n) {
  const d = new Date(year, month, 1);
  const shift = (weekday - d.getDay() + 7) % 7;
  return new Date(year, month, 1 + shift + (n - 1) * 7);
}
const within = (d, m, from, to) => d.getMonth() === m && d.getDate() >= from && d.getDate() <= to;

export function holidayTheme(d = new Date()) {
  const y = d.getFullYear();
  const thanksgiving = nthWeekday(y, 10, 4, 4);
  const near = (target, days) => Math.abs(d - target) <= days * 864e5;
  if (within(d, 9, 24, 31)) return { name: 'halloween', colors: ['#ff7a1a', '#8b5cf6', '#facc15', '#1f2937'], shapes: ['🎃', '👻', '🦇'], word: 'Spooky strong' };
  if (near(thanksgiving, 3)) return { name: 'thanksgiving', colors: ['#d97706', '#b45309', '#facc15', '#7c2d12'], shapes: ['🍂', '🦃'], word: 'Thankful gains' };
  if (within(d, 11, 18, 26)) return { name: 'christmas', colors: ['#dc2626', '#16a34a', '#ffffff', '#facc15'], shapes: ['❄️', '🎄'], word: 'Festive and fueled' };
  if (within(d, 11, 30, 31) || within(d, 0, 1, 2)) return { name: 'newyear', colors: ['#facc15', '#e5e7eb', '#a855f7', '#22d3ee'], shapes: ['✨', '🎉'], word: 'New year, same discipline' };
  if (within(d, 1, 10, 14)) return { name: 'valentines', colors: ['#f43f5e', '#fb7185', '#ffffff', '#be123c'], shapes: ['❤️'], word: 'Love the progress' };
  if (within(d, 2, 15, 17)) return { name: 'stpatricks', colors: ['#16a34a', '#22c55e', '#facc15', '#ffffff'], shapes: ['☘️'], word: 'Lucky streak' };
  if (within(d, 6, 1, 4)) return { name: 'july4', colors: ['#dc2626', '#ffffff', '#2563eb'], shapes: ['⭐'], word: 'Independence from junk food' };
  return BASE;
}

const PROTEIN_LINES = ['Protein goal hit!', 'Protein target: done.', 'That’s your protein for today!', 'Muscle-protecting protein: covered.'];
const FIBER_LINES = ['Fiber goal reached', 'Fiber target: done', 'Plenty of fiber today'];

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function burst(size, theme) {
  if (reducedMotion()) return;
  const n = size === 'big' ? 70 : size === 'medium' ? 36 : 16;
  const colors = theme.colors || tokenColors();
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const ring = document.querySelector('.ring-wrap')?.getBoundingClientRect();
  const x0 = ring ? ring.left + ring.width / 2 : innerWidth / 2;
  const y0 = ring ? ring.top + ring.height / 2 : innerHeight * 0.3;
  const spread = size === 'small' ? 110 : 260;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const emoji = theme.shapes.length && Math.random() < 0.35;
    if (emoji) {
      p.className = 'emoji';
      p.textContent = theme.shapes[i % theme.shapes.length];
    }
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * (0.35 + Math.random() * 0.65);
    p.style.cssText = `--x0:${x0}px;--y0:${y0}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist + (size === 'small' ? 20 : 140)}px;`
      + `--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colors[i % colors.length]};--d:${900 + Math.random() * (size === 'small' ? 300 : 900)}ms`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  document.querySelector('.ring-wrap')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
  setTimeout(() => layer.remove(), 2200);
}

function cheer(text) {
  const el = document.createElement('div');
  el.className = 'cheer';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function onLogged(made, { date, before }) {
  if (S.settings.celebrate === false || !S.profile || date !== todayKey() || !before) return;
  const t = S.profile.targets;
  const after = dayTotals(date);
  const theme = holidayTheme();
  const pick = lines => lines[hash(todayKey() + made[0].id) % lines.length];
  const suffix = theme.word ? ` ${theme.shapes[0] || ''} ${theme.word}` : '';
  // Wait for sheets to slide away so the burst lands over Today's ring.
  const go = fn => setTimeout(fn, 350);

  if (before.p < t.protein && after.p >= t.protein) {
    return go(() => { burst('big', theme); cheer(pick(PROTEIN_LINES) + suffix); });
  }
  const fiberGoal = Math.round((14 * t.kcal) / 1000);
  if (before.fiber < fiberGoal && after.fiber >= fiberGoal) {
    return go(() => { burst('medium', theme); cheer(pick(FIBER_LINES)); });
  }
  if (made.some(e => e.n.p >= 15 && e.n.kcal > 0 && (e.n.p / e.n.kcal) * 100 >= 9)) go(() => burst('small', theme));
}

export function installCelebrations() {
  hooks.onLogged = onLogged;
}

// Settings preview button.
export function previewCelebration() {
  const theme = holidayTheme();
  burst('big', theme);
  cheer(`Protein goal hit!${theme.word ? ` ${theme.shapes[0] || ''} ${theme.word}` : ''}`);
}
