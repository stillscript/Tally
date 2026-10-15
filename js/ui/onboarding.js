import { html, useState } from '../preact.js';
import { S, saveProfile, saveSettings, setWeight, toast } from '../store.js';
import { formulaTdee, computeTargets, paceOf } from '../goals.js';
import { AboutYou, GoalFields, draftFromProfile, validate, heightCm } from './profile-form.js';
import { fmtInt, num, todayKey, addDays, parseKey, round, toDisplayWeight, fromDisplayWeight, wUnit, KCAL_PER_KG } from '../util.js';

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [d, setD] = useState(draftFromProfile(null, S.settings.units, null));

  function next() {
    const err = validate(d, { needWeight: true, step });
    if (err) return toast(err);
    setStep(step + 1);
    window.scrollTo(0, 0);
  }

  // Build the plan from the draft.
  const weightKg = fromDisplayWeight(num(d.weight) || 0, d.units);
  const profile = {
    sex: d.sex,
    birthYear: new Date().getFullYear() - (num(d.age) || 30),
    heightCm: heightCm(d) || 170,
    goalWeightKg: fromDisplayWeight(num(d.goal) || 0, d.units),
    pace: d.pace,
    activity: d.activity,
    lifts: d.lifts !== false,
  };
  const tdee = step === 3 ? Math.round(formulaTdee(profile, weightKg) / 10) * 10 : 0;
  const targets = step === 3 ? computeTargets(profile, tdee, weightKg) : null;

  async function finish() {
    await saveSettings({ units: d.units });
    await setWeight(todayKey(), weightKg);
    await saveProfile({
      ...profile, startWeightKg: weightKg, startDate: todayKey(),
      tdee, tdeeSource: 'formula', targets, manualTargets: false,
    });
  }

  const u = wUnit(d.units);
  const dots = html`<div class="dots">${[1, 2, 3].map(i => html`<span class=${i <= step ? 'on' : ''}></span>`)}</div>`;

  if (step === 0) {
    return html`<div class="onboard welcome">
      <img src="icons/icon.svg" width="72" height="72" alt="" />
      <h1>Tally</h1>
      <p class="lead">Scan what you eat. See what’s in it. Hit your numbers.</p>
      <ul class="bullets">
        <li><b>Barcode scanning</b> backed by USDA manufacturer data and Open Food Facts.</li>
        <li><b>Targets that learn.</b> Each week, Tally checks your real intake against your weight trend and fine-tunes.</li>
        <li><b>Private.</b> No account. Your log never leaves this phone.</li>
      </ul>
      <button class="btn primary block big" onClick=${() => setStep(1)}>Set up my plan</button>
      <p class="muted small">Takes about a minute.</p>
    </div>`;
  }

  if (step === 1) {
    return html`<div class="onboard">
      ${dots}
      <h1>About you</h1>
      <p class="muted">Used to set your calorie and protein targets.</p>
      <${AboutYou} d=${d} set=${setD} needWeight />
      <div class="onboard-nav"><button class="btn" onClick=${() => setStep(0)}>Back</button>
        <button class="btn primary grow" onClick=${next}>Next</button></div>
    </div>`;
  }

  if (step === 2) {
    return html`<div class="onboard">
      ${dots}
      <h1>Your goal</h1>
      <p class="muted">Losing fat steadily while keeping muscle.</p>
      <${GoalFields} d=${d} set=${setD} currentKg=${weightKg} />
      <div class="onboard-nav"><button class="btn" onClick=${() => setStep(1)}>Back</button>
        <button class="btn primary grow" onClick=${next}>See my plan</button></div>
    </div>`;
  }

  const deficit = tdee - targets.kcal;
  const perWeek = (deficit * 7) / KCAL_PER_KG;
  const toGo = weightKg - profile.goalWeightKg;
  const eta = perWeek > 0 && toGo > 0 ? addDays(todayKey(), Math.ceil((toGo / perWeek) * 7)) : null;
  return html`<div class="onboard plan">
    ${dots}
    <h1>Your plan</h1>
    <div class="plan-hero">
      <span class="plan-kcal">${fmtInt(targets.kcal)}</span><span class="plan-unit">kcal a day</span>
    </div>
    <div class="target-grid">
      <div class="protein"><b>${targets.protein}g</b><span>protein</span></div>
      <div class="carbs"><b>${targets.carbs}g</b><span>carbs</span></div>
      <div class="fat"><b>${targets.fat}g</b><span>fat</span></div>
    </div>
    <ul class="bullets">
      <li>Estimated burn today: <b>${fmtInt(tdee)} kcal</b>. ${deficit > 0
        ? html`Eating ${fmtInt(targets.kcal)} is a ${fmtInt(deficit)} kcal daily deficit — about <b>${round(toDisplayWeight(perWeek, d.units), 1)} ${u} a week</b>.`
        : 'You’re at your goal, so this is a maintenance target.'}</li>
      <li>${profile.lifts
        ? html`<b>Protein is set high because you lift</b> (about ${round(targets.protein / toDisplayWeight(profile.goalWeightKg, d.units), 1)} g per ${u} of goal weight) to protect muscle while you lose fat. It’s the number to prioritize.`
        : html`<b>Protein</b> is about ${round(targets.protein / toDisplayWeight(profile.goalWeightKg, d.units), 1)} g per ${u} of goal weight, enough to protect muscle while you lose fat. If you start lifting, turn that on in Settings and it goes up.`}</li>
      <li><b>It adapts.</b> Log honestly, and weigh in whenever you like (even once or twice a week helps). Tally compares the two and fine-tunes your calories.</li>
      ${eta && html`<li>At this pace you’d reach ${round(toDisplayWeight(profile.goalWeightKg, d.units), 1)} ${u} around <b>${parseKey(eta).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</b>.</li>`}
    </ul>
    ${targets.floored && html`<p class="note warn">Calories are held at a safe minimum, so progress will be a bit slower than the ${paceOf(profile).label.toLowerCase()} pace.</p>`}
    <div class="onboard-nav"><button class="btn" onClick=${() => setStep(2)}>Back</button>
      <button class="btn primary grow big" onClick=${finish}>Start tracking</button></div>
  </div>`;
}
