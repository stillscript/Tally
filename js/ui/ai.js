import { html, useState, useMemo, useRef, useEffect } from '../preact.js';
import { S, saveSettings, upsertFood, addEntry, updateEntry, deleteEntry, restoreEntry, toast } from '../store.js';
import {
  PROVIDERS, providerById, currentProvider, keyFor, hasAiKey, aiName, modelFor,
  verifyAiKey, estimatePhoto, lookupRestaurant, reviseMeal, askCoach,
} from '../ai.js';
import { sourceLabel } from '../sources.js';
import { dataSummary } from '../summary.js';
import { Sheet, MealPicker, Field, Note, Seg } from './common.js';
import { EntryActions } from './entry-actions.js';
import { Icon } from './icons.js';
import { openSheet, replaceSheet, closeSheet, closeAllSheets } from './nav.js';
import { fmtInt, fmtG, mealLabel, mealForTime, uid, round } from '../util.js';

// ---------- meal items ----------
// An item: { name, portion, grams, kcal, protein_g, carbs_g, fat_g, sodium_mg?, k (portion multiplier), on }.
const scale = (i, k) => ({
  ...i, grams: (i.grams || 0) * k, kcal: i.kcal * k, protein_g: i.protein_g * k, carbs_g: i.carbs_g * k, fat_g: i.fat_g * k,
  ...(i.sodium_mg != null && { sodium_mg: i.sodium_mg * k }),
});
const applied = i => ({ ...scale(i, i.k ?? 1), k: 1 });
const eatenOf = items => items.filter(i => i.on !== false).map(applied);
const editable = list => list.map(i => ({ ...i, k: 1, on: !i.off }));
const compact = i => {
  const o = { name: i.name, portion: i.portion || '', grams: round(i.grams || 0, 1), kcal: round(i.kcal, 1),
    protein_g: round(i.protein_g, 1), carbs_g: round(i.carbs_g, 1), fat_g: round(i.fat_g, 1) };
  if (i.sodium_mg != null) o.sodium_mg = Math.round(i.sodium_mg);
  if (i.approx) o.approx = true; // macros split from the meal's total, not known per item
  return o;
};
const sum = items => items.reduce((t, i) => ({
  kcal: t.kcal + i.kcal, p: t.p + i.protein_g, c: t.c + i.carbs_g, f: t.f + i.fat_g,
  sodium: t.sodium + (i.sodium_mg || 0), grams: t.grams + (i.grams || 0),
}), { kcal: 0, p: 0, c: 0, f: 0, sodium: 0, grams: 0 });
const toN = t => ({ kcal: t.kcal, p: t.p, c: t.c, f: t.f, fiber: 0, sugar: 0, addedSugar: 0, satFat: 0, sodium: t.sodium || 0 });

const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
function frac(k) {
  const whole = Math.floor(k + 1e-9);
  const part = FRACTIONS[round(k - whole, 2)];
  if (part) return whole ? `${whole}${part}` : part;
  return String(round(k, 2));
}

// Sodium isn't part of a recalculated meal; keep it for items that are still there.
function carrySodium(before, after) {
  return after.map(i => {
    const old = before.find(b => b.name.toLowerCase() === i.name.toLowerCase() && b.sodium_mg != null);
    return old ? { ...i, sodium_mg: old.kcal > 0 ? old.sodium_mg * (i.kcal / old.kcal) : old.sodium_mg } : i;
  });
}

function MealItems({ items, setItems, macrosAsSub }) {
  const update = (idx, fn) => setItems(list => list.map((x, j) => (j === idx ? fn(x) : x)));
  return html`<div class="ai-items">
    ${items.map((i, idx) => {
      const s = applied(i);
      const sub = i.approx ? i.portion || '' : macrosAsSub || !i.portion ? `${fmtG(s.protein_g)}g P · ${fmtG(s.carbs_g)}g C · ${fmtG(s.fat_g)}g F` : i.portion;
      return html`<div class=${'ai-item' + (i.on ? '' : ' off')}>
        <button class="ai-check" onClick=${() => update(idx, x => ({ ...x, on: !x.on }))}
          aria-label=${(i.on ? 'Remove ' : 'Include ') + i.name}>${i.on ? html`<${Icon} n="check" size=${16} />` : ''}</button>
        <span class="ai-main"><b>${i.name}</b><small>${sub}</small></span>
        <span class="ai-grams">
          <button onClick=${() => update(idx, x => ({ ...x, k: Math.max(0.25, round(x.k - 0.25, 2)) }))} aria-label=${'Less ' + i.name}>−</button>
          <span>${i.grams > 0 ? `${Math.round(s.grams)} g` : `${frac(i.k)}×`}</span>
          <button onClick=${() => update(idx, x => ({ ...x, k: round(x.k + 0.25, 2) }))} aria-label=${'More ' + i.name}>+</button>
        </span>
        <span class="ai-kcal">${fmtInt(s.kcal)}</span>
      </div>`;
    })}
  </div>`;
}

const Totals = ({ t }) => html`<div class="tmpl-total"><span>${fmtG(t.p)}g P · ${fmtG(t.c)}g C · ${fmtG(t.f)}g F</span><b>${fmtInt(t.kcal)} kcal</b></div>`;

// "Coke Zero instead", "only ate half the fries": the AI updates the items, everything else stays.
function FixIt({ dish, place, current, onDone, label = 'Anything different?' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!hasAiKey()) return null;
  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const before = current();
      const r = await reviseMeal({ dish, items: before, change: text, place });
      onDone({ ...r, items: carrySodium(before, r.items) }, sum(before).kcal);
      setText('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return html`<div class="fix-it">
    <${Field} label=${label} hint="e.g. “Coke Zero instead of regular”, “only ate half the fries”, “no cheese”">
      <textarea class="input" rows="2" value=${text} onInput=${e => setText(e.currentTarget.value)}
        placeholder="Say what was different"></textarea>
    <//>
    <button class="btn small" onClick=${run} disabled=${busy || !text.trim()}>
      ${busy ? html`<span class="spinner small"></span> Recalculating…` : html`<${Icon} n="refresh" size=${16} /> Recalculate with ${aiName()}`}</button>
    ${err && html`<${Note} tone="warn">${err}<//>`}
  </div>`;
}

const Revised = ({ r }) => r && html`<${Note} tone="good" icon="refresh">
  <b>${fmtInt(r.before)} → ${fmtInt(r.after)} kcal.</b> ${r.note}<//>`;

export function SourceLinks({ sources, max = 4 }) {
  const list = (sources || []).slice(0, max).map(s => {
    if (typeof s !== 'string') return s;
    let label = s;
    try { label = new URL(s).hostname.replace(/^www\./, ''); } catch {}
    return { url: s, label };
  });
  return list.map(s => html` <a href=${s.url} target="_blank" rel="noopener">${s.label}</a>`);
}

async function logAiMeal({ kind, name, brand, items, meal, date, extra }) {
  const eaten = eatenOf(items);
  const t = sum(eaten);
  if (!(t.kcal > 0)) return toast('Nothing left to add');
  const restaurant = kind === 'restaurant';
  // Restaurant orders have no meaningful weight: "1 order" stands in as 100 g.
  const grams = restaurant ? 100 : t.grams || 100;
  const per = v => (v / grams) * 100;
  const kept = eaten.map(compact);
  const food = {
    id: 'ai:' + uid(), barcode: null, name, brand: brand || '', source: restaurant ? 'ai-restaurant' : 'ai',
    aiBy: S.settings.aiProvider, aiKind: kind, base: 'g', ...(restaurant && { portionOnly: true }),
    per100: { kcal: per(t.kcal), p: per(t.p), c: per(t.c), f: per(t.f), fiber: null, sugar: null, addedSugar: null, satFat: null, sodium: restaurant ? per(t.sodium) || null : null },
    servings: [{ label: restaurant ? '1 order' : `1 plate (${Math.round(grams)} g)`, g: grams }],
    categories: [], quality: [], aiItems: kept, last: { qty: 1, unit: 's0' }, ...extra,
  };
  const saved = await upsertFood(food);
  const n = toN(t);
  const made = await addEntry({
    date, meal, foodId: saved.id, name: food.name, brand: food.brand, qty: 1, unit: 's0', unitLabel: food.servings[0].label,
    amount: restaurant ? '1 order' : 'photo estimate', grams, n, aiItems: kept, eaten: 1,
  });
  S.ui.date = date;
  S.ui.tab = 'today';
  toast(`Added to ${mealLabel(meal)} · ${fmtInt(n.kcal)} kcal`, { label: 'Undo', fn: () => deleteEntry(made.id) });
  closeAllSheets();
}

function Working({ title, sub }) {
  return html`<div class="lookup"><div class="spinner"></div><p><b>${title}</b><br /><span class="muted small">${sub}</span></p></div>`;
}

// Shrink photos to a size every service handles well (≤1568 px) before sending: faster and cheaper.
export async function prepareImage(file, max = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Couldn’t open that photo. Try another one.'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { preview: dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- setup: pick one service, then connect it ----------
export function AiSetupSheet({ next, nextProps, choose }) {
  const cur = currentProvider();
  const [pid, setPid] = useState(choose ? null : cur?.id || null);
  return pid
    ? html`<${ConnectForm} key=${pid} p=${providerById(pid)} next=${next} nextProps=${nextProps} onSwitch=${() => setPid(null)} />`
    : html`<${Sheet} title="Choose your AI">
        <p>Meal photos, restaurant lookups, label reading and questions about your log can run on the AI service you already have an <b>API key</b> for. Tally uses just that one; you can switch here any time.</p>
        <div class="menu-group">
          ${PROVIDERS.map(p => html`<button class="menu-row" onClick=${() => setPid(p.id)}>
            <span class=${'ai-mark ai-' + p.id} aria-hidden="true">${p.name[0]}</span>
            <span class="menu-main"><b>${p.name}</b><small>${p.company}</small></span>
            ${cur?.id === p.id && keyFor(p.id) ? html`<span class="badge ok">In use</span>` : keyFor(p.id) ? html`<span class="badge">Key saved</span>` : null}
            <${Icon} n="right" size=${18} />
          </button>`)}
        </div>
        <p class="muted small">Not sure? Any of them works the same in Tally. An API key is separate from a chat subscription and is billed per use, usually a few cents at a time.</p>
      <//>`;
}

function ConnectForm({ p, next, nextProps, onSwitch }) {
  const saved = keyFor(p.id);
  const [key, setKey] = useState(saved);
  const [modelId, setModelId] = useState(modelFor(p));
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const inUse = S.settings.aiProvider === p.id && !!saved;

  async function save() {
    if (!key.trim()) return toast('Paste your API key first');
    setState('checking');
    setErr('');
    try {
      await verifyAiKey(p.id, key.trim(), modelId);
      await saveSettings({
        aiProvider: p.id,
        aiKeys: { ...S.settings.aiKeys, [p.id]: key.trim() },
        aiModels: { ...S.settings.aiModels, [p.id]: modelId },
      });
      toast(`${p.name} is connected`);
      if (next) replaceSheet(next, nextProps || {});
      else closeSheet();
    } catch (e) {
      setErr(e.message);
      setState(null);
    }
  }
  async function remove() {
    const aiKeys = { ...S.settings.aiKeys };
    delete aiKeys[p.id];
    await saveSettings({ aiKeys, ...(S.settings.aiProvider === p.id && { aiProvider: '' }) });
    setKey('');
    toast(`${p.name} key removed from this device`);
  }

  return html`<${Sheet} title=${`Connect ${p.name}`} footer=${html`
      ${saved && html`<button class="btn" onClick=${remove}>Remove key</button>`}
      <button class="btn primary grow" onClick=${save} disabled=${state === 'checking'}>${state === 'checking' ? 'Checking…' : inUse ? 'Save' : 'Save & connect'}</button>`}>
    ${inUse ? html`<${Note} tone="good" icon="check">${p.name} is connected. Meal photos, restaurant lookups, label reading and “Ask ${p.name}” are on.<//>`
      : html`<p>Meal photos, restaurant lookups, label reading and “Ask ${p.name}” run on ${p.name} through your own <b>${p.keyName}</b>.
        It’s separate from ${p.separate} and billed per use: usually a few cents per photo or question, a bit more for restaurant lookups because they search the web.</p>
      <ol class="steps">${p.steps.map(s => html`<li>${s}</li>`)}</ol>`}
    <a class="btn small ghost" href=${p.keyUrl} target="_blank" rel="noopener">Open the ${p.console} <${Icon} n="ext" size=${16} /></a>
    <${Field} label=${p.keyName}>
      <input class="input mono" type="password" value=${key} placeholder=${p.keyHint} autocomplete="off" autocapitalize="off" spellcheck="false"
        onInput=${e => setKey(e.currentTarget.value)} />
    <//>
    ${p.models.length > 1 && html`<${Field} label="Model">
      <select class="input" value=${modelId} onChange=${e => setModelId(e.currentTarget.value)}>
        ${p.models.map(m => html`<option value=${m.id}>${m.label}${m.sub ? ` — ${m.sub}` : ''}</option>`)}
      </select>
    <//>`}
    ${err && html`<p class="error small">${err}</p>`}
    <p class="muted small">The key is stored only on this device and is never included in backups. Photos and questions go straight from your phone to ${p.company}.</p>
    <button class="link small switch-ai" onClick=${onSwitch}>Use a different AI service</button>
  <//>`;
}

// Open an AI feature, or the setup sheet first if no service is connected yet.
export function openAi(sheet, props = {}) {
  if (hasAiKey()) openSheet(sheet, props);
  else openSheet('ai-setup', { next: sheet, nextProps: props });
}

// ---------- meal photo ----------
export function PhotoSheet({ meal: m0, date: d0 }) {
  const [meal, setMeal] = useState(m0 || mealForTime());
  const date = d0 || S.ui.date;
  const [stage, setStage] = useState('pick');
  const [img, setImg] = useState(null);
  const [notes, setNotes] = useState('');
  const [res, setRes] = useState(null);
  const [items, setItems] = useState([]);
  const [dish, setDish] = useState('');
  const [revised, setRevised] = useState(null);
  const [err, setErr] = useState('');
  const cam = useRef(null);
  const lib = useRef(null);
  const name = aiName();

  async function pick(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      setImg(await prepareImage(f));
      setStage('ready');
    } catch (x) {
      toast(x.message);
    }
  }
  async function run() {
    setStage('working');
    setErr('');
    try {
      const r = await estimatePhoto({ base64: img.base64, notes });
      setRes(r);
      setDish(r.dish);
      setItems(editable(r.items));
      setRevised(null);
      setStage('review');
    } catch (x) {
      setErr(x.message);
      setStage('ready');
    }
  }
  const t = sum(eatenOf(items));
  const add = () => logAiMeal({
    kind: 'photo', name: dish.trim() || 'Meal', items, meal, date,
    extra: { confidence: res.confidence, aiNotes: revised?.note || res.assumptions },
  });

  const footer = stage === 'review'
    ? html`<button class="btn" onClick=${() => setStage('ready')}>Back</button>
        <button class="btn primary grow" onClick=${add}>Add to ${mealLabel(meal)} <span class="btn-sub">${fmtInt(t.kcal)} kcal</span></button>`
    : stage === 'ready' ? html`<button class="btn primary grow" onClick=${run}><${Icon} n="spark" /> Estimate with ${name}</button>` : null;

  return html`<${Sheet} title="Meal photo" footer=${footer}>
    <input ref=${cam} type="file" accept="image/*" capture="environment" hidden onChange=${pick} />
    <input ref=${lib} type="file" accept="image/*" hidden onChange=${pick} />
    ${stage === 'pick' && html`<div class="photo-pick">
      <p class="muted">Snap your plate from slightly above, with the whole plate in frame. A fork or hand nearby helps ${name} judge size.</p>
      <button class="btn primary block big" onClick=${() => cam.current.click()}><${Icon} n="camera" /> Take a photo</button>
      <button class="btn block" onClick=${() => lib.current.click()}>Choose from photos</button>
    </div>`}
    ${(stage === 'ready' || stage === 'working') && img && html`<img class="photo-preview" src=${img.preview} alt="Your meal" />`}
    ${stage === 'ready' && html`
      <${Field} label=${`Anything ${name} can’t see? (optional)`} hint="Cooking oil, butter, sauces, or exact amounts you know. These make the biggest difference.">
        <textarea class="input" rows="2" value=${notes} placeholder="e.g. cooked in 1 tbsp olive oil, 6 oz chicken"
          onInput=${e => setNotes(e.currentTarget.value)}></textarea>
      <//>
      <button class="btn small ghost" onClick=${() => setStage('pick')}>Use a different photo</button>
      ${err && html`<${Note} tone="warn">${err}<//>`}`}
    ${stage === 'working' && html`<${Working} title=${`${name} is looking at your meal…`} sub="Usually 5–20 seconds" />`}
    ${stage === 'review' && html`
      <${Field} label="Meal name"><input class="input" value=${dish} onInput=${e => setDish(e.currentTarget.value)} /><//>
      <div class="badges"><span class=${'badge conf-' + res.confidence}>${res.confidence} confidence</span><span class="badge">AI estimate · adjust if needed</span></div>
      <${MealItems} items=${items} setItems=${setItems} />
      <${Totals} t=${t} />
      ${revised ? html`<${Revised} r=${{ ...revised, after: t.kcal }} />` : res.assumptions && html`<${Note} tone="info">${res.assumptions}<//>`}
      <${FixIt} dish=${dish} current=${() => eatenOf(items)} label="Anything to fix?"
        onDone=${(r, before) => { setItems(editable(r.items)); setRevised({ before, note: r.assumptions }); }} />
      <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>`}
  <//>`;
}

// ---------- restaurant ----------
const BASIS = { official: 'Official nutrition info', third_party: 'Third-party data', estimate: 'Estimate' };

export function RestaurantSheet({ meal: m0, date: d0 }) {
  const [meal, setMeal] = useState(m0 || mealForTime());
  const date = d0 || S.ui.date;
  const [place, setPlace] = useState('');
  const [order, setOrder] = useState('');
  const [stage, setStage] = useState('form');
  const [res, setRes] = useState(null);
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [revised, setRevised] = useState(null);
  const [err, setErr] = useState('');
  const ai = aiName();

  async function run() {
    if (!place.trim() || !order.trim()) return toast('Add the restaurant and what you ordered');
    setStage('working');
    setErr('');
    try {
      const r = await lookupRestaurant({ restaurant: place, order });
      setRes(r);
      setName(r.meal_name);
      setItems(editable(r.items));
      setRevised(null);
      setStage('review');
    } catch (x) {
      setErr(x.message);
      setStage('form');
    }
  }
  const t = sum(eatenOf(items));
  const add = () => logAiMeal({
    kind: 'restaurant', name: name.trim() || 'Restaurant meal', brand: res.restaurant, items, meal, date,
    extra: { basis: res.basis, sources: res.sources, aiNotes: revised?.note || res.notes },
  });

  const footer = stage === 'form' ? html`<button class="btn primary grow" onClick=${run}><${Icon} n="search" /> Look it up</button>`
    : stage === 'review' ? html`<button class="btn" onClick=${() => setStage('form')}>Back</button>
        <button class="btn primary grow" onClick=${add}>Add to ${mealLabel(meal)} <span class="btn-sub">${fmtInt(t.kcal)} kcal</span></button>` : null;

  return html`<${Sheet} title="Restaurant meal" footer=${footer}>
    ${stage === 'form' && html`
      <p class="muted small">${ai} searches the restaurant’s published nutrition info for your exact order.</p>
      <${Field} label="Restaurant"><input class="input" value=${place} placeholder="e.g. Chipotle" onInput=${e => setPlace(e.currentTarget.value)} /><//>
      <${Field} label="What you ordered" hint="Include size, protein, sides and add-ons, e.g. sauces or extra cheese.">
        <textarea class="input" rows="3" value=${order} placeholder="e.g. Chicken burrito bowl, white rice, black beans, fajita veggies, mild salsa, cheese"
          onInput=${e => setOrder(e.currentTarget.value)}></textarea>
      <//>
      ${err && html`<${Note} tone="warn">${err}<//>`}`}
    ${stage === 'working' && html`<${Working} title=${`Checking ${place.trim()}’s nutrition info…`} sub=${`${ai} is searching the web. Usually 15–40 seconds.`} />`}
    ${stage === 'review' && html`
      <${Field} label="Meal name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} /><//>
      <div class="badges"><span class=${'badge basis-' + res.basis}>${BASIS[res.basis] || res.basis}</span><span class="badge">${res.restaurant}</span></div>
      <${MealItems} items=${items} setItems=${setItems} macrosAsSub />
      <${Totals} t=${t} />
      ${revised ? html`<${Revised} r=${{ ...revised, after: t.kcal }} />` : res.notes && html`<${Note} tone="info">${res.notes}<//>`}
      ${res.sources?.length > 0 && html`<div class="sources"><span class="field-label">Sources</span><${SourceLinks} sources=${res.sources} /></div>`}
      <${FixIt} dish=${name} place=${res.restaurant} current=${() => eatenOf(items)} label="Anything to fix?"
        onDone=${(r, before) => { setItems(editable(r.items)); setRevised({ before, note: r.assumptions }); }} />
      <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>`}
  <//>`;
}

// ---------- edit a logged AI meal ----------
export const isAiMeal = e => !!(e.aiItems?.length || S.foods.get(e.foodId)?.aiItems?.length);

function itemsForEntry(e) {
  if (e.aiItems?.length) return { items: editable(e.aiItems), eaten: e.eaten || 1 };
  // Logged before 3.0, or re-logged from Recents: the entry's numbers are the truth, spread over the food's items.
  const food = S.foods.get(e.foodId);
  const src = food?.aiItems?.length ? food.aiItems : [{ name: e.name, kcal: e.n.kcal }];
  const total = src.reduce((s, i) => s + (i.kcal || 0), 0);
  const k = total > 0 ? e.n.kcal / total : 1;
  const share = i => (total > 0 ? (i.kcal || 0) / total : 1 / src.length);
  return {
    eaten: 1,
    items: editable(src.map(i => (i.protein_g != null ? scale(i, k) : {
      name: i.name, portion: i.portion || '', grams: (i.grams || 0) * k, approx: true,
      kcal: e.n.kcal * share(i), protein_g: e.n.p * share(i), carbs_g: e.n.c * share(i), fat_g: e.n.f * share(i),
      ...(e.n.sodium ? { sodium_mg: e.n.sodium * share(i) } : {}),
    }))),
  };
}

const PORTIONS = [{ value: 1, label: 'All' }, { value: 0.75, label: '¾' }, { value: 0.5, label: '½' }, { value: 0.25, label: '¼' }];

export function AiEntrySheet({ entry }) {
  const food = S.foods.get(entry.foodId);
  const restaurant = food?.source === 'ai-restaurant';
  const start = useMemo(() => itemsForEntry(entry), []);
  const [items, setItems] = useState(start.items);
  const [eaten, setEaten] = useState(start.eaten);
  const [name, setName] = useState(entry.name);
  const [meal, setMeal] = useState(entry.meal);
  const [revised, setRevised] = useState(null);
  const effective = () => eatenOf(items).map(i => scale(i, eaten));
  const t = sum(effective());

  async function save() {
    if (!(t.kcal > 0)) return toast('Nothing selected. Remove the entry instead?');
    const kept = items.map(i => ({ ...compact(applied(i)), ...(i.on ? {} : { off: true }) }));
    const whole = restaurant ? 'order' : 'plate';
    await updateEntry({
      ...entry, name: name.trim() || entry.name, meal, n: toN(t), aiItems: kept, eaten,
      grams: restaurant ? 100 * eaten : t.grams || entry.grams,
      amount: eaten !== 1 ? `${frac(eaten)} of the ${whole}` : entry.aiItems || revised ? (restaurant ? '1 order' : 'photo estimate') : entry.amount,
    });
    toast('Saved');
    closeSheet();
  }
  async function remove() {
    const e = await deleteEntry(entry.id);
    closeSheet();
    toast('Removed', { label: 'Undo', fn: () => restoreEntry(e) });
  }

  return html`<${Sheet} title="Edit meal" footer=${html`
      <button class="btn danger" onClick=${remove} aria-label="Remove entry"><${Icon} n="trash" /></button>
      <button class="btn primary grow" onClick=${save}>Save changes <span class="btn-sub">${fmtInt(t.kcal)} kcal</span></button>`}>
    <${Field} label="Meal name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} /><//>
    ${food && html`<div class="badges"><span class=${'badge src ' + food.source}>${sourceLabel(food)}</span>${food.brand && html`<span class="badge">${food.brand}</span>`}</div>`}
    <div class="field">
      <span class="field-label">How much did you eat?</span>
      <${Seg} label="How much did you eat" value=${eaten} onChange=${setEaten} options=${PORTIONS} />
    </div>
    <${MealItems} items=${items} setItems=${setItems} macrosAsSub=${restaurant} />
    <${Totals} t=${t} />
    ${eaten !== 1 && html`<p class="muted small eaten-note">You ate ${frac(eaten)} of the ${restaurant ? 'order' : 'plate'} · ${fmtInt(sum(eatenOf(items)).kcal)} kcal for all of it</p>`}
    ${revised ? html`<${Revised} r=${{ ...revised, after: t.kcal }} />`
      : (food?.aiNotes || food?.sources?.length > 0) && html`<p class="muted small ai-note">${food.aiNotes || ''}<${SourceLinks} sources=${food.sources} max=${3} /></p>`}
    <${FixIt} dish=${name} place=${restaurant ? food?.brand : ''} current=${effective}
      onDone=${(r, before) => { setItems(editable(r.items)); setEaten(1); setRevised({ before, note: r.assumptions }); }} />
    ${!hasAiKey() && html`<p class="muted small">Connect an AI service in Settings to recalculate from a description, like “Coke Zero instead”.</p>`}
    <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>
    <${EntryActions} entry=${entry} />
  <//>`;
}

// ---------- share with any AI chat (no API key needed) ----------
export async function copySummary() {
  const text = `Here is my food and weight log from my tracking app. Please look it over and help me with my questions.\n\n${dataSummary()}`;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied. Paste it into ${hasAiKey() ? `a ${aiName()} chat` : 'any AI chat'} and ask away.`);
  } catch {
    if (navigator.share) {
      try { await navigator.share({ title: 'My Tally log', text }); } catch {}
    } else toast('Couldn’t copy on this device');
  }
}

// ---------- ask questions about your log ----------
const SUGGESTIONS = [
  'How did this week go?',
  'What one change would help me most right now?',
  'Where can I get more protein from foods I already eat?',
  'Is my weight trend on track for my goal?',
];

function Rich({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map(part => (/^\*\*[^*]+\*\*$/.test(part) ? html`<b>${part.slice(2, -2)}</b>` : part));
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      if (!list) blocks.push((list = { li: [] }));
      list.li.push(m[1]);
    } else {
      list = null;
      blocks.push({ p: line.replace(/^#+\s*/, '') });
    }
  }
  return blocks.map(b => (b.li ? html`<ul>${b.li.map(x => html`<li>${inline(x)}</li>`)}</ul>` : html`<p>${inline(b.p)}</p>`));
}

export function CoachSheet() {
  const summary = useMemo(() => dataSummary(), []);
  const [shown, setShown] = useState([]); // { role, text }
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef(null);
  const name = aiName();
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [shown.length, busy]);

  async function ask(text) {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ('');
    setErr('');
    const history = [...shown, { role: 'user', text: question }];
    setShown(history);
    setBusy(true);
    try {
      const r = await askCoach(history, summary);
      setShown([...history, { role: 'assistant', text: r.text }]);
    } catch (x) {
      setErr(x.message);
      setShown(history.slice(0, -1));
      setQ(question);
    } finally {
      setBusy(false);
    }
  }

  return html`<${Sheet} title=${`Ask ${name}`} full className="coach-sheet" footer=${html`
      <form class="coach-input" onSubmit=${e => { e.preventDefault(); ask(); }}>
        <input class="input" value=${q} placeholder="Ask about your eating, weight or targets" onInput=${e => setQ(e.currentTarget.value)} disabled=${busy} />
        <button class="btn primary" type="submit" disabled=${busy || !q.trim()} aria-label="Send">Ask</button>
      </form>`}>
    ${!shown.length && html`<div class="coach-intro">
      <p class="muted small">${name} sees your last 4 weeks: daily totals, weigh-ins, what you ate this week, your targets and check-ins.</p>
      <div class="chips">${SUGGESTIONS.map(s => html`<button class="chip" onClick=${() => ask(s)}>${s}</button>`)}</div>
    </div>`}
    <div class="coach-log">
      ${shown.map(m => html`<div class=${'bubble ' + m.role}>${m.role === 'assistant' ? html`<${Rich} text=${m.text} />` : m.text}</div>`)}
      ${busy && html`<div class="bubble assistant thinking"><span class="spinner small"></span> Looking at your data…</div>`}
      ${err && html`<${Note} tone="warn">${err}<//>`}
      <div ref=${end}></div>
    </div>
  <//>`;
}
