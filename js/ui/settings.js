import { html, useState, useRef } from '../preact.js';
import { S, saveProfile, saveSettings, saveMeta, exportData, importData, eraseAll, toast } from '../store.js';
import { computeTargets, latestTrendKg, formulaTdee, paceOf, ACTIVITY, lifts } from '../goals.js';
import { AI_MODELS, hasAiKey } from '../ai.js';
import { copySummary } from './ai.js';
import { verifyUsdaKey, hasUsdaKey } from '../sources.js';
import { Sheet, Seg, Field, NumField, Note } from './common.js';
import { Icon } from './icons.js';
import { openSheet, closeSheet } from './nav.js';
import { AboutYou, GoalFields, draftFromProfile, validate, heightCm } from './profile-form.js';
import { fmtInt, fmtW, wUnit, num, todayKey, fromDisplayWeight } from '../util.js';

// Ask the browser to look for a newer version right now (it otherwise checks on its own schedule).
async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) return toast('Updates apply automatically when Tally is opened from its web address');
  try {
    await reg.update();
  } catch {
    return toast('Couldn’t check right now. Are you online?');
  }
  if (reg.installing || reg.waiting) toast('New version found, installing…');
  else toast(`You’re on the latest version (${self.TALLY_VERSION})`);
}

const REGIONS = [
  { value: 'united-states', label: 'United States' },
  { value: 'canada', label: 'Canada' },
  { value: 'united-kingdom', label: 'United Kingdom' },
  { value: 'australia', label: 'Australia' },
  { value: 'world', label: 'Anywhere' },
];

export function Settings() {
  const p = S.profile;
  const units = S.settings.units;
  const [key, setKey] = useState(S.settings.usdaKey || '');
  const [keyState, setKeyState] = useState(null);
  const file = useRef(null);

  async function saveKey() {
    const k = key.trim();
    if (!k) {
      await saveSettings({ usdaKey: '' });
      setKeyState(null);
      return toast('Using the shared demo key');
    }
    setKeyState('checking');
    const r = await verifyUsdaKey(k);
    if (r.ok || r.code === 'rate') {
      await saveSettings({ usdaKey: k });
      setKeyState('ok');
      toast('USDA key saved');
    } else setKeyState(r.code === 'key' ? 'bad' : 'net');
  }

  async function doExport() {
    const name = `tally-backup-${todayKey()}.json`;
    const blob = new Blob([JSON.stringify(exportData())], { type: 'application/json' });
    const f = new File([blob], name, { type: 'application/json' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title: 'Tally backup' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function doImport(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm(`Replace everything on this device with the backup from ${String(data.exportedAt || '').slice(0, 10) || 'this file'}?`)) return;
      await importData(data);
      toast('Backup restored');
    } catch (err) {
      toast(err.message || 'Couldn’t read that file');
    }
  }

  async function doErase() {
    if (!confirm('Erase all of your Tally data on this device? This can’t be undone.')) return;
    await eraseAll();
  }

  return html`<div class="settings">
    <h1 class="screen-title">Settings</h1>

    <section class="card">
      <header class="card-head"><h2>Daily targets</h2>
        <button class="btn small" onClick=${() => openSheet('targets')}>Edit</button></header>
      <div class="target-grid">
        <div><b>${fmtInt(p.targets.kcal)}</b><span>kcal</span></div>
        <div class="protein"><b>${fmtInt(p.targets.protein)}g</b><span>protein</span></div>
        <div class="carbs"><b>${fmtInt(p.targets.carbs)}g</b><span>carbs</span></div>
        <div class="fat"><b>${fmtInt(p.targets.fat)}g</b><span>fat</span></div>
      </div>
      <p class="small">${lifts(p) ? html`<b>Protein is set higher because you lift</b>, to keep muscle while you lose fat. ` : ''}${p.manualTargets ? 'Targets set by you.' : 'Refined at each weekly check-in.'}</p>
      <button class="btn small ghost" onClick=${() => openSheet('targets-info')}><${Icon} n="info" size=${16} /> How these are set</button>
    </section>

    <section class="card">
      <header class="card-head"><h2>Claude</h2>
        <button class="btn small" onClick=${() => openSheet('ai-setup')}>${hasAiKey() ? 'Change' : 'Connect'}</button></header>
      <p class="small">${hasAiKey()
        ? html`Connected · ${AI_MODELS.find(m => m.id === S.settings.aiModel)?.label || S.settings.aiModel}. Meal photos, restaurant lookups and “Ask Claude” are on.`
        : 'Connect your Anthropic API key to estimate meals from photos, look up restaurant orders, and ask questions about your progress.'}</p>
      <button class="btn small ghost" onClick=${copySummary}><${Icon} n="copy" size=${16} /> Copy my log for a Claude chat (free)</button>
    </section>

    <section class="card">
      <header class="card-head"><h2>Goal & profile</h2>
        <button class="btn small" onClick=${() => openSheet('profile')}>Edit</button></header>
      <p>Goal <b>${fmtW(p.goalWeightKg, units)} ${wUnit(units)}</b> · ${paceOf(p).label} pace · ${ACTIVITY.find(a => a.id === p.activity)?.label} · ${lifts(p) ? 'lifts weights' : 'no lifting'}</p>
    </section>

    <section class="card">
      <header class="card-head"><h2>Preferences</h2></header>
      <${Field} label="Units">
        <${Seg} label="Units" value=${units} onChange=${v => saveSettings({ units: v })}
          options=${[{ value: 'imperial', label: 'lb' }, { value: 'metric', label: 'kg' }]} />
      <//>
      <${Field} label="Food notes & lighter swaps" hint="Short, occasional notes when something is unusually fatty, salty or sugary — and protein-friendly swaps from the same aisle.">
        <${Seg} label="Food notes" value=${S.settings.tips === false ? 'off' : 'on'} onChange=${v => saveSettings({ tips: v === 'on' })}
          options=${[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      <//>
      ${Object.keys(S.meta.muted || {}).length > 0 && html`<button class="btn small ghost" onClick=${() => { saveMeta({ muted: {} }); toast('Notes re-enabled for all foods'); }}>
        Un-hide ${Object.keys(S.meta.muted).length} muted food${Object.keys(S.meta.muted).length > 1 ? 's' : ''}</button>`}
      <${Field} label="Where you shop" hint="Product search and lighter swaps only show products sold here.">
        <select class="input" value=${S.settings.region} onChange=${e => saveSettings({ region: e.currentTarget.value })}>
          ${REGIONS.map(r => html`<option value=${r.value}>${r.label}</option>`)}
        </select>
      <//>
    </section>

    <section class="card">
      <header class="card-head"><h2>Food data</h2></header>
      <p class="small">Barcodes are checked against <b>USDA FoodData Central</b> (manufacturer label data, the most reliable source for US products) and <b>Open Food Facts</b> (worldwide, community-maintained) at the same time.</p>
      ${!hasUsdaKey() && html`<${Note} tone="info">You’re on USDA’s shared demo key, which allows only a handful of lookups per hour. A free personal key takes a minute and allows about 1,000 per hour.<//>`}
      <${Field} label="USDA API key">
        <span class="input-wrap">
          <input class="input mono" value=${key} placeholder="Paste your key" autocomplete="off" autocapitalize="off" spellcheck="false"
            onInput=${e => { setKey(e.currentTarget.value); setKeyState(null); }} />
        </span>
      <//>
      ${keyState === 'bad' && html`<p class="error small">USDA rejected that key. Check it was copied fully.</p>`}
      ${keyState === 'net' && html`<p class="error small">Couldn’t reach USDA to check the key. Try again when online.</p>`}
      <div class="row-btns">
        <button class="btn small primary" onClick=${saveKey} disabled=${keyState === 'checking'}>${keyState === 'checking' ? 'Checking…' : 'Save key'}</button>
        <a class="btn small ghost" href="https://fdc.nal.usda.gov/api-key-signup/" target="_blank" rel="noopener">Get a free key <${Icon} n="ext" size=${16} /></a>
      </div>
    </section>

    <section class="card">
      <header class="card-head"><h2>Your data</h2></header>
      <p class="small muted">Everything stays on this device — no account, nothing uploaded. Export a backup now and then, especially before switching phones.</p>
      <div class="row-btns">
        <button class="btn small" onClick=${doExport}><${Icon} n="download" size=${18} /> Export backup</button>
        <button class="btn small" onClick=${() => file.current.click()}><${Icon} n="upload" size=${18} /> Restore</button>
        <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${doImport} />
      </div>
      ${S.memoryOnly && html`<${Note} tone="warn">This browser is blocking storage (private mode?), so nothing will be kept after you close it.<//>`}
      <button class="btn small danger-text" onClick=${doErase}>Erase all data</button>
    </section>

    <section class="card">
      <header class="card-head"><h2>App</h2>
        <button class="btn small" onClick=${checkForUpdate}>Check for updates</button></header>
      <p class="small">Tally version <b>${self.TALLY_VERSION || '?'}</b></p>
    </section>

    <p class="muted small credits">Food data: USDA FoodData Central (public domain) and Open Food Facts (ODbL, openfoodfacts.org). Targets use the Mifflin-St Jeor equation and adapt to your logged intake and weight trend. Not medical advice.</p>
  </div>`;
}

export function ProfileSheet() {
  const p = S.profile;
  const units = S.settings.units;
  const kg = latestTrendKg();
  const [d, setD] = useState(draftFromProfile(p, units, kg));
  async function save() {
    const err = validate(d, {});
    if (err) return toast(err);
    const next = {
      ...p,
      sex: d.sex,
      birthYear: new Date().getFullYear() - num(d.age),
      heightCm: heightCm(d),
      goalWeightKg: fromDisplayWeight(num(d.goal), d.units),
      pace: d.pace,
      activity: d.activity,
      lifts: d.lifts !== false,
    };
    // Until the adaptive estimate kicks in, a profile change also changes the formula burn.
    if (next.tdeeSource !== 'adaptive') next.tdee = Math.round(formulaTdee(next, kg) / 10) * 10;
    if (!next.manualTargets) next.targets = computeTargets(next, next.tdee, kg);
    await saveProfile(next);
    if (d.units !== units) await saveSettings({ units: d.units });
    toast('Profile updated');
    closeSheet();
  }
  return html`<${Sheet} title="Goal & profile" footer=${html`<button class="btn primary grow" onClick=${save}>Save</button>`}>
    <${AboutYou} d=${d} set=${setD} />
    <${GoalFields} d=${d} set=${setD} currentKg=${kg} />
  <//>`;
}

export function TargetsSheet() {
  const p = S.profile;
  const [t, setT] = useState({
    kcal: String(p.targets.kcal), protein: String(p.targets.protein), carbs: String(p.targets.carbs), fat: String(p.targets.fat),
  });
  const set = k => v => setT(x => ({ ...x, [k]: v }));
  const macroKcal = 4 * (num(t.protein) || 0) + 4 * (num(t.carbs) || 0) + 9 * (num(t.fat) || 0);

  async function save() {
    const v = { kcal: num(t.kcal), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat) };
    if (Object.values(v).some(x => !(x >= 0)) || v.kcal < 800) return toast('Check the numbers');
    await saveProfile({ ...p, manualTargets: true, targets: { ...v, floored: false, maintenance: false } });
    toast('Targets saved');
    closeSheet();
  }
  async function reset() {
    const targets = computeTargets(p, p.tdee, latestTrendKg());
    await saveProfile({ ...p, manualTargets: false, targets });
    toast('Back to recommended targets');
    closeSheet();
  }
  // Keep carbs filling the remaining calories when calories/protein/fat change.
  function fillCarbs() {
    const c = Math.max(0, Math.round(((num(t.kcal) || 0) - 4 * (num(t.protein) || 0) - 9 * (num(t.fat) || 0)) / 4));
    setT(x => ({ ...x, carbs: String(c) }));
  }

  return html`<${Sheet} title="Daily targets" footer=${html`
      <button class="btn" onClick=${reset}>Use recommended</button>
      <button class="btn primary grow" onClick=${save}>Save</button>`}>
    <${NumField} label="Calories" value=${t.kcal} onInput=${set('kcal')} suffix="kcal" />
    <div class="grid3">
      <${NumField} label="Protein" value=${t.protein} onInput=${set('protein')} suffix="g" />
      <${NumField} label="Carbs" value=${t.carbs} onInput=${set('carbs')} suffix="g" />
      <${NumField} label="Fat" value=${t.fat} onInput=${set('fat')} suffix="g" />
    </div>
    <p class=${'small ' + (Math.abs(macroKcal - (num(t.kcal) || 0)) > 60 ? 'error' : 'muted')}>
      Macros add up to ${fmtInt(macroKcal)} kcal.
      ${Math.abs(macroKcal - (num(t.kcal) || 0)) > 60 && html` <button class="link" onClick=${fillCarbs}>Balance with carbs</button>`}
    </p>
    <p class="muted small">Setting targets by hand turns off automatic adjustments. The weekly check-in will still show your estimated burn.</p>
  <//>`;
}
