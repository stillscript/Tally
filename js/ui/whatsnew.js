import { html } from '../preact.js';
import { CHANGELOG } from '../changelog.js';
import { Sheet } from './common.js';
import { parseKey } from '../util.js';

export function WhatsNewSheet() {
  const current = self.TALLY_VERSION;
  return html`<${Sheet} title="What’s new">
    ${CHANGELOG.map(v => html`<section class="release">
      <h3>Version ${v.version}${v.version === current ? html` <span class="badge ok">installed</span>` : ''}</h3>
      <span class="muted small">${parseKey(v.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
      <ul>${v.items.map(i => html`<li>${i}</li>`)}</ul>
    </section>`)}
  <//>`;
}
