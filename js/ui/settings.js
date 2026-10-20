import { html, useState, useRef } from '../preact.js';
import { S, saveProfile, saveSettings, saveMeta, importData, eraseAll, toast } from '../store.js';
import { computeTargets, latestTrendKg, formulaTdee, paceOf, lifts } from '../goals.js';
import { currentProvider, hasAiKey, modelLabel, aiName } from '../ai.js';
import { copySummary } from './ai.js';
import { appearanceLabel } from './appearance.js';
import { exportBackup, backupLabel, backupOverdue } from './backup.js';
import { previewCelebration } from './celebrate.js';
import { isStandalone, showInstallAgain } from './install.js';
import { verifyUsdaKey, hasUsdaKey } from '../sources.js';
import { Sheet, Seg, Field, NumField, Note } from './common.js';
import { applyUpright } from '../upright.js';
import { Icon } from './icons.js';
import { openSheet, closeSheet } from './nav.js';
import { AboutYou, GoalFields, draftFromProfile, validate, heightCm } from './profile-form.js';
import { fmtInt, fmtW, wUnit, num, fromDisplayWeight } from '../util.js';

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
const ON_OFF = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];

function Row({ icon, title, sub, warn, onClick }) {
  return html`<button class="menu-row" onClick=${onClick}>
    <span class="menu-icon"><${Icon} n=${icon} size=${20} /></span>
    <span class="menu-main"><b>${title}</b>${sub && html`<small class=${warn ? 'warn-text' : ''}>${sub}</small>`}</span>
    <${Icon} n="right" size=${18} />
  </button>`;
}

export function Settings() {
  const p = S.profile;
  const units = S.settings.units;
  const ai = currentProvider();
  const region = REGIONS.find(r => r.value === S.settings.region)?.label || 'United States';
  const prefs = [units === 'imperial' ? 'lb' : 'kg', `food notes ${S.settings.tips === false ? 'off' : 'on'}`,
    `celebrations ${S.settings.celebrate === false ? 'off' : 'on'}`].join(' · ');

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

    <div class="menu-group">
      <${Row} icon="target" title="Goal & profile" onClick=${() => openSheet('profile')}
        sub=${`Goal ${fmtW(p.goalWeightKg, units)} ${wUnit(units)} · ${paceOf(p).label} pace · ${lifts(p) ? 'lifts weights' : 'no lifting'}`} />
      <${Row} icon="spark" title="AI assistant" onClick=${() => openSheet('ai-setup')}
        sub=${hasAiKey() ? (modelLabel(ai).startsWith(ai.name) ? modelLabel(ai) : `${ai.name} · ${modelLabel(ai)}`) : 'Not connected: photos, restaurants, labels, questions'} />
      <${Row} icon="apple" title="Food data" onClick=${() => openSheet('food-data')}
        sub=${`${hasUsdaKey() ? 'Personal USDA key' : 'Shared demo key (limited)'} · ${region}`} warn=${!hasUsdaKey()} />
    </div>

    <div class="menu-group">
      <${Row} icon="palette" title="Appearance" sub=${appearanceLabel()} onClick=${() => openSheet('appearance')} />
      <${Row} icon="settings" title="Preferences" sub=${prefs} onClick=${() => openSheet('preferences')} />
    </div>

    <div class="menu-group">
      <${Row} icon="data" title="Your data" sub=${S.memoryOnly ? 'Not being saved on this browser' : backupLabel()}
        warn=${S.memoryOnly || backupOverdue()} onClick=${() => openSheet('your-data')} />
      <${Row} icon="copy" title=${`Copy my log for ${hasAiKey() ? `a ${aiName()}` : 'an AI'} chat`} sub="Free: paste it into any chat and ask away" onClick=${copySummary} />
    </div>

    <p class="muted small credits">Food data: USDA FoodData Central (public domain) and Open Food Facts (ODbL, openfoodfacts.org). Targets use the Mifflin-St Jeor equation and adapt to your logged intake and weight trend. Not medical advice.</p>
    <footer class="app-version">
      <span>Tally version <b>${self.TALLY_VERSION || '?'}</b></span>
      <button class="link" onClick=${() => openSheet('whats-new')}>What’s new</button>
      <button class="link" onClick=${checkForUpdate}>Check for updates</button>
      ${!isStandalone() && html`<button class="link" onClick=${showInstallAgain}>Add to Home Screen</button>`}
    </footer>
  </div>`;
}

export function PreferencesSheet() {
  const s = S.settings;
  const touch = matchMedia('(pointer: coarse)').matches;
  return html`<${Sheet} title="Preferences">
    <div class="field"><span class="field-label">Units</span>
      <${Seg} label="Units" value=${s.units} onChange=${v => saveSettings({ units: v })}
        options=${[{ value: 'imperial', label: 'lb' }, { value: 'metric', label: 'kg' }]} />
    </div>
    <div class="field"><span class="field-label">Food notes & lighter swaps</span>
      <${Seg} label="Food notes" value=${s.tips === false ? 'off' : 'on'} onChange=${v => saveSettings({ tips: v === 'on' })} options=${ON_OFF} />
      <span class="field-hint">Short, occasional notes when something is unusually fatty, salty or sugary, and protein-friendly swaps from the same aisle.</span>
      ${Object.keys(S.meta.muted || {}).length > 0 && html`<button class="btn small ghost" onClick=${() => { saveMeta({ muted: {} }); toast('Notes re-enabled for all foods'); }}>
        Un-hide ${Object.keys(S.meta.muted).length} muted food${Object.keys(S.meta.muted).length > 1 ? 's' : ''}</button>`}
    </div>
    <div class="field"><span class="field-label">Celebrations</span>
      <div class="row-btns tight">
        <${Seg} label="Celebrations" value=${s.celebrate === false ? 'off' : 'on'} onChange=${v => saveSettings({ celebrate: v === 'on' })} options=${ON_OFF} />
        <button class="btn small ghost" onClick=${previewCelebration}>Preview</button>
      </div>
      <span class="field-hint">Confetti when you hit your protein or fiber goal, a sparkle for protein-packed foods. Holidays get their own look.</span>
    </div>
    <div class="field"><span class="field-label">Scan sound & flash</span>
      <${Seg} label="Scan sound and flash" value=${s.scanFeedback === false ? 'off' : 'on'} onChange=${v => saveSettings({ scanFeedback: v === 'on' })} options=${ON_OFF} />
      <span class="field-hint">A soft tick and a green flash the moment a barcode is read. The tick follows your phone’s silent switch.</span>
    </div>
    ${touch && html`<div class="field"><span class="field-label">Keep upright</span>
      <${Seg} label="Keep upright" value=${s.keepUpright === false ? 'off' : 'on'} onChange=${v => saveSettings({ keepUpright: v === 'on' }).then(applyUpright)} options=${ON_OFF} />
      <span class="field-hint">Tally stays in portrait when you tilt your phone, so it doesn’t flip around while you scan.</span>
    </div>`}
  <//>`;
}

export function FoodDataSheet() {
  const [key, setKey] = useState(S.settings.usdaKey || '');
  const [keyState, setKeyState] = useState(null);
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
  return html`<${Sheet} title="Food data">
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
    <${Field} label="Where you shop" hint="Product search and lighter swaps only show products sold here.">
      <select class="input" value=${S.settings.region} onChange=${e => saveSettings({ region: e.currentTarget.value })}>
        ${REGIONS.map(r => html`<option value=${r.value}>${r.label}</option>`)}
      </select>
    <//>
  <//>`;
}

export function DataSheet() {
  const file = useRef(null);
  async function doImport(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm(`Replace everything on this device with the backup from ${String(data.exportedAt || '').slice(0, 10) || 'this file'}?`)) return;
      await importData(data);
      toast('Backup restored');
      closeSheet();
    } catch (err) {
      toast(err.message || 'Couldn’t read that file');
    }
  }
  async function doErase() {
    if (!confirm('Erase all of your Tally data on this device? This can’t be undone.')) return;
    await eraseAll();
  }
  return html`<${Sheet} title="Your data">
    <p class="small muted">Everything stays on this device: no account, nothing uploaded. Export a backup now and then, especially before switching phones. Backups never include your API keys.</p>
    ${S.memoryOnly && html`<${Note} tone="warn">This browser is blocking storage (private mode?), so nothing will be kept after you close it.<//>`}
    <p class=${'small' + (backupOverdue() ? ' warn-text' : '')}><b>${backupLabel()}</b></p>
    <div class="row-btns">
      <button class="btn small primary" onClick=${exportBackup}><${Icon} n="download" size=${18} /> Export backup</button>
      <button class="btn small" onClick=${() => file.current.click()}><${Icon} n="upload" size=${18} /> Restore</button>
      <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${doImport} />
    </div>
    <div class="danger-zone">
      <button class="btn small danger-text" onClick=${doErase}>Erase all data</button>
    </div>
  <//>`;
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
