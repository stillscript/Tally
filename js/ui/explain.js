import { html } from '../preact.js';
import { S } from '../store.js';
import { paceOf, lifts, latestTrendKg } from '../goals.js';
import { Sheet } from './common.js';
import { goTo } from './nav.js';
import { fmtInt, round, toDisplayWeight, wUnit, KCAL_PER_KG } from '../util.js';

// Plain-language breakdown of where each daily target comes from.
export function TargetsInfoSheet() {
  const p = S.profile;
  const t = p.targets;
  const units = S.settings.units;
  const u = wUnit(units);
  const goal = toDisplayWeight(p.goalWeightKg, units);
  const perUnit = round(t.protein / goal, 1);
  const deficit = Math.max(0, p.tdee - t.kcal);
  const perWeek = round(toDisplayWeight((deficit * 7) / KCAL_PER_KG, units), 1);

  return html`<${Sheet} title="How your targets are set">
    <section class="explain">
      <h3><span class="dot kcal"></span>Calories · ${fmtInt(t.kcal)}</h3>
      ${p.manualTargets ? html`<p>You set this by hand. Your estimated burn is ${fmtInt(p.tdee)} kcal a day.</p>`
        : t.maintenance ? html`<p>Your estimated burn is ${fmtInt(p.tdee)} kcal a day. You're at your goal, so this holds your weight steady.</p>`
        : html`<p>Your estimated burn (${fmtInt(p.tdee)} kcal a day) minus ${fmtInt(deficit)} for a ${paceOf(p).label.toLowerCase()} pace,
          about ${perWeek} ${u} a week. ${p.tdeeSource === 'adaptive' ? 'The burn estimate is calibrated from your own logging and weight trend.' : 'The burn starts from a standard formula and gets calibrated to you after about two weeks of logging and weigh-ins.'}</p>`}
      ${t.floored && html`<p class="muted small">Held at a safe minimum, so progress is a little slower than the chosen pace.</p>`}

      <h3><span class="dot protein"></span>Protein · ${fmtInt(t.protein)} g</h3>
      ${lifts(p)
        ? html`<p><b>Set higher because you lift.</b> That's about ${perUnit} g per ${u} of goal weight (${fmtInt(goal)} ${u}). In a calorie deficit, plenty of protein plus lifting is what keeps muscle on while fat comes off. Make this the number you hit first.</p>`
        : html`<p>About ${perUnit} g per ${u} of goal weight (${fmtInt(goal)} ${u}), enough to protect muscle in a deficit. If you lift weights, turn that on and it goes up.</p>`}

      <h3><span class="dot fat"></span>Fat · ${fmtInt(t.fat)} g</h3>
      <p>At least a quarter of your calories. Going much lower tends to hurt energy, hormones and how full you feel.</p>

      <h3><span class="dot carbs"></span>Carbs · ${fmtInt(t.carbs)} g</h3>
      <p>Whatever calories are left after protein and fat. Carbs are what fuel hard training sessions.</p>

      <p class="muted small">Targets update at your weekly check-in. Trend weight now: ${round(toDisplayWeight(latestTrendKg(), units), 1)} ${u}.</p>
      <div class="row-btns">
        <button class="btn small" onClick=${() => goTo('settings', 'profile')}>Edit goal & lifting</button>
        <button class="btn small ghost" onClick=${() => goTo('settings', 'targets')}>Set targets by hand</button>
      </div>
    </section>
  <//>`;
}
