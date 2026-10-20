// Color themes and light/dark appearance.
//
// A theme only sets its accent (with the text color that sits on it) for light and dark mode,
// plus overrides where the accent would clash with a fixed meaning: "over target" or a macro color.
// Every screen uses tokens (--accent, --over, --protein…), so new features work in every theme.
// Contrast is checked by tools/check-themes.mjs (WCAG AA: 4.5:1 for text, 3:1 for graphics).

const VIOLET = { light: '#7c3aed', dark: '#c084fc' };
const AMBER_OVER = { light: '#b45309', dark: '#fbbf24' };

export const THEMES = [
  { id: 'green', name: 'Green', light: { accent: '#157a3a', ink: '#ffffff' }, dark: { accent: '#3dd47a', ink: '#04140a' } },
  { id: 'teal', name: 'Teal', light: { accent: '#0f766e', ink: '#ffffff' }, dark: { accent: '#2dd4bf', ink: '#03201c' } },
  { id: 'blue', name: 'Blue', light: { accent: '#1d4ed8', ink: '#ffffff' }, dark: { accent: '#60a5fa', ink: '#04122b' },
    overrides: { '--protein': VIOLET } },
  { id: 'purple', name: 'Purple', light: { accent: '#7e22ce', ink: '#ffffff' }, dark: { accent: '#c084fc', ink: '#1a0630' } },
  { id: 'pink', name: 'Pink', light: { accent: '#be185d', ink: '#ffffff' }, dark: { accent: '#f472b6', ink: '#2a0616' },
    overrides: { '--fat': VIOLET, '--over': AMBER_OVER } },
  { id: 'red', name: 'Red', light: { accent: '#b91c1c', ink: '#ffffff' }, dark: { accent: '#f87171', ink: '#2a0606' },
    overrides: { '--fat': VIOLET, '--over': AMBER_OVER } },
  { id: 'orange', name: 'Orange', light: { accent: '#c2410c', ink: '#ffffff' }, dark: { accent: '#fb923c', ink: '#2a1003' },
    overrides: { '--carbs': { light: '#a16207', dark: '#facc15' }, '--over': { light: '#be123c', dark: '#fb7185' } } },
  { id: 'graphite', name: 'Graphite', light: { accent: '#1f2937', ink: '#ffffff' }, dark: { accent: '#e5e7eb', ink: '#111827' } },
];

export const APPEARANCES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const BOOT_KEY = 'tally.appearance';
const OVERRIDABLE = ['--protein', '--carbs', '--fat', '--over'];
const media = matchMedia('(prefers-color-scheme: dark)');
let current = { theme: 'green', mode: 'system' };

export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];

// The CSS variables a theme sets in one scheme.
export function themeVars(id, scheme) {
  const t = themeById(id);
  const other = scheme === 'dark' ? 'light' : 'dark';
  // --accent-inverse: the accent as it looks on the opposite background (e.g. inside the dark toast in light mode).
  const vars = { '--accent': t[scheme].accent, '--accent-ink': t[scheme].ink, '--accent-inverse': t[other].accent };
  for (const [name, val] of Object.entries(t.overrides || {})) vars[name] = val[scheme];
  return vars;
}

function apply() {
  const scheme = current.mode === 'dark' || (current.mode === 'system' && media.matches) ? 'dark' : 'light';
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  for (const name of OVERRIDABLE) root.style.removeProperty(name);
  for (const [name, val] of Object.entries(themeVars(current.theme, scheme))) root.style.setProperty(name, val);
  // Browser chrome / status bar matches the page background.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg));
  // Cached so the next launch paints the right colors before any script runs (see index.html).
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({
      mode: current.mode, vars: { light: themeVars(current.theme, 'light'), dark: themeVars(current.theme, 'dark') },
    }));
  } catch {}
}

export function setAppearance({ theme = current.theme, mode = current.mode } = {}) {
  current = { theme, mode };
  apply();
}

media.addEventListener?.('change', () => { if (current.mode === 'system') apply(); });
