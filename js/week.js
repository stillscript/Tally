// "Your week": a consistency score and day-by-day summary over 7 complete days.
//
// The score (0–100) rewards the four habits that actually drive results:
//   logging 40 · protein 30 · calories on target 20 · weigh-ins 10
// Windows end yesterday, so a half-eaten today never drags the score down, and
// days before you started using Tally don't count against you.
import { S, entriesFor, sumN } from './store.js';
import { isLoggedDay, weightSeries } from './goals.js';
import { todayKey, addDays, mean } from './util.js';

export const MIN_DAYS = 3;
export const PROTEIN_HIT = 0.9; // 90% of target counts as a hit
export const CAL_BAND = 0.1; // within ±10% of the calorie target
export const WEIGH_INS_PER_WEEK = 5;

export const SCORE_PARTS = [
  { key: 'logged', label: 'Logging', short: 'Logged', pts: 40,
    what: 'Days with your meals logged.', why: 'Complete logs are what the weekly check-in learns your real burn from.' },
  { key: 'protein', label: 'Protein', short: 'Protein', pts: 30,
    what: `Days at ${Math.round(PROTEIN_HIT * 100)}% or more of your protein target.`, why: 'Protects muscle while you lose fat.' },
  { key: 'calories', label: 'Calories', short: 'On target', pts: 20,
    what: `Days within ${Math.round(CAL_BAND * 100)}% of your calorie target.`, why: 'Steady days make progress, and your check-ins, predictable.' },
  { key: 'weighins', label: 'Weigh-ins', short: 'Weigh-ins', pts: 10,
    what: `Full points at ${WEIGH_INS_PER_WEEK} weigh-ins in 7 days.`, why: 'Feeds the trend line that shows real fat loss through water swings.' },
];

export function scoreBand(score) {
  if (score == null) return { label: 'Building your first week', tone: 'new' };
  if (score >= 90) return { label: 'Excellent', tone: 'top' };
  if (score >= 75) return { label: 'Great', tone: 'good' };
  if (score >= 60) return { label: 'Good', tone: 'good' };
  if (score >= 40) return { label: 'Building', tone: 'mid' };
  return { label: 'Getting started', tone: 'low' };
}

export function weekWindow(offset = 0) {
  const end = addDays(todayKey(), -1 - 7 * offset);
  return { start: addDays(end, -6), end };
}

// Trend weight on (or most recently before) a date.
function trendOn(series, d) {
  let hit = null;
  for (const s of series) {
    if (s.date > d) break;
    hit = s;
  }
  return hit;
}

export function weekSummary(offset = 0) {
  const p = S.profile;
  const t = p.targets;
  const { start, end } = weekWindow(offset);
  const weighed = new Set(S.weights.map(w => w.date));
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const tot = sumN(entriesFor(d));
    const eligible = d >= p.startDate;
    const logged = eligible && isLoggedDay(d, t.kcal);
    const ratio = t.kcal > 0 ? tot.kcal / t.kcal : 0;
    days.push({
      date: d, eligible, logged, kcal: tot.kcal, p: tot.p, ratio,
      proteinHit: logged && tot.p >= t.protein * PROTEIN_HIT,
      cal: !logged ? null : ratio > 1 + CAL_BAND ? 'over' : ratio < 1 - CAL_BAND ? 'under' : 'on',
      weighed: weighed.has(d),
    });
  }

  const el = days.filter(d => d.eligible);
  const n = el.length;
  const count = {
    logged: el.filter(d => d.logged).length,
    protein: el.filter(d => d.proteinHit).length,
    calories: el.filter(d => d.cal === 'on').length,
    weighins: el.filter(d => d.weighed).length,
    over: el.filter(d => d.cal === 'over').length,
    under: el.filter(d => d.cal === 'under').length,
  };
  const weighNeed = Math.max(1, Math.ceil((n * WEIGH_INS_PER_WEEK) / 7));
  const frac = n ? {
    logged: count.logged / n,
    protein: count.protein / n,
    calories: count.calories / n,
    weighins: Math.min(1, count.weighins / weighNeed),
  } : { logged: 0, protein: 0, calories: 0, weighins: 0 };
  const score = n >= MIN_DAYS ? Math.round(SCORE_PARTS.reduce((s, part) => s + part.pts * frac[part.key], 0)) : null;

  const loggedDays = el.filter(d => d.logged);
  const avg = loggedDays.length ? { kcal: mean(loggedDays.map(d => d.kcal)), p: mean(loggedDays.map(d => d.p)) } : null;

  const series = weightSeries();
  const a = trendOn(series, addDays(start, -1)) || series.find(s => s.date >= start && s.date <= end);
  const b = trendOn(series, end);
  const trendChange = a && b && a.date < b.date && b.date >= start ? b.trend - a.trend : null;

  return { offset, start, end, days, n, count, frac, weighNeed, score, avg, trendChange };
}

// The habit costing the most points: where the next week's easiest gains are.
export function biggestOpportunity(w) {
  return [...SCORE_PARTS]
    .map(part => ({ ...part, lost: part.pts * (1 - w.frac[part.key]) }))
    .sort((x, y) => y.lost - x.lost)[0];
}

export function strongest(w) {
  return [...SCORE_PARTS].sort((x, y) => w.frac[y.key] - w.frac[x.key] || y.pts - x.pts)[0];
}

// The earliest window that still overlaps your start date (for paging back).
export function oldestOffset() {
  const start = S.profile.startDate;
  let o = 0;
  while (o < 520 && weekWindow(o + 1).end >= start) o++;
  return o;
}
