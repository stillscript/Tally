import { html, useState } from '../preact.js';
import { S, addEntry, updateEntry, deleteEntry, restoreEntry, toast } from '../store.js';
import { Sheet, MealPicker, NumField, Field } from './common.js';
import { Icon } from './icons.js';
import { closeSheet, closeAllSheets } from './nav.js';
import { EntryActions } from './entry-actions.js';
import { num, fmtInt, mealLabel, mealForTime } from '../util.js';

// For restaurant meals or anything you only know the calories of.
export function QuickAddSheet({ meal: m0, date: d0, entry }) {
  const [meal, setMeal] = useState(entry?.meal || m0 || mealForTime());
  const date = entry?.date || d0 || S.ui.date;
  const [name, setName] = useState(entry?.name || '');
  const [kcal, setKcal] = useState(entry ? String(Math.round(entry.n.kcal)) : '');
  const [p, setP] = useState(entry?.n.p ? String(entry.n.p) : '');
  const [c, setC] = useState(entry?.n.c ? String(entry.n.c) : '');
  const [f, setF] = useState(entry?.n.f ? String(entry.n.f) : '');

  async function save() {
    const k = num(kcal);
    if (k == null || k < 0) return toast('Enter the calories');
    const n = { kcal: k, p: num(p) || 0, c: num(c) || 0, f: num(f) || 0, fiber: 0, sugar: 0, addedSugar: 0, satFat: 0, sodium: 0 };
    const payload = { date, meal, foodId: null, name: name.trim() || 'Quick add', brand: '', qty: 1, unit: 'quick', amount: '', grams: 0, n };
    if (entry) {
      await updateEntry({ ...entry, ...payload });
      toast('Saved');
      closeSheet();
    } else {
      await addEntry(payload);
      S.ui.date = date;
      S.ui.tab = 'today';
      toast(`Added to ${mealLabel(meal)} · ${fmtInt(k)} kcal`);
      closeAllSheets();
    }
  }
  async function remove() {
    const e = await deleteEntry(entry.id);
    closeSheet();
    toast('Removed', { label: 'Undo', fn: () => restoreEntry(e) });
  }

  return html`<${Sheet} title=${entry ? 'Edit quick add' : 'Quick add'} footer=${html`
      ${entry && html`<button class="btn danger" onClick=${remove} aria-label="Remove"><${Icon} n="trash" /></button>`}
      <button class="btn primary grow" onClick=${save}>${entry ? 'Save changes' : `Add to ${mealLabel(meal)}`}</button>`}>
    <${Field} label="Name (optional)">
      <input class="input" value=${name} placeholder="e.g. Chipotle bowl" onInput=${e => setName(e.currentTarget.value)} />
    <//>
    <${NumField} label="Calories" value=${kcal} onInput=${setKcal} suffix="kcal" />
    <div class="grid3">
      <${NumField} label="Protein" value=${p} onInput=${setP} suffix="g" />
      <${NumField} label="Carbs" value=${c} onInput=${setC} suffix="g" />
      <${NumField} label="Fat" value=${f} onInput=${setF} suffix="g" />
    </div>
    <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>
    ${entry && html`<${EntryActions} entry=${entry} />`}
  <//>`;
}
