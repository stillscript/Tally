// Gemini (Google) through the Gemini API's generateContent endpoint.
import { request, parseJson, declined, cutOff, fail } from './http.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BLOCKED = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT'];

// Older-style schema for models that don't take standard JSON Schema: uppercase types, no additionalProperties.
function legacySchema(s) {
  if (Array.isArray(s)) return s.map(legacySchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([p, d]) => [p, legacySchema(d)]));
    else out[k] = legacySchema(v);
  }
  return out;
}

export function geminiAdapter(ctx) {
  const part = c => (c.image ? { inlineData: { mimeType: c.image.mediaType, data: c.image.base64 } } : { text: c.text });

  async function call(key, model, body) {
    const r = await request(ctx, `${BASE}/models/${model}:generateContent`, { headers: { 'x-goog-api-key': key }, body });
    if (r?.promptFeedback?.blockReason) throw declined(ctx);
    const cand = r?.candidates?.[0];
    if (!cand) throw declined(ctx);
    if (BLOCKED.includes(cand.finishReason)) throw declined(ctx);
    const text = (cand.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
    if (cand.finishReason === 'MAX_TOKENS') throw cutOff(ctx);
    const sources = (cand.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(w => w?.uri)
      .map(w => ({ url: w.uri, title: w.title || '' }));
    return { text, sources };
  }

  return {
    // A tiny real request, so a free key without access to the chosen model is caught here rather than later.
    async verify({ key, model }) {
      await request(ctx, `${BASE}/models/${model}:generateContent`, {
        headers: { 'x-goog-api-key': key },
        body: { contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }] },
      });
    },

    async generate({ key, model, system, content, messages, schema, search }) {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages
          ? messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }))
          : [{ role: 'user', parts: content.map(part) }],
      };
      if (search) body.tools = [{ googleSearch: {} }];
      if (!schema) {
        const r = await call(key, model, body);
        if (!r.text.trim()) throw fail(`${ctx.name} didn’t send an answer. Please try again.`);
        return r;
      }
      let r;
      try {
        r = await call(key, model, { ...body, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema } });
      } catch (e) {
        if (e.status !== 400 || e.auth) throw e;
        r = await call(key, model, { ...body, generationConfig: { responseMimeType: 'application/json', responseSchema: legacySchema(schema) } });
      }
      return { ...r, data: parseJson(ctx, r.text) };
    },
  };
}
