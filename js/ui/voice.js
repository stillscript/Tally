import { html, useState, useEffect, useRef, useMemo } from '../preact.js';
import { S, addEntries, upsertFood, deleteEntry, toast } from '../store.js';
import { parseSpoken, entryFor } from '../parse.js';
import { hasAiKey, estimateText } from '../ai.js';
import { Sheet, MealPicker } from './common.js';
import { Icon } from './icons.js';
import { closeAllSheets } from './nav.js';
import { logSavedMeal } from './meals.js';
import { fmtInt, fmtG, mealLabel, mealForTime, uid } from '../util.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const MIC_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it for this site in your browser settings, or use your keyboard’s mic.',
  'service-not-allowed': 'Voice input isn’t available here. Use the mic button on your keyboard instead.',
  'no-speech': 'Didn’t catch that. Tap the mic and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input needs a connection. You can still type it.',
};

// Claude's per-item estimates become foods so they can be re-logged later.
function aiItemToFood(i) {
  const g = i.grams > 0 ? i.grams : 100;
  const per = v => (v / g) * 100;
  return {
    id: 'ai:' + uid(), barcode: null, name: i.name, brand: '', source: 'ai', base: 'g',
    per100: { kcal: per(i.kcal), p: per(i.protein_g), c: per(i.carbs_g), f: per(i.fat_g), fiber: null, sugar: null, addedSugar: null, satFat: null, sodium: null },
    servings: [{ label: `${i.portion} (${Math.round(g)} g)`, g }], categories: [], quality: [], last: { qty: 1, unit: 's0' },
  };
}

export function VoiceSheet({ meal: m0, date: d0 }) {
  const [meal, setMeal] = useState(m0 || mealForTime());
  const date = d0 || S.ui.date;
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState('');
  const [off, setOff] = useState({}); // unticked items by key
  const [aiItems, setAiItems] = useState([]); // { key, food, qty, unit }
  const [aiBusy, setAiBusy] = useState(false);
  const rec = useRef(null);

  const parsed = useMemo(() => parseSpoken(text), [text, S.foods.size, S.meals]);
  useEffect(() => () => rec.current?.abort?.(), []);

  function listen() {
    if (listening) return rec.current?.stop();
    setErr('');
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    const start = text ? text.trim() + ', ' : '';
    r.onresult = e => setText(start + [...e.results].map(x => x[0].transcript).join(' '));
    r.onerror = e => setErr(MIC_ERRORS[e.error] || 'Voice input stopped. You can type it instead.');
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
      setAiItems([]);
    } catch {
      setErr(MIC_ERRORS['service-not-allowed']);
    }
  }

  async function estimateRest() {
    setAiBusy(true);
    try {
      const r = await estimateText(parsed.unmatched.join(', '));
      setAiItems(r.items.map(i => {
        const food = aiItemToFood(i);
        return { key: 'ai:' + i.name, said: i.name, food, qty: 1, unit: { key: 's0', label: food.servings[0].label, g: food.servings[0].g, serving: true }, ai: true };
      }));
    } catch (e) {
      toast(e.message);
    } finally {
      setAiBusy(false);
    }
  }

  const foodItems = [...parsed.items.filter(i => i.food), ...aiItems].filter(i => !off[i.key]);
  const mealItems = parsed.items.filter(i => i.meal && !off[i.key]);
  const kcalOf = i => (i.food ? (i.food.per100.kcal * i.qty * i.unit.g) / 100 : i.meal.items.reduce((s, x) => s + x.n.kcal, 0) * i.qty);
  const total = [...foodItems, ...mealItems].reduce((s, i) => s + kcalOf(i), 0);
  const count = foodItems.length + mealItems.length;
  const unresolved = aiItems.length ? [] : parsed.unmatched;

  async function add() {
    if (!count) return toast('Nothing to add yet');
    for (const i of foodItems) await upsertFood({ ...i.food, last: i.ai ? { qty: 1, unit: 's0' } : i.food.last });
    const made = foodItems.length ? await addEntries(foodItems.map(i => entryFor(i, { date, meal }))) : [];
    for (const i of mealItems) await logSavedMeal(i.meal, { meal, date, factor: i.qty });
    S.ui.date = date;
    S.ui.tab = 'today';
    if (made.length) toast(`Added ${made.length} item${made.length > 1 ? 's' : ''} to ${mealLabel(meal)} · ${fmtInt(total)} kcal`, { label: 'Undo', fn: () => made.forEach(e => deleteEntry(e.id)) });
    closeAllSheets();
  }

  const row = (i, sub) => html`<div class=${'ai-item' + (off[i.key] ? ' off' : '')}>
    <button class="ai-check" onClick=${() => setOff(o => ({ ...o, [i.key]: !o[i.key] }))} aria-label=${(off[i.key] ? 'Include ' : 'Remove ') + (i.food?.name || i.meal.name)}>
      ${off[i.key] ? '' : html`<${Icon} n="check" size=${16} />`}</button>
    <span class="ai-main"><b>${i.food?.name || i.meal.name}</b><small>${sub}</small></span>
    <span class="ai-kcal">${fmtInt(kcalOf(i))}</span>
  </div>`;

  return html`<${Sheet} title="Say what you ate" footer=${html`
      <button class="btn primary grow" onClick=${add} disabled=${!count}>Add to ${mealLabel(meal)} ${count ? html`<span class="btn-sub">${count} item${count > 1 ? 's' : ''} · ${fmtInt(total)} kcal</span>` : ''}</button>`}>
    ${Recognition && html`<div class="voice-mic">
      <button class=${'mic-btn' + (listening ? ' live' : '')} onClick=${listen} aria-label=${listening ? 'Stop listening' : 'Start listening'}>
        <${Icon} n="mic" size=${30} /></button>
      <span class="muted small">${listening ? 'Listening… tap to stop' : text ? 'Tap to add more' : 'Tap and say what you ate'}</span>
    </div>`}
    <textarea class="input voice-text" rows="2" value=${text} onInput=${e => { setText(e.currentTarget.value); setAiItems([]); }}
      placeholder=${Recognition ? 'e.g. two eggs, a slice of toast and a black coffee' : 'Type or use your keyboard’s mic: “two eggs and a banana”'}></textarea>
    ${err && html`<p class="error small">${err}</p>`}

    ${(parsed.items.length > 0 || aiItems.length > 0) && html`<div class="ai-items">
      ${parsed.items.map(i => row(i, i.food ? `${i.approx ? '≈ ' : ''}${fmtG(i.qty)} × ${i.unit.label} · ${fmtG((i.food.per100.p * i.qty * i.unit.g) / 100)}g P`
        : `saved meal · ${i.meal.items.length} items${i.qty !== 1 ? ` · ${fmtG(i.qty)}×` : ''}`))}
      ${aiItems.map(i => row(i, `Claude estimate · ${i.unit.label}`))}
    </div>`}
    ${unresolved.length > 0 && html`<div class="voice-miss">
      <span class="small">Couldn’t place: ${unresolved.map(u => html`<b>“${u}”</b> `)}</span>
      ${hasAiKey() ? html`<button class="btn small" onClick=${estimateRest} disabled=${aiBusy}>${aiBusy ? 'Estimating…' : html`<${Icon} n="spark" size=${16} /> Estimate with Claude`}</button>`
        : html`<span class="muted small">Try a simpler name, or add it from Search.</span>`}
    </div>`}
    ${text.trim() && html`<div class="meal-pick"><span class="field-label">Meal</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>`}
  <//>`;
}
