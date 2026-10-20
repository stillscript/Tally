import { html, useState, useEffect } from '../preact.js';
import { S, dayTotals, upsertFood, addEntry, updateEntry, deleteEntry, restoreEntry, toast } from '../store.js';
import {
  lookupBarcode, nutrientsFor, unitsFor, findUnit, defaultAmount, amountText, stepFor, sourceLabel, hasCore, hasUsdaKey,
} from '../sources.js';
import { pickInsight, renderInsight, muteFood, wantsAlternatives, findAlternatives } from '../insights.js';
import { Sheet, MealPicker, Stepper, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet, replaceSheet, closeSheet, closeAllSheets } from './nav.js';
import { EntryActions } from './entry-actions.js';
import { hasAiKey, aiName } from '../ai.js';
import { SourceLinks } from './ai.js';
import { fmtInt, fmtG, mealLabel, mealForTime, num, prettyDate, round } from '../util.js';

// A food rebuilt from an entry if its record has gone missing.
function foodFromEntry(e) {
  const k = e.grams > 0 ? 100 / e.grams : 0;
  const per100 = {};
  for (const key in e.n) per100[key] = e.n[key] * k;
  return { id: e.foodId, name: e.name, brand: e.brand, source: 'custom', base: 'g', per100, servings: [] };
}

function startAmount(entry, food) {
  if (!food) return { qty: 1, unit: 's0' };
  if (!entry) return defaultAmount(food);
  if (unitsFor(food).some(u => u.key === entry.unit)) return { qty: entry.qty, unit: entry.unit };
  return { qty: round(entry.grams, 1), unit: food.base === 'ml' ? 'ml' : 'g' };
}

const hideImg = e => { e.currentTarget.style.visibility = 'hidden'; };

// Same amount of food, expressed in a different unit.
function convertQty(grams, u) {
  const v = grams / u.g;
  if (u.serving) return Math.max(0.25, Math.round(v * 4) / 4);
  if (u.key === 'g' || u.key === 'ml') return Math.round(v);
  return Math.round(v * 10) / 10;
}

export function FoodSheet({ food: given, barcode, format, entry, meal: givenMeal, date: givenDate, fromScan }) {
  const initialFood = given || (entry ? S.foods.get(entry.foodId) || foodFromEntry(entry) : null);
  const [baseFood, setFood] = useState(initialFood);
  // If the food was corrected from its label while this sheet was open, show the corrected version.
  const stored = baseFood && S.foods.get(baseFood.id);
  const food = stored && (stored.updatedAt || 0) > (baseFood.updatedAt || 0) ? stored : baseFood;
  const [status, setStatus] = useState(initialFood ? 'ready' : 'loading');
  const [errors, setErrors] = useState(null);
  const start = startAmount(entry, initialFood);
  const [qtyText, setQtyText] = useState(String(start.qty));
  const [unitKey, setUnitKey] = useState(start.unit);
  const [meal, setMeal] = useState(entry?.meal || givenMeal || mealForTime());
  const [pick, setPick] = useState(undefined);
  const [alts, setAlts] = useState(null);
  const [hidden, setHidden] = useState(false);
  const date = entry?.date || givenDate || S.ui.date;

  useEffect(() => {
    if (food || !barcode) return;
    let alive = true;
    lookupBarcode(barcode, format)
      .then(res => {
        if (!alive) return;
        if (res.food) {
          const a = defaultAmount(res.food);
          setFood(res.food);
          setQtyText(String(a.qty));
          setUnitKey(a.unit);
          setStatus('ready');
        } else {
          setErrors({ ...res.errors, code: res.n?.display || barcode });
          setStatus(res.errors?.invalid ? 'invalid' : 'notfound');
        }
      })
      .catch(e => alive && (setErrors({ fatal: e }), setStatus('notfound')));
    return () => { alive = false; };
  }, []);

  const unit = food ? findUnit(food, unitKey) : null;
  const qty = num(qtyText) ?? 0;
  const grams = unit ? qty * unit.g : 0;
  const n = food ? nutrientsFor(food.per100, grams) : null;
  const totals = dayTotals(date, entry?.id);
  const targets = S.profile.targets;
  const args = food && { food, n, date, totals, targets };

  // Choose one note when the food first appears; numbers stay live after that.
  useEffect(() => {
    if (status !== 'ready' || pick !== undefined) return;
    setPick(entry ? null : pickInsight(args));
    if (!entry && wantsAlternatives(food)) {
      let alive = true;
      findAlternatives(food).then(list => alive && setAlts(list)).catch(() => {});
      return () => { alive = false; };
    }
  }, [status]);

  async function save(scanNext) {
    if (!(qty > 0)) return toast('Enter an amount first');
    const saved = await upsertFood({ ...food, last: { qty, unit: unit.key } });
    const payload = {
      date, meal, foodId: saved.id, name: food.name, brand: food.brand || '',
      qty, unit: unit.key, unitLabel: unit.label, amount: amountText(qty, unit), grams, n,
    };
    if (entry) {
      await updateEntry({ ...entry, ...payload });
      toast('Saved');
      closeSheet();
      return;
    }
    const made = await addEntry(payload);
    S.ui.date = date;
    S.ui.tab = 'today';
    toast(`Added to ${mealLabel(meal)} · ${fmtInt(n.kcal)} kcal`, { label: 'Undo', fn: () => deleteEntry(made.id) });
    if (scanNext) replaceSheet('scanner', { meal, date });
    else closeAllSheets();
  }

  async function remove() {
    const e = await deleteEntry(entry.id);
    closeSheet();
    toast('Removed', { label: 'Undo', fn: () => restoreEntry(e) });
  }

  // ---------- loading / not found ----------
  if (status === 'loading') {
    return html`<${Sheet} title="Looking it up…">
      <div class="lookup">
        <div class="spinner"></div>
        <p>Checking USDA and Open Food Facts for <b>${barcode}</b></p>
      </div>
    <//>`;
  }
  if (status === 'invalid' || status === 'notfound') {
    const rate = errors?.usda?.code === 'rate';
    const offline = errors?.usda?.code === 'offline' || errors?.off?.code === 'offline' || errors?.fatal?.code === 'offline';
    return html`<${Sheet} title=${status === 'invalid' ? 'That barcode doesn’t look right' : 'Not found'}>
      ${status === 'invalid'
        ? html`<p class="muted">The digits don’t pass the barcode check. Try scanning again, or type it carefully.</p>`
        : offline
          ? html`<p class="muted">You appear to be offline. Connect and scan again, or enter it from the label.</p>`
          : html`<p class="muted">Neither USDA nor Open Food Facts has <b>${errors?.code}</b> yet. Add it once from the label and it’ll be instant next time.</p>`}
      ${rate && !hasUsdaKey() && html`<${Note} tone="warn">USDA’s shared demo key hit its hourly limit. Add your free personal key in Settings for full coverage.<//>`}
      <div class="stack">
        ${status === 'notfound' && hasAiKey() && html`<label class="btn primary block">
          <input type="file" accept="image/*" capture="environment" hidden
            onChange=${e => { const photo = e.currentTarget.files?.[0]; if (photo) replaceSheet('label', { barcode: errors?.code, meal, date, then: 'food', fromScan, photo }); }} />
          <${Icon} n="camera" /> Snap the label, ${aiName()} fills it in</label>`}
        ${status === 'notfound' && html`<button class=${'btn block' + (hasAiKey() ? '' : ' primary')} onClick=${() => replaceSheet('label', { barcode: errors?.code, meal, date, then: 'food', fromScan })}>
          <${Icon} n="edit" /> Enter from the label</button>`}
        <button class="btn block" onClick=${() => replaceSheet('scanner', { meal, date })}><${Icon} n="scan" /> Scan again</button>
        <button class="btn ghost block" onClick=${() => replaceSheet('add', { meal, date })}><${Icon} n="search" /> Search by name</button>
      </div>
    <//>`;
  }

  // ---------- ready ----------
  const units = unitsFor(food);
  const remaining = targets.kcal - totals.kcal - n.kcal;
  const pLeft = targets.protein - totals.p - n.p;
  const ins = !hidden && renderInsight(pick, args);
  const q = food.quality || [];
  const incomplete = !hasCore(food.per100);
  const footer = html`
    ${entry && html`<button class="btn danger" onClick=${remove} aria-label="Remove entry"><${Icon} n="trash" /></button>`}
    ${!entry && fromScan && html`<button class="btn" onClick=${() => save(true)}>Add + scan next</button>`}
    <button class="btn primary grow" onClick=${() => save(false)}>
      ${entry ? 'Save changes' : `Add to ${mealLabel(meal)}`} <span class="btn-sub">${fmtInt(n.kcal)} kcal</span>
    </button>`;

  return html`<${Sheet} title=${entry ? 'Edit entry' : prettyDate(date) === 'Today' ? 'Add food' : `Add food · ${prettyDate(date)}`} footer=${footer}
    headerRight=${html`<button class="icon-btn" aria-label="Correct nutrition from label"
      onClick=${() => openSheet('label', { food, barcode: food.barcode, meal, date, then: 'back' })}><${Icon} n="edit" /></button>`}>

    <div class="food-head">
      ${food.image && html`<img class="food-img" src=${food.image} alt="" loading="lazy" onError=${hideImg} />`}
      <div class="food-titles">
        <div class="food-name">${food.name}</div>
        ${food.brand && html`<div class="food-brand">${food.brand}</div>`}
        <div class="badges">
          ${food.verified ? html`<span class="badge ok"><${Icon} n="check" size=${14} /> Checked by you</span>`
            : html`<span class=${'badge src ' + food.source}>${sourceLabel(food)}</span>`}
        </div>
      </div>
    </div>

    ${incomplete && html`<${Note} tone="warn">This entry is missing calories or macros. Tap the pencil to fill them in from the label.<//>`}
    ${!incomplete && !food.verified && (q.includes('mismatch') || q.includes('impossible') || q.includes('off-flagged')) && html`<${Note} tone="warn">
      These numbers don’t add up (calories vs. protein/carbs/fat). It may be fiber or sugar alcohols, or a data error — worth a glance at the label.<//>`}
    ${(food.aiNotes || food.sources?.length) && html`<p class="muted small ai-note">${food.aiNotes || ''}
      <${SourceLinks} sources=${food.sources} max=${3} /></p>`}
    ${!food.verified && food.conflict && html`<${Note} tone="info">
      ${food.conflict.source} lists ${fmtInt(food.conflict.kcal100)} kcal per 100 ${food.base} instead of ${fmtInt(food.per100.kcal)}. USDA’s figure comes from the manufacturer; if your label differs, tap the pencil.<//>`}

    <div class="amount-row">
      <${Stepper} value=${qtyText} onChange=${setQtyText} step=${stepFor(unit)} />
      <select class="input unit-select" value=${unit.key} aria-label="Unit"
        onChange=${e => {
          const next = units.find(u => u.key === e.currentTarget.value);
          // Keep the same amount of food when switching units.
          if (next && grams > 0) setQtyText(String(convertQty(grams, next)));
          setUnitKey(e.currentTarget.value);
        }}>
        ${units.map(u => html`<option value=${u.key}>${u.label}</option>`)}
      </select>
    </div>

    <div class="nutri-hero">
      <div class="kcal-big"><span>${fmtInt(n.kcal)}</span><small>kcal</small></div>
      <div class="trio">
        <div class="protein"><b>${fmtG(n.p)}</b><span>Protein</span></div>
        <div class="carbs"><b>${fmtG(n.c)}</b><span>Carbs</span></div>
        <div class="fat"><b>${fmtG(n.f)}</b><span>Fat</span></div>
      </div>
    </div>

    <p class=${'after' + (remaining < 0 ? ' over' : '')}>
      After this: <b>${fmtInt(Math.abs(remaining))}</b> kcal ${remaining < 0 ? 'over' : 'left'}
      ${pLeft > 0 ? html` · <b>${fmtInt(pLeft)} g</b> protein to go` : html` · protein target met`}
    </p>

    ${ins && html`<div class=${'insight ' + ins.tone}>
      <${Icon} n=${ins.tone === 'good' ? 'spark' : ins.tone === 'warn' ? 'alert' : 'info'} size=${18} />
      <div><p>${ins.text}</p>
        <button class="link" onClick=${() => { muteFood(food.id); setHidden(true); setAlts(null); }}>Don’t flag this food</button></div>
    </div>`}

    ${alts?.length > 0 && !hidden && html`<div class="alts">
      <div class="alts-head"><${Icon} n="swap" size=${16} /> Lighter options, same aisle <span class="muted">per 100 ${food.base}</span></div>
      ${alts.map(a => html`<button class="alt" onClick=${() => openSheet('food', { barcode: a.code, meal, date })}>
        ${a.image ? html`<img src=${a.image} alt="" loading="lazy" onError=${hideImg} />` : html`<span class="alt-ph"></span>`}
        <span class="alt-main"><span class="alt-name">${a.name}</span><span class="alt-brand">${a.brand}</span></span>
        <span class="alt-delta">
          ${a.kcalCut >= 0.05 ? html`<b class="good">−${Math.round(a.kcalCut * 100)}% kcal</b>` : html`<b>${fmtInt(a.kcal)} kcal</b>`}
          ${a.dP >= 2 ? html`<small>+${fmtG(a.dP)} g protein</small>` : html`<small>${fmtG(a.f)} g fat</small>`}
        </span>
      </button>`)}
    </div>`}

    <details class="more">
      <summary>More nutrition</summary>
      <dl class="nutr-table">
        <dt>Fiber</dt><dd>${fmtG(n.fiber)} g</dd>
        <dt>Sugars</dt><dd>${fmtG(n.sugar)} g</dd>
        ${food.per100.addedSugar != null && html`<dt>Added sugars</dt><dd>${fmtG(n.addedSugar)} g</dd>`}
        <dt>Saturated fat</dt><dd>${fmtG(n.satFat)} g</dd>
        <dt>Sodium</dt><dd>${fmtInt(n.sodium)} mg</dd>
        <dt>Amount</dt><dd>${fmtG(grams)} ${food.base}</dd>
      </dl>
    </details>

    <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>
    ${entry && html`<${EntryActions} entry=${entry} />`}
  <//>`;
}
