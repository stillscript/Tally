import { html, useState, useMemo } from '../preact.js';
import { S, recentFoods, addEntry, deleteEntry, upsertFood, toast } from '../store.js';
import { usdaSearch, offSearch, hasUsdaKey, nutrientsFor, findUnit, defaultAmount, amountText } from '../sources.js';
import { searchLocal, remoteQuery } from '../search.js';
import { Sheet, MealPicker, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet, replaceSheet, goTo } from './nav.js';
import { openAi } from './ai.js';
import { logSavedMeal } from './meals.js';
import { fmtInt, fmtG, mealLabel, mealForTime, prettyDate } from '../util.js';

function preview(food) {
  const a = defaultAmount(food);
  const u = findUnit(food, a.unit);
  return { n: nutrientsFor(food.per100, a.qty * u.g), text: amountText(a.qty, u), a, u };
}

function FoodRow({ food, onOpen, onQuick, sub }) {
  const p = preview(food);
  return html`<div class="row">
    <button class="row-main" onClick=${onOpen}>
      <span class="row-name">${food.name}</span>
      <span class="row-sub">${[food.brand, sub ?? p.text].filter(Boolean).join(' · ')}</span>
    </button>
    <span class="row-kcal"><b>${fmtInt(p.n.kcal)}</b><small>${fmtG(p.n.p)}g P</small></span>
    ${onQuick && html`<button class="row-add" onClick=${onQuick} aria-label=${'Quick add ' + food.name}><${Icon} n="plus" size=${20} /></button>`}
  </div>`;
}

function MealRow({ m, onOpen, onQuick }) {
  const kcal = m.items.reduce((s, i) => s + i.n.kcal, 0);
  const p = m.items.reduce((s, i) => s + i.n.p, 0);
  return html`<div class="row">
    <button class="row-main" onClick=${onOpen}>
      <span class="row-name">${m.name}</span>
      <span class="row-sub">${m.items.length} item${m.items.length > 1 ? 's' : ''} · ${m.items.slice(0, 3).map(i => i.name).join(', ')}</span>
    </button>
    <span class="row-kcal"><b>${fmtInt(kcal)}</b><small>${fmtG(p)}g P</small></span>
    <button class="row-add" onClick=${onQuick} aria-label=${'Add ' + m.name}><${Icon} n="plus" size=${20} /></button>
  </div>`;
}

export function AddSheet({ meal: m0, date: d0 }) {
  const [meal, setMeal] = useState(m0 || mealForTime());
  const date = d0 || S.ui.date;
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [res, setRes] = useState({});
  const [errs, setErrs] = useState({});

  const recents = useMemo(() => recentFoods(40), [S.entries.length]);
  const local = useMemo(() => searchLocal(q), [q, S.foods.size, S.meals]);
  const meals = useMemo(() => [...S.meals].sort((a, b) => b.usedAt - a.usedAt), [S.meals]);

  function search(e) {
    e?.preventDefault();
    const query = remoteQuery(q);
    if (query.length < 2) return;
    document.activeElement?.blur?.();
    setSubmitted(q.trim());
    setErrs({});
    const jobs = { generic: () => usdaSearch(query, 'generic'), packaged: () => offSearch(query) };
    if (hasUsdaKey()) jobs.branded = () => usdaSearch(query, 'branded');
    setRes(Object.fromEntries(Object.keys(jobs).map(k => [k, 'loading'])));
    for (const [k, run] of Object.entries(jobs)) {
      run()
        .then(list => setRes(r => ({ ...r, [k]: list })))
        .catch(err => {
          setRes(r => ({ ...r, [k]: [] }));
          setErrs(x => ({ ...x, [k]: err.code || 'error' }));
        });
    }
  }

  async function quickAdd(food) {
    const p = preview(food);
    const saved = await upsertFood({ ...food, last: p.a });
    const made = await addEntry({
      date, meal, foodId: saved.id, name: food.name, brand: food.brand || '',
      qty: p.a.qty, unit: p.u.key, unitLabel: p.u.label, amount: p.text, grams: p.a.qty * p.u.g, n: p.n,
    });
    S.ui.date = date;
    toast(`Added to ${mealLabel(meal)} · ${fmtInt(p.n.kcal)} kcal`, { label: 'Undo', fn: () => deleteEntry(made.id) });
  }

  const open = food => openSheet('food', { food, meal, date });
  const openMeal = m => openSheet('meal-template', { id: m.id, meal, date });
  const showingResults = submitted && q.trim() === submitted;
  const anyLocal = local.common.length + local.meals.length + local.yours.length > 0;

  const group = (key, title, note) => {
    const v = res[key];
    if (v === undefined) return null;
    return html`<section class="group">
      <h3 class="group-title">${title}${note && html`<span class="muted"> · ${note}</span>`}</h3>
      ${v === 'loading' ? html`<div class="row-skel"></div><div class="row-skel"></div>`
        : v.length ? v.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} />`)
        : html`<p class="muted small">${errs[key] === 'rate' ? 'Hourly limit reached for this source. Add your free USDA key in Settings to lift it.'
            : errs[key] ? 'Couldn’t reach this source right now.' : 'No matches.'}</p>`}
    </section>`;
  };

  const localGroups = html`
    ${local.common.length > 0 && html`<section class="group"><h3 class="group-title">Common foods <span class="muted">· USDA & label data</span></h3>
      ${local.common.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}</section>`}
    ${local.meals.length > 0 && html`<section class="group"><h3 class="group-title">Saved meals</h3>
      ${local.meals.map(m => html`<${MealRow} key=${m.id} m=${m} onOpen=${() => openMeal(m)} onQuick=${() => logSavedMeal(m, { meal, date })} />`)}</section>`}
    ${local.yours.length > 0 && html`<section class="group"><h3 class="group-title">Your foods</h3>
      ${local.yours.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}</section>`}`;

  return html`<${Sheet} title=${prettyDate(date) === 'Today' ? 'Add food' : `Add food · ${prettyDate(date)}`} full className="add-sheet">
    <form class="searchbar" onSubmit=${search} role="search">
      <${Icon} n="search" size=${20} />
      <input type="search" placeholder="Search foods, brands, saved meals" value=${q} enterkeyhint="search"
        onInput=${e => setQ(e.currentTarget.value)} aria-label="Search foods" />
    </form>

    <div class="quick-actions">
      <button class="qa" onClick=${() => replaceSheet('scanner', { meal, date })}><${Icon} n="scan" /><span>Scan</span></button>
      <button class="qa" onClick=${() => openAi('photo', { meal, date })}><${Icon} n="camera" /><span>Photo</span></button>
      <button class="qa" onClick=${() => openAi('restaurant', { meal, date })}><${Icon} n="store" /><span>Dine out</span></button>
      <button class="qa" onClick=${() => openSheet('quick', { meal, date })}><${Icon} n="bolt" /><span>Quick add</span></button>
      <button class="qa" onClick=${() => openSheet('label', { meal, date, then: 'food' })}><${Icon} n="edit" /><span>Create</span></button>
    </div>

    <div class="meal-pick"><span class="field-label">Adding to</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>

    ${showingResults ? html`
      ${localGroups}
      ${group('generic', 'Basic foods', 'USDA lab data')}
      ${group('branded', 'Brands', 'USDA manufacturer data')}
      ${group('packaged', 'Products', 'Open Food Facts')}
      ${!hasUsdaKey() && html`<${Note} tone="info">Searching on USDA’s shared demo key (about 10 lookups an hour).
        <button class="link" onClick=${() => goTo('settings')}>Add your free key</button> for reliable results.<//>`}
    ` : q.trim() ? html`
      ${localGroups}
      <button class="row search-go" onClick=${search}><${Icon} n="search" size=${18} />
        <span>${anyLocal ? 'Not it? ' : ''}Search USDA and Open Food Facts for “${q.trim()}”</span></button>
    ` : html`
      ${meals.length > 0 && html`<section class="group"><h3 class="group-title">Saved meals</h3>
        ${meals.slice(0, 6).map(m => html`<${MealRow} key=${m.id} m=${m} onOpen=${() => openMeal(m)} onQuick=${() => logSavedMeal(m, { meal, date })} />`)}</section>`}
      ${recents.length ? html`<section class="group"><h3 class="group-title">Recent <span class="muted">· tap + to add your usual amount</span></h3>
          ${recents.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}
        </section>`
        : !meals.length && html`<div class="empty">
          <p><b>Scan a barcode</b> for packaged food, <b>search</b> basics like “apple” or “chicken breast”, or snap a <b>photo</b> of a home-cooked plate.</p>
          <p class="muted">Everything you log shows up here for one-tap re-adding.</p>
        </div>`}
    `}
  <//>`;
}
