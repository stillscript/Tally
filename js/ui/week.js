import { html, useState, useMemo } from '../preact.js';
import { S, emit } from '../store.js';
import { weekSummary, weekWindow, scoreBand, biggestOpportunity, strongest, oldestOffset, SCORE_PARTS, MIN_DAYS, PROTEIN_HIT, CAL_BAND } from '../week.js';
import { weeklyPatterns, proteinFriendlyFoods } from '../insights.js';
import { Sheet, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet, setTab } from './nav.js';
import { fmtInt, fmtW, wUnit, parseKey, shortDate, prettyDate } from '../util.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function rangeLabel(w) {
  if (w.offset === 0) return 'Last 7 days';
  const a = parseKey(w.start), b = parseKey(w.end);
  return a.getMonth() === b.getMonth()
    ? `${shortDate(w.start)} – ${b.getDate()}`
    : `${shortDate(w.start)} – ${shortDate(w.end)}`;
}

const partCount = (w, key) => (key === 'weighins' ? `${w.count.weighins}/${w.weighNeed}` : `${w.count[key]}/${w.n}`);

function insight(w) {
  if (w.score == null) {
    return w.n === 0
      ? 'Your week builds here. Each full day you log fills in a column below.'
      : `Your score appears after ${MIN_DAYS} full days (${w.n} so far). Log your meals and weigh in most mornings.`;
  }
  if (w.score >= 90) return 'Locked in: every habit is on track.';
  const best = strongest(w);
  const opp = biggestOpportunity(w);
  const praise = w.frac[best.key] >= 0.7 && best.key !== opp.key
    ? `${best.label} ${best.key === 'weighins' ? 'were' : 'was'} your strongest habit (${best.key === 'weighins' ? plural(w.count.weighins, 'weigh-in') : `${w.count[best.key]} of ${w.n} days`}). ` : '';
  let tip;
  if (opp.key === 'logged') tip = 'Easiest gain: log every day, even rough entries. Quick add counts.';
  else if (opp.key === 'protein') {
    const regs = proteinFriendlyFoods(2).map(f => f.name);
    tip = `Easiest gain: protein (${w.count.protein} of ${w.n} days). ` + (regs.length ? `Quick adds from your regulars: ${regs.join(' and ')}.` : 'Build each meal around a protein source.');
  } else if (opp.key === 'calories') {
    tip = w.count.over + w.count.under === 0 ? 'Easiest gain: log full days so they count toward calories on target.'
      : w.count.over >= w.count.under ? `Easiest gain: steadier calories. ${plural(w.count.over, 'day')} ran more than ${Math.round(CAL_BAND * 100)}% over target.`
      : `Easiest gain: steadier calories. ${plural(w.count.under, 'day')} came in well under target, which can cost energy and muscle.`;
  } else tip = `Easiest gain: weigh in most mornings (${w.count.weighins} of ${w.weighNeed} this week).`;
  return praise + tip;
}

function ScoreRing({ score, tone, size = 88 }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : score / 100;
  const mid = size / 2;
  return html`<span class=${'score-ring ' + tone} style=${{ width: size + 'px', height: size + 'px' }}>
    <svg viewBox="0 0 ${size} ${size}" width=${size} height=${size} aria-hidden="true">
      <circle cx=${mid} cy=${mid} r=${r} class="ring-track" stroke-width=${stroke} fill="none" />
      <circle cx=${mid} cy=${mid} r=${r} class="score-fill" stroke-width=${stroke} fill="none" stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - frac)} transform="rotate(-90 ${mid} ${mid})" />
    </svg>
    <span class="score-num">${score == null ? '—' : score}<small>${score == null ? '' : '/100'}</small></span>
  </span>`;
}

function DayColumn({ d }) {
  const letter = parseKey(d.date).toLocaleDateString(undefined, { weekday: 'narrow' });
  const h = Math.min(d.ratio, 1.3) / 1.3;
  const status = !d.eligible ? 'before' : d.logged ? d.cal : d.kcal > 0 ? 'partial' : 'empty';
  const label = `${prettyDate(d.date)}: ${!d.eligible ? 'before you started' : d.kcal > 0 ? `${fmtInt(d.kcal)} kcal${d.logged ? '' : ' (partly logged)'}` : 'nothing logged'}`
    + `${d.proteinHit ? ', protein hit' : ''}${d.weighed ? ', weighed in' : ''}. Open this day.`;
  const open = () => { S.ui.date = d.date; setTab('today'); emit(); };
  return html`<button class=${'day-col ' + status} onClick=${open} aria-label=${label}>
    <span class=${'pdot' + (d.proteinHit ? ' hit' : d.logged ? ' miss' : '')}></span>
    <span class="bar-box">
      <span class="tline"></span>
      ${d.kcal > 0 && html`<span class="kbar" style=${{ height: Math.max(4, h * 100) + '%' }}></span>`}
    </span>
    <span class="dname">${letter}</span>
    <span class="ddate">${parseKey(d.date).getDate()}</span>
    <span class=${'wmark' + (d.weighed ? ' on' : '')}></span>
  </button>`;
}

export function WeekCard() {
  const [offset, setOffset] = useState(0);
  const oldest = useMemo(() => oldestOffset(), [S.profile.startDate]);
  const w = useMemo(() => weekSummary(offset), [offset, S.entries, S.weights, S.profile]);
  const prev = useMemo(() => weekSummary(offset + 1), [offset, S.entries, S.weights, S.profile]);
  const patterns = useMemo(() => weeklyPatterns(w.start, w.end), [w]);
  const band = scoreBand(w.score);
  const units = S.settings.units;
  const t = S.profile.targets;
  const delta = w.score != null && prev.score != null ? w.score - prev.score : null;

  return html`<section class="card week-card">
    <header class="card-head">
      <h2>Your week</h2>
      <div class="week-nav">
        <button class="icon-btn small" onClick=${() => setOffset(offset + 1)} disabled=${offset >= oldest} aria-label="Earlier week"><${Icon} n="left" size=${18} /></button>
        <span class="week-range">${rangeLabel(w)}</span>
        <button class="icon-btn small" onClick=${() => setOffset(offset - 1)} disabled=${offset === 0} aria-label="Later week"><${Icon} n="right" size=${18} /></button>
      </div>
    </header>

    <div class="score-row">
      <button class="score-btn" onClick=${() => openSheet('score-info', { offset })} aria-label=${`Consistency score ${w.score ?? 'not ready yet'}. How it works`}>
        <${ScoreRing} score=${w.score} tone=${band.tone} />
      </button>
      <div class="score-text">
        <div class="score-head">
          <b>${band.label}</b>
          ${delta != null && html`<span class=${'score-delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '')}>
            ${delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : 'No change'} <span class="muted">vs 7 days before</span></span>`}
        </div>
        <p>${insight(w)}</p>
      </div>
    </div>

    <div class="score-parts">
      ${SCORE_PARTS.map(part => html`<button class="part" onClick=${() => openSheet('score-info', { offset })}>
        <span class="part-top"><span>${part.short}</span><b>${partCount(w, part.key)}</b></span>
        <span class="part-bar"><span class=${w.frac[part.key] < 0.5 ? 'low' : ''} style=${{ width: w.frac[part.key] * 100 + '%' }}></span></span>
      </button>`)}
    </div>

    <div class="week-strip">${w.days.map(d => html`<${DayColumn} key=${d.date} d=${d} />`)}</div>
    <div class="strip-legend">
      <span><i class="lg-dot"></i>protein hit</span>
      <span><i class="lg-line"></i>calorie target</span>
      <span><i class="lg-mark"></i>weighed in</span>
    </div>

    <div class="stat-row week-avgs">
      <div class="stat"><span class="stat-num">${w.avg ? fmtInt(w.avg.kcal) : '—'}</span>
        <span class="stat-label">avg kcal</span><span class="stat-sub">target ${fmtInt(t.kcal)}</span></div>
      <div class="stat"><span class="stat-num">${w.avg ? fmtInt(w.avg.p) : '—'}<small>${w.avg ? 'g' : ''}</small></span>
        <span class="stat-label">avg protein</span><span class="stat-sub">target ${fmtInt(t.protein)}g</span></div>
      <div class="stat"><span class=${'stat-num ' + (w.trendChange == null ? '' : w.trendChange <= 0 ? 'down' : 'up')}>
        ${w.trendChange == null ? '—' : `${w.trendChange <= 0 ? '−' : '+'}${fmtW(Math.abs(w.trendChange), units)}`}<small>${w.trendChange == null ? '' : wUnit(units)}</small></span>
        <span class="stat-label">trend weight</span><span class="stat-sub">${w.trendChange == null ? 'needs weigh-ins' : 'over these 7 days'}</span></div>
    </div>

    ${patterns.length > 0 && html`<div class="week-notes">
      <span class="field-label">Patterns</span>
      <div class="stack">${patterns.map(x => html`<${Note} tone=${x.tone}>${x.text}<//>`)}</div>
    </div>`}
  </section>`;
}

export function ScoreInfoSheet({ offset = 0 }) {
  const w = weekSummary(offset);
  const { start, end } = weekWindow(offset);
  return html`<${Sheet} title="Consistency score">
    <p>A 0–100 snapshot of the four habits that drive results, over ${offset === 0 ? 'the last 7 full days' : `${shortDate(start)} – ${shortDate(end)}`}.
      Today isn't counted until it's over, and days before you started don't count against you.</p>
    <div class="score-breakdown">
      ${SCORE_PARTS.map(part => html`<div class="sb-row">
        <div class="sb-head"><b>${part.label}</b><span>${w.score == null ? '' : `${Math.round(part.pts * w.frac[part.key])} / `}${part.pts} pts</span></div>
        <div class="part-bar"><span style=${{ width: w.frac[part.key] * 100 + '%' }}></span></div>
        <p class="small"><b>${partCount(w, part.key)}</b> · ${part.what} ${part.why}</p>
      </div>`)}
    </div>
    <p class="muted small">Ratings: 90+ excellent · 75+ great · 60+ good · 40+ building. A logged day has at least 800 kcal
      (or 40% of your target) entered, so a forgotten day never looks like a low-calorie one. Protein counts at ${Math.round(PROTEIN_HIT * 100)}% of target.</p>
  <//>`;
}
