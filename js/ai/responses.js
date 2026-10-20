// ChatGPT (OpenAI) and Grok (xAI): both use the Responses API, so one adapter serves both.
import { request, parseJson, declined, cutOff, fail } from './http.js';

export function responsesAdapter(ctx) {
  const auth = key => ({ Authorization: `Bearer ${key}` });
  const part = c => (c.image
    ? { type: 'input_image', image_url: `data:${c.image.mediaType};base64,${c.image.base64}`, detail: 'high' }
    : { type: 'input_text', text: c.text });

  async function create(key, body) {
    // store: false — nothing is kept on their side beyond what's needed to answer.
    const r = await request(ctx, `${ctx.base}/responses`, { headers: auth(key), body: { store: false, ...body } });
    const parts = (r?.output || []).filter(o => o.type === 'message').flatMap(m => m.content || []);
    if (parts.some(p => p.type === 'refusal')) throw declined(ctx);
    const text = parts.filter(p => p.type === 'output_text').map(p => p.text).join('');
    if (r?.status === 'failed') throw fail(`${ctx.name} returned an error. Try again in a moment.`);
    if (r?.status === 'incomplete') {
      if (r.incomplete_details?.reason === 'content_filter') throw declined(ctx);
      throw cutOff(ctx);
    }
    const sources = parts.flatMap(p => (p.annotations || []).filter(a => a.type === 'url_citation' && a.url)
      .map(a => ({ url: a.url, title: a.title || '' })));
    return { text, sources };
  }

  return {
    // A tiny real request: proves the key, the model and that the account has credit (costs a tiny fraction of a cent).
    async verify({ key, model }) {
      await request(ctx, `${ctx.base}/responses`, {
        headers: auth(key), body: { model, input: 'Reply with OK.', max_output_tokens: 64, store: false },
      });
    },

    // One answer. With a schema, the reply is constrained to it and parsed.
    async generate({ key, model, system, content, messages, schema, schemaName = 'result', search }) {
      const input = [{ role: 'system', content: system }];
      if (messages) input.push(...messages.map(m => ({ role: m.role, content: m.text })));
      else input.push({ role: 'user', content: content.map(part) });
      const body = { model, input };
      if (search) body.tools = [{ type: 'web_search' }];
      if (schema) body.text = { format: { type: 'json_schema', name: schemaName, schema, strict: true } };
      const r = await create(key, body);
      if (!schema && !r.text.trim()) throw fail(`${ctx.name} didn’t send an answer. Please try again.`);
      return { text: r.text, sources: r.sources, data: schema ? parseJson(ctx, r.text) : undefined };
    },
  };
}
