// Settings → Appearance: light/dark mode and the accent color. Changes apply instantly.
import { html } from '../preact.js';
import { S, saveSettings } from '../store.js';
import { THEMES, APPEARANCES, themeById } from '../theme.js';
import { Sheet, Seg, Ring, MacroBar } from './common.js';
import { Icon } from './icons.js';

const scheme = () => document.documentElement.dataset.scheme || 'light';

export const appearanceLabel = () =>
  `${themeById(S.settings.theme).name} · ${APPEARANCES.find(a => a.id === S.settings.appearance)?.label || 'System'}`;

export function AppearanceSheet() {
  const cur = S.settings.theme;
  const sc = scheme();
  return html`<${Sheet} title="Appearance">
    <div class="field">
      <span class="field-label">Mode</span>
      <${Seg} label="Mode" value=${S.settings.appearance} onChange=${v => saveSettings({ appearance: v })}
        options=${APPEARANCES.map(a => ({ value: a.id, label: a.label }))} />
      <span class="field-hint">System follows your phone’s light or dark setting.</span>
    </div>

    <div class="field">
      <span class="field-label">Color</span>
      <div class="swatches" role="radiogroup" aria-label="Color">
        ${THEMES.map(t => html`<button type="button" role="radio" aria-checked=${cur === t.id} class=${'swatch' + (cur === t.id ? ' on' : '')}
          style=${{ '--sw': t[sc].accent, '--sw-ink': t[sc].ink }} onClick=${() => saveSettings({ theme: t.id })}>
          <span class="sw-dot">${cur === t.id && html`<${Icon} n="check" size=${18} />`}</span>
          <span class="sw-name">${t.name}</span>
        </button>`)}
      </div>
    </div>

    <div class="theme-preview" aria-hidden="true">
      <div class="tp-ring"><${Ring} value=${1240} max=${1810} size=${72} stroke=${8} /></div>
      <div class="tp-bars">
        <${MacroBar} label="Protein" value=${118} target=${150} cls="protein" />
        <${MacroBar} label="Carbs" value=${96} target=${170} cls="carbs" />
        <${MacroBar} label="Fat" value=${41} target=${55} cls="fat" />
      </div>
      <button class="btn primary small tp-btn" tabindex="-1">Log food</button>
    </div>
    <p class="muted small">Every color is checked for readability in light and dark mode.</p>
  <//>`;
}
