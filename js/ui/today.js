import { html, useMemo, useState } from '../preact.js';
import { S, emit, entriesFor, dayTotals, addEntries, deleteEntry, upsertFood, toast, saveMeta, saveProfile } from '../store.js';
import { latestTrendKg, checkInDue, lifts, nutrientGuides, computeTargets } from '../goals.js';
import { fillTheGap } from '../fillgap.js';
import { amountText, hasUsdaKey } from '../sources.js';
import { Ring, MacroBar } from './common.js';
import { Icon } from './icons.js';
import { openSheet, goTo } from './nav.js';
import { isAiMeal } from './ai.js';
import { BackupCard } from './backup.js';
import { MEALS, todayKey, addDays, prettyDate, fmtInt, fmtG, fmtW, wUnit, mealForTime, mealLabel } from '../util.js';

function go(delta) {
  S.ui.date = addDays(S.ui.date, delta);
  emit();
}

function Entry({ e }) {
  const open = () => openSheet(isAiMeal(e) ? 'ai-entry' : e.foodId ? 'food' : 'quick', { entry: e });
  return html`<button class="entry" onClick=${open}>
    <span class="e-main">
      <span class="e-name">${e.name}</span>
      <span class="e-sub">${[e.brand, e.amount].filter(Boolean).join(' · ')}</span>
    </span>
    <span class="e-nums"><b>${fmtInt(e.n.kcal)}</b><small>${fmtG(e.n.p)}g P</small></span>
  </button>`;
}

function Meal({ meal, date, list }) {
  const kcal = list.reduce((s, e) => s + e.n.kcal, 0);
  const yesterday = list.length ? [] : entriesFor(addDays(date, -1)).filter(e => e.meal === meal.id);
  async function copy() {
    await addEntries(yesterday.map(({ id, createdAt, ...rest }) => ({ ...rest, date })));
    toast(`Copied ${yesterday.length} item${yesterday.length > 1 ? 's' : ''} to ${meal.label}`);
  }
  return html`<section class="meal card">
    <header class="meal-head">
      <h3>${meal.label}</h3>
      ${list.length > 0 && html`<span class="meal-kcal">${fmtInt(kcal)} kcal</span>`}
      <button class="icon-btn add" onClick=${() => openSheet('add', { meal: meal.id, date })} aria-label=${'Add to ' + meal.label}>
        <${Icon} n="plus" />
      </button>
    </header>
    ${list.map(e => html`<${Entry} key=${e.id} e=${e} />`)}
    ${!list.length && yesterday.length > 0 && html`<button class="copy-link" onClick=${copy}>
      <${Icon} n="copy" size=${16} /> Same as yesterday? Copy ${yesterday.length} item${yesterday.length > 1 ? 's' : ''} · ${fmtInt(yesterday.reduce((s, e) => s + e.n.kcal, 0))} kcal
    </button>`}
    ${list.length >= 2 && html`<button class="copy-link subtle" onClick=${() => openSheet('save-meal', { date, meal: meal.id })}>
      <${Icon} n="save" size=${16} /> Save as a meal for one-tap logging
    </button>`}
  </section>`;
}

// One-time setup reminder: the shared USDA demo key runs out after ~10 lookups an hour.
function KeyCard() {
  if (hasUsdaKey() || S.meta.usdaCardHidden) return null;
  return html`<section class="card setup-card">
    <div><b>Finish setup: free USDA key</b>
      <p class="small muted">Barcode lookups share a demo key that runs out after about 10 scans an hour. Your own key takes a minute and lifts that to ~1,000.</p>
      <div class="row-btns"><button class="btn small primary" onClick=${() => goTo('settings', 'food-data')}>Set it up</button>
        <button class="btn small ghost" onClick=${() => { saveMeta({ usdaCardHidden: true }); emit(); }}>Later</button></div>
    </div>
  </section>`;
}

// Late in the day with protein to go: one or two small combos that cover it within your calories. One tap adds.
function FillGap({ date }) {
  const gap = useMemo(() => fillTheGap(date), [S.entries.length, S.entries.reduce((s, e) => s + e.n.kcal, 0), date, S.profile.targets, new Date().getHours()]);
  if (!gap || S.meta.gapHidden === todayKey()) return null;
  async function add(o) {
    const meal = mealForTime();
    for (const i of o.items) if (!S.foods.has(i.food.id)) await upsertFood({ ...i.food, last: { qty: i.qty, unit: i.unit.key } });
    const made = await addEntries(o.items.map(i => ({
      date, meal, foodId: i.food.id, name: i.food.name, brand: i.food.brand || '',
      qty: i.qty, unit: i.unit.key, unitLabel: i.unit.label, amount: amountText(i.qty, i.unit), grams: i.grams, n: i.n,
    })));
    toast(`Added to ${mealLabel(meal)} · ${fmtG(o.p)} g protein`, { label: 'Undo', fn: () => made.forEach(e => deleteEntry(e.id)) });
  }
  return html`<section class="card gap-card">
    <header class="gap-head">
      <span><b>Fill the gap</b><small>${fmtInt(gap.pLeft)} g protein and ${fmtInt(gap.kLeft)} kcal left today</small></span>
      <button class="icon-btn small" aria-label="Hide for today" onClick=${() => { saveMeta({ gapHidden: todayKey() }); emit(); }}><${Icon} n="x" size=${16} /></button>
    </header>
    ${gap.options.map(o => html`<div class="gap-option">
      <span class="gap-main"><b>${o.items.map(i => i.food.name).join(' + ')}</b>
        <small>${o.items.map(i => amountText(i.qty, i.unit)).join(' · ')}</small>
        <small><b class="gap-p">${fmtG(o.p)} g protein</b> · ${fmtInt(o.kcal)} kcal</small></span>
      <button class="btn small" onClick=${() => add(o)} aria-label=${'Add ' + o.items.map(i => i.food.name).join(' and ')}><${Icon} n="plus" size=${16} /> Add</button>
    </div>`)}
  </section>`;
}

// Fiber, sugars, saturated fat and sodium, folded away until you want them.
const OPEN_KEY = 'tally.nutrientsOpen';
function readOpen() {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}
function NutrientPanel({ tot, kcal }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(OPEN_KEY, open ? '0' : '1'); } catch {}
  };
  const guides = nutrientGuides(kcal);
  const fmt = (v, unit) => (unit === 'mg' ? fmtInt(v) : fmtG(v));
  return html`<div class="nutrients">
    ${open && html`<div class="nutrient-list">
      ${guides.map(g => {
        const v = tot[g.key] || 0;
        const frac = g.target ? Math.min(1, v / g.target) : 0;
        const over = g.kind === 'limit' && v > g.target;
        const status = g.kind === 'goal' ? (v >= g.target ? 'goal met' : `${fmt(g.target - v, g.unit)} ${g.unit} to go`)
          : g.kind === 'limit' ? (over ? `${fmt(v - g.target, g.unit)} ${g.unit} over` : 'under limit') : '';
        return html`<div class=${`nutrient ${g.kind}${over ? ' over' : ''}`} title=${g.why}>
          <div class="macro-top">
            <span class="macro-label">${g.label}</span>
            <span class="macro-num"><b>${fmt(v, g.unit)}</b>${g.target ? ` / ${fmt(g.target, g.unit)}` : ''} ${g.unit}</span>
          </div>
          ${g.target ? html`<div class="bar"><div class="bar-fill" style=${{ width: frac * 100 + '%' }}></div></div>` : null}
          <span class="nutrient-note">${status ? html`<b>${status}</b> · ` : ''}${g.why}</span>
        </div>`;
      })}
      <p class="nutrient-foot">Quick adds and some database items don’t list these, so totals can read a little low.</p>
    </div>`}
    <button class="nutrients-toggle" onClick=${toggle} aria-expanded=${open}>
      ${open ? 'Hide' : 'Fiber, sugars, sodium & more'} <${Icon} n=${open ? 'up' : 'down'} size=${16} />
    </button>
  </div>`;
}

// Profiles created before the lifting question existed get asked once.
function LiftCard() {
  const p = S.profile;
  if (p.lifts !== undefined) return null;
  async function answer(yes) {
    const next = { ...p, lifts: yes };
    if (!p.manualTargets) next.targets = computeTargets(next, p.tdee, latestTrendKg());
    await saveProfile(next);
    toast(yes ? `Protein stays at ${next.targets.protein} g, set higher for lifting` : `Protein set to ${next.targets.protein} g`);
  }
  return html`<section class="card setup-card">
    <div><b>Quick question: do you lift weights or strength train?</b>
      <p class="small muted">It decides your protein target. Lifters get more (about 0.9 g per lb of goal weight) to keep muscle while losing fat.</p>
      <div class="row-btns"><button class="btn small primary" onClick=${() => answer(true)}>Yes, I lift</button>
        <button class="btn small" onClick=${() => answer(false)}>No</button></div>
    </div>
  </section>`;
}

export function Today() {
  const date = S.ui.date;
  const t = S.profile.targets;
  const tot = dayTotals(date);
  const left = t.kcal - tot.kcal;
  const over = left < 0;
  const units = S.settings.units;
  const weighIn = S.weights.find(w => w.date === date);
  const isToday = date === todayKey();
  const list = entriesFor(date);

  return html`<div class="today">
    <header class="day-nav">
      <button class="icon-btn" onClick=${() => go(-1)} aria-label="Previous day"><${Icon} n="left" /></button>
      <button class="day-title" onClick=${() => { S.ui.date = todayKey(); emit(); }}>${prettyDate(date)}</button>
      <button class="icon-btn" onClick=${() => go(1)} disabled=${isToday} aria-label="Next day"><${Icon} n="right" /></button>
    </header>

    <section class="card summary">
      <div class="ring-wrap">
        <${Ring} value=${tot.kcal} max=${t.kcal} over=${over} />
        <div class="ring-center">
          <span class=${'ring-num' + (over ? ' over' : '')}>${fmtInt(Math.abs(left))}</span>
          <span class="ring-label">${over ? 'kcal over' : 'kcal left'}</span>
        </div>
      </div>
      <button class="summary-side" onClick=${() => openSheet('targets-info')} aria-label="How your targets are set">
        <span class="eaten"><span><b>${fmtInt(tot.kcal)}</b> eaten</span><span class="muted">of ${fmtInt(t.kcal)} <${Icon} n="info" size=${14} className="inline-icon" /></span></span>
        <${MacroBar} label="Protein" value=${tot.p} target=${t.protein} cls="protein"
          note=${S.profile.lifts === true && !S.profile.manualTargets ? 'set higher because you lift' : null} />
        <${MacroBar} label="Carbs" value=${tot.c} target=${t.carbs} cls="carbs" />
        <${MacroBar} label="Fat" value=${tot.f} target=${t.fat} cls="fat" />
      </button>
      <${NutrientPanel} tot=${tot} kcal=${t.kcal} />
    </section>

    <${LiftCard} />
    ${isToday && html`<${KeyCard} />`}

    <div class="pills">
      <button class="pill" onClick=${() => openSheet('weight', { date })}>
        <${Icon} n="scale" size=${18} />
        ${weighIn ? html`<span><b>${fmtW(weighIn.kg, units)}</b> ${wUnit(units)} · trend ${fmtW(latestTrendKg(), units)}</span>`
          : html`<span>${isToday ? 'Log today’s weight' : 'Log weight for this day'}</span>`}
      </button>
    </div>

    ${isToday && checkInDue() && html`<button class="card checkin-card" onClick=${() => openSheet('checkin')}>
      <${Icon} n="spark" /><span><b>Weekly check-in is ready</b><small>See how this week went and fine-tune your targets</small></span><${Icon} n="right" />
    </button>`}

    <${FillGap} date=${date} />
    ${isToday && (hasUsdaKey() || S.meta.usdaCardHidden) && html`<${BackupCard} />`}

    ${MEALS.map(m => html`<${Meal} key=${m.id} meal=${m} date=${date} list=${list.filter(e => e.meal === m.id)} />`)}
  </div>`;
}
