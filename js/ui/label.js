import { html, useState } from '../preact.js';
import { S, upsertFood, toast } from '../store.js';
import { normalizeBarcode } from '../barcode.js';
import { assessQuality } from '../sources.js';
import { Sheet, NumField, Field, Seg } from './common.js';
import { closeSheet, replaceSheet } from './nav.js';
import { num, round, uid, fmtInt } from '../util.js';

const r1 = v => (v == null ? '' : String(round(v, 1)));

// Type values straight from the Nutrition Facts panel (per serving).
// Saved foods are marked "checked by you" and win over database data for that barcode.
export function LabelSheet({ food, barcode, meal, date, then = 'back', fromScan }) {
  const s0 = food?.servings?.[0];
  const size0 = s0?.g || 100;
  const per = k => (food?.per100?.[k] != null ? (food.per100[k] * size0) / 100 : null);
  const [f, setF] = useState({
    name: food?.name || '',
    brand: food?.brand || '',
    desc: s0 ? s0.label.replace(/\s*\([^)]*\)\s*$/, '') : '1 serving',
    size: food ? r1(size0) : '',
    base: food?.base || 'g',
    kcal: food ? r1(per('kcal')) : '',
    p: r1(per('p')), c: r1(per('c')), fat: r1(per('f')),
    fiber: r1(per('fiber')), sugar: r1(per('sugar')), addedSugar: r1(per('addedSugar')),
    satFat: r1(per('satFat')), sodium: food?.per100?.sodium != null ? String(Math.round(per('sodium'))) : '',
  });
  const set = k => v => setF(x => ({ ...x, [k]: v }));
  const gtin14 = barcode ? normalizeBarcode(barcode)?.gtin14 || null : null;

  const est = 4 * (num(f.p) || 0) + 4 * (num(f.c) || 0) + 9 * (num(f.fat) || 0);
  const kcalN = num(f.kcal);
  const showEst = kcalN != null && (num(f.p) != null || num(f.c) != null || num(f.fat) != null);

  async function save() {
    const size = num(f.size);
    if (!f.name.trim()) return toast('Give it a name');
    if (!(size > 0)) return toast('Enter the serving size in grams or ml (it’s in brackets on the label)');
    if (kcalN == null) return toast('Enter the calories');
    const k = 100 / size;
    const v = key => (num(f[key]) != null ? num(f[key]) * k : null);
    const per100 = {
      kcal: kcalN * k, p: v('p') ?? 0, c: v('c') ?? 0, f: v('fat') ?? 0,
      fiber: v('fiber'), sugar: v('sugar'), addedSugar: v('addedSugar'), satFat: v('satFat'), sodium: v('sodium'),
    };
    const desc = f.desc.trim() || '1 serving';
    const servings = [{ label: `${desc} (${round(size, 1)} ${f.base})`, g: size }];
    // Keep "whole package" if it existed and still makes sense.
    const pkg = food?.servings?.find(s => /^Whole package/.test(s.label));
    if (pkg && f.base === food.base) servings.push(pkg);
    const id = food?.id || (gtin14 ? 'bc:' + gtin14 : 'my:' + uid());
    const saved = await upsertFood({
      ...(food || {}),
      id,
      barcode: food?.barcode || gtin14,
      name: f.name.trim(),
      brand: f.brand.trim(),
      source: food?.source || 'custom',
      base: f.base,
      per100,
      servings,
      verified: true,
      quality: assessQuality(per100),
      conflict: null,
      last: { qty: 1, unit: 's0' },
    });
    toast('Saved — this barcode will use your numbers from now on');
    if (then === 'food') replaceSheet('food', { food: saved, meal, date, fromScan });
    else closeSheet();
  }

  return html`<${Sheet} title=${food ? 'Correct from label' : 'Enter from label'}
      footer=${html`<button class="btn primary grow" onClick=${save}>Save food</button>`}>
    <p class="muted small">Copy the numbers from the Nutrition Facts panel, per serving.${gtin14 ? ' Linked to barcode ' + (normalizeBarcode(barcode)?.display || '') + '.' : ''}</p>
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${e => set('name')(e.currentTarget.value)} placeholder="e.g. Protein bar, chocolate" /><//>
    <${Field} label="Brand (optional)"><input class="input" value=${f.brand} onInput=${e => set('brand')(e.currentTarget.value)} /><//>
    <div class="grid2">
      <${Field} label="Serving"><input class="input" value=${f.desc} onInput=${e => set('desc')(e.currentTarget.value)} placeholder="1 bar" /><//>
      <${NumField} label="Serving size" value=${f.size} onInput=${set('size')} suffix=${f.base} placeholder="60" />
    </div>
    <${Seg} small label="Measured in" value=${f.base} onChange=${set('base')}
      options=${[{ value: 'g', label: 'Grams (food)' }, { value: 'ml', label: 'Milliliters (drink)' }]} />
    <${NumField} label="Calories" value=${f.kcal} onInput=${set('kcal')} suffix="kcal"
      hint=${showEst ? (Math.abs(est - kcalN) > Math.max(25, kcalN * 0.2)
        ? `Heads up: protein/carbs/fat add up to about ${fmtInt(est)} kcal. Double-check for typos.`
        : `Close to what the macros add up to (≈${fmtInt(est)} kcal).`) : null} />
    <div class="grid3">
      <${NumField} label="Protein" value=${f.p} onInput=${set('p')} suffix="g" />
      <${NumField} label="Carbs" value=${f.c} onInput=${set('c')} suffix="g" />
      <${NumField} label="Fat" value=${f.fat} onInput=${set('fat')} suffix="g" />
    </div>
    <details class="more" open=${!!food}>
      <summary>More (optional)</summary>
      <div class="grid2">
        <${NumField} label="Fiber" value=${f.fiber} onInput=${set('fiber')} suffix="g" />
        <${NumField} label="Total sugars" value=${f.sugar} onInput=${set('sugar')} suffix="g" />
        <${NumField} label="Added sugars" value=${f.addedSugar} onInput=${set('addedSugar')} suffix="g" />
        <${NumField} label="Saturated fat" value=${f.satFat} onInput=${set('satFat')} suffix="g" />
        <${NumField} label="Sodium" value=${f.sodium} onInput=${set('sodium')} suffix="mg" />
      </div>
    </details>
  <//>`;
}
