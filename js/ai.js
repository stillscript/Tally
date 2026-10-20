// AI features: meal photo estimates, spoken/typed meals, restaurant lookups, nutrition labels,
// meal edits, and questions about your log.
//
// You pick one service (Claude, ChatGPT, Gemini or Grok) and use your own API key, kept only on this device.
// Every service gets the same instructions and the same answer format, and every answer goes through the
// same checks below, so the app behaves the same whichever one you use.
import { S } from './store.js';
import { fail, parseJson } from './ai/http.js';
import { claudeAdapter } from './ai/claude.js';
import { responsesAdapter } from './ai/responses.js';
import { geminiAdapter } from './ai/gemini.js';

export const PROVIDERS = [
  {
    id: 'claude', name: 'Claude', company: 'Anthropic', console: 'Claude Console', keyName: 'Anthropic API key',
    keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', separate: 'a Claude.ai subscription',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'most accurate' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'about half the cost' },
    ],
    steps: [
      'Open the Claude Console and sign in (or sign up), then add a little credit under Billing.',
      'Set a monthly spend limit (e.g. $10) under Limits so there are no surprises.',
      'Go to API keys → Create key, copy it, and paste it below.',
    ],
  },
  {
    id: 'openai', name: 'ChatGPT', company: 'OpenAI', console: 'OpenAI dashboard', keyName: 'OpenAI API key',
    keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', separate: 'a ChatGPT Plus or Pro subscription',
    base: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', sub: 'most accurate' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', sub: 'cheapest' },
    ],
    steps: [
      'Open the OpenAI dashboard and sign in, then add a little credit under Billing.',
      'Set a monthly budget under Limits so there are no surprises.',
      'Go to API keys → Create new secret key, copy it, and paste it below.',
    ],
  },
  {
    id: 'gemini', name: 'Gemini', company: 'Google', console: 'Google AI Studio', keyName: 'Gemini API key',
    keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', separate: 'a Google One or Gemini subscription',
    quotaHint: 'Gemini is limiting this key right now. Free keys have tight limits and may not include every model: wait a minute, pick the cheaper model, or turn on billing in Google AI Studio.',
    region: 'Gemini may not be available in your region.',
    models: [
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', sub: 'most accurate' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', sub: 'cheapest' },
    ],
    steps: [
      'Open Google AI Studio and sign in with your Google account.',
      'Choose Create API key, copy it, and paste it below.',
      'Free keys work to start. Turning on billing raises the limits, and Google doesn’t use paid requests to improve its products.',
    ],
  },
  {
    id: 'grok', name: 'Grok', company: 'xAI', console: 'xAI Console', keyName: 'xAI API key',
    keyHint: 'xai-…', keyUrl: 'https://console.x.ai', separate: 'an X Premium or SuperGrok subscription',
    base: 'https://api.x.ai/v1',
    models: [{ id: 'grok-4.7', label: 'Grok 4.7', sub: '' }],
    steps: [
      'Open the xAI Console and sign in, then add a little credit under Billing.',
      'Go to API Keys → Create API key, copy it, and paste it below.',
    ],
  },
];

const ADAPTERS = {
  claude: claudeAdapter(PROVIDERS[0]),
  openai: responsesAdapter(PROVIDERS[1]),
  gemini: geminiAdapter(PROVIDERS[2]),
  grok: responsesAdapter(PROVIDERS[3]),
};

export const providerById = id => PROVIDERS.find(p => p.id === id) || null;
export const currentProvider = () => providerById(S.settings.aiProvider);
export const keyFor = id => String(S.settings.aiKeys?.[id] || '').trim();
export const hasAiKey = () => !!currentProvider() && !!keyFor(S.settings.aiProvider);
// The name shown on buttons and screens: "Estimate with Gemini", "Ask Claude"…
export const aiName = () => currentProvider()?.name || 'AI';
export function modelFor(p) {
  const chosen = S.settings.aiModels?.[p.id];
  return p.models.some(m => m.id === chosen) ? chosen : p.models[0].id;
}
export const modelLabel = p => p.models.find(m => m.id === modelFor(p))?.label || modelFor(p);

function active() {
  const p = currentProvider();
  if (!p) throw fail('Choose an AI service in Settings → AI assistant first.');
  const key = keyFor(p.id);
  if (!key) throw fail(`Add your ${p.keyName} in Settings → AI assistant.`);
  return { p, key, model: modelFor(p), adapter: ADAPTERS[p.id] };
}

export async function verifyAiKey(providerId, key, model) {
  const p = providerById(providerId);
  await ADAPTERS[p.id].verify({ key: String(key).trim(), model: model || p.models[0].id });
}

// ---------- answer formats ----------
const MACROS = {
  kcal: { type: 'number' },
  protein_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fat_g: { type: 'number' },
};
const mealSchema = notes => ({
  type: 'object',
  properties: {
    dish: { type: 'string', description: 'Short name for the whole meal, e.g. "Chicken, rice and broccoli"' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          portion: { type: 'string', description: 'Household amount, e.g. "about 1 cup"' },
          grams: { type: 'number', description: 'Estimated weight as served (cooked); 0 if unknown' },
          ...MACROS,
        },
        required: ['name', 'portion', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
        additionalProperties: false,
      },
    },
    assumptions: { type: 'string', description: notes },
  },
  required: ['dish', 'confidence', 'items', 'assumptions'],
  additionalProperties: false,
});
const MEAL_SCHEMA = mealSchema('One or two short sentences: hidden ingredients assumed and what would change the estimate most');
const REVISED_SCHEMA = mealSchema('One short sentence saying what changed, e.g. "Swapped the large Coke for a Coke Zero (−290 kcal)"');

const RESTAURANT_SCHEMA = {
  type: 'object',
  properties: {
    restaurant: { type: 'string' },
    meal_name: { type: 'string', description: 'Short name for the whole order' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, ...MACROS, sodium_mg: { type: 'number' } },
        required: ['name', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg'],
        additionalProperties: false,
      },
    },
    basis: { type: 'string', enum: ['official', 'third_party', 'estimate'], description: 'official = the restaurant’s own published nutrition information' },
    sources: { type: 'array', items: { type: 'string' }, description: 'URLs the numbers came from' },
    notes: { type: 'string', description: 'Short: sizes or customizations assumed, anything uncertain' },
  },
  required: ['restaurant', 'meal_name', 'items', 'basis', 'sources', 'notes'],
  additionalProperties: false,
};

const num = d => ({ type: 'number', description: d });
const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean', description: 'false if this isn’t a nutrition label or the numbers can’t be read' },
    name: { type: 'string', description: 'Product name if visible on the package, else ""' },
    brand: { type: 'string', description: 'Brand if visible, else ""' },
    serving_text: { type: 'string', description: 'Serving size exactly as printed, e.g. "2/3 cup (55g)"' },
    serving_g: num('Serving weight in grams; -1 if not printed'),
    serving_ml: num('Serving volume in mL; -1 if not printed'),
    kcal: num('Calories per serving; -1 if not printed'),
    fat_g: num('Total fat per serving; -1 if not printed'),
    sat_fat_g: num('Saturated fat per serving; -1 if not printed'),
    carbs_g: num('Total carbohydrate per serving; -1 if not printed'),
    fiber_g: num('Dietary fiber per serving; -1 if not printed'),
    sugar_g: num('Total sugars per serving; -1 if not printed'),
    added_sugar_g: num('Added sugars per serving; -1 if not printed'),
    protein_g: num('Protein per serving; -1 if not printed'),
    sodium_mg: num('Sodium per serving in mg; -1 if not printed'),
  },
  required: ['readable', 'name', 'brand', 'serving_text', 'serving_g', 'serving_ml', 'kcal', 'fat_g', 'sat_fat_g', 'carbs_g',
    'fiber_g', 'sugar_g', 'added_sugar_g', 'protein_g', 'sodium_mg'],
  additionalProperties: false,
};

// ---------- instructions (identical for every service) ----------
const PHOTO_SYSTEM = `You estimate the nutrition of meals from photos for a calorie-tracking app used by someone losing fat while strength training.

Identify each distinct food on the plate and estimate its weight as served, in grams. Use visual scale cues: a standard dinner plate is about 10–11 inches (26–28 cm) across unless the photo suggests otherwise; also use utensils, hands, cups and packaging. Then give calories, protein, carbs and fat for that weight using standard USDA-style values for the food as prepared.

Account for calories people tend to miss: cooking oil, butter, dressings, sauces, cheese and sugary drinks. When one is plausibly present, list it as its own item so the user can remove it. If the user adds notes, treat them as facts that override what you see. Aim for a realistic estimate rather than a low one — portion sizes are usually underestimated.

Keep item names short (e.g. "Grilled chicken breast", "White rice"). Use "high" confidence only when portions are clearly visible and the foods are unambiguous.`;

const TEXT_SYSTEM = `You estimate the nutrition of foods someone describes in words for a calorie-tracking app used by someone losing fat while strength training.

List each food as its own item with a realistic portion in grams as eaten (use the amount they say; otherwise a typical single serving), and give calories, protein, carbs and fat for that amount using standard USDA-style values. Include obvious add-ons they mention (butter, oil, sauces). Keep names short. "dish" is a short name for the whole description.`;

const RESTAURANT_SYSTEM = `You look up nutrition for restaurant orders for a calorie-tracking app.

Use web search to find the restaurant's own published nutrition information (nutrition calculator, nutrition PDF or menu pages) for each part of the order, matching sizes and customizations. Prefer official sources; fall back to reputable third-party nutrition databases; estimate only when nothing is published, and say so. When the restaurant publishes components separately (e.g. a bowl's rice, protein, beans, salsa, cheese), list each component as its own item so the user can adjust. Assume US menus unless the user says otherwise. Use 0 for sodium only if it is genuinely unknown.`;

const REVISE_SYSTEM = `You update a meal that was already logged in a calorie-tracking app, after the user says what was different (a swapped item, a smaller portion, something left out or added).

You get the current items with their numbers. Return the complete updated list. Keep every item the change doesn't touch exactly as it is, with the same numbers. For changed or new items use standard USDA-style values, or the restaurant's published values when you know them (e.g. a Coke Zero has 0 kcal). "Ate half" means half the amount, so halve that item's grams and every number. If the change applies to the whole meal, scale every item. If an item's protein, carbs or fat are null, fill them in with standard values that fit its calories. Keep names short.`;

const LABEL_SYSTEM = `You read Nutrition Facts labels from photos for a calorie-tracking app. Copy the numbers exactly as printed for one serving; don't estimate or calculate missing values, use -1 for anything not printed. If a label shows two columns (e.g. per serving and per container, or as packaged and prepared), use the first per-serving column. If the photo isn't a nutrition label or the numbers can't be read, set readable to false.`;

const COACH_SYSTEM = `You're a supportive, evidence-based nutrition coach inside the user's food-tracking app. They're losing fat while strength training. Their tracking data is below.

Answer using their actual data: point to specific days, foods and numbers. Be concise (under about 200 words unless they ask for more), practical and non-judgmental. Use short paragraphs or bullet points, no tables. Daily weight swings of 1–3 lb are mostly water; judge progress by the trend. Don't give medical advice; suggest a doctor or registered dietitian for medical concerns.`;

// ---------- one structured answer, the same way on every service ----------
const plain = content => content.filter(c => c.text != null).map(c => c.text).join('\n');
// A model that can't do what was asked (400) or sent something unreadable: worth another route. Key/billing problems aren't.
const canReroute = e => !e.auth && (e.status === 400 || e.unreadable);

async function structured(opts) {
  const { p, key, model, adapter } = active();
  const req = { key, model, ...opts };
  try {
    return await adapter.generate(req);
  } catch (e) {
    // Claude's path is direct. Others reroute if a model can't combine web search with a strict format,
    // or rejects the format itself.
    if (p.id === 'claude' || !canReroute(e)) throw e;
  }
  if (!req.search) return described(req, adapter, p);
  // Research in plain text first, then turn the notes into the format.
  const notes = await adapter.generate({ ...req, schema: null, system: `${req.system}\n\nResearch the numbers now. Reply in plain text with every value the answer needs and the URLs you used; a separate step formats it.` });
  const fmt = { ...req, search: false, content: [{ text: `Request:\n${plain(req.content)}\n\nResearch notes:\n${notes.text}` }], system: 'Turn these research notes into the requested answer. Use only the numbers and URLs in the notes.' };
  let r;
  try {
    r = await adapter.generate(fmt);
  } catch (e) {
    if (!canReroute(e)) throw e;
    r = await described(fmt, adapter, p);
  }
  return { ...r, sources: [...notes.sources, ...(r.sources || [])] };
}

// Last resort: describe the format in words and read the JSON out of a plain reply.
async function described(req, adapter, p) {
  const r = await adapter.generate({
    ...req, schema: null,
    system: `${req.system}\n\nReply with only a JSON object (no other text) that matches this JSON Schema:\n${JSON.stringify(req.schema)}`,
  });
  return { ...r, data: parseJson(p, r.text) };
}

// ---------- tidy answers (every service's output looks the same to the app) ----------
const amount = v => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const str = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

function item(i = {}) {
  const it = {
    name: str(i.name, 80) || 'Item', portion: str(i.portion, 60), grams: amount(i.grams),
    kcal: amount(i.kcal), protein_g: amount(i.protein_g), carbs_g: amount(i.carbs_g), fat_g: amount(i.fat_g),
  };
  if (i.sodium_mg != null) it.sodium_mg = amount(i.sodium_mg);
  // A missing calorie number with macros present: fill it from the macros.
  if (!it.kcal && (it.protein_g || it.carbs_g || it.fat_g)) it.kcal = Math.round(4 * it.protein_g + 4 * it.carbs_g + 9 * it.fat_g);
  return it;
}
function itemsOf(r, name) {
  const items = (Array.isArray(r?.items) ? r.items : []).map(item);
  if (!items.length) throw fail(`${name} couldn’t find any food in that. Try adding more detail.`);
  return items;
}
function meal(r, name) {
  const items = itemsOf(r, name);
  return {
    dish: str(r.dish, 80) || items.slice(0, 3).map(i => i.name).join(', '),
    confidence: oneOf(r.confidence, ['low', 'medium', 'high'], 'medium'),
    items,
    assumptions: str(r.assumptions, 400),
  };
}

// Real links the service cited first, then ones it listed; one per site, shown by site name.
function sourceList(cited = [], listed = []) {
  const out = [];
  const seen = new Set();
  for (const s of [...cited, ...listed.map(u => ({ url: u, title: '' }))]) {
    let host;
    try {
      const u = new URL(s.url);
      if (!/^https?:$/.test(u.protocol)) continue;
      host = u.hostname.replace(/^www\./, '');
    } catch { continue; }
    // Gemini's links are redirects; their title is the real site.
    const label = /vertexaisearch|googleusercontent/.test(host) ? str(s.title, 60) || 'source' : host;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ url: s.url, label });
  }
  return out.slice(0, 4);
}

// ---------- features ----------
export async function estimatePhoto({ base64, mediaType = 'image/jpeg', notes }) {
  const r = await structured({
    system: PHOTO_SYSTEM, schema: MEAL_SCHEMA, schemaName: 'meal_estimate', effort: 'medium',
    content: [{ image: { base64, mediaType } }, { text: notes?.trim() ? `My notes about this meal: ${notes.trim()}` : 'Estimate this meal.' }],
  });
  return meal(r.data, aiName());
}

export async function estimateText(text) {
  const r = await structured({ system: TEXT_SYSTEM, schema: MEAL_SCHEMA, schemaName: 'meal_estimate', effort: 'low', content: [{ text: text.trim() }] });
  return meal(r.data, aiName());
}

export async function lookupRestaurant({ restaurant, order }) {
  const r = await structured({
    system: RESTAURANT_SYSTEM, schema: RESTAURANT_SCHEMA, schemaName: 'restaurant_nutrition', effort: 'medium', search: true,
    content: [{ text: `Restaurant: ${restaurant.trim()}\nMy order: ${order.trim()}` }],
  });
  const d = r.data || {};
  const items = itemsOf(d, aiName()).map(i => ({ ...i, sodium_mg: i.sodium_mg || 0 }));
  return {
    restaurant: str(d.restaurant, 60) || restaurant.trim(),
    meal_name: str(d.meal_name, 80) || order.trim().slice(0, 60),
    items,
    basis: oneOf(d.basis, ['official', 'third_party', 'estimate'], 'estimate'),
    sources: sourceList(r.sources, Array.isArray(d.sources) ? d.sources : []),
    notes: str(d.notes, 400),
  };
}

// items: [{ name, portion, grams, kcal, protein_g, carbs_g, fat_g }]
export async function reviseMeal({ dish, items, change, place }) {
  // Items logged before 3.0 only knew their calories: their macros go as null for the AI to fill in.
  const m = (i, v) => (i.approx ? null : +v.toFixed(1));
  const current = items.map(i => ({ name: i.name, portion: i.portion || '', grams: Math.round(i.grams || 0),
    kcal: Math.round(i.kcal), protein_g: m(i, i.protein_g), carbs_g: m(i, i.carbs_g), fat_g: m(i, i.fat_g) }));
  const r = await structured({
    system: REVISE_SYSTEM, schema: REVISED_SCHEMA, schemaName: 'revised_meal', effort: 'low',
    content: [{ text: `Meal: ${dish}${place ? ` (from ${place})` : ''}\nCurrent items:\n${JSON.stringify(current, null, 1)}\n\nWhat changed: ${change.trim()}` }],
  });
  return meal(r.data, aiName());
}

export async function readLabel({ base64, mediaType = 'image/jpeg' }) {
  const r = await structured({
    system: LABEL_SYSTEM, schema: LABEL_SCHEMA, schemaName: 'nutrition_label', effort: 'low',
    content: [{ image: { base64, mediaType } }, { text: 'Read this nutrition label.' }],
  });
  const d = r.data || {};
  const v = x => { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) && n >= 0 ? n : null; };
  const out = {
    readable: d.readable !== false, name: str(d.name, 80), brand: str(d.brand, 60), servingText: str(d.serving_text, 60),
    servingG: v(d.serving_g) || null, servingMl: v(d.serving_ml) || null,
    kcal: v(d.kcal), fat: v(d.fat_g), satFat: v(d.sat_fat_g), carbs: v(d.carbs_g), fiber: v(d.fiber_g),
    sugar: v(d.sugar_g), addedSugar: v(d.added_sugar_g), protein: v(d.protein_g), sodium: v(d.sodium_mg),
  };
  if (!out.readable || out.kcal == null) {
    throw fail(`${aiName()} couldn’t read a nutrition label in that photo. Try again closer, flat and in good light.`);
  }
  return out;
}

// messages: [{ role: 'user' | 'assistant', text }]
export async function askCoach(messages, dataSummary) {
  const { key, model, adapter } = active();
  const r = await adapter.generate({
    key, model, effort: 'medium', messages,
    system: `${COACH_SYSTEM}\n\n<tracking_data>\n${dataSummary}\n</tracking_data>`,
  });
  return { text: r.text };
}
