// Keyword normalization for Douyin search.
//
// Douyin is a Chinese platform; a Vietnamese or English keyword returns thin,
// off-topic results. So a non-CJK keyword is translated into ONE short Chinese
// query before it reaches the provider.
//
// One query, never an expanded set: each extra query would be another billed
// actor run. If translation fails for any reason we fall back to the original
// keyword rather than blocking the scan.

import { GoogleGenAI } from '@google/genai';
import { cacheGet, cacheSet } from './cache.mjs';

// Cheapest model in the chain server/handlers.mjs already uses. Translating four
// words does not need the newest one.
const TRANSLATE_MODEL = 'gemini-2.5-flash';

const TRANSLATE_TIMEOUT_MS = 15_000;

// A keyword's translation does not change; hold it far longer than a result set.
const TRANSLATION_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT =
  'Translate the search keyword into ONE short Chinese search query for Douyin. ' +
  'Reply with the query only: no quotes, no pinyin, no explanation, no punctuation.';

/** CJK ideographs, plus the kana blocks so mixed input is not mistaken for Latin. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

export const hasCJK = (text) => CJK_RE.test(text || '');

/**
 * Guards against a model that ignores the instruction and answers with a
 * sentence. Anything that is not a short CJK phrase is rejected, and the caller
 * keeps the original keyword.
 */
const acceptTranslation = (text) => {
  const value = (text || '').trim().replace(/^["'“”「」]+|["'“”「」]+$/g, '').split('\n')[0].trim();
  if (!value || value.length > 30) return null;
  if (!hasCJK(value)) return null;
  return value;
};

/**
 * @returns {Promise<{query: string, translated: boolean, original: string}>}
 */
export const normalizeKeyword = async (keyword, apiKey) => {
  const original = (keyword || '').trim();

  // Already Chinese (or Japanese) - send it through untouched.
  if (!original || hasCJK(original)) {
    return { query: original, translated: false, original };
  }

  const cacheKey = `radar:kw:${original.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { query: cached, translated: true, original };

  const key = (apiKey || '').trim() || process.env.GEMINI_API_KEY || '';
  if (!key) return { query: original, translated: false, original };

  try {
    const ai = new GoogleGenAI({ apiKey: key });

    const response = await Promise.race([
      ai.models.generateContent({
        model: TRANSLATE_MODEL,
        contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nKeyword: ${original}` }] }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TRANSLATE_TIMEOUT_MS)),
    ]);

    const accepted = acceptTranslation(response?.text);
    if (!accepted) return { query: original, translated: false, original };

    cacheSet(cacheKey, accepted, TRANSLATION_TTL_MS);
    return { query: accepted, translated: true, original };
  } catch (err) {
    // Translation is an optimisation, never a gate.
    console.error('[radar] dịch từ khoá thất bại, dùng nguyên văn:', err?.message || err);
    return { query: original, translated: false, original };
  }
};
