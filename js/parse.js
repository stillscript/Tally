// Turns "two eggs, a slice of toast and a black coffee" into foods + amounts.
// Runs on the phone against built-in foods, your foods and saved meals; anything it
// can't place is returned as "unmatched" (Claude can estimate those if connected).
import { searchLocal } from './search.js';
import { unitsFor, defaultAmount, findUnit, nutrientsFor, amountText } from './sources.js';

const NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, few: 3, half: 0.5, quarter: 0.25, dozen: 12,
};
// Spoken unit → words that appear in serving labels (or a base unit).
const UNITS = {
  cup: ['cup'], cups: ['cup'], slice: ['slice'], slices: ['slice'], piece: ['piece'], pieces: ['piece'],
  tablespoon: ['tbsp', 'tablespoon'], tablespoons: ['tbsp', 'tablespoon'], tbsp: ['tbsp', 'tablespoon'],
  teaspoon: ['tsp', 'teaspoon'], teaspoons: ['tsp', 'teaspoon'], tsp: ['tsp', 'teaspoon'],
  scoop: ['scoop'], scoops: ['scoop'], can: ['can'], cans: ['can'], bottle: ['bottle'], bottles: ['bottle'],
  glass: ['glass', 'serving', 'cup'], glasses: ['glass', 'serving', 'cup'], serving: ['serving'], servings: ['serving'],
  large: ['large'], medium: ['medium'], small: ['small'], container: ['container'], bar: ['bar'], bars: ['bar'],
  oz: '#oz', ounce: '#oz', ounces: '#oz', g: '#g', gram: '#g', grams: '#g', lb: '#lb', lbs: '#lb', pound: '#lb', pounds: '#lb', ml: '#ml',
};

function normalize(text) {
  return String(text || '').toLowerCase()
    .replace(/[“”"!?]/g, ' ')
    .replace(/\b(i had|i ate|i've had|i've eaten|for (breakfast|lunch|dinner|a snack)|just|some|about|around|like)\b/g, ' ')
    .replace(/\b(\d+|one|two|three|four|five) and a half\b/g, (_, n) => String((Number(n) || NUM[n]) + 0.5))
    .replace(/\ba (couple|few) of\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const leadingAmount = label => {
  const m = String(label).match(/^\s*(½|¼|¾|\d+\/\d+|\d+(?:\.\d+)?)/);
  if (!m) return 1;
  const s = m[1];
  if (s === '½') return 0.5;
  if (s === '¼') return 0.25;
  if (s === '¾') return 0.75;
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return a / b; }
  return Number(s) || 1;
};

function parseQty(words) {
  let qty = null;
  while (words.length) {
    const w = words[0];
    let v = null;
    if (/^\d+(\.\d+)?$/.test(w)) v = Number(w);
    else if (/^\d+\/\d+$/.test(w)) { const [a, b] = w.split('/').map(Number); v = a / b; }
    else if (w in NUM) v = NUM[w];
    if (v == null) break;
    words.shift();
    qty = qty == null ? v : qty * v; // "half a" = 0.5, "a dozen" = 12, "two dozen" = 24
  }
  return qty;
}

function amountFor(food, qty, unit) {
  const units = unitsFor(food);
  if (typeof unit === 'string' && unit.startsWith('#')) {
    const base = food.base === 'ml';
    if (unit === '#g' || unit === '#ml') { const u = units.find(x => x.key === (base ? 'ml' : 'g')); if (u) return { qty, unit: u }; }
    if (unit === '#oz') { const u = units.find(x => x.key === (base ? 'floz' : 'oz')); if (u) return { qty, unit: u }; }
    if (unit === '#lb') { const u = units.find(x => x.key === 'oz'); if (u) return { qty: qty * 16, unit: u }; }
  } else if (unit) {
    const u = units.find(x => x.serving && unit.some(w => x.label.toLowerCase().includes(w)));
    if (u) return { qty: qty / leadingAmount(u.label), unit: u };
  }
  const a = defaultAmount(food);
  const def = findUnit(food, a.unit);
  // "a dozen almonds" counts pieces, but the default serving is a weight or volume (1 oz, 1 cup):
  // don't turn 12 almonds into 12 oz. Fall back to one serving, flagged as approximate.
  if (!unit && qty >= 4 && (!def.serving || /^\S+\s+(oz|cup|tbsp|tsp|tablespoon|teaspoon|serving)\b/i.test(def.label))) {
    return { qty: a.qty, unit: def, approx: true };
  }
  return { qty: a.qty * qty, unit: def, approx: !!unit };
}

export function parseSpoken(text) {
  const clean = normalize(text);
  if (!clean) return { items: [], unmatched: [] };
  const parts = clean.split(/\s*(?:,|;|\band then\b|\bthen\b|\bplus\b|\balong with\b|\bwith\b|\band\b)\s*/).filter(Boolean);
  const items = [];
  const unmatched = [];
  for (const raw of parts) {
    const words = raw.split(' ').filter(Boolean);
    const qtyRaw = parseQty(words);
    let unit = null;
    if (words.length > 1 && UNITS[words[0]]) unit = UNITS[words.shift()];
    if (words[0] === 'of') words.shift();
    const phrase = words.join(' ');
    if (!phrase) continue;
    const qty = qtyRaw ?? 1;
    const r = searchLocal(phrase);
    const food = r.common[0] || r.yours[0];
    if (food) {
      const a = amountFor(food, qty, unit);
      items.push({ key: raw, said: raw, food, qty: Math.round(a.qty * 100) / 100, unit: a.unit, approx: a.approx });
    } else if (r.meals[0]) {
      items.push({ key: raw, said: raw, meal: r.meals[0], qty });
    } else {
      unmatched.push(raw);
    }
  }
  return { items, unmatched };
}

// Entry payload for a parsed food item.
export function entryFor(item, { date, meal }) {
  const grams = item.qty * item.unit.g;
  return {
    date, meal, foodId: item.food.id, name: item.food.name, brand: item.food.brand || '',
    qty: item.qty, unit: item.unit.key, unitLabel: item.unit.label, amount: amountText(item.qty, item.unit),
    grams, n: nutrientsFor(item.food.per100, grams),
  };
}
