import { html, useMemo } from '../preact.js';
import { S, emit, entriesFor, dayTotals, addEntries, toast, saveMeta } from '../store.js';
import { latestTrendKg, checkInDue, lifts } from '../goals.js';
import { proteinFriendlyFoods } from '../insights.js';
import { nutrientsFor, defaultAmount, findUnit, hasUsdaKey } from '../sources.js';
import { Ring, MacroBar } from './common.js';
import { Icon } from './icons.js';
import { openSheet, goTo } from './nav.js';
import { MEALS, todayKey, addDays, prettyDate, fmtInt, fmtG, fmtW, wUnit, mealForTime } from '../util.js';

function go(delta) {
  S.ui.date = addDays(S.ui.date, delta);
  emit();
}

function Entry({ e }) {
  const open = () => (e.foodId ? openSheet('food', { entry: e }) : openSheet('quick', { entry: e }));
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
      <div class="row-btns"><button class="btn small primary" onClick=${() => goTo('settings')}>Set it up</button>
        <button class="btn small ghost" onClick=${() => { saveMeta({ usdaCardHidden: true }); emit(); }}>Later</button></div>
    </div>
  </section>`;
}

// Late in the day with lots of protein left: suggest the user's own protein-dense regulars.
function ProteinNudge({ remP, date }) {
  const foods = useMemo(() => proteinFriendlyFoods(3), [S.entries.length]);
  if (date !== todayKey() || new Date().getHours() < 15 || remP < 40 || !foods.length) return null;
  if (S.meta.nudgeHidden === todayKey()) return null;
  return html`<section class="card nudge">
    <div class="nudge-head"><span><b>${fmtInt(remP)} g</b> protein to go today. Quick wins from your regulars:</span>
      <button class="icon-btn small" aria-label="Hide for today" onClick=${() => { saveMeta({ nudgeHidden: todayKey() }); emit(); }}><${Icon} n="x" size=${16} /></button></div>
    <div class="chips">
      ${foods.map(f => {
        const a = defaultAmount(f);
        const n = nutrientsFor(f.per100, a.qty * findUnit(f, a.unit).g);
        return html`<button class="chip" onClick=${() => openSheet('food', { food: f, meal: mealForTime(), date })}>
          ${f.name} <small>${fmtG(n.p)}g · ${fmtInt(n.kcal)} kcal</small></button>`;
      })}
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
          note=${lifts(S.profile) && !S.profile.manualTargets ? 'set higher because you lift' : null} />
        <${MacroBar} label="Carbs" value=${tot.c} target=${t.carbs} cls="carbs" />
        <${MacroBar} label="Fat" value=${tot.f} target=${t.fat} cls="fat" />
      </button>
    </section>

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

    <${ProteinNudge} remP=${t.protein - tot.p} date=${date} />

    ${MEALS.map(m => html`<${Meal} key=${m.id} meal=${m} date=${date} list=${list.filter(e => e.meal === m.id)} />`)}
  </div>`;
}
