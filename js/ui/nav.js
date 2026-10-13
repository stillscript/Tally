// Bottom sheets live in a stack mirrored into browser history, so the phone's
// back gesture closes the top sheet instead of leaving the app.
import { S, emit } from '../store.js';
import { uid } from '../util.js';

// History entries left over from before a reload must not count as open sheets.
const SID = uid();
if (history.state?.sheet) history.replaceState(null, '');

export function openSheet(type, props = {}) {
  S.ui.sheets = [...S.ui.sheets, { type, props, key: uid() }];
  history.pushState({ sheet: S.ui.sheets.length, sid: SID }, '');
  emit();
}

// Swap the top sheet without touching history (scanner → food, food → label…).
export function replaceSheet(type, props = {}) {
  if (!S.ui.sheets.length) return openSheet(type, props);
  S.ui.sheets = [...S.ui.sheets.slice(0, -1), { type, props, key: uid() }];
  emit();
}

export function closeSheet() {
  if (S.ui.sheets.length) history.back();
}

export function closeAllSheets() {
  const n = S.ui.sheets.length;
  if (n) history.go(-n);
}

export function setTab(tab) {
  closeAllSheets();
  S.ui.tab = tab;
  emit();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', e => {
  const n = e.state?.sid === SID ? e.state.sheet : 0;
  if (S.ui.sheets.length > n) {
    S.ui.sheets = S.ui.sheets.slice(0, n);
    emit();
  }
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.ui.sheets.length) closeSheet();
});
