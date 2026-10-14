import { html, useState, useMemo } from '../preact.js';
import { S, entriesFor, sumN } from '../store.js';
import { weightSeries, latestTrendKg, projection, checkInDue, daysToCheckIn, paceOf } from '../goals.js';
import { weeklyPatterns } from '../insights.js';
import { WeightChart, CalorieBars } from './charts.js';
import { Seg, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet } from './nav.js';
import { openAi, copySummary } from './ai.js';
import { todayKey, addDays, fmtInt, fmtW, wUnit, round, toDisplayWeight, parseKey, mean, prettyDate } from '../util.js';

export function Progress() {
  const [range, setRange] = useState('30');
  const units = S.settings.units;
  const p = S.profile;
  const u = wUnit(units);
  const today = todayKey();

  const all = useMemo(() => weightSeries(), [S.weights]);
  const series = range === 'all' ? all : all.filter(s => s.date >= addDays(today, -(Number(range) - 1)));
  const trendNow = latestTrendKg();
  const weekAgo = all.find(s => s.date === addDays(all[all.length - 1]?.date || today, -7));
  const change7 = weekAgo ? trendNow - weekAgo.trend : null;
  const proj = projection();

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ date: d, kcal: sumN(entriesFor(d)).kcal, today: d === today });
  }
  const logged = days.filter(d => d.kcal >= 400 && !d.today);
  const avg = logged.length ? mean(logged.map(d => d.kcal)) : null;
  const onTarget = logged.filter(d => Math.abs(d.kcal - p.targets.kcal) <= p.targets.kcal * 0.1).length;
  const patterns = useMemo(() => weeklyPatterns(), [S.entries.length, p.targets.kcal]);

  return html`<div class="progress">
    <h1 class="screen-title">Progress</h1>

    <section class="card">
      <header class="card-head">
        <h2>Weight</h2>
        <${Seg} small label="Range" value=${range} onChange=${setRange}
          options=${[{ value: '30', label: '1M' }, { value: '90', label: '3M' }, { value: 'all', label: 'All' }]} />
      </header>
      <div class="stat-row">
        <div class="stat"><span class="stat-num">${fmtW(trendNow, units)}<small>${u}</small></span><span class="stat-label">Trend weight</span></div>
        <div class="stat"><span class=${'stat-num ' + (change7 == null ? '' : change7 <= 0 ? 'down' : 'up')}>
          ${change7 == null ? '—' : `${change7 <= 0 ? '−' : '+'}${fmtW(Math.abs(change7), units)}`}<small>${change7 == null ? '' : u}</small></span>
          <span class="stat-label">Last 7 days</span></div>
        <div class="stat"><span class="stat-num">${fmtW(p.goalWeightKg, units)}<small>${u}</small></span><span class="stat-label">Goal</span></div>
      </div>
      <${WeightChart} series=${series} goalKg=${p.goalWeightKg} units=${units} />
      <p class="muted small proj">
        ${proj.reached ? 'You’re at your goal weight. Nice work — targets hold you here.'
          : proj.gaining ? 'Your trend is drifting up lately. Tighten up logging for a week and the check-in will adjust.'
          : html`${fmtW(proj.toGo, units)} ${u} to go. ${proj.basis === 'trend' ? 'At your current pace' : `At your planned pace (${round(toDisplayWeight(proj.perWeekKg, units), 1)} ${u}/week)`}, you’ll get there around <b>${parseKey(proj.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: proj.days > 300 ? 'numeric' : undefined })}</b>.`}
      </p>
      <button class="btn block" onClick=${() => openSheet('weight', {})}><${Icon} n="scale" /> Log weight</button>
    </section>

    <section class="card">
      <header class="card-head"><h2>Calories</h2><span class="muted small">last 7 days</span></header>
      <${CalorieBars} days=${days} target=${p.targets.kcal} />
      <p class="muted small">${avg != null
        ? html`Average <b>${fmtInt(avg)}</b> kcal on ${logged.length} logged day${logged.length > 1 ? 's' : ''} · ${onTarget} within 10% of target`
        : 'Log a full day to start seeing averages.'}</p>
    </section>

    <section class="card">
      <header class="card-head"><h2>This week</h2></header>
      <div class="stack">${patterns.map(x => html`<${Note} tone=${x.tone}>${x.text}<//>`)}</div>
    </section>

    <section class="card">
      <header class="card-head"><h2>Ask Claude</h2></header>
      <p class="small muted">Ask how your week went, what to change, or why the scale is doing what it’s doing. Answers are based on your actual log.</p>
      <div class="row-btns">
        <button class="btn small primary" onClick=${() => openAi('coach')}><${Icon} n="chat" size=${18} /> Ask a question</button>
        <button class="btn small" onClick=${copySummary}><${Icon} n="copy" size=${18} /> Copy for a Claude chat</button>
      </div>
    </section>

    <section class="card">
      <header class="card-head"><h2>Your burn</h2></header>
      <p><b>${fmtInt(p.tdee)} kcal/day</b> estimated · target <b>${fmtInt(p.targets.kcal)}</b>${' '}(${p.targets.maintenance ? 'maintenance' : `${paceOf(p).label.toLowerCase()} pace`})</p>
      <p class="muted small">${p.tdeeSource === 'adaptive'
        ? 'Calibrated from your own logging and weight trend.'
        : 'Based on the standard formula for now. After ~2 weeks of logging and weigh-ins, Tally calibrates it to you.'}
        ${checkInDue() ? '' : ` Next check-in in ${daysToCheckIn()} day${daysToCheckIn() === 1 ? '' : 's'}.`}</p>
      ${checkInDue() && html`<button class="btn primary block" onClick=${() => openSheet('checkin')}>Run weekly check-in</button>`}
    </section>

    ${S.weights.length > 0 && html`<section class="card">
      <header class="card-head"><h2>Weigh-ins</h2></header>
      ${[...S.weights].reverse().slice(0, 10).map(w => html`<button class="entry" onClick=${() => openSheet('weight', { date: w.date })}>
        <span class="e-main"><span class="e-name">${prettyDate(w.date)}</span></span>
        <span class="e-nums"><b>${fmtW(w.kg, units)}</b><small>${u}</small></span>
      </button>`)}
    </section>`}
  </div>`;
}
