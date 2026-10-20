// "Fill the gap": late in the day with protein still to go, suggest one or two small combos
// (1–3 foods, your usual amounts) that cover most of it, up to one sitting's worth, without going over your calories.
// Foods you've eaten in the last 30 days come first; a few no-cook staples fill in.
import { S, entriesFor } from './store.js';
import { commonFoods } from './search.js';
import { nutrientsFor, defaultAmount, findUnit } from './sources.js';
import { addDays, todayKey } from './util.js';

// No-cook, protein-dense staples, with a sensible amount (servings of the built-in foods).
const STAPLES = [
  { id: 'usda:170894', qty: 1 }, // Greek yogurt, nonfat — 1 container
  { id: 'usda:172182', qty: 1 }, // cottage cheese 2% — 1 cup
  { id: 'usda:173180', qty: 1 }, // whey protein — 1 scoop
  { id: 'usda:173709', qty: 1 }, // tuna in water — 1 can
  { id: 'usda:173424', qty: 2 }, // hard-boiled eggs — 2
  { id: 'usda:172941', qty: 4 }, // deli turkey — 4 slices
  { id: 'usda:171269', qty: 1 }, // skim milk — 1 cup
  { id: 'usda:168411', qty: 1 }, // edamame — 1 cup
];

const MIN_PROTEIN_LEFT = 25;
const MIN_KCAL_LEFT = 150;
const FROM_HOUR = 14;
// One sitting's worth: with a big gap left, dinner can do the rest.
const MAX_AIM = 50;

function portion(food, qty, unitKey) {
  const unit = findUnit(food, unitKey);
  if (!unit || !(qty > 0)) return null;
  const grams = qty * unit.g;
  return { food, qty, unit, grams, n: nutrientsFor(food.per100, grams) };
}

function candidates(today) {
  const seen = new Map(); // food id → times logged in 30 days
  const from = addDays(today, -30);
  for (const e of S.entries) {
    if (!e.foodId || e.date < from || e.date > today) continue;
    seen.set(e.foodId, (seen.get(e.foodId) || 0) + 1);
  }
  const out = [];
  for (const [id, count] of seen) {
    const f = S.foods.get(id);
    // Whole meals (photos, restaurants) aren't snack-sized building blocks.
    if (!f || f.aiItems || f.portionOnly || !f.per100?.kcal) continue;
    const a = defaultAmount(f);
    const c = portion(f, a.qty, a.unit);
    if (c) out.push({ ...c, familiar: count });
  }
  const common = new Map(commonFoods().map(f => [f.id, f]));
  for (const s of STAPLES) {
    if (seen.has(s.id)) continue;
    const f = common.get(s.id);
    const c = f && portion(f, s.qty, 's0');
    if (c) out.push({ ...c, familiar: 0 });
  }
  // Protein-forward foods only: at least 5 g and 6 g per 100 kcal.
  return out
    .filter(c => c.n.p >= 5 && c.n.kcal > 0 && (c.n.p / c.n.kcal) * 100 >= 6)
    .sort((a, b) => b.n.p / b.n.kcal + b.familiar * 0.01 - (a.n.p / a.n.kcal + a.familiar * 0.01))
    .slice(0, 12);
}

function scoreCombo(items, aim, kLeft) {
  const p = items.reduce((s, i) => s + i.n.p, 0);
  const kcal = items.reduce((s, i) => s + i.n.kcal, 0);
  if (kcal > kLeft + 30) return null;
  const cover = Math.min(p, aim) / aim;
  const familiar = items.filter(i => i.familiar > 0).length / items.length;
  // Cover the gap, with as few foods and as few calories as possible, preferring foods you eat.
  const score = cover * 100 - (items.length - 1) * 7 + familiar * 10 - (kcal / kLeft) * 12 - Math.max(0, p - aim * 1.3) * 0.5;
  return { items, p, kcal, cover, score };
}

export function fillTheGap(date = todayKey(), now = new Date()) {
  if (date !== todayKey() || now.getHours() < FROM_HOUR || !S.profile) return null;
  const t = S.profile.targets;
  const tot = entriesFor(date).reduce((s, e) => ({ p: s.p + e.n.p, kcal: s.kcal + e.n.kcal }), { p: 0, kcal: 0 });
  const pLeft = t.protein - tot.p;
  const kLeft = t.kcal - tot.kcal;
  if (pLeft < MIN_PROTEIN_LEFT || kLeft < MIN_KCAL_LEFT) return null;

  const c = candidates(date);
  const combos = [];
  const aim = Math.min(pLeft, MAX_AIM);
  const consider = items => { const r = scoreCombo(items, aim, kLeft); if (r) combos.push(r); };
  for (let i = 0; i < c.length; i++) {
    consider([c[i]]);
    for (let j = i + 1; j < c.length; j++) {
      consider([c[i], c[j]]);
      for (let k = j + 1; k < c.length; k++) consider([c[i], c[j], c[k]]);
    }
  }
  combos.sort((a, b) => b.score - a.score);
  const best = combos.find(x => x.cover >= 0.5);
  if (!best) return null;
  const ids = new Set(best.items.map(i => i.food.id));
  const second = combos.find(x => x.cover >= 0.5 && x.items.every(i => !ids.has(i.food.id)));
  return { pLeft, kLeft, options: second ? [best, second] : [best] };
}
