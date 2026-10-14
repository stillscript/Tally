import { html } from '../preact.js';
import { Icon } from './icons.js';
import { closeSheet } from './nav.js';
import { MEALS, fmtInt, num, round, fmtQty } from '../util.js';

export function Sheet({ title, children, footer, full, className = '', onClose = closeSheet, headerRight }) {
  return html`<div class="sheet-wrap" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <section class=${`sheet ${full ? 'full' : ''} ${className}`} role="dialog" aria-modal="true" aria-label=${title || 'Dialog'}>
      <header class="sheet-head">
        <h2>${title}</h2>
        ${headerRight}
        <button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} n="x" /></button>
      </header>
      <div class="sheet-body">${children}</div>
      ${footer && html`<footer class="sheet-foot">${footer}</footer>`}
    </section>
  </div>`;
}

export function Seg({ options, value, onChange, small, label }) {
  return html`<div class=${'seg' + (small ? ' small' : '')} role="radiogroup" aria-label=${label}>
    ${options.map(o => html`<button type="button" role="radio" aria-checked=${value === o.value}
      class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function MealPicker({ value, onChange }) {
  return html`<${Seg} label="Meal" small value=${value} onChange=${onChange}
    options=${MEALS.map(m => ({ value: m.id, label: m.label }))} />`;
}

export function Stepper({ value, onChange, step = 1 }) {
  const n = num(value) ?? 0;
  const dec = () => onChange(fmtQty(n - step > 0 ? round(n - step, 2) : round(n / 2, 2)));
  const inc = () => onChange(fmtQty(round(n + step, 2)));
  return html`<div class="stepper">
    <button type="button" onClick=${dec} aria-label="Less"><${Icon} n="minus" size=${20} /></button>
    <input inputmode="decimal" value=${value} aria-label="Amount"
      onInput=${e => onChange(e.currentTarget.value)} onFocus=${e => e.currentTarget.select()} />
    <button type="button" onClick=${inc} aria-label="More"><${Icon} n="plus" size=${20} /></button>
  </div>`;
}

export function Field({ label, hint, children, className = '' }) {
  return html`<label class=${'field ' + className}>
    <span class="field-label">${label}</span>
    ${children}
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function NumField({ label, value, onInput, suffix, placeholder, hint, required }) {
  return html`<${Field} label=${label + (required ? '' : '')} hint=${hint}>
    <span class="input-wrap">
      <input class="input" inputmode="decimal" value=${value} placeholder=${placeholder || ''}
        onInput=${e => onInput(e.currentTarget.value)} />
      ${suffix && html`<span class="suffix">${suffix}</span>`}
    </span>
  <//>`;
}

export function Ring({ value, max, size = 176, stroke = 14, over }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const mid = size / 2;
  return html`<svg class="ring" viewBox="0 0 ${size} ${size}" width=${size} height=${size} aria-hidden="true">
    <circle cx=${mid} cy=${mid} r=${r} class="ring-track" stroke-width=${stroke} fill="none" />
    <circle cx=${mid} cy=${mid} r=${r} class=${'ring-fill' + (over ? ' over' : '')} stroke-width=${stroke} fill="none"
      stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - frac)}
      transform="rotate(-90 ${mid} ${mid})" />
  </svg>`;
}

export function MacroBar({ label, value, target, cls, note }) {
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const over = cls !== 'protein' && value > target * 1.08;
  return html`<div class=${'macro ' + cls}>
    <div class="macro-top"><span class="macro-label">${label}</span>
      <span class="macro-num"><b>${fmtInt(value)}</b> / ${fmtInt(target)} g</span></div>
    <div class="bar"><div class=${'bar-fill' + (over ? ' over' : '')} style=${{ width: frac * 100 + '%' }}></div></div>
    ${note && html`<span class="macro-note">${note}</span>`}
  </div>`;
}

export function Note({ tone = 'info', children, icon }) {
  const ic = icon || (tone === 'warn' ? 'alert' : tone === 'good' ? 'spark' : 'info');
  return html`<div class=${'note ' + tone}><${Icon} n=${ic} size=${18} /><div>${children}</div></div>`;
}
