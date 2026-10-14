import { html, useState, useMemo, useRef, useEffect } from '../preact.js';
import { S, saveSettings, upsertFood, addEntry, deleteEntry, toast } from '../store.js';
import { AI_MODELS, hasAiKey, verifyAiKey, estimatePhoto, lookupRestaurant, askCoach } from '../ai.js';
import { dataSummary } from '../summary.js';
import { Sheet, MealPicker, Field, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet, replaceSheet, closeAllSheets } from './nav.js';
import { fmtInt, fmtG, mealLabel, mealForTime, uid, round } from '../util.js';

// ---------- shared ----------
const sum = items => items.reduce((t, i) => ({
  kcal: t.kcal + i.kcal, p: t.p + i.protein_g, c: t.c + i.carbs_g, f: t.f + i.fat_g, sodium: t.sodium + (i.sodium_mg || 0),
}), { kcal: 0, p: 0, c: 0, f: 0, sodium: 0 });

const toN = t => ({ kcal: t.kcal, p: t.p, c: t.c, f: t.f, fiber: 0, sugar: 0, addedSugar: 0, satFat: 0, sodium: t.sodium || 0 });

async function logAiFood(food, { meal, date, amount, grams }) {
  const saved = await upsertFood(food);
  const n = toN({ kcal: food.per100.kcal * grams / 100, p: food.per100.p * grams / 100, c: food.per100.c * grams / 100, f: food.per100.f * grams / 100, sodium: (food.per100.sodium || 0) * grams / 100 });
  const made = await addEntry({ date, meal, foodId: saved.id, name: food.name, brand: food.brand || '', qty: 1, unit: 's0', unitLabel: food.servings[0].label, amount, grams, n });
  S.ui.date = date;
  S.ui.tab = 'today';
  toast(`Added to ${mealLabel(meal)} · ${fmtInt(n.kcal)} kcal`, { label: 'Undo', fn: () => deleteEntry(made.id) });
  closeAllSheets();
}

function Working({ title, sub }) {
  return html`<div class="lookup"><div class="spinner"></div><p><b>${title}</b><br /><span class="muted small">${sub}</span></p></div>`;
}

// Shrink photos to Claude's recommended size (≤1568 px) before sending: faster and cheaper.
async function prepareImage(file, max = 1568) {
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

// ---------- setup ----------
export function AiSetupSheet({ next, nextProps }) {
  const [key, setKey] = useState(S.settings.anthropicKey || '');
  const [modelId, setModelId] = useState(S.settings.aiModel || AI_MODELS[0].id);
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');

  async function save() {
    if (!key.trim()) return toast('Paste your API key first');
    setState('checking');
    setErr('');
    try {
      await verifyAiKey(key.trim(), modelId);
      await saveSettings({ anthropicKey: key.trim(), aiModel: modelId });
      toast('Claude is connected');
      if (next) replaceSheet(next, nextProps || {});
      else closeAllSheets();
    } catch (e) {
      setErr(e.message);
      setState(null);
    }
  }
  async function remove() {
    await saveSettings({ anthropicKey: '' });
    setKey('');
    toast('Claude key removed from this device');
  }

  return html`<${Sheet} title="Connect Claude" footer=${html`
      ${S.settings.anthropicKey && html`<button class="btn" onClick=${remove}>Remove key</button>`}
      <button class="btn primary grow" onClick=${save} disabled=${state === 'checking'}>${state === 'checking' ? 'Checking…' : 'Save & connect'}</button>`}>
    <p>Meal photos, restaurant lookups and “Ask Claude” run on Claude through your own <b>Anthropic API key</b>.
      It's separate from a Claude.ai subscription and billed per use. Rough costs with the default model:
      a meal photo ≈ 3–7¢, a restaurant lookup ≈ 10–25¢ (it searches the web), a question ≈ 3–5¢.</p>
    <ol class="steps">
      <li>Open the Claude Console and sign in (or sign up), then add a little credit under Billing.</li>
      <li>Set a monthly spend limit (e.g. $10) under Limits so there are no surprises.</li>
      <li>Go to API keys → Create key, copy it, and paste it below.</li>
    </ol>
    <a class="btn small ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Open the Claude Console <${Icon} n="ext" size=${16} /></a>
    <${Field} label="Anthropic API key">
      <input class="input mono" type="password" value=${key} placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"
        onInput=${e => setKey(e.currentTarget.value)} />
    <//>
    <${Field} label="Model">
      <select class="input" value=${modelId} onChange=${e => setModelId(e.currentTarget.value)}>
        ${AI_MODELS.map(m => html`<option value=${m.id}>${m.label} — ${m.sub}</option>`)}
      </select>
    <//>
    ${err && html`<p class="error small">${err}</p>`}
    <p class="muted small">The key is stored only on this device and is never included in backups. Photos and questions go straight from your phone to Anthropic.</p>
  <//>`;
}

// Open a Claude feature, or the setup sheet first if no key is saved yet.
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
  const [err, setErr] = useState('');
  const cam = useRef(null);
  const lib = useRef(null);

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
      // Remember per-gram values so portions can be adjusted.
      setItems(r.items.map(i => ({ ...i, g0: i.grams, on: true })));
      setStage('review');
    } catch (x) {
      setErr(x.message);
      setStage('ready');
    }
  }
  const scaled = items.filter(i => i.on).map(i => {
    const k = i.g0 > 0 ? i.grams / i.g0 : 1;
    return { ...i, kcal: i.kcal * k, protein_g: i.protein_g * k, carbs_g: i.carbs_g * k, fat_g: i.fat_g * k };
  });
  const t = sum(scaled);
  const grams = scaled.reduce((s, i) => s + i.grams, 0);
  const setGrams = (idx, g) => setItems(list => list.map((x, j) => (j === idx ? { ...x, grams: Math.max(0, g) } : x)));
  const toggle = idx => setItems(list => list.map((x, j) => (j === idx ? { ...x, on: !x.on } : x)));

  async function add() {
    if (!(grams > 0)) return toast('Nothing left to add');
    const per = v => (v / grams) * 100;
    const food = {
      id: 'ai:' + uid(), barcode: null, name: dish.trim() || 'Meal', brand: '', source: 'ai', base: 'g',
      per100: { kcal: per(t.kcal), p: per(t.p), c: per(t.c), f: per(t.f), fiber: null, sugar: null, addedSugar: null, satFat: null, sodium: null },
      servings: [{ label: `1 plate (${Math.round(grams)} g)`, g: grams }],
      categories: [], quality: [], confidence: res.confidence, aiNotes: res.assumptions,
      aiItems: scaled.map(({ name, grams: g, kcal }) => ({ name, grams: Math.round(g), kcal: Math.round(kcal) })),
      last: { qty: 1, unit: 's0' },
    };
    await logAiFood(food, { meal, date, amount: 'photo estimate', grams });
  }

  const footer = stage === 'review'
    ? html`<button class="btn" onClick=${() => setStage('ready')}>Back</button>
        <button class="btn primary grow" onClick=${add}>Add to ${mealLabel(meal)} <span class="btn-sub">${fmtInt(t.kcal)} kcal</span></button>`
    : stage === 'ready' ? html`<button class="btn primary grow" onClick=${run}><${Icon} n="spark" /> Estimate with Claude</button>` : null;

  return html`<${Sheet} title="Meal photo" footer=${footer}>
    <input ref=${cam} type="file" accept="image/*" capture="environment" hidden onChange=${pick} />
    <input ref=${lib} type="file" accept="image/*" hidden onChange=${pick} />
    ${stage === 'pick' && html`<div class="photo-pick">
      <p class="muted">Snap your plate from slightly above, with the whole plate in frame. A fork or hand nearby helps Claude judge size.</p>
      <button class="btn primary block big" onClick=${() => cam.current.click()}><${Icon} n="scan" /> Take a photo</button>
      <button class="btn block" onClick=${() => lib.current.click()}>Choose from photos</button>
    </div>`}
    ${(stage === 'ready' || stage === 'working') && img && html`<img class="photo-preview" src=${img.preview} alt="Your meal" />`}
    ${stage === 'ready' && html`
      <${Field} label="Anything Claude can’t see? (optional)" hint="Cooking oil, butter, sauces, or exact amounts you know. These make the biggest difference.">
        <textarea class="input" rows="2" value=${notes} placeholder="e.g. cooked in 1 tbsp olive oil, 6 oz chicken"
          onInput=${e => setNotes(e.currentTarget.value)}></textarea>
      <//>
      <button class="btn small ghost" onClick=${() => setStage('pick')}>Use a different photo</button>
      ${err && html`<${Note} tone="warn">${err}<//>`}`}
    ${stage === 'working' && html`<${Working} title="Claude is looking at your meal…" sub="Usually 5–20 seconds" />`}
    ${stage === 'review' && html`
      <${Field} label="Meal name"><input class="input" value=${dish} onInput=${e => setDish(e.currentTarget.value)} /><//>
      <div class="badges"><span class=${'badge conf-' + res.confidence}>${res.confidence} confidence</span><span class="badge">AI estimate · adjust if needed</span></div>
      <div class="ai-items">
        ${items.map((i, idx) => html`<div class=${'ai-item' + (i.on ? '' : ' off')}>
          <button class="ai-check" onClick=${() => toggle(idx)} aria-label=${(i.on ? 'Remove ' : 'Include ') + i.name}>${i.on ? html`<${Icon} n="check" size=${16} />` : ''}</button>
          <span class="ai-main"><b>${i.name}</b><small>${i.portion}</small></span>
          <span class="ai-grams">
            <button onClick=${() => setGrams(idx, round(i.grams * 0.8))} aria-label="Less">−</button>
            <span>${Math.round(i.grams)} g</span>
            <button onClick=${() => setGrams(idx, round(i.grams * 1.25))} aria-label="More">+</button>
          </span>
          <span class="ai-kcal">${fmtInt(i.g0 > 0 ? i.kcal * i.grams / i.g0 : i.kcal)}</span>
        </div>`)}
      </div>
      <div class="tmpl-total"><span>${fmtG(t.p)}g P · ${fmtG(t.c)}g C · ${fmtG(t.f)}g F</span><b>${fmtInt(t.kcal)} kcal</b></div>
      ${res.assumptions && html`<${Note} tone="info">${res.assumptions}<//>`}
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
  const [err, setErr] = useState('');

  async function run() {
    if (!place.trim() || !order.trim()) return toast('Add the restaurant and what you ordered');
    setStage('working');
    setErr('');
    try {
      const r = await lookupRestaurant({ restaurant: place, order });
      setRes(r);
      setName(r.meal_name);
      setItems(r.items.map(i => ({ ...i, on: true })));
      setStage('review');
    } catch (x) {
      setErr(x.message);
      setStage('form');
    }
  }
  const t = sum(items.filter(i => i.on));
  async function add() {
    if (!(t.kcal > 0)) return toast('Nothing selected');
    const food = {
      id: 'ai:' + uid(), barcode: null, name: name.trim() || 'Restaurant meal', brand: res.restaurant, source: 'ai-restaurant',
      base: 'g', portionOnly: true,
      per100: { kcal: t.kcal, p: t.p, c: t.c, f: t.f, fiber: null, sugar: null, addedSugar: null, satFat: null, sodium: t.sodium || null },
      servings: [{ label: '1 order', g: 100 }],
      categories: [], quality: [], basis: res.basis, sources: res.sources, aiNotes: res.notes,
      aiItems: items.filter(i => i.on).map(({ name: n, kcal }) => ({ name: n, kcal: Math.round(kcal) })),
      last: { qty: 1, unit: 's0' },
    };
    await logAiFood(food, { meal, date, amount: '1 order', grams: 100 });
  }

  const footer = stage === 'form' ? html`<button class="btn primary grow" onClick=${run}><${Icon} n="search" /> Look it up</button>`
    : stage === 'review' ? html`<button class="btn" onClick=${() => setStage('form')}>Back</button>
        <button class="btn primary grow" onClick=${add}>Add to ${mealLabel(meal)} <span class="btn-sub">${fmtInt(t.kcal)} kcal</span></button>` : null;

  return html`<${Sheet} title="Restaurant meal" footer=${footer}>
    ${stage === 'form' && html`
      <p class="muted small">Claude searches the restaurant's published nutrition info for your exact order.</p>
      <${Field} label="Restaurant"><input class="input" value=${place} placeholder="e.g. Chipotle" onInput=${e => setPlace(e.currentTarget.value)} /><//>
      <${Field} label="What you ordered" hint="Include size, protein, sides and add-ons, e.g. sauces or extra cheese.">
        <textarea class="input" rows="3" value=${order} placeholder="e.g. Chicken burrito bowl, white rice, black beans, fajita veggies, mild salsa, cheese"
          onInput=${e => setOrder(e.currentTarget.value)}></textarea>
      <//>
      ${err && html`<${Note} tone="warn">${err}<//>`}`}
    ${stage === 'working' && html`<${Working} title=${`Checking ${place.trim()}'s nutrition info…`} sub="Claude is searching the web. Usually 15–40 seconds." />`}
    ${stage === 'review' && html`
      <${Field} label="Meal name"><input class="input" value=${name} onInput=${e => setName(e.currentTarget.value)} /><//>
      <div class="badges"><span class=${'badge basis-' + res.basis}>${BASIS[res.basis] || res.basis}</span><span class="badge">${res.restaurant}</span></div>
      <div class="ai-items">
        ${items.map((i, idx) => html`<div class=${'ai-item' + (i.on ? '' : ' off')}>
          <button class="ai-check" onClick=${() => setItems(list => list.map((x, j) => (j === idx ? { ...x, on: !x.on } : x)))}
            aria-label=${(i.on ? 'Remove ' : 'Include ') + i.name}>${i.on ? html`<${Icon} n="check" size=${16} />` : ''}</button>
          <span class="ai-main"><b>${i.name}</b><small>${fmtG(i.protein_g)}g P · ${fmtG(i.carbs_g)}g C · ${fmtG(i.fat_g)}g F</small></span>
          <span class="ai-kcal">${fmtInt(i.kcal)}</span>
        </div>`)}
      </div>
      <div class="tmpl-total"><span>${fmtG(t.p)}g P · ${fmtG(t.c)}g C · ${fmtG(t.f)}g F</span><b>${fmtInt(t.kcal)} kcal</b></div>
      ${res.notes && html`<${Note} tone="info">${res.notes}<//>`}
      ${res.sources?.length > 0 && html`<div class="sources"><span class="field-label">Sources</span>
        ${res.sources.slice(0, 4).map(u => { let h = u; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch {} return html`<a href=${u} target="_blank" rel="noopener">${h}</a>`; })}</div>`}
      <div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>`}
  <//>`;
}

// ---------- share with a Claude chat (no API key needed) ----------
export async function copySummary() {
  const text = `Here is my food and weight log from my tracking app. Please look it over and help me with my questions.\n\n${dataSummary()}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it into a Claude chat and ask away.');
  } catch {
    if (navigator.share) {
      try { await navigator.share({ title: 'My Tally log', text }); } catch {}
    } else toast('Couldn’t copy on this device');
  }
}

// ---------- ask Claude ----------
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
  const [history, setHistory] = useState([]); // API messages
  const [shown, setShown] = useState([]); // { role, text }
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [shown.length, busy]);

  async function ask(text) {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ('');
    setErr('');
    const nextHistory = [...history, { role: 'user', content: question }];
    setShown(s => [...s, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const r = await askCoach(nextHistory, summary);
      setHistory([...nextHistory, { role: 'assistant', content: r.content }]);
      setShown(s => [...s, { role: 'assistant', text: r.text }]);
    } catch (x) {
      setErr(x.message);
      setShown(s => s.slice(0, -1));
      setQ(question);
    } finally {
      setBusy(false);
    }
  }

  return html`<${Sheet} title="Ask Claude" full className="coach-sheet" footer=${html`
      <form class="coach-input" onSubmit=${e => { e.preventDefault(); ask(); }}>
        <input class="input" value=${q} placeholder="Ask about your eating, weight or targets" onInput=${e => setQ(e.currentTarget.value)} disabled=${busy} />
        <button class="btn primary" type="submit" disabled=${busy || !q.trim()} aria-label="Send">Ask</button>
      </form>`}>
    ${!shown.length && html`<div class="coach-intro">
      <p class="muted small">Claude sees your last 4 weeks: daily totals, weigh-ins, what you ate this week, your targets and check-ins.</p>
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
