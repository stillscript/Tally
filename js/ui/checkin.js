import { html, useMemo } from '../preact.js';
import { S, toast } from '../store.js';
import { checkInPreview, applyCheckIn } from '../goals.js';
import { Sheet, Note } from './common.js';
import { closeSheet } from './nav.js';
import { fmtInt, round, toDisplayWeight, wUnit } from '../util.js';

function Delta({ from, to, unit = '' }) {
  const d = to - from;
  if (Math.abs(d) < 1) return html`<span class="muted">no change</span>`;
  return html`<span class="delta">${d > 0 ? '+' : '−'}${fmtInt(Math.abs(d))}${unit} from ${fmtInt(from)}${unit}</span>`;
}

export function CheckInSheet() {
  const pre = useMemo(() => checkInPreview(), []);
  const p = S.profile;
  const units = S.settings.units;
  const old = p.targets;
  const t = pre.targets;
  const rate = pre.slopeKgPerWeek != null ? toDisplayWeight(pre.slopeKgPerWeek, units) : null;

  async function done(accept) {
    await applyCheckIn(pre, accept);
    toast(accept ? 'Targets updated' : 'Keeping your current targets');
    closeSheet();
  }

  return html`<${Sheet} title="Weekly check-in" footer=${html`
      <button class="btn" onClick=${() => done(false)}>Keep current</button>
      <button class="btn primary grow" onClick=${() => done(true)}>Update targets</button>`}>
    ${pre.mode === 'adaptive' && html`
      <p>Over the last 3 weeks you averaged <b>${fmtInt(pre.avgIntake)} kcal</b> on ${pre.loggedDays} logged days,
        and your trend weight moved <b>${rate > 0 ? '+' : '−'}${Math.abs(round(rate, 2))} ${wUnit(units)}/week</b>.</p>
      <p>That puts your real daily burn near <b>${fmtInt(pre.observed)} kcal</b>. Tally moves toward that gradually so one odd week can’t throw things off.</p>`}
    ${pre.mode === 'formula' && html`<${Note} tone="info">
      Not enough data yet for a personal estimate. It needs 10+ logged days and a few weigh-ins over 3 weeks; you have ${pre.loggedDays} days and ${pre.weighIns} weigh-ins. For now, targets are refreshed for your current weight.<//>`}
    ${pre.mode === 'hold' && html`<${Note} tone="info">
      Not much logging this stretch, so your burn estimate stays where it was. Targets refresh for your current weight.<//>`}

    <div class="checkin-grid">
      <div><span class="muted small">Estimated burn</span><b>${fmtInt(pre.next)}</b><${Delta} from=${pre.prior} to=${pre.next} /></div>
      <div><span class="muted small">Calories</span><b>${fmtInt(t.kcal)}</b><${Delta} from=${old.kcal} to=${t.kcal} /></div>
      <div><span class="muted small">Protein</span><b>${fmtInt(t.protein)} g</b><${Delta} from=${old.protein} to=${t.protein} unit=" g" /></div>
      <div><span class="muted small">Carbs · Fat</span><b>${fmtInt(t.carbs)} · ${fmtInt(t.fat)} g</b></div>
    </div>
    ${t.maintenance && html`<${Note} tone="good">You’ve reached your goal weight. These targets are set to hold it.<//>`}
    ${t.floored && html`<${Note} tone="warn">Your calories are at the safe minimum, so the pace will be a bit slower than planned.<//>`}
    ${p.manualTargets && html`<p class="muted small">You set targets by hand, so only the burn estimate updates. Change targets in Settings.</p>`}
  <//>`;
}
