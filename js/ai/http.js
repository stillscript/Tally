// Shared plumbing for the AI services: requests with retries, plain-English errors, reading JSON answers.
// Every service is called straight from this device with your own key; nothing goes through another server.

// Errors with .tally carry a message that's ready to show.
export const fail = (message, extra) => Object.assign(new Error(message), { tally: true, ...extra });

export const declined = ctx => fail(`${ctx.name} declined this request. Try rephrasing or a different photo.`);
export const cutOff = ctx => fail(`${ctx.name}’s answer was cut off. Please try again.`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TIMEOUT_MS = 180000; // web research can take a while; anything longer is stuck

function errorText(data, raw) {
  const e = data?.error;
  const msg = (typeof e === 'string' ? e : e?.message) || data?.message || data?.detail || raw || '';
  return String(msg).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function httpError(ctx, status, data, raw) {
  const msg = errorText(data, raw);
  const code = data?.error?.code || data?.error?.status || data?.code || '';
  const where = 'Settings → AI assistant';
  const keyBad = /api key not valid|invalid api key|incorrect api key|invalid x-api-key|api_key_invalid|unauthorized|authentication/i;
  const noCredit = /credit|balance|billing|insufficient_quota|payment|spend(ing)? limit/i;
  const base = { status, auth: false, raw: msg };
  if (status === 401 || keyBad.test(msg) || code === 'API_KEY_INVALID') {
    return fail(`Your ${ctx.keyName || ctx.name + ' key'} was rejected. Check it in ${where}.`, { ...base, auth: true });
  }
  if (status === 402 || code === 'insufficient_quota' || (status !== 429 && noCredit.test(msg))) {
    return fail(`Your ${ctx.company} account is out of credits. Add some in the ${ctx.console}.`, { ...base, auth: true });
  }
  if (status === 403) return fail(`This key isn’t allowed to use that ${ctx.name} model.${ctx.region ? ' ' + ctx.region : ''}`, { ...base, auth: true });
  if (status === 404) return fail(`That ${ctx.name} model isn’t available to this key. Pick another model in ${where}.`, { ...base, auth: true });
  if (status === 429) return fail(ctx.quotaHint || `${ctx.name} is rate-limiting this key right now. Wait a minute and try again.`, base);
  if (status === 400) return fail(`${ctx.name} couldn’t process that${msg ? ` (${msg})` : ''}.`, base);
  return fail(`${ctx.name} returned an error${status ? ` (${status})` : ''}. Try again in a moment.`, base);
}

// JSON request with up to two retries for rate limits, overloads and dropped connections (like the official SDKs).
export async function request(ctx, url, { method = 'POST', headers = {}, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout?.(TIMEOUT_MS),
      });
    } catch (e) {
      if (e?.name === 'TimeoutError') throw fail(`${ctx.name} took too long to answer. Please try again.`);
      if (attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      throw fail(`Couldn’t reach ${ctx.name}. Check your connection.`);
    }
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (res.ok) return data;
    const err = httpError(ctx, res.status, data, raw);
    const retry = !err.auth && (res.status === 429 || res.status === 408 || res.status >= 500);
    if (retry && attempt < 2) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 ? Math.min(after, 8) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw err;
  }
}

// Reads a JSON object out of an answer, tolerating code fences or a sentence around it.
export function parseJson(ctx, text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try {
    const v = JSON.parse(t);
    if (v && typeof v === 'object') return v;
  } catch {}
  throw fail(`${ctx.name}’s answer couldn’t be read. Please try again.`, { unreadable: true });
}
