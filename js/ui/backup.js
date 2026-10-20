// Backup files, plus a gentle monthly reminder: the log lives only on this device.
import { html } from '../preact.js';
import { S, emit, exportData, saveMeta } from '../store.js';
import { Icon } from './icons.js';
import { todayKey } from '../util.js';

const DAY = 864e5;
const REMIND_AFTER_DAYS = 30;

export async function exportBackup() {
  const name = `tally-backup-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(exportData())], { type: 'application/json' });
  const f = new File([blob], name, { type: 'application/json' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: 'Tally backup' });
      await saveMeta({ lastBackup: Date.now() });
      emit();
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
  await saveMeta({ lastBackup: Date.now() });
  emit();
}

export function backupAge() {
  const t = S.meta.lastBackup;
  if (!t) return null;
  return Math.floor((Date.now() - t) / DAY);
}

export function backupLabel() {
  const d = backupAge();
  if (d == null) return 'No backup yet';
  if (d === 0) return 'Backed up today';
  if (d === 1) return 'Backed up yesterday';
  if (d < 60) return `Backed up ${d} days ago`;
  return `Backed up ${Math.round(d / 30)} months ago`;
}

export const backupOverdue = () => {
  const d = backupAge();
  return d == null ? new Set(S.entries.map(e => e.date)).size >= 14 : d >= REMIND_AFTER_DAYS;
};

// Shown on Today once there's a couple of weeks of log worth protecting, then monthly. "Later" waits two weeks.
export function BackupCard() {
  if (!backupOverdue() || (S.meta.backupSnooze || 0) > Date.now()) return null;
  const never = backupAge() == null;
  return html`<section class="card setup-card">
    <div><b>${never ? 'Keep your log safe' : 'Time for a backup'}</b>
      <p class="small muted">${never
        ? 'Your log lives only on this phone. A backup file keeps it safe if you switch or lose your phone.'
        : `Your last backup was ${backupAge()} days ago. It takes a few seconds.`}</p>
      <div class="row-btns">
        <button class="btn small primary" onClick=${exportBackup}><${Icon} n="download" size=${16} /> Back up now</button>
        <button class="btn small ghost" onClick=${() => { saveMeta({ backupSnooze: Date.now() + 14 * DAY }); emit(); }}>Later</button>
      </div>
    </div>
  </section>`;
}
