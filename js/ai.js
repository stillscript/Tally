// Claude features: meal photo estimates, restaurant lookups, and questions about your log.
// Calls the Claude API directly from this device with the API key you add in Settings
// (official Anthropic SDK, loaded on first use). Nothing goes through any other server.
import { S } from './store.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'most accurate' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'half the cost' },
];
export const hasAiKey = () => !!(S.settings.anthropicKey || '').trim();
const model = () => S.settings.aiModel || 'claude-opus-5-5';

// If a safety classifier declines a request, the API re-runs it on a recommended fallback model.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

let sdk = null;
function loadSdk() {
  if (!sdk) {
    sdk = import(SDK_URL).catch(() => {
      sdk = null;
      throw new Error('Couldn’t load the Claude SDK. Check your connection and try again.');
    });
  }
  return sdk;
}

function friendly(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it in Settings → Claude.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That Claude model isn’t available to this API key.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate-limiting this key right now. Wait a minute and try again.';
  if (e instanceof Anthropic.BadRequestError) {
    return /credit balance/i.test(e.message) ? 'Your Anthropic account is out of credits. Add credits in the Claude Console.' : `Claude couldn’t process that (${e.message}).`;
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Claude. Check your connection.';
  if (e instanceof Anthropic.APIError) return `Claude returned an error${e.status ? ` (${e.status})` : ''}. Try again in a moment.`;
  return e?.message || 'Something went wrong talking to Claude.';
}

async function withClient(fn, key = S.settings.anthropicKey) {
  const mod = await loadSdk();
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey: String(key || '').trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    return await fn(client);
  } catch (e) {
    if (e?.tally) throw e;
    throw Object.assign(new Error(friendly(e, Anthropic)), { cause: e, tally: true });
  }
}

const fail = msg => Object.assign(new Error(msg), { tally: true });
function checkStop(res) {
  if (res.stop_reason === 'refusal') throw fail('Claude declined this request. Try rephrasing or a different photo.');
  if (res.stop_reason === 'max_tokens') throw fail('Claude’s answer was cut off. Please try again.');
}
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('');

// Checks the key (and access to the chosen model) without spending tokens.
export async function verifyAiKey(key, modelId = model()) {
  return withClient(c => c.models.retrieve(modelId), key);
}

// ---------- meal photo ----------
const MACROS = {
  kcal: { type: 'number' },
  protein_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fat_g: { type: 'number' },
};
const PHOTO_SCHEMA = {
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
          grams: { type: 'number', description: 'Estimated weight as served (cooked)' },
          ...MACROS,
        },
        required: ['name', 'portion', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
        additionalProperties: false,
      },
    },
    assumptions: { type: 'string', description: 'One or two short sentences: hidden ingredients assumed and what would change the estimate most' },
  },
  required: ['dish', 'confidence', 'items', 'assumptions'],
  additionalProperties: false,
};

const PHOTO_SYSTEM = `You estimate the nutrition of meals from photos for a calorie-tracking app used by someone losing fat while strength training.

Identify each distinct food on the plate and estimate its weight as served, in grams. Use visual scale cues: a standard dinner plate is about 10–11 inches (26–28 cm) across unless the photo suggests otherwise; also use utensils, hands, cups and packaging. Then give calories, protein, carbs and fat for that weight using standard USDA-style values for the food as prepared.

Account for calories people tend to miss: cooking oil, butter, dressings, sauces, cheese and sugary drinks. When one is plausibly present, list it as its own item so the user can remove it. If the user adds notes, treat them as facts that override what you see. Aim for a realistic estimate rather than a low one — portion sizes are usually underestimated.

Keep item names short (e.g. "Grilled chicken breast", "White rice"). Use "high" confidence only when portions are clearly visible and the foods are unambiguous.`;

export async function estimatePhoto({ base64, mediaType = 'image/jpeg', notes }) {
  return withClient(async c => {
    const res = await c.beta.messages.create({
      model: model(),
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
      system: PHOTO_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: notes?.trim() ? `My notes about this meal: ${notes.trim()}` : 'Estimate this meal.' },
        ],
      }],
    });
    checkStop(res);
    try {
      return JSON.parse(textOf(res));
    } catch {
      throw fail('Claude’s answer couldn’t be read. Please try again.');
    }
  });
}

// ---------- spoken / typed description ----------
const TEXT_SYSTEM = `You estimate the nutrition of foods someone describes in words for a calorie-tracking app used by someone losing fat while strength training.

List each food as its own item with a realistic portion in grams as eaten (use the amount they say; otherwise a typical single serving), and give calories, protein, carbs and fat for that amount using standard USDA-style values. Include obvious add-ons they mention (butter, oil, sauces). Keep names short. "dish" is a short name for the whole description.`;

export async function estimateText(text) {
  return withClient(async c => {
    const res = await c.beta.messages.create({
      model: model(),
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
      system: TEXT_SYSTEM,
      messages: [{ role: 'user', content: text.trim() }],
    });
    checkStop(res);
    try {
      return JSON.parse(textOf(res));
    } catch {
      throw fail('Claude’s answer couldn’t be read. Please try again.');
    }
  });
}

// ---------- restaurant order ----------
const RECORD_TOOL = {
  name: 'record_nutrition',
  description: 'Record the final nutrition for the order. Call exactly once, after researching.',
  strict: true,
  input_schema: {
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
  },
};

const RESTAURANT_SYSTEM = `You look up nutrition for restaurant orders for a calorie-tracking app.

Use web search to find the restaurant's own published nutrition information (nutrition calculator, nutrition PDF or menu pages) for each part of the order, matching sizes and customizations. Prefer official sources; fall back to reputable third-party nutrition databases; estimate only when nothing is published, and say so. When the restaurant publishes components separately (e.g. a bowl's rice, protein, beans, salsa, cheese), list each component as its own item so the user can adjust. Assume US menus unless the user says otherwise.

When you have the numbers, call record_nutrition exactly once. Use 0 for sodium only if it is genuinely unknown.`;

export async function lookupRestaurant({ restaurant, order }) {
  return withClient(async c => {
    const messages = [{ role: 'user', content: `Restaurant: ${restaurant.trim()}\nMy order: ${order.trim()}` }];
    for (let turn = 0; turn < 4; turn++) {
      const res = await c.beta.messages.create({
        model: model(),
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium' },
        system: RESTAURANT_SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }, RECORD_TOOL],
        tool_choice: { type: 'auto' },
        messages,
      });
      if (res.stop_reason === 'refusal') checkStop(res);
      const call = res.content.find(b => b.type === 'tool_use' && b.name === 'record_nutrition');
      if (call) return call.input;
      checkStop(res);
      // pause_turn (long web research) or finished without recording: continue the same conversation.
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'pause_turn') {
        messages.push({ role: 'user', content: 'Please call record_nutrition now with your best numbers.' });
      }
    }
    throw fail('Claude couldn’t pin down nutrition for that order. Try adding more detail (size, protein, sides).');
  });
}

// ---------- questions about your data ----------
const COACH_SYSTEM = `You're a supportive, evidence-based nutrition coach inside the user's food-tracking app. They're losing fat while strength training. Their tracking data is below.

Answer using their actual data: point to specific days, foods and numbers. Be concise (under about 200 words unless they ask for more), practical and non-judgmental. Use short paragraphs or bullet points, no tables. Daily weight swings of 1–3 lb are mostly water; judge progress by the trend. Don't give medical advice; suggest a doctor or registered dietitian for medical concerns.`;

// history: [{ role: 'user', content: string } | { role: 'assistant', content: ContentBlock[] }]
export async function askCoach(history, dataSummary) {
  return withClient(async c => {
    const res = await c.beta.messages.create({
      model: model(),
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: `${COACH_SYSTEM}\n\n<tracking_data>\n${dataSummary}\n</tracking_data>`, cache_control: { type: 'ephemeral' } }],
      messages: history,
    });
    checkStop(res);
    return { text: textOf(res), content: res.content };
  });
}
