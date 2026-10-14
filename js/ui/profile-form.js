import { html } from '../preact.js';
import { ACTIVITY, PACES } from '../goals.js';
import { Seg, NumField, Field } from './common.js';
import { num, round, toDisplayWeight, fromDisplayWeight, wUnit } from '../util.js';

const CM_PER_IN = 2.54;

export function draftFromProfile(p, units, currentKg) {
  const totalIn = p ? p.heightCm / CM_PER_IN : null;
  return {
    units,
    sex: p?.sex || '',
    age: p ? String(new Date().getFullYear() - p.birthYear) : '',
    ft: totalIn ? String(Math.floor(totalIn / 12)) : '',
    inch: totalIn ? String(Math.round(totalIn % 12)) : '',
    cm: p ? String(Math.round(p.heightCm)) : '',
    weight: currentKg ? String(round(toDisplayWeight(currentKg, units), 1)) : '',
    goal: p ? String(round(toDisplayWeight(p.goalWeightKg, units), 1)) : '',
    pace: p?.pace || 'balanced',
    activity: p?.activity || '',
    lifts: p ? p.lifts !== false : null,
  };
}

// Switching units converts what's already typed.
export function switchUnits(d, units) {
  if (d.units === units) return d;
  const conv = v => {
    const n = num(v);
    if (n == null) return v;
    return String(round(toDisplayWeight(fromDisplayWeight(n, d.units), units), 1));
  };
  const cm = heightCm(d);
  const totalIn = cm ? cm / CM_PER_IN : null;
  return {
    ...d, units, weight: conv(d.weight), goal: conv(d.goal),
    cm: cm ? String(Math.round(cm)) : d.cm,
    ft: totalIn ? String(Math.floor(totalIn / 12)) : d.ft,
    inch: totalIn ? String(Math.round(totalIn % 12)) : d.inch,
  };
}

export function heightCm(d) {
  if (d.units === 'imperial') {
    const ft = num(d.ft), inch = num(d.inch) || 0;
    return ft ? (ft * 12 + inch) * CM_PER_IN : null;
  }
  return num(d.cm);
}

export function validate(d, { needWeight, step } = {}) {
  const age = num(d.age), cm = heightCm(d), w = num(d.weight), g = num(d.goal);
  if (step !== 2) {
    if (!d.sex) return 'Choose male or female for the calorie formula';
    if (!(age >= 14 && age <= 100)) return 'Enter your age';
    if (!(cm >= 120 && cm <= 230)) return 'Enter your height';
    if (needWeight && !(w > 0)) return 'Enter your current weight';
  }
  if (step !== 1) {
    if (!(g > 0)) return 'Enter a goal weight';
    const gKg = fromDisplayWeight(g, d.units);
    if (gKg < 35) return 'That goal weight looks too low';
    if (needWeight && fromDisplayWeight(g, d.units) > fromDisplayWeight(w, d.units) + 0.1)
      return 'Tally is built for losing fat — set a goal at or below your current weight';
    if (!d.activity) return 'Pick an activity level';
    if (d.lifts == null) return 'Let us know whether you lift weights';
  }
  return null;
}

export function AboutYou({ d, set, needWeight }) {
  const u = wUnit(d.units);
  return html`
    <${Field} label="Units">
      <${Seg} label="Units" value=${d.units} onChange=${v => set(switchUnits(d, v))}
        options=${[{ value: 'imperial', label: 'lb · ft/in' }, { value: 'metric', label: 'kg · cm' }]} />
    <//>
    <${Field} label="Sex" hint="Only used to estimate your starting burn (Mifflin-St Jeor formula). Tally recalibrates from your real data.">
      <${Seg} label="Sex" value=${d.sex} onChange=${v => set({ ...d, sex: v })}
        options=${[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
    <//>
    <div class="grid2">
      <${NumField} label="Age" value=${d.age} onInput=${v => set({ ...d, age: v })} suffix="yrs" />
      ${d.units === 'imperial'
        ? html`<div class="grid2 tight">
            <${NumField} label="Height" value=${d.ft} onInput=${v => set({ ...d, ft: v })} suffix="ft" />
            <${NumField} label=${' '} value=${d.inch} onInput=${v => set({ ...d, inch: v })} suffix="in" />
          </div>`
        : html`<${NumField} label="Height" value=${d.cm} onInput=${v => set({ ...d, cm: v })} suffix="cm" />`}
    </div>
    ${needWeight && html`<${NumField} label="Current weight" value=${d.weight} onInput=${v => set({ ...d, weight: v })} suffix=${u} />`}
  `;
}

export function GoalFields({ d, set, currentKg }) {
  const u = wUnit(d.units);
  const kg = currentKg ?? fromDisplayWeight(num(d.weight) || 0, d.units);
  return html`
    <${NumField} label="Goal weight" value=${d.goal} onInput=${v => set({ ...d, goal: v })} suffix=${u}
      hint="Pick a first milestone if you like — you can change it any time." />
    <${Field} label="Pace">
      <div class="choices">
        ${PACES.map(p => html`<button type="button" class=${'choice' + (d.pace === p.id ? ' on' : '')} onClick=${() => set({ ...d, pace: p.id })}>
          <b>${p.label}${kg ? html` <span class="muted">· ${round(toDisplayWeight((kg * p.pct) / 100, d.units), 1)} ${u}/week</span>` : ''}</b>
          <span>${p.sub}</span>
        </button>`)}
      </div>
    <//>
    <${Field} label="Typical activity" hint="Count your job and workouts. If unsure, pick the lower one — the weekly check-in corrects it.">
      <div class="choices">
        ${ACTIVITY.map(a => html`<button type="button" class=${'choice' + (d.activity === a.id ? ' on' : '')} onClick=${() => set({ ...d, activity: a.id })}>
          <b>${a.label}</b><span>${a.sub}</span>
        </button>`)}
      </div>
    <//>
    <${Field} label="Do you lift weights or strength train?"
      hint=${`If yes, your protein target is set higher (${d.units === 'imperial' ? 'about 0.9 g per lb of goal weight instead of 0.7' : '2.0 g per kg of goal weight instead of 1.6'}) so you keep muscle while losing fat.`}>
      <${Seg} label="Lift weights" value=${d.lifts == null ? '' : d.lifts ? 'yes' : 'no'} onChange=${v => set({ ...d, lifts: v === 'yes' })}
        options=${[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
    <//>
  `;
}
