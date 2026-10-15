// Version log shown in Settings → What's new. Add an entry here (newest first) with every update,
// and bump the number in version.js to match.
export const CHANGELOG = [
  {
    version: '2.5', date: '2026-10-15',
    items: [
      'Weigh-ins are optional: they no longer count toward the consistency score, which is now logging (40), protein (35) and calories on target (25).',
      'Each day in the Your week strip shows its calorie total at a glance.',
    ],
  },
  {
    version: '2.4', date: '2026-10-15',
    items: [
      'Your week, at the top of Progress: a consistency score (0–100) built from logging, protein, calories on target and weigh-ins, compared with the 7 days before.',
      'A 7-day strip showing each day’s calories against target, protein hits and weigh-ins at a glance. Tap a day to open it.',
      'Weekly averages, trend weight and patterns now live in the same card, which replaces the old Calories and This week cards. Use the arrows to look back at earlier weeks.',
      'The score explains itself: tap it to see how each habit earned its points, plus the easiest gain for next week.',
    ],
  },
  {
    version: '2.3', date: '2026-10-14',
    items: [
      'Voice logging: tap the mic in Search and say what you ate, e.g. “two eggs and a black coffee”.',
      'Celebrations when you reach your protein or fiber goal, and a quick sparkle for protein-packed foods. Holidays get their own themes. Toggle in Settings → Preferences.',
      'This version log: Settings → What’s new, plus a heads-up after each update.',
    ],
  },
  {
    version: '2.2', date: '2026-10-13',
    items: [
      'Lifting question moved to the first setup screen; existing profiles are asked once on Today.',
      'Fiber, sugars, added sugars, saturated fat and sodium panel on Today, with daily goals and limits.',
      'Version number moved to the bottom of Settings.',
    ],
  },
  {
    version: '2.1', date: '2026-10-13',
    items: ['Version number and a Check for updates button.'],
  },
  {
    version: '2.0', date: '2026-10-13',
    items: [
      'Fixed scanning Coca-Cola cans and other short (UPC-E) barcodes on iPhone.',
      'Barcode lookups try both 12- and 13-digit forms and retry busy servers.',
      'About 160 everyday foods built in from USDA data, plus major sodas; instant offline search.',
      'Saved meals: save any meal and re-log it in one tap at ½× to 2×.',
      'Claude (optional, your API key): meal photo estimates, restaurant lookups, Ask Claude.',
      'Copy your log for a Claude chat (free).',
      'Protein target now depends on whether you lift, with a “How targets are set” explainer.',
      '“Tally was updated” prompt after new versions install.',
    ],
  },
  {
    version: '1.0', date: '2026-10-13',
    items: [
      'First release: barcode scanning (USDA + Open Food Facts), adaptive calorie targets with weekly check-ins, weight trend, food notes and lighter swaps, backups.',
    ],
  },
];
