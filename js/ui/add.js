import { html, useState, useMemo } from '../preact.js';
import { S, recentFoods, addEntry, deleteEntry, upsertFood, toast } from '../store.js';
import { usdaSearch, offSearch, hasUsdaKey, nutrientsFor, findUnit, defaultAmount, amountText } from '../sources.js';
import { Sheet, MealPicker } from './common.js';
import { Icon } from './icons.js';
import { openSheet, replaceSheet } from './nav.js';
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

const tokens = s => s.toLowerCase().split(/\s+/).filter(Boolean);

export function AddSheet({ meal: m0, date: d0 }) {
  const [meal, setMeal] = useState(m0 || mealForTime());
  const date = d0 || S.ui.date;
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [res, setRes] = useState({});
  const [errs, setErrs] = useState({});

  const recents = useMemo(() => recentFoods(40), [S.entries.length]);
  const local = useMemo(() => {
    const t = tokens(q);
    if (!t.length) return [];
    return [...S.foods.values()]
      .filter(f => { const hay = `${f.name} ${f.brand || ''}`.toLowerCase(); return t.every(w => hay.includes(w)); })
      .slice(0, 12);
  }, [q, S.foods.size]);

  function search(e) {
    e?.preventDefault();
    const query = q.trim();
    if (query.length < 2) return;
    document.activeElement?.blur?.();
    setSubmitted(query);
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
  const showingResults = submitted && q.trim() === submitted;

  const group = (key, title, note) => {
    const v = res[key];
    if (v === undefined) return null;
    return html`<section class="group">
      <h3 class="group-title">${title}${note && html`<span class="muted"> · ${note}</span>`}</h3>
      ${v === 'loading' ? html`<div class="row-skel"></div><div class="row-skel"></div>`
        : v.length ? v.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} />`)
        : html`<p class="muted small">${errs[key] === 'rate' ? 'Hourly limit reached for this source — try again later, or add your free USDA key in Settings.'
            : errs[key] ? 'Couldn’t reach this source right now.' : 'No matches.'}</p>`}
    </section>`;
  };

  return html`<${Sheet} title=${prettyDate(date) === 'Today' ? 'Add food' : `Add food · ${prettyDate(date)}`} full className="add-sheet">
    <form class="searchbar" onSubmit=${search} role="search">
      <${Icon} n="search" size=${20} />
      <input type="search" placeholder="Search foods, brands, restaurants" value=${q} enterkeyhint="search"
        onInput=${e => setQ(e.currentTarget.value)} aria-label="Search foods" />
    </form>

    <div class="quick-actions">
      <button class="qa" onClick=${() => replaceSheet('scanner', { meal, date })}><${Icon} n="scan" /><span>Scan</span></button>
      <button class="qa" onClick=${() => openSheet('quick', { meal, date })}><${Icon} n="bolt" /><span>Quick add</span></button>
      <button class="qa" onClick=${() => openSheet('label', { meal, date, then: 'food' })}><${Icon} n="edit" /><span>Create food</span></button>
    </div>

    <div class="meal-pick"><span class="field-label">Adding to</span><${MealPicker} value=${meal} onChange=${setMeal} /></div>

    ${showingResults ? html`
      ${local.length > 0 && html`<section class="group"><h3 class="group-title">Your foods</h3>
        ${local.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}</section>`}
      ${group('generic', 'Basic foods', 'USDA lab data')}
      ${group('branded', 'Brands', 'USDA manufacturer data')}
      ${group('packaged', 'Products', 'Open Food Facts')}
    ` : q.trim() ? html`
      <button class="row search-go" onClick=${search}><${Icon} n="search" size=${18} />
        <span>Search USDA and Open Food Facts for “${q.trim()}”</span></button>
      ${local.length > 0 && html`<section class="group"><h3 class="group-title">Your foods</h3>
        ${local.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}</section>`}
    ` : recents.length ? html`
      <section class="group"><h3 class="group-title">Recent <span class="muted">· tap + to add your usual amount</span></h3>
        ${recents.map(f => html`<${FoodRow} key=${f.id} food=${f} onOpen=${() => open(f)} onQuick=${() => quickAdd(f)} />`)}
      </section>
    ` : html`<div class="empty">
      <p><b>Scan a barcode</b> for packaged food, or <b>search</b> for basics like “chicken breast” or “banana”.</p>
      <p class="muted">Everything you log shows up here for one-tap re-adding.</p>
    </div>`}
  <//>`;
}
