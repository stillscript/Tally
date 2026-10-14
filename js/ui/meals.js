import { html, useState } from '../preact.js';
import { S, entriesFor, addEntries, saveMealTemplate, updateMealTemplate, deleteMealTemplate, deleteEntry, toast } from '../store.js';
import { amountText } from '../sources.js';
import { Sheet, MealPicker, Seg, Field } from './common.js';
import { Icon } from './icons.js';
import { closeSheet, closeAllSheets } from './nav.js';
import { fmtInt, fmtG, mealLabel, mealForTime, round } from '../util.js';

const total = items => items.reduce((t, i) => ({ kcal: t.kcal + i.n.kcal, p: t.p + i.n.p, c: t.c + i.n.c, f: t.f + i.n.f }), { kcal: 0, p: 0, c: 0, f: 0 });

function scaleItem(i, k) {
  if (k === 1) return i;
  const n = {};
  for (const key in i.n) n[key] = (i.n[key] || 0) * k;
  const qty = round(i.qty * k, 2);
  const unit = { label: i.unitLabel, serving: /^s\d/.test(i.unit) };
  return { ...i, n, qty, grams: (i.grams || 0) * k, amount: i.unit === 'quick' ? '' : amountText(qty, unit) };
}

// Log every item of a saved meal at once.
export async function logSavedMeal(m, { meal, date, factor = 1 }) {
  const made = await addEntries(m.items.map(i => ({ ...scaleItem(i, factor), date, meal })));
  await updateMealTemplate({ ...m, usedAt: Date.now() });
  S.ui.date = date;
  const kcal = made.reduce((s, e) => s + e.n.kcal, 0);
  toast(`Added ${m.name} · ${fmtInt(kcal)} kcal`, { label: 'Undo', fn: () => made.forEach(e => deleteEntry(e.id)) });
}

function ItemList({ items }) {
  const t = total(items);
  return html`<div class="tmpl-items">
    ${items.map(i => html`<div class="tmpl-item"><span><b>${i.name}</b>${i.amount && html`<small>${i.amount}</small>`}</span><span>${fmtInt(i.n.kcal)}</span></div>`)}
    <div class="tmpl-total"><span>Total · ${fmtG(t.p)}g P · ${fmtG(t.c)}g C · ${fmtG(t.f)}g F</span><b>${fmtInt(t.kcal)} kcal</b></div>
  </div>`;
}

export function SaveMealSheet({ date, meal }) {
  const items = entriesFor(date).filter(e => e.meal === meal);
  const [name, setName] = useState(`My usual ${mealLabel(meal).toLowerCase()}`);
  async function save() {
    if (!name.trim()) return toast('Give the meal a name');
    await saveMealTemplate(name.trim(), items);
    toast('Saved — find it under Search → Saved meals');
    closeSheet();
  }
  return html`<${Sheet} title="Save as a meal" footer=${html`<button class="btn primary grow" onClick=${save}>Save meal</button>`}>
    <${Field} label="Name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} /><//>
    <${ItemList} items=${items} />
    <p class="muted small">Next time, add all of this in one tap, scaled up or down if you like.</p>
  <//>`;
}

export function MealTemplateSheet({ id, meal: m0, date: d0 }) {
  const m = S.meals.find(x => x.id === id);
  const [meal, setMeal] = useState(m0 || mealForTime());
  const [factor, setFactor] = useState('1');
  const [name, setName] = useState(m?.name || '');
  const date = d0 || S.ui.date;
  if (!m) return null;
  const k = Number(factor);
  const items = m.items.map(i => scaleItem(i, k));

  async function add() {
    if (name.trim() && name.trim() !== m.name) await updateMealTemplate({ ...m, name: name.trim() });
    await logSavedMeal(S.meals.find(x => x.id === id), { meal, date, factor: k });
    S.ui.tab = 'today';
    closeAllSheets();
  }
  async function remove() {
    if (!confirm(`Delete the saved meal “${m.name}”? Logged days aren’t affected.`)) return;
    await deleteMealTemplate(m.id);
    toast('Saved meal deleted');
    closeSheet();
  }

  return html`<${Sheet} title="Saved meal" footer=${html`
      <button class="btn danger" onClick=${remove} aria-label="Delete saved meal"><${Icon} n="trash" /></button>
      <button class="btn primary grow" onClick=${add}>Add to ${mealLabel(meal)} <span class="btn-sub">${fmtInt(total(items).kcal)} kcal</span></button>`}>
    <${Field} label="Name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} /><//>
    <${Field} label="Portion">
      <${Seg} small label="Portion" value=${factor} onChange=${setFactor}
        options=${[{ value: '0.5', label: '½×' }, { value: '1', label: '1×' }, { value: '1.5', label: '1½×' }, { value: '2', label: '2×' }]} />
    <//>
    <${ItemList} items=${items} />
    <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>
  <//>`;
}
