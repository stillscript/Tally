// Claude (Anthropic) through the official SDK, loaded on first use.
import { fail, declined, cutOff, parseJson } from './http.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
// If a safety classifier declines a request, the API re-runs it on a recommended fallback model.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

let sdk = null;
function loadSdk() {
  if (!sdk) {
    sdk = import(SDK_URL).catch(() => {
      sdk = null;
      throw fail('Couldn’t load the Claude SDK. Check your connection and try again.');
    });
  }
  return sdk;
}

export function claudeAdapter(ctx) {
  function friendly(e, A) {
    const where = 'Settings → AI assistant';
    if (e instanceof A.AuthenticationError) return fail(`Your Anthropic API key was rejected. Check it in ${where}.`, { auth: true, status: 401 });
    if (e instanceof A.PermissionDeniedError) return fail('This API key isn’t allowed to use that model.', { auth: true, status: 403 });
    if (e instanceof A.NotFoundError) return fail(`That Claude model isn’t available to this API key. Pick another model in ${where}.`, { auth: true, status: 404 });
    if (e instanceof A.RateLimitError) return fail('Claude is rate-limiting this key right now. Wait a minute and try again.', { status: 429 });
    if (e instanceof A.BadRequestError) {
      return /credit balance/i.test(e.message)
        ? fail('Your Anthropic account is out of credits. Add credits in the Claude Console.', { auth: true, status: 400 })
        : fail(`Claude couldn’t process that (${e.message}).`, { status: 400 });
    }
    if (e instanceof A.APIConnectionError) return fail('Couldn’t reach Claude. Check your connection.');
    if (e instanceof A.APIError) return fail(`Claude returned an error${e.status ? ` (${e.status})` : ''}. Try again in a moment.`, { status: e.status });
    return fail(e?.message || 'Something went wrong talking to Claude.');
  }

  async function withClient(key, fn) {
    const A = (await loadSdk()).default;
    const client = new A({ apiKey: String(key || '').trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
    try {
      return await fn(client);
    } catch (e) {
      if (e?.tally) throw e;
      throw friendly(e, A);
    }
  }

  function checkStop(res) {
    if (res.stop_reason === 'refusal') throw declined(ctx);
    if (res.stop_reason === 'max_tokens') throw cutOff(ctx);
  }
  const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const cited = res => res.content.flatMap(b => b.citations || []).filter(c => c.url).map(c => ({ url: c.url, title: c.title || '' }));
  const blocks = content => content.map(c => (c.image
    ? { type: 'image', source: { type: 'base64', media_type: c.image.mediaType, data: c.image.base64 } }
    : { type: 'text', text: c.text }));

  return {
    // Checks the key and access to the model without spending tokens.
    verify: ({ key, model }) => withClient(key, c => c.models.retrieve(model)),

    generate: ({ key, model, system, content, messages, schema, search, effort = 'medium' }) => withClient(key, async c => {
      const base = { model, max_tokens: 16000, ...FALLBACK };

      if (messages) {
        const res = await c.beta.messages.create({
          ...base,
          output_config: { effort },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: messages.map(m => ({ role: m.role, content: m.text })),
        });
        checkStop(res);
        return { text: textOf(res), sources: [] };
      }

      if (!search) {
        const res = await c.beta.messages.create({
          ...base,
          output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
          system,
          messages: [{ role: 'user', content: blocks(content) }],
        });
        checkStop(res);
        const text = textOf(res);
        return { text, sources: [], data: schema ? parseJson(ctx, text) : undefined };
      }

      // Web research, then the final numbers through a strict tool (structured output alongside search).
      const tool = { name: 'record_result', description: 'Record the final answer. Call exactly once, after researching.', strict: true, input_schema: schema };
      const msgs = [{ role: 'user', content: blocks(content) }];
      const sources = [];
      for (let turn = 0; turn < 4; turn++) {
        const res = await c.beta.messages.create({
          ...base,
          output_config: { effort },
          system: `${system}\n\nWhen you have the numbers, call record_result exactly once.`,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }, tool],
          tool_choice: { type: 'auto' },
          messages: msgs,
        });
        if (res.stop_reason === 'refusal') checkStop(res);
        sources.push(...cited(res));
        const call = res.content.find(b => b.type === 'tool_use' && b.name === 'record_result');
        if (call) return { text: '', sources, data: call.input };
        checkStop(res);
        // pause_turn (long web research) or finished without recording: continue the same conversation.
        msgs.push({ role: 'assistant', content: res.content });
        if (res.stop_reason !== 'pause_turn') msgs.push({ role: 'user', content: 'Please call record_result now with your best numbers.' });
      }
      throw fail('Claude couldn’t pin down the numbers. Try adding more detail.', { noResult: true });
    }),
  };
}
