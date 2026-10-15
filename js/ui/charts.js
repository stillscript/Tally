import { html } from '../preact.js';
import { toDisplayWeight, shortDate, round } from '../util.js';

const W = 340;

export function WeightChart({ series, goalKg, units }) {
  if (series.length < 2) {
    return html`<div class="chart-empty">Your trend line appears after a couple of weigh-ins.</div>`;
  }
  const H = 172, L = 36, R = 8, T = 10, B = 22;
  const vals = series.flatMap(s => [s.kg, s.trend]).map(v => toDisplayWeight(v, units));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const goal = toDisplayWeight(goalKg, units);
  const span0 = Math.max(hi - lo, 1);
  const showGoal = goal >= lo - span0 * 0.6;
  if (showGoal) lo = Math.min(lo, goal);
  const pad = Math.max((hi - lo) * 0.08, 0.3);
  lo -= pad;
  hi += pad;
  const n = series.length;
  const x = i => L + (i / (n - 1)) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const trend = series.map((s, i) => `${x(i).toFixed(1)},${y(toDisplayWeight(s.trend, units)).toFixed(1)}`).join(' ');
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight and trend chart">
    ${ticks.map(v => html`<g>
      <line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} class="grid" />
      <text x=${L - 6} y=${y(v) + 4} class="axis" text-anchor="end">${round(v, 1)}</text>
    </g>`)}
    ${showGoal && html`<g>
      <line x1=${L} x2=${W - R} y1=${y(goal)} y2=${y(goal)} class="goal-line" />
      <text x=${W - R} y=${y(goal) - 5} class="axis goal-label" text-anchor="end">goal</text>
    </g>`}
    ${series.map((s, i) => s.real && html`<circle cx=${x(i)} cy=${y(toDisplayWeight(s.kg, units))} r="2.6" class="dot" />`)}
    <polyline points=${trend} class="trend-line" fill="none" />
    <text x=${L} y=${H - 5} class="axis">${shortDate(series[0].date)}</text>
    <text x=${W - R} y=${H - 5} class="axis" text-anchor="end">${shortDate(series[n - 1].date)}</text>
  </svg>`;
}
