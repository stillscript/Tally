import { html } from '../preact.js';
import { addEntries, deleteEntry, toast } from '../store.js';
import { Icon } from './icons.js';
import { closeSheet } from './nav.js';
import { todayKey, mealLabel } from '../util.js';

const copyOf = ({ id, createdAt, ...rest }) => rest;

// Shown when editing a logged entry. Buttons rather than swipes, so nothing happens by accident.
// (Moving to another meal is the meal picker on the same screen.)
export function EntryActions({ entry }) {
  const today = todayKey();
  async function duplicate() {
    const [made] = await addEntries([copyOf(entry)]);
    closeSheet();
    toast(`Duplicated in ${mealLabel(entry.meal)}`, { label: 'Undo', fn: () => deleteEntry(made.id) });
  }
  async function copyToToday() {
    const [made] = await addEntries([{ ...copyOf(entry), date: today }]);
    closeSheet();
    toast(`Copied to today · ${mealLabel(entry.meal)}`, { label: 'Undo', fn: () => deleteEntry(made.id) });
  }
  return html`<div class="entry-actions">
    <button class="btn small ghost" onClick=${duplicate}><${Icon} n="duplicate" size=${16} /> Duplicate</button>
    ${entry.date !== today && html`<button class="btn small ghost" onClick=${copyToToday}><${Icon} n="today" size=${16} /> Copy to today</button>`}
  </div>`;
}
