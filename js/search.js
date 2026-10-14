// Instant, offline search over built-in everyday foods, saved meals and foods you've logged.
// Also cleans up queries before they go to USDA / Open Food Facts.
import { S } from './store.js';
import { COMMON_FOODS } from './data/common-foods.js';
import { BRAND_DRINKS } from './data/brand-drinks.js';

// Words people type that don't help matching ("a regular coke", "simple red apple").
const FILLER = new Set(['a', 'an', 'the', 'some', 'of', 'regular', 'simple', 'normal', 'just', 'one', 'piece', 'serving', 'my', 'with']);
// What food databases actually call things.
const REMOTE_SYNONYMS = { coke: 'coca-cola', 'mtn': 'mountain', pop: 'soda', oj: 'orange juice', pb: 'peanut butter' };

const singular = w => (w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
  : w.length > 3 && w.endsWith('es') && /(ch|sh|ss|x|o)es$/.test(w) ? w.slice(0, -2)
  : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export function tokens(q) {
  return String(q || '').toLowerCase().replace(/[^a-z0-9%/\s-]/g, ' ').split(/[\s-]+/)
    .filter(w => w && !FILLER.has(w)).map(singular);
}

export function remoteQuery(q) {
  const t = String(q || '').toLowerCase().split(/\s+/).filter(w => w && !FILLER.has(w));
  return t.map(w => REMOTE_SYNONYMS[w] || w).join(' ') || String(q || '').trim();
}

let common = null;
// Built-in foods as regular food objects. A copy you've logged (with your usual amount) wins.
export function commonFoods() {
  if (!common) {
    common = [
      ...COMMON_FOODS.map(f => ({ ...f, barcode: null, brand: '', source: 'usda-generic', base: 'g', categories: [], curated: true, quality: [] })),
      ...BRAND_DRINKS.map(f => ({ ...f, barcode: null, source: 'label', categories: [], curated: true, quality: [] })),
    ];
  }
  return common.map(f => S.foods.get(f.id) || f);
}

function score(qt, phrase, name, aliases) {
  const n = name.toLowerCase();
  const names = [n, ...aliases.map(a => a.toLowerCase())];
  if (names.includes(phrase)) return 100 - (n === phrase ? 0 : 2);
  if (names.some(x => x.startsWith(phrase))) return 85;
  const words = new Set(tokens(names.join(' ')));
  const nameWords = tokens(n);
  const hit = qt.filter(t => [...words].some(w => w.startsWith(t)));
  if (hit.length === qt.length) {
    const inName = qt.filter(t => nameWords.some(w => w.startsWith(t))).length;
    return 60 + inName * 5 - n.length / 40;
  }
  return 0;
}

function rank(list, q, getName, getAliases, limit) {
  const qt = tokens(q);
  if (!qt.length) return [];
  const phrase = qt.join(' ');
  return list
    .map(x => ({ x, s: score(qt, phrase, getName(x), getAliases(x)) }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(r => r.x);
}

export function searchLocal(q) {
  const commonIds = new Set(commonFoods().map(f => f.id));
  const yours = [...S.foods.values()].filter(f => !commonIds.has(f.id));
  return {
    common: rank(commonFoods(), q, f => f.name, f => f.aliases || [], 8),
    meals: rank(S.meals, q, m => m.name, m => m.items.map(i => i.name), 5),
    yours: rank(yours, q, f => `${f.name} ${f.brand || ''}`, () => [], 10),
  };
}
