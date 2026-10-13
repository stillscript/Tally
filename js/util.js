export const KG_PER_LB = 0.45359237;
export const G_PER_OZ = 28.349523125;
export const ML_PER_FLOZ = 29.5735295625;
// Energy in a kilogram of body-weight change (fat + lean mix), the standard planning figure.
export const KCAL_PER_KG = 7700;

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
];
export const mealLabel = id => (MEALS.find(m => m.id === id) || MEALS[3]).label;

export function mealForTime(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 15) return 'lunch';
  if (h >= 17 && h < 21.5) return 'dinner';
  return 'snacks';
}

// ---- dates (local calendar days as YYYY-MM-DD) ----
const pad2 = n => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayKey = () => dateKey();
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
export function prettyDate(k) {
  const diff = daysBetween(todayKey(), k);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export const shortDate = k => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ---- numbers ----
export const round = (n, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
export const fmtInt = n => Math.round(n || 0).toLocaleString();
export function fmtG(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  return Math.abs(n) >= 10 ? String(Math.round(n)) : String(round(n, 1));
}
export const fmtQty = n => String(round(n, 2));
export const pct = f => `${Math.round(f * 100)}%`;
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- body weight (always stored in kg) ----
export const toDisplayWeight = (kg, units) => (units === 'imperial' ? kg / KG_PER_LB : kg);
export const fromDisplayWeight = (v, units) => (units === 'imperial' ? v * KG_PER_LB : v);
export const wUnit = units => (units === 'imperial' ? 'lb' : 'kg');
export const fmtW = (kg, units, d = 1) => round(toDisplayWeight(kg, units), d).toFixed(d);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Database names often arrive in ALL CAPS; make them readable.
export function niceCase(s) {
  if (!s) return '';
  s = String(s).trim().replace(/\s+/g, ' ');
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-/(&])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  }
  return s;
}
