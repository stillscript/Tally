// A readable snapshot of your log for Claude: paste it into a Claude chat, or send it with
// in-app questions. Plain text and short so it stays cheap and easy to read.
import { S, entriesFor, sumN } from './store.js';
import { weightSeries, latestTrendKg, paceOf, lifts, ACTIVITY } from './goals.js';
import { todayKey, addDays, parseKey, fmtInt, fmtG, toDisplayWeight, wUnit, round, MEALS } from './util.js';

export function dataSummary({ days = 28, detailDays = 7 } = {}) {
  const p = S.profile;
  const t = p.targets;
  const units = S.settings.units;
  const u = wUnit(units);
  const w = kg => `${round(toDisplayWeight(kg, units), 1)} ${u}`;
  const today = todayKey();
  const series = weightSeries();
  const byDate = new Map(S.weights.map(x => [x.date, x.kg]));
  const trendOn = d => series.find(s => s.date === d)?.trend;
  const out = [];

  out.push(`# Food and weight log from my Tally app (${parseKey(today).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })})`);
  out.push('');
  out.push(`- Goal: lose fat, ${w(latestTrendKg())} (trend) → ${w(p.goalWeightKg)}, ${paceOf(p).label.toLowerCase()} pace`);
  out.push(`- Lifts weights: ${lifts(p) ? 'yes' : 'no'} · Activity: ${ACTIVITY.find(a => a.id === p.activity)?.label || p.activity}`);
  out.push(`- Daily targets: ${fmtInt(t.kcal)} kcal · protein ${fmtInt(t.protein)} g · carbs ${fmtInt(t.carbs)} g · fat ${fmtInt(t.fat)} g${p.manualTargets ? ' (set by hand)' : ''}`);
  out.push(`- Estimated burn: ${fmtInt(p.tdee)} kcal/day (${p.tdeeSource === 'adaptive' ? 'calibrated from my logging and weight trend' : 'formula estimate'})`);
  const wk = trendOn(addDays(today, -7));
  if (series.length && wk != null) out.push(`- Trend weight change, last 7 days: ${round(toDisplayWeight(latestTrendKg() - wk, units), 1)} ${u}`);
  out.push('');

  out.push(`## Daily totals, last ${days} days`);
  out.push(`date | kcal | protein g | carbs g | fat g | weigh-in (${u})`);
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const list = entriesFor(d);
    const kg = byDate.get(d);
    const wt = kg != null ? round(toDisplayWeight(kg, units), 1) : '';
    if (!list.length) {
      if (kg != null) out.push(`${d} | not logged | | | | ${wt}`);
      continue;
    }
    const n = sumN(list);
    out.push(`${d}${d === today ? ' (today, in progress)' : ''} | ${fmtInt(n.kcal)} | ${fmtInt(n.p)} | ${fmtInt(n.c)} | ${fmtInt(n.f)} | ${wt}`);
  }
  out.push('');

  out.push(`## What I ate, last ${detailDays} days`);
  for (let i = detailDays - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const list = entriesFor(d);
    if (!list.length) continue;
    out.push(`### ${parseKey(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    for (const m of MEALS) {
      const items = list.filter(e => e.meal === m.id);
      if (!items.length) continue;
      out.push(`- ${m.label}: ` + items.map(e => `${e.name}${e.amount ? ` (${e.amount})` : ''} ${fmtInt(e.n.kcal)} kcal/${fmtG(e.n.p)}g P`).join('; '));
    }
  }
  out.push('');

  const counts = new Map();
  for (let i = 0; i < days; i++) {
    for (const e of entriesFor(addDays(today, -i))) {
      const c = counts.get(e.name) || { n: 0, kcal: 0, p: 0 };
      c.n++; c.kcal += e.n.kcal; c.p += e.n.p;
      counts.set(e.name, c);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].kcal - a[1].kcal).slice(0, 12);
  if (top.length) {
    out.push(`## Biggest calorie sources, last ${days} days`);
    for (const [name, c] of top) out.push(`- ${name}: ${c.n}× · ${fmtInt(c.kcal)} kcal · ${fmtInt(c.p)} g protein`);
    out.push('');
  }

  const checks = (S.meta.checkIns || []).slice(-6);
  if (checks.length) {
    out.push('## Weekly check-ins');
    for (const c of checks) out.push(`- ${c.date}: burn estimate ${fmtInt(c.tdee)} kcal${c.avgIntake ? `, averaged ${fmtInt(c.avgIntake)} kcal eaten` : ''}${c.accepted === false ? ' (kept old targets)' : ''}`);
  }
  return out.join('\n');
}
