// Keyword suggestions.
//
// Most people know their topic but not the phrase Douyin actually indexes it
// under - "AI Marketing" is a category, 智能体营销 is what creators tag. This
// turns a broad topic into a handful of concrete Chinese search terms the user
// picks from.
//
// Costs an LLM call, never an Apify run: suggesting is free, scanning is not.

import { GoogleGenAI } from '@google/genai';
import { cacheGet, cacheSet } from './cache.mjs';

// Cheapest first, then up. Free-tier quota is counted per model, so when the
// cheap one is exhausted a newer model can still answer - the same fallback
// idea server/handlers.mjs already uses, just ordered by price instead of
// capability, because naming six keywords needs no frontier model.
const SUGGEST_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];

const SUGGEST_TIMEOUT_MS = 20_000;
const SUGGEST_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_SUGGESTIONS = 6;
const MAX_TOPIC_LENGTH = 100;

const PROMPT = `You suggest Douyin (抖音) search keywords.

Given a broad topic, return ${MAX_SUGGESTIONS} concrete Chinese search keywords that real
Douyin creators actually use for it. Prefer terms people search, not academic
category names. Vary the angle: some broad, some niche, some practical.

Return JSON only, an array of objects:
[{"keyword": "<Chinese search term, max 10 chars>", "note": "<short Vietnamese gloss, max 6 words>"}]

No markdown, no code fence, no explanation.

Topic: `;

/** Models sometimes wrap JSON in a fence despite being told not to. */
export const parseJsonArray = (text) => {
  const cleaned = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Fall back to the first bracketed block in a chattier answer.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
};

const CJK_RE = /[一-鿿]/;

/**
 * Keeps only entries that are actually usable as a Douyin query: short, Chinese,
 * not duplicated. A model that ignores the format yields fewer suggestions
 * rather than junk chips.
 */
export const acceptSuggestions = (rows) => {
  const out = [];
  const seen = new Set();

  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;

    const keyword = String(row.keyword || '').trim().replace(/^["'#]+|["']+$/g, '');
    if (!keyword || keyword.length > 20 || !CJK_RE.test(keyword)) continue;
    if (seen.has(keyword)) continue;

    const note = String(row.note || '').trim().slice(0, 60);
    seen.add(keyword);
    out.push({ keyword, note: note || null });
    if (out.length >= MAX_SUGGESTIONS) break;
  }

  return out;
};

const requestError = (message) => {
  const err = new Error(message);
  err.name = 'RadarRequestError';
  err.status = 400;
  return err;
};

/** Quota and overload are worth retrying on another model; nothing else is. */
const isQuotaOrOverload = (error) => {
  const text = (error?.message || '') + JSON.stringify(error?.error || '');
  return error?.status === 429 || error?.status === 503 ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|quota|overloaded|rate limit/i.test(text);
};

/**
 * Walks the model chain until one answers. Ends with a message that names the
 * real problem instead of a bare 429.
 */
const generateWithFallback = async (ai, topic) => {
  let lastError;

  for (const model of SUGGEST_MODEL_CHAIN) {
    try {
      return await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: PROMPT + topic }] }],
          config: { responseMimeType: 'application/json' },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SUGGEST_TIMEOUT_MS)),
      ]);
    } catch (err) {
      lastError = err;
      if (!isQuotaOrOverload(err)) break;
      console.log(`[radar] ${model} hết quota hoặc quá tải, thử model kế tiếp...`);
    }
  }

  if (isQuotaOrOverload(lastError)) {
    throw requestError(
      'Gemini đã hết hạn ngạch cho hôm nay trên mọi model đang dùng. ' +
      'Chờ quota reset, hoặc dán một API key Gemini khác ở mục Tích hợp. ' +
      'Bạn vẫn gõ từ khoá thủ công và quét bình thường được.'
    );
  }
  if (/timeout/i.test(lastError?.message || '')) {
    throw requestError('Gemini phản hồi quá chậm. Thử lại sau ít phút.');
  }
  throw requestError(`Không gợi ý được từ khoá: ${String(lastError?.message || 'lỗi không xác định').slice(0, 200)}`);
};

/**
 * @returns {Promise<{topic: string, suggestions: {keyword: string, note: string|null}[], cached: boolean}>}
 */
export const suggestKeywords = async (topic, apiKey) => {
  const trimmed = (topic || '').trim().slice(0, MAX_TOPIC_LENGTH);
  if (!trimmed) return { topic: trimmed, suggestions: [], cached: false };

  const cacheKey = `radar:suggest:${trimmed.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { topic: trimmed, suggestions: cached, cached: true };

  const key = (apiKey || '').trim() || process.env.GEMINI_API_KEY || '';
  if (!key) {
    const err = new Error('Chưa có API key Gemini. Vào mục Tích hợp để dán key, rồi thử lại.');
    err.name = 'RadarRequestError';
    err.status = 400;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const response = await generateWithFallback(ai, trimmed);

  const suggestions = acceptSuggestions(parseJsonArray(response?.text));
  if (suggestions.length) cacheSet(cacheKey, suggestions, SUGGEST_TTL_MS);

  return { topic: trimmed, suggestions, cached: false };
};
