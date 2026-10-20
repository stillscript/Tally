// App state: one plain object, persisted to IndexedDB, re-rendered on emit().
import { useState, useEffect } from './preact.js';
import { db } from './db.js';
import { uid, todayKey } from './util.js';
import { setAppearance } from './theme.js';

const DEFAULT_SETTINGS = {
  units: 'imperial', usdaKey: '', region: 'united-states', tips: true,
  theme: 'green', appearance: 'system', keepUpright: true, scanFeedback: true,
  // AI: the one service you chose, a key per service (only on this device), and an optional model choice per service.
  aiProvider: '', aiKeys: {}, aiModels: {},
};
// Device-only settings: keys never go into backup files, and the AI choice follows the keys.
const DEVICE_SETTINGS = ['usdaKey', 'aiKeys', 'aiProvider', 'aiModels'];

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...raw, aiKeys: { ...(raw.aiKeys || {}) }, aiModels: { ...(raw.aiModels || {}) } };
  // Versions before 3.0 stored a single Claude key.
  if (raw.anthropicKey && !s.aiKeys.claude) s.aiKeys.claude = raw.anthropicKey;
  if (raw.aiModel && !s.aiModels.claude) s.aiModels.claude = raw.aiModel;
  if (raw.anthropicKey && !s.aiProvider) s.aiProvider = 'claude';
  delete s.anthropicKey;
  delete s.aiModel;
  return s;
}
const syncAppearance = () => setAppearance({ theme: S.settings.theme, mode: S.settings.appearance });
const freshMeta = () => ({ insights: {}, muted: {}, altSeen: {}, checkIns: [], lastCheckIn: null });

export const S = {
  ready: false,
  memoryOnly: false,
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  meta: freshMeta(),
  altCache: {},
  meals: [], // saved meals: { id, name, items: [entry-like], createdAt, usedAt }
  foods: new Map(),
  byBarcode: new Map(),
  entries: [],
  weights: [],
  ui: { tab: 'today', date: todayKey(), sheets: [], toast: null },
};

// ---- subscriptions ----
const subs = new Set();
let version = 0;
let byDate = null;
export function emit() {
  version++;
  byDate = null;
  subs.forEach(fn => fn(version));
}
export function useStore() {
  const [, set] = useState(version);
  useEffect(() => {
    subs.add(set);
    set(version); // catch up on anything emitted before we subscribed
    return () => subs.delete(set);
  }, []);
  return S;
}

// ---- derived ----
export function entriesByDate() {
  if (!byDate) {
    byDate = new Map();
    for (const e of S.entries) {
      let list = byDate.get(e.date);
      if (!list) byDate.set(e.date, (list = []));
      list.push(e);
    }
    for (const list of byDate.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  }
  return byDate;
}
export const entriesFor = date => entriesByDate().get(date) || [];

export const NUTRIENT_KEYS = ['kcal', 'p', 'c', 'f', 'fiber', 'sugar', 'addedSugar', 'satFat', 'sodium'];
export function sumN(list) {
  const t = {};
  for (const k of NUTRIENT_KEYS) t[k] = 0;
  for (const e of list) for (const k of NUTRIENT_KEYS) t[k] += e.n?.[k] || 0;
  return t;
}
export const dayTotals = (date, excludeId) => sumN(entriesFor(date).filter(e => e.id !== excludeId));

// Foods you've logged, most recent first (one row per food).
export function recentFoods(limit = 30) {
  const seen = new Set();
  const out = [];
  const sorted = [...S.entries].sort((a, b) => b.createdAt - a.createdAt);
  for (const e of sorted) {
    if (out.length >= limit) break;
    if (!e.foodId || seen.has(e.foodId)) continue;
    seen.add(e.foodId);
    const f = S.foods.get(e.foodId);
    if (f) out.push(f);
  }
  return out;
}
export function logCounts() {
  const m = new Map();
  for (const e of S.entries) if (e.foodId) m.set(e.foodId, (m.get(e.foodId) || 0) + 1);
  return m;
}

// ---- persistence ----
async function save(store, value, key) {
  if (S.memoryOnly) return;
  try {
    await db.put(store, value, key);
  } catch (e) {
    console.error(e);
    toast('Couldn’t save to this device’s storage');
  }
}
async function remove(store, key) {
  if (S.memoryOnly) return;
  try {
    await db.del(store, key);
  } catch (e) {
    console.error(e);
  }
}

function indexFood(f) {
  S.foods.set(f.id, f);
  if (f.barcode) S.byBarcode.set(f.barcode, f.id);
}

export async function init() {
  try {
    const [kv, foods, entries, weights] = await Promise.all([db.kvAll(), db.all('foods'), db.all('entries'), db.all('weights')]);
    S.profile = kv.profile || null;
    S.settings = normalizeSettings(kv.settings);
    if (kv.settings && 'anthropicKey' in kv.settings) save('kv', S.settings, 'settings'); // keep the 3.0 layout
    S.meta = { ...freshMeta(), ...(kv.meta || {}) };
    S.altCache = kv.altCache || {};
    S.meals = kv.meals || [];
    foods.forEach(indexFood);
    S.entries = entries;
    S.weights = weights.sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn('Storage unavailable — running in memory only', e);
    S.memoryOnly = true;
  }
  S.ready = true;
  syncAppearance();
  emit();
  try {
    navigator.storage?.persist?.();
  } catch {}
}

export async function saveProfile(p) {
  S.profile = p;
  emit();
  await save('kv', p, 'profile');
}
export async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  if ('theme' in patch || 'appearance' in patch) syncAppearance();
  emit();
  await save('kv', S.settings, 'settings');
}
export async function saveMeta(patch) {
  S.meta = { ...S.meta, ...patch };
  await save('kv', S.meta, 'meta');
}
export async function saveAltCache(cache) {
  S.altCache = cache;
  await save('kv', cache, 'altCache');
}

// ---- saved meals ----
const mealItem = ({ id, createdAt, date, meal, ...rest }) => rest;
export async function saveMealTemplate(name, entries) {
  const m = { id: uid(), name, items: entries.map(mealItem), createdAt: Date.now(), usedAt: Date.now() };
  S.meals = [m, ...S.meals];
  emit();
  await save('kv', S.meals, 'meals');
  return m;
}
export async function updateMealTemplate(m) {
  S.meals = S.meals.map(x => (x.id === m.id ? m : x));
  emit();
  await save('kv', S.meals, 'meals');
}
export async function deleteMealTemplate(id) {
  S.meals = S.meals.filter(x => x.id !== id);
  emit();
  await save('kv', S.meals, 'meals');
}

export async function upsertFood(food) {
  const f = { ...food, updatedAt: Date.now() };
  indexFood(f);
  emit();
  await save('foods', f);
  return f;
}

// Optional listeners (celebrations) told about every new log, with the day's totals beforehand.
export const hooks = { onLogged: null };

export async function addEntry(e) {
  return (await addEntries([e]))[0];
}
export async function addEntries(list) {
  const now = Date.now();
  const date = list[0]?.date;
  const before = date ? dayTotals(date) : null;
  const made = list.map((e, i) => ({ ...e, id: uid(), createdAt: now + i }));
  S.entries = [...S.entries, ...made];
  emit();
  try { hooks.onLogged?.(made, { date, before }); } catch (err) { console.warn(err); }
  for (const e of made) await save('entries', e);
  return made;
}
export async function updateEntry(e) {
  S.entries = S.entries.map(x => (x.id === e.id ? e : x));
  emit();
  await save('entries', e);
}
export async function deleteEntry(id) {
  const e = S.entries.find(x => x.id === id);
  S.entries = S.entries.filter(x => x.id !== id);
  emit();
  await remove('entries', id);
  return e;
}
export async function restoreEntry(e) {
  S.entries = [...S.entries, e];
  emit();
  await save('entries', e);
}

export async function setWeight(date, kg) {
  const w = { date, kg };
  S.weights = [...S.weights.filter(x => x.date !== date), w].sort((a, b) => a.date.localeCompare(b.date));
  emit();
  await save('weights', w);
}
export async function deleteWeight(date) {
  S.weights = S.weights.filter(x => x.date !== date);
  emit();
  await remove('weights', date);
}

// ---- toast ----
let toastTimer;
export function toast(msg, action) {
  S.ui.toast = { msg, action, id: uid() };
  emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.ui.toast = null;
    emit();
  }, action ? 5000 : 2600);
}

// ---- backup ----
export function exportData() {
  return {
    app: 'tally',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: S.profile,
    settings: Object.fromEntries(Object.entries(S.settings).filter(([k]) => !DEVICE_SETTINGS.includes(k))),
    meta: S.meta,
    meals: S.meals,
    foods: [...S.foods.values()],
    entries: S.entries,
    weights: S.weights,
  };
}

export async function importData(d) {
  if (!d || d.app !== 'tally' || !Array.isArray(d.entries)) throw new Error('This file isn’t a Tally backup.');
  // Keep this device's keys and AI choice; backups never contain them.
  const settings = normalizeSettings({ ...(d.settings || {}), anthropicKey: '', aiModel: '' });
  for (const k of DEVICE_SETTINGS) settings[k] = S.settings[k];
  const payload = {
    kv: { profile: d.profile, settings, meta: { ...freshMeta(), ...(d.meta || {}) }, meals: d.meals || [] },
    foods: d.foods || [],
    entries: d.entries,
    weights: d.weights || [],
  };
  if (!S.memoryOnly) await db.replaceAll(payload);
  S.profile = d.profile || null;
  S.settings = settings;
  syncAppearance();
  S.meta = payload.kv.meta;
  S.meals = payload.kv.meals;
  S.foods = new Map();
  S.byBarcode = new Map();
  payload.foods.forEach(indexFood);
  S.entries = payload.entries;
  S.weights = [...payload.weights].sort((a, b) => a.date.localeCompare(b.date));
  emit();
}

export async function eraseAll() {
  if (!S.memoryOnly) await db.replaceAll({});
  Object.assign(S, {
    profile: null, settings: { ...DEFAULT_SETTINGS }, meta: freshMeta(), altCache: {}, meals: [],
    foods: new Map(), byBarcode: new Map(), entries: [], weights: [],
  });
  S.ui = { tab: 'today', date: todayKey(), sheets: [], toast: null };
  syncAppearance();
  emit();
}
