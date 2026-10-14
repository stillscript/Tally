// Targets, weight trend, and the weekly adaptive check-in.
//
// Start: Mifflin-St Jeor BMR × activity factor (the most accurate common formula).
// Then: every week, compare what you actually ate with how your trend weight actually moved.
//   burn ≈ average intake − (weight change × 7700 kcal/kg)
// The estimate is blended in gradually and capped per week so one noisy week can't whipsaw targets.
import { S, entriesFor, sumN, saveProfile, saveMeta } from './store.js';
import { KCAL_PER_KG, addDays, daysBetween, todayKey, clamp, mean } from './util.js';

export const ACTIVITY = [
  { id: 'sedentary', label: 'Mostly sitting', sub: 'Desk job, not much walking', f: 1.2 },
  { id: 'light', label: 'Lightly active', sub: 'On your feet some, or 1–3 workouts a week', f: 1.375 },
  { id: 'moderate', label: 'Active', sub: '3–5 workouts a week, or an active job', f: 1.55 },
  { id: 'very', label: 'Very active', sub: 'Hard training most days, or a physical job', f: 1.725 },
];

// Weekly loss as % of body weight. ~0.5–1%/week is the evidence-based range for keeping muscle.
export const PACES = [
  { id: 'steady', pct: 0.5, label: 'Steady', sub: 'Easiest to stick with, best for keeping strength' },
  { id: 'balanced', pct: 0.75, label: 'Balanced', sub: 'Recommended for most people' },
  { id: 'fast', pct: 1.0, label: 'Fast', sub: 'Harder; best with plenty of weight to lose' },
];
export const paceOf = p => PACES.find(x => x.id === p.pace) || PACES[1];

export const ageFrom = birthYear => new Date().getFullYear() - birthYear;

export function bmr(p, kg) {
  return 10 * kg + 6.25 * p.heightCm - 5 * ageFrom(p.birthYear) + (p.sex === 'male' ? 5 : -161);
}
export function formulaTdee(p, kg) {
  return bmr(p, kg) * (ACTIVITY.find(a => a.id === p.activity)?.f || 1.375);
}

// Protein per kg of goal weight. People who lift get the higher end of the evidence range
// (~1.6–2.4 g/kg in a deficit) to hold on to muscle; profiles from before this setting count as lifting.
export const lifts = p => p.lifts !== false;
export const proteinPerKg = p => (lifts(p) ? 2.0 : 1.6);

export function computeTargets(p, tdee, kg) {
  const atGoal = kg <= p.goalWeightKg + 0.3;
  const deficit = atGoal ? 0 : (paceOf(p).pct / 100) * kg * KCAL_PER_KG / 7;
  const floor = p.sex === 'male' ? 1500 : 1200;
  const raw = tdee - deficit;
  const kcal = Math.round(Math.max(floor, raw) / 10) * 10;
  const protein = Math.round((proteinPerKg(p) * p.goalWeightKg) / 5) * 5;
  // Fat: at least 25% of calories, never below 0.6 g/kg goal weight.
  const fat = Math.round(Math.max(0.6 * p.goalWeightKg, (0.25 * kcal) / 9));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, floored: raw < floor, maintenance: atGoal };
}

// ---------- weight trend ----------
// Exponentially smoothed trend (α = 0.1, as in The Hacker's Diet / Happy Scale).
// Missing days are linearly interpolated so gaps don't distort the line.
export function weightSeries(weights = S.weights) {
  if (!weights.length) return [];
  const alpha = 0.1;
  const out = [];
  let trend = weights[0].kg;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (i > 0) {
      const prev = weights[i - 1];
      const gap = daysBetween(prev.date, w.date);
      for (let d = 1; d < gap; d++) {
        const kg = prev.kg + ((w.kg - prev.kg) * d) / gap;
        trend += alpha * (kg - trend);
        out.push({ date: addDays(prev.date, d), kg, trend, real: false });
      }
      trend += alpha * (w.kg - trend);
    }
    out.push({ date: w.date, kg: w.kg, trend, real: true });
  }
  return out;
}

export function latestTrendKg() {
  const s = weightSeries();
  return s.length ? s[s.length - 1].trend : S.profile?.startWeightKg;
}

// Least-squares slope of real weigh-ins in a window, kg/day. Null if too little data.
export function slopeKgPerDay(endDate = todayKey(), days = 21) {
  const start = addDays(endDate, -(days - 1));
  const pts = S.weights.filter(w => w.date >= start && w.date <= endDate);
  if (pts.length < 4) return null;
  const xs = pts.map(w => daysBetween(start, w.date));
  if (xs[xs.length - 1] - xs[0] < 7) return null;
  const mx = mean(xs);
  const my = mean(pts.map(w => w.kg));
  let num = 0, den = 0;
  pts.forEach((w, i) => {
    num += (xs[i] - mx) * (w.kg - my);
    den += (xs[i] - mx) ** 2;
  });
  return den ? num / den : null;
}

const dayKcal = d => sumN(entriesFor(d)).kcal;
// Days with very little logged are probably incomplete; leave them out of the burn estimate.
export const isLoggedDay = (d, targetKcal) => dayKcal(d) >= Math.max(800, 0.4 * targetKcal);

export function checkInDue(today = todayKey()) {
  const p = S.profile;
  if (!p) return false;
  return daysBetween(S.meta.lastCheckIn || p.startDate, today) >= 7;
}
export function daysToCheckIn(today = todayKey()) {
  const p = S.profile;
  return Math.max(0, 7 - daysBetween(S.meta.lastCheckIn || p.startDate, today));
}

export function checkInPreview(today = todayKey()) {
  const p = S.profile;
  const end = addDays(today, -1);
  const start = addDays(end, -20);
  const logged = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isLoggedDay(d, p.targets.kcal)) logged.push(dayKcal(d));
  const slope = slopeKgPerDay(end, 21);
  const kg = latestTrendKg();
  const prior = p.tdee;
  let next, mode, observed = null;
  if (logged.length >= 10 && slope != null) {
    observed = clamp(mean(logged) - slope * KCAL_PER_KG, 1000, 6000);
    const w = 0.5 * Math.min(1, logged.length / 14);
    next = clamp(prior + w * (observed - prior), prior - 250, prior + 250);
    mode = 'adaptive';
  } else if (p.tdeeSource === 'adaptive') {
    next = prior;
    mode = 'hold';
  } else {
    next = formulaTdee(p, kg);
    mode = 'formula';
  }
  next = Math.round(next / 10) * 10;
  return {
    mode, prior, next, observed, kg,
    avgIntake: logged.length ? mean(logged) : null,
    loggedDays: logged.length,
    weighIns: S.weights.filter(w => w.date >= start && w.date <= end).length,
    slopeKgPerWeek: slope != null ? slope * 7 : null,
    targets: p.manualTargets ? p.targets : computeTargets(p, next, kg),
  };
}

export async function applyCheckIn(pre, accept) {
  const p = S.profile;
  const today = todayKey();
  if (accept) {
    await saveProfile({
      ...p,
      tdee: pre.next,
      tdeeSource: pre.mode === 'adaptive' ? 'adaptive' : p.tdeeSource,
      targets: pre.targets,
    });
  }
  const log = [...(S.meta.checkIns || []), {
    date: today, tdee: accept ? pre.next : p.tdee, mode: pre.mode,
    avgIntake: pre.avgIntake, slopeKgPerWeek: pre.slopeKgPerWeek, accepted: accept,
  }].slice(-60);
  await saveMeta({ lastCheckIn: today, checkIns: log });
}

// When will the goal be reached? Uses the real trend once there's enough data.
export function projection() {
  const p = S.profile;
  const kg = latestTrendKg();
  const toGo = kg - p.goalWeightKg;
  if (toGo <= 0.3) return { reached: true, toGo: 0 };
  const slope = slopeKgPerDay(todayKey(), 28);
  const trendRate = slope != null && slope < -0.01 ? -slope : null;
  const planRate = ((paceOf(p).pct / 100) * kg) / 7;
  const rate = trendRate ?? planRate;
  const days = Math.ceil(toGo / rate);
  return { reached: false, toGo, days, date: addDays(todayKey(), days), basis: trendRate ? 'trend' : 'plan', perWeekKg: rate * 7, gaining: slope != null && slope > 0.01 };
}
