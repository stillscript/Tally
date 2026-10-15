// Food notes and lighter swaps, designed not to nag:
//  • at most one note per food view, built from the real numbers and today's budget
//  • the same note never repeats for the same food within a few days; wording rotates
//  • a daily cap on warnings, and positives only when something genuinely stands out
//  • swaps are real products from the same category, rotated so you don't see the same three
import { S, saveMeta, entriesFor, sumN, logCounts } from './store.js';
import { fetchCategoryProducts } from './sources.js';
import { isLoggedDay } from './goals.js';
import { todayKey, addDays, daysBetween, parseKey, fmtG, fmtInt, pct, ordinal, hash, mean } from './util.js';

const DV = { satFat: 20, sodium: 2300, addedSugar: 50, fiber: 28 };

function context({ food, n, date, totals, targets }) {
  const kcal = n.kcal || 0;
  let week = { c: 0, kcal: 0 };
  for (let i = 0; i < 7; i++) {
    for (const e of entriesFor(addDays(date, -i))) {
      if (e.foodId === food.id) { week.c++; week.kcal += e.n.kcal; }
    }
  }
  return {
    food, n, kcal, week,
    fatShare: kcal > 0 ? (n.f * 9) / kcal : 0,
    pDensity: kcal > 0 ? (n.p / kcal) * 100 : 0,
    remFat: targets.fat - totals.f,
    remP: targets.protein - totals.p,
  };
}

const RULES = {
  fat: {
    tone: 'warn',
    test: x => (x.n.f >= 12 && x.fatShare >= 0.5 ? 2 + x.n.f / Math.max(8, x.remFat) : null),
    lines: x => [
      x.remFat > 0
        ? `${fmtG(x.n.f)} g of fat — about ${pct(Math.min(x.n.f / x.remFat, 9.99))} of the fat you have left today.`
        : `You're already at today's fat target, and this adds ${fmtG(x.n.f)} g more.`,
      `${Math.round(x.fatShare * 100)}% of these calories come from fat (${fmtG(x.n.f)} g).`,
      `Fat-heavy: ${fmtG(x.n.f)} g fat in ${fmtInt(x.kcal)} kcal, which leaves less room for protein today.`,
    ],
  },
  satFat: {
    tone: 'warn',
    test: x => (x.n.satFat >= 5 ? 1.5 + x.n.satFat / DV.satFat : null),
    lines: x => [
      `${fmtG(x.n.satFat)} g saturated fat — ${pct(x.n.satFat / DV.satFat)} of the daily limit in one go.`,
      `High in saturated fat: ${fmtG(x.n.satFat)} g (the daily limit is about 20 g).`,
    ],
  },
  sugar: {
    tone: 'warn',
    test: x => {
      if (x.food.source === 'usda-generic') return null; // whole fruit, milk etc.
      const added = x.food.per100.addedSugar != null;
      const g = added ? x.n.addedSugar : x.n.sugar;
      return g >= (added ? 12 : 20) ? 1.2 + g / DV.addedSugar : null;
    },
    lines: x => {
      const added = x.food.per100.addedSugar != null;
      const g = added ? x.n.addedSugar : x.n.sugar;
      return [
        `${fmtG(g)} g of ${added ? 'added ' : ''}sugar — roughly ${Math.max(1, Math.round(g / 4))} teaspoons.`,
        `${added ? 'Added sugar' : 'Sugar'}: ${fmtG(g)} g. That's ${pct(g / DV.addedSugar)} of a day's added-sugar limit.`,
      ];
    },
  },
  sodium: {
    tone: 'info',
    test: x => (x.n.sodium >= 700 ? 1 + x.n.sodium / DV.sodium : null),
    lines: x => [
      `${fmtInt(x.n.sodium)} mg sodium (${pct(x.n.sodium / DV.sodium)} of a day). Salty meals can bump the scale tomorrow — that's water, not fat.`,
      `Pretty salty: ${fmtInt(x.n.sodium)} mg sodium. If tomorrow's weigh-in jumps, this is the likely reason.`,
    ],
  },
  lowProtein: {
    tone: 'info',
    test: x => (x.kcal >= 300 && x.pDensity < 4 && x.remP >= 30 ? 1 + x.kcal / 600 : null),
    lines: x => [
      `${fmtInt(x.kcal)} kcal with only ${fmtG(x.n.p)} g protein, and you've still got ${fmtInt(x.remP)} g of protein to go today.`,
      `Lots of calories, little protein (${fmtG(x.n.p)} g). Pairing it with something protein-heavy will keep you fuller.`,
    ],
  },
  repeat: {
    tone: 'info',
    test: x => (x.week.c >= 3 && x.kcal >= 200 ? 1 + x.week.c / 5 : null),
    lines: x => [
      `This would be the ${ordinal(x.week.c + 1)} time this week — ${fmtInt(x.week.kcal)} kcal from it so far.`,
      `You've had this ${x.week.c} times in the last 7 days (${fmtInt(x.week.kcal)} kcal in total).`,
    ],
  },
  protein: {
    tone: 'good',
    positive: true,
    test: x => (x.n.p >= 15 && x.pDensity >= 9 ? 1 : null),
    lines: x => [
      `Solid pick — ${fmtG(x.n.p)} g protein for ${fmtInt(x.kcal)} kcal.`,
      x.remP > 0
        ? `Covers ${pct(Math.min(1, x.n.p / x.remP))} of the protein you still need today.`
        : `${fmtG(x.pDensity)} g of protein per 100 kcal — very efficient.`,
      `${fmtG(x.pDensity)} g of protein per 100 kcal. Foods like this make a deficit much easier.`,
    ],
  },
  fiber: {
    tone: 'good',
    positive: true,
    test: x => (x.n.fiber >= 7 ? 0.8 : null),
    lines: x => [
      `${fmtG(x.n.fiber)} g of fiber — that helps keep hunger down.`,
      `Good fiber hit: ${fmtG(x.n.fiber)} g (about ${pct(x.n.fiber / DV.fiber)} of a day).`,
    ],
  },
};

// Choose (and remember) at most one note for this food view.
export function pickInsight(args) {
  const { food, n } = args;
  if (S.settings.tips === false || !n.kcal || S.meta.muted?.[food.id]) return null;
  const x = context(args);
  const today = todayKey();
  const log = S.meta.insights || {};
  const warnsToday = S.meta.tipDay === today ? S.meta.tipCount || 0 : 0;

  const cands = [];
  for (const [type, rule] of Object.entries(RULES)) {
    const score = rule.test(x);
    if (score == null) continue;
    const rec = log[`${food.id}:${type}`];
    if (rec && daysBetween(rec.d, today) < (rule.positive ? 10 : 4)) continue;
    cands.push({ type, score, positive: !!rule.positive });
  }
  const warn = cands.filter(c => !c.positive).sort((a, b) => b.score - a.score);
  const good = cands.filter(c => c.positive).sort((a, b) => b.score - a.score);
  let pick = null;
  if (warn.length) pick = warnsToday < 4 ? warn[0] : null;
  else if (good.length && S.meta.goodDay !== today) pick = good[0];
  if (!pick) return null;

  const key = `${food.id}:${pick.type}`;
  const variants = RULES[pick.type].lines(x).length;
  const prev = log[key]?.v;
  const v = prev == null ? hash(food.id + today) % variants : (prev + 1) % variants;
  const pruned = Object.fromEntries(Object.entries(log).filter(([, r]) => daysBetween(r.d, today) < 30));
  saveMeta({
    insights: { ...pruned, [key]: { d: today, v } },
    tipDay: today,
    tipCount: pick.positive ? warnsToday : warnsToday + 1,
    goodDay: pick.positive ? today : S.meta.goodDay,
  });
  return { type: pick.type, v };
}

// Render with live numbers (the amount can change after the note was chosen).
export function renderInsight(pick, args) {
  if (!pick) return null;
  const rule = RULES[pick.type];
  const x = context(args);
  if (rule.test(x) == null) return null;
  const lines = rule.lines(x);
  return { text: lines[pick.v % lines.length], tone: rule.tone };
}

export async function muteFood(foodId) {
  await saveMeta({ muted: { ...(S.meta.muted || {}), [foodId]: true } });
}

// ---------- lighter swaps ----------
export function wantsAlternatives(food) {
  if (S.settings.tips === false || S.meta.muted?.[food.id]) return false;
  const c = food.per100;
  if (!food.categories?.some(t => t.startsWith('en:')) || !c?.kcal || c.kcal < 150) return false;
  const fatShare = (c.f * 9) / c.kcal;
  const pDensity = (c.p / c.kcal) * 100;
  const sugar = c.addedSugar ?? c.sugar ?? 0;
  return (fatShare >= 0.45 && c.f >= 12) || (c.kcal >= 380 && pDensity < 8) || sugar >= 25;
}

export async function findAlternatives(food) {
  const cats = food.categories.filter(t => t.startsWith('en:'));
  const cur = food.per100;
  const curPD = (cur.p / cur.kcal) * 100;
  // Try the most specific category first. If everything there is equally heavy, widen to a
  // mid-level one (e.g. "chocolate-hazelnut spreads" → "sweet spreads"); neighbors at the
  // end of the list are usually near-synonyms.
  const useful = cats.filter(t => !/^en:(foods?|snacks|plant-based-foods.*|beverages.*|breakfasts|fats)$/.test(t));
  const tags = [...new Set([useful[useful.length - 1], useful[Math.floor(useful.length * 0.3)]])].filter(Boolean);
  for (let i = 0; i < tags.length; i++) {
    const items = await fetchCategoryProducts(tags[i]);
    const ranked = rankAlternatives(items, food, cur, curPD);
    if (ranked.length >= 2 || i === tags.length - 1) return rotate(ranked, tags[i]);
  }
  return [];
}

function rankAlternatives(items, food, cur, curPD) {
  const seen = new Set();
  return items
    .filter(a => a.code !== food.sourceId && !food.barcode?.endsWith(a.code))
    .map(a => {
      const kcalCut = (cur.kcal - a.kcal) / cur.kcal;
      const pd = (a.p / a.kcal) * 100;
      const fatCut = (cur.f - a.f) / Math.max(cur.f, 1);
      const better = kcalCut >= 0.2 || (pd >= curPD + 3 && kcalCut > -0.05) || (fatCut >= 0.4 && kcalCut >= 0);
      return { ...a, kcalCut, dP: a.p - cur.p, score: kcalCut + (pd - curPD) * 0.05 + fatCut * 0.3, better };
    })
    .filter(a => {
      const k = (a.name + '|' + a.brand).toLowerCase();
      if (!a.better || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

function rotate(ranked, tag) {
  const seenList = S.meta.altSeen?.[tag] || [];
  const seen = new Set(seenList);
  const pool = ranked.slice(0, 12);
  const fresh = pool.filter(a => !seen.has(a.code));
  // Already-shown ones come back oldest-first.
  const old = pool.filter(a => seen.has(a.code)).sort((a, b) => seenList.indexOf(b.code) - seenList.indexOf(a.code));
  const pick = [...fresh, ...old].slice(0, 3);
  const nextSeen = [...new Set([...pick.map(a => a.code), ...seenList])].slice(0, 40);
  saveMeta({ altSeen: { ...(S.meta.altSeen || {}), [tag]: nextSeen } });
  return pick;
}

export const categoryName = tag => (tag || '').replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');

// ---------- your own go-to foods ----------
export function proteinFriendlyFoods(limit = 3) {
  const counts = logCounts();
  return [...S.foods.values()]
    .filter(f => f.per100?.kcal > 0 && (f.per100.p / f.per100.kcal) * 100 >= 8 && counts.get(f.id))
    .sort((a, b) => counts.get(b.id) - counts.get(a.id) || b.per100.p / b.per100.kcal - a.per100.p / a.per100.kcal)
    .slice(0, limit);
}

// ---------- weekly patterns (Your week card) ----------
// Observations about one 7-day window. Averages and protein days live in the card itself,
// so these stick to what the numbers alone don't show.
export function weeklyPatterns(start, end) {
  const t = S.profile.targets;
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (d < S.profile.startDate || !isLoggedDay(d, t.kcal)) continue;
    const list = entriesFor(d);
    days.push({ d, list, tot: sumN(list) });
  }
  if (days.length < 3) return [];
  const out = [];
  const byName = new Map();
  let total = 0, fatKcal = 0, snackKcal = 0;
  for (const o of days) {
    for (const e of o.list) {
      byName.set(e.name, (byName.get(e.name) || 0) + e.n.kcal);
      total += e.n.kcal;
      fatKcal += e.n.f * 9;
      if (e.meal === 'snacks') snackKcal += e.n.kcal;
    }
  }
  const [topName, topKcal] = [...byName.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (topName && topKcal / total >= 0.12) {
    out.push({ tone: 'info', text: `${topName} was ${pct(topKcal / total)} of your calories (${fmtInt(topKcal)} kcal).` });
  }
  const weekend = days.filter(o => [0, 6].includes(parseKey(o.d).getDay()));
  const weekday = days.filter(o => ![0, 6].includes(parseKey(o.d).getDay()));
  if (weekend.length && weekday.length) {
    const gap = mean(weekend.map(o => o.tot.kcal)) - mean(weekday.map(o => o.tot.kcal));
    if (gap >= 250) out.push({ tone: 'warn', text: `Weekends ran about ${fmtInt(gap)} kcal higher than weekdays.` });
  }
  if (total && fatKcal / total >= 0.4) {
    out.push({ tone: 'info', text: `${pct(fatKcal / total)} of your calories came from fat. Trimming fat is usually the easiest way to make room for more protein.` });
  } else if (total && snackKcal / total >= 0.3) {
    out.push({ tone: 'info', text: `Snacks made up ${pct(snackKcal / total)} of your calories.` });
  }
  return out.slice(0, 3);
}
