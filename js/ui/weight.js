import { html, useState } from '../preact.js';
import { S, setWeight, deleteWeight, toast } from '../store.js';
import { latestTrendKg } from '../goals.js';
import { Sheet, NumField, Field } from './common.js';
import { Icon } from './icons.js';
import { closeSheet } from './nav.js';
import { num, round, todayKey, toDisplayWeight, fromDisplayWeight, wUnit, fmtW } from '../util.js';

export function WeightSheet({ date: d0 }) {
  const units = S.settings.units;
  const [date, setDate] = useState(d0 || todayKey());
  const existing = S.weights.find(w => w.date === date);
  const last = S.weights[S.weights.length - 1];
  const [val, setVal] = useState(existing ? String(round(toDisplayWeight(existing.kg, units), 1)) : '');

  async function save() {
    const v = num(val);
    const kg = v != null ? fromDisplayWeight(v, units) : null;
    if (!(kg > 25 && kg < 350)) return toast('Enter your weight');
    await setWeight(date, kg);
    toast('Weight saved');
    closeSheet();
  }
  async function remove() {
    await deleteWeight(date);
    toast('Weigh-in removed');
    closeSheet();
  }

  return html`<${Sheet} title="Log weight" footer=${html`
      ${existing && html`<button class="btn danger" onClick=${remove} aria-label="Delete weigh-in"><${Icon} n="trash" /></button>`}
      <button class="btn primary grow" onClick=${save}>Save</button>`}>
    <div class="weight-input">
      <input class="input huge" inputmode="decimal" autoFocus value=${val} placeholder=${last ? fmtW(last.kg, units) : '0.0'}
        onInput=${e => setVal(e.currentTarget.value)} aria-label=${'Weight in ' + wUnit(units)} />
      <span class="huge-unit">${wUnit(units)}</span>
    </div>
    <${Field} label="Date">
      <input class="input" type="date" value=${date} max=${todayKey()} onInput=${e => {
        const d = e.currentTarget.value;
        if (!d) return;
        setDate(d);
        const w = S.weights.find(x => x.date === d);
        setVal(w ? String(round(toDisplayWeight(w.kg, units), 1)) : '');
      }} />
    <//>
    <p class="muted small">Best practice: weigh in the morning, after the bathroom, before eating. Daily numbers bounce around with water and salt — Tally follows the smoothed trend${S.weights.length ? `, currently ${fmtW(latestTrendKg(), units)} ${wUnit(units)}` : ''}.</p>
  <//>`;
}
