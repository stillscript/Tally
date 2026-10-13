// Nutrition data sources.
//
// 1. USDA FoodData Central, Branded Foods: label data submitted by manufacturers
//    (via GS1/1WorldSync), validated by USDA. Most trustworthy for US packaged food.
// 2. USDA Foundation + SR Legacy: lab-analyzed values for whole foods (chicken, rice, eggs…).
// 3. Open Food Facts: huge crowdsourced global database. Broadest coverage, noisier.
//
// Barcode lookups query USDA and Open Food Facts in parallel, prefer USDA's label data,
// borrow categories/images from Open Food Facts, and flag when the two disagree.
import { S, saveAltCache } from './store.js';
import { normalizeBarcode } from './barcode.js';
import { niceCase, round, fmtQty, G_PER_OZ, ML_PER_FLOZ } from './util.js';

const USDA = 'https://api.nal.usda.gov/fdc/v1';
const OFF = 'https://world.openfoodfacts.org';
const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'brands', 'quantity', 'product_quantity',
  'serving_size', 'serving_quantity', 'serving_quantity_unit', 'nutriments', 'nutriscore_grade',
  'nova_group', 'categories_tags', 'image_front_small_url', 'data_quality_errors_tags', 'data_quality_warnings_tags',
].join(',');

// Open Food Facts runs its own checks on contributed data; respect the nutrition ones.
const OFF_BAD = /nutrition.*(does-not-match-value|very-low-for-category|very-high-for-category)|energy-value-in-kcal-does-not-match/;
const offFlagged = p => [...(p.data_quality_errors_tags || []), ...(p.data_quality_warnings_tags || [])]
  .some(t => OFF_BAD.test(t) && !/may-not-match/.test(t));

export const SOURCE_LABEL = {
  usda: 'USDA · manufacturer label data',
  'usda-generic': 'USDA · lab-analyzed',
  off: 'Open Food Facts · community data',
  custom: 'Your entry',
};

export const usdaKey = () => (S.settings.usdaKey || '').trim() || 'DEMO_KEY';
export const hasUsdaKey = () => usdaKey() !== 'DEMO_KEY';

// Open Food Facts' edge sometimes drops the first request for an uncached query
// (it surfaces as a CORS "Failed to fetch"); an identical retry succeeds.
async function getJSON(url, ms = 12000) {
  for (const wait of [600, 1500]) {
    try {
      return await getJSONOnce(url, ms);
    } catch (e) {
      if (e.code !== 'network') throw e;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return getJSONOnce(url, ms);
}

async function getJSONOnce(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (r.status === 429) throw Object.assign(new Error('Rate limited'), { code: 'rate' });
    if (r.status === 403 || r.status === 401) throw Object.assign(new Error('Key rejected'), { code: 'key' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { code: 'http' });
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Timed out'), { code: 'timeout' });
    if (!e.code) e.code = navigator.onLine === false ? 'offline' : 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- nutrient helpers ----------
const EMPTY = { kcal: null, p: null, c: null, f: null, fiber: null, sugar: null, addedSugar: null, satFat: null, sodium: null };
export const hasCore = n => !!n && [n.kcal, n.p, n.c, n.f].every(v => v != null && Number.isFinite(v));

function fillKcal(n) {
  if (n.kcal == null && n.p != null && n.c != null && n.f != null) {
    n.kcal = 4 * n.p + 4 * n.c + 9 * n.f;
    n.kcalEstimated = true;
  }
  return n;
}

export function nutrientsFor(per100, grams) {
  const k = grams / 100;
  const o = {};
  for (const key in EMPTY) o[key] = per100?.[key] != null ? per100[key] * k : 0;
  return o;
}

// Sanity check: do the calories roughly match 4/4/9 kcal per gram of protein/carbs/fat?
// Catches typos and per-serving/per-100g mixups common in crowdsourced data.
export function assessQuality(n) {
  const issues = [];
  if (n.kcal == null) issues.push('missing-kcal');
  if ([n.p, n.c, n.f].some(v => v == null)) issues.push('missing-macros');
  else {
    if (n.p + n.c + n.f > 105) issues.push('impossible');
    if (n.kcal != null && !n.kcalEstimated) {
      const est = 4 * n.p + 4 * n.c + 9 * n.f;
      if (Math.abs(n.kcal - est) > Math.max(30, 0.22 * Math.max(n.kcal, est))) issues.push('mismatch');
    }
  }
  return issues;
}

// ---------- servings ----------
export function unitsFor(food) {
  const list = (food.servings || []).map((s, i) => ({ key: 's' + i, label: s.label, g: s.g, serving: true }));
  if (food.base === 'ml') list.push({ key: 'ml', label: 'ml', g: 1 }, { key: 'floz', label: 'fl oz', g: ML_PER_FLOZ });
  else list.push({ key: 'g', label: 'g', g: 1 }, { key: 'oz', label: 'oz', g: G_PER_OZ });
  return list;
}
export function findUnit(food, key) {
  const units = unitsFor(food);
  return units.find(u => u.key === key) || units[0];
}
export function defaultAmount(food) {
  const units = unitsFor(food);
  if (food.last && units.some(u => u.key === food.last.unit)) return { ...food.last };
  if (food.servings?.length && food.source !== 'usda-generic') return { qty: 1, unit: 's0' };
  return { qty: 100, unit: food.base === 'ml' ? 'ml' : 'g' };
}
export function amountText(qty, unit) {
  if (!unit) return '';
  if (unit.serving) return qty === 1 ? unit.label : `${fmtQty(qty)} × ${unit.label}`;
  return `${fmtQty(qty)} ${unit.label}`;
}
export function stepFor(unit) {
  if (!unit || unit.serving) return 0.5;
  if (unit.key === 'g' || unit.key === 'ml') return 10;
  return 0.5;
}

function cleanHousehold(t) {
  if (!t) return null;
  t = String(t).trim().replace(/\s+/g, ' ');
  if (!/[\d½¼¾⅓⅔]/.test(t)) return null;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) t = t.toLowerCase();
  return t.length > 42 ? t.slice(0, 42) + '…' : t;
}
function servingLabel(hh, g, base) {
  const amt = `${round(g, 1)} ${base}`;
  if (!hh) return `1 serving (${amt})`;
  return /\d\s*(g|ml|gram)\b/i.test(hh) ? hh : `${hh} (${amt})`;
}
function parsePackage(s, base) {
  if (!s) return null;
  s = String(s);
  let m;
  if (base === 'ml') {
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*ml\b/i))) return +m[1];
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*l\b/i))) return +m[1] * 1000;
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*fl\.?\s*oz/i))) return +m[1] * ML_PER_FLOZ;
    return null;
  }
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(g|grams?)\b/i))) return +m[1];
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*kg\b/i))) return +m[1] * 1000;
  if (!/fl/i.test(s) && (m = s.match(/(\d+(?:\.\d+)?)\s*oz\b/i))) return +m[1] * G_PER_OZ;
  return null;
}
function withPackage(servings, pkg, base, name) {
  if (!pkg || pkg <= 0) return servings;
  if (/\b(\d+\s*(pk|pack|ct|count)|multi-?pack|variety)\b/i.test(name || '')) return servings;
  const s0 = servings[0]?.g;
  if (s0 && (Math.abs(pkg - s0) < 1 || pkg / s0 > 12)) return servings;
  return [...servings, { label: `Whole package (${round(pkg, 1)} ${base})`, g: pkg }];
}

// ---------- USDA ----------
const NUT = {
  kcal: [1008, 2048, 2047], p: [1003], c: [1005], f: [1004], fiber: [1079],
  sugar: [2000, 1063], addedSugar: [1235], satFat: [1258], sodium: [1093],
};
function usdaNutrients(list) {
  const by = new Map();
  for (const n of list || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const v = Number(n.value ?? n.amount);
    if (id != null && Number.isFinite(v) && !by.has(id)) by.set(id, v);
  }
  const out = {};
  for (const [k, ids] of Object.entries(NUT)) {
    out[k] = null;
    for (const id of ids) if (by.has(id)) { out[k] = by.get(id); break; }
  }
  if (out.kcal == null && by.has(1062)) out.kcal = by.get(1062) / 4.184;
  return fillKcal(out);
}

function parseUsdaBranded(f, gtin14) {
  const unit = String(f.servingSizeUnit || '').toLowerCase();
  const base = unit === 'ml' || unit === 'mlt' ? 'ml' : 'g';
  const name = niceCase(f.description) || 'Unnamed product';
  let servings = [];
  const size = Number(f.servingSize);
  if (size > 0) servings.push({ label: servingLabel(cleanHousehold(f.householdServingFullText), size, base), g: size });
  servings = withPackage(servings, parsePackage(f.packageWeight, base), base, name);
  const g14 = gtin14 || normalizeBarcode(f.gtinUpc)?.gtin14 || null;
  const food = {
    id: g14 ? 'bc:' + g14 : 'fdc:' + f.fdcId,
    barcode: g14,
    name,
    brand: niceCase(f.brandName || f.brandOwner || ''),
    source: 'usda',
    sourceId: f.fdcId,
    base,
    per100: usdaNutrients(f.foodNutrients),
    servings,
    categories: [],
    published: f.publishedDate || null,
  };
  food.quality = assessQuality(food.per100);
  return food;
}

function parseUsdaGeneric(f) {
  const servings = (f.foodMeasures || [])
    .filter(m => m.gramWeight > 0 && m.disseminationText && !/quantity not specified/i.test(m.disseminationText))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 6)
    .map(m => ({ label: `${m.disseminationText} (${round(m.gramWeight, 1)} g)`, g: m.gramWeight }));
  const food = {
    id: 'fdc:' + f.fdcId,
    barcode: null,
    name: f.description,
    brand: '',
    source: 'usda-generic',
    sourceId: f.fdcId,
    base: 'g',
    per100: usdaNutrients(f.foodNutrients),
    servings,
    categories: [],
  };
  food.quality = assessQuality(food.per100);
  return food;
}

async function usdaByBarcode(n) {
  const strip = s => String(s || '').replace(/^0+/, '');
  const target = strip(n.gtin14);
  const queries = [n.gtin14];
  // Some older USDA records store the 12/13-digit form. Only spend the extra call with a personal key.
  if (hasUsdaKey()) queries.push(n.upcA || n.ean13 || n.display);
  for (const q of [...new Set(queries)]) {
    const j = await getJSON(`${USDA}/foods/search?api_key=${encodeURIComponent(usdaKey())}&query=${q}&dataType=Branded&pageSize=10`);
    const hits = (j?.foods || []).filter(f => strip(f.gtinUpc) === target);
    if (hits.length) {
      // Several records can share a GTIN (reformulations). Newest wins.
      hits.sort((a, b) => String(b.publishedDate || '').localeCompare(String(a.publishedDate || '')));
      return parseUsdaBranded(hits[0], n.gtin14);
    }
  }
  return null;
}

export async function usdaSearch(query, kind = 'generic') {
  // Multiple data types are comma-separated (OpenAPI form style, explode=false).
  const dt = kind === 'branded' ? 'Branded' : 'Foundation,SR%20Legacy';
  const url = `${USDA}/foods/search?api_key=${encodeURIComponent(usdaKey())}&query=${encodeURIComponent(query)}&dataType=${dt}&pageSize=${kind === 'branded' ? 12 : 15}`;
  const j = await getJSON(url);
  return (j?.foods || [])
    .map(f => (kind === 'branded' ? parseUsdaBranded(f) : parseUsdaGeneric(f)))
    .filter(f => hasCore(f.per100));
}

export async function verifyUsdaKey(key) {
  try {
    await getJSON(`${USDA}/foods/search?api_key=${encodeURIComponent(key)}&query=apple&pageSize=1&dataType=Foundation`);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code };
  }
}

// ---------- Open Food Facts ----------
function parseOff(p) {
  const nm = p.nutriments || {};
  const v = k => {
    const x = nm[k];
    if (x === '' || x == null) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const servingText = String(p.serving_size || '');
  const base = /\d\s*g\b/i.test(servingText) ? 'g'
    : p.serving_quantity_unit === 'ml' || /\bml\b|fl\.?\s?oz|\bcl\b/i.test(servingText) ? 'ml' : 'g';
  const sodium = v('sodium_100g') != null ? v('sodium_100g') * 1000 : v('salt_100g') != null ? v('salt_100g') * 400 : null;
  let per100 = {
    kcal: v('energy-kcal_100g') ?? (v('energy_100g') != null ? v('energy_100g') / 4.184 : null),
    p: v('proteins_100g'), c: v('carbohydrates_100g'), f: v('fat_100g'),
    fiber: v('fiber_100g'), sugar: v('sugars_100g'), addedSugar: v('added-sugars_100g'),
    satFat: v('saturated-fat_100g'), sodium,
  };
  const sq = Number(p.serving_quantity) || null;
  // Some products only have per-serving numbers; scale them to 100 g.
  if (sq && [per100.kcal, per100.p, per100.c, per100.f].every(x => x == null)) {
    const k = 100 / sq;
    const s = key => (v(key + '_serving') != null ? v(key + '_serving') * k : null);
    per100 = {
      kcal: s('energy-kcal'), p: s('proteins'), c: s('carbohydrates'), f: s('fat'), fiber: s('fiber'),
      sugar: s('sugars'), addedSugar: s('added-sugars'), satFat: s('saturated-fat'),
      sodium: s('sodium') != null ? s('sodium') * 1000 : null,
    };
  }
  fillKcal(per100);
  const name = niceCase((p.product_name_en || p.product_name || p.generic_name || '').trim()) || 'Unnamed product';
  let servings = [];
  if (sq > 0) {
    const txt = servingText.trim();
    const label = !txt ? `1 serving (${round(sq, 1)} ${base})` : /\d\s*(g|ml)\b/i.test(txt) ? txt : `${txt} (${round(sq, 1)} ${base})`;
    servings.push({ label: label.length > 48 ? label.slice(0, 48) + '…' : label, g: sq });
  }
  const pkg = Number(p.product_quantity) > 0 ? Number(p.product_quantity) : parsePackage(p.quantity, base);
  servings = withPackage(servings, pkg, base, name);
  const n = normalizeBarcode(p.code);
  const food = {
    id: n ? 'bc:' + n.gtin14 : 'off:' + p.code,
    barcode: n?.gtin14 || null,
    name,
    brand: niceCase(String(p.brands || '').split(',')[0].trim()),
    source: 'off',
    sourceId: String(p.code || ''),
    base,
    per100,
    servings,
    categories: Array.isArray(p.categories_tags) ? p.categories_tags : [],
    nutriscore: /^[a-e]$/.test(p.nutriscore_grade || '') ? p.nutriscore_grade : null,
    nova: p.nova_group || null,
    image: p.image_front_small_url || null,
  };
  food.quality = assessQuality(food.per100);
  if (offFlagged(p)) food.quality.push('off-flagged');
  return food;
}

async function offByBarcode(n) {
  const code = n.ean13 || n.ean8 || n.display;
  const j = await getJSON(`${OFF}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  if (!j || j.status !== 1 || !j.product) return null;
  return parseOff(j.product);
}

// Full-text search. Open Food Facts allows ~10 searches/minute, so only run on submit.
export async function offSearch(query) {
  const region = S.settings.region || 'united-states';
  const country = region === 'world' ? '' : `&tagtype_0=countries&tag_contains_0=contains&tag_0=${region}`;
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n${country}&fields=${OFF_FIELDS}`;
  const j = await getJSON(url, 15000);
  const seen = new Set();
  return (j?.products || []).map(parseOff).filter(f => {
    if (!hasCore(f.per100) || f.quality.includes('impossible') || seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

// ---------- barcode lookup ----------
const session = new Map();

export async function lookupBarcode(raw, format) {
  const n = normalizeBarcode(raw, format);
  if (!n) return { food: null, n: null, errors: { invalid: true } };

  const local = S.foods.get(S.byBarcode.get(n.gtin14));
  if (local) return { food: local, n, errors: {}, from: 'local' };
  if (session.has(n.gtin14)) return session.get(n.gtin14);

  const [u, o] = await Promise.allSettled([usdaByBarcode(n), offByBarcode(n)]);
  const usda = u.status === 'fulfilled' ? u.value : null;
  const off = o.status === 'fulfilled' ? o.value : null;
  const errors = { usda: u.status === 'rejected' ? u.reason : null, off: o.status === 'rejected' ? o.reason : null };

  let food = null;
  if (usda && hasCore(usda.per100)) {
    food = usda;
    if (off) {
      food.categories = off.categories;
      food.nutriscore = off.nutriscore;
      food.nova = off.nova;
      food.image = off.image;
      if (!food.servings.length && off.servings.length && off.base === food.base) food.servings = off.servings;
      if (hasCore(off.per100) && off.base === food.base) {
        const a = usda.per100.kcal, b = off.per100.kcal;
        if (Math.abs(a - b) > Math.max(15, 0.15 * Math.max(a, b))) food.conflict = { source: 'Open Food Facts', kcal100: b };
      }
    }
  } else if (off && hasCore(off.per100)) {
    food = off;
  } else {
    food = usda || off;
  }

  if (!food && n.alt) {
    const r = await lookupBarcode(n.alt.display, n.alt.ean8 ? 'ean_8' : undefined);
    if (r.food) return r;
  }
  if (food) {
    food.barcode = n.gtin14;
    food.id = 'bc:' + n.gtin14;
  }
  const res = { food, n, errors, from: 'remote' };
  if (food) session.set(n.gtin14, res);
  return res;
}

// ---------- category products (for lighter swaps) ----------
const altMem = new Map();
const slim = p => {
  const f = parseOff(p);
  if (!hasCore(f.per100) || f.quality.length) return null;
  return { code: f.sourceId, name: f.name, brand: f.brand, kcal: f.per100.kcal, p: f.per100.p, c: f.per100.c, f: f.per100.f, image: f.image };
};

export async function fetchCategoryProducts(tag) {
  const region = S.settings.region || 'united-states';
  const key = `v2|${tag}|${region}`;
  if (altMem.has(key)) return altMem.get(key);
  const cached = S.altCache[key];
  if (cached && Date.now() - cached.at < 7 * 864e5) {
    altMem.set(key, cached.items);
    return cached.items;
  }
  const country = region === 'world' ? '' : `&countries_tags_en=${region}`;
  const url = `${OFF}/api/v2/search?categories_tags=${encodeURIComponent(tag)}${country}&fields=code,product_name,product_name_en,brands,nutriments,serving_quantity,image_front_small_url,data_quality_errors_tags,data_quality_warnings_tags&page_size=60&sort_by=popularity_key`;
  const j = await getJSON(url, 15000);
  const items = (j?.products || []).map(slim).filter(Boolean);
  altMem.set(key, items);
  const entries = Object.entries({ ...S.altCache, [key]: { at: Date.now(), items } })
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 25);
  saveAltCache(Object.fromEntries(entries));
  return items;
}
