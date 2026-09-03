// One place for the Radar's small LLM calls (keyword translation, keyword
// suggestions).
//
// Both are cheap, optional helpers, and both used to name a single model. That
// broke the day Google stopped issuing gemini-2.5-flash to new accounts: the
// API answers 404 "no longer available to new users", which is not a quota
// error, so a chain that only retried on quota gave up on the first model.
//
// So the rule here is: walk the chain on ANY error that another model could
// plausibly survive - quota, overload, and a model that this account cannot
// reach at all.

import { GoogleGenAI } from '@google/genai';

// Newest first, matching TEXT_MODEL_CHAIN in server/handlers.mjs. Free-tier
// quota is counted per model, so a chain is what keeps these helpers working.
export const RADAR_TEXT_MODEL_CHAIN = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];

const errorText = (error) => (error?.message || '') + JSON.stringify(error?.error || error?.response || '');

/** Out of quota or momentarily overloaded - another model may well answer. */
export const isQuotaOrOverload = (error) => {
  const text = errorText(error);
  return error?.status === 429 || error?.status === 503 ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|quota|overloaded|rate limit/i.test(text);
};

/**
 * This account cannot use this model at all: retired, not granted, or renamed.
 * Google returns 404 with "no longer available to new users" for the first case.
 */
export const isModelUnavailable = (error) => {
  const text = errorText(error);
  return error?.status === 404 ||
    /no longer available|not available|NOT_FOUND|is not found|does not exist|unsupported model|permission.*model/i.test(text);
};

export class LlmUnavailableError extends Error {
  constructor(message) {
    super(message);
    // Reuses the Radar's "this is a message for the user" marker so the route
    // surfaces it verbatim instead of flattening it to a generic 500.
    this.name = 'RadarRequestError';
    this.status = 400;
  }
}

/**
 * Runs one prompt against the model chain and returns the first answer.
 *
 * @param {string} apiKey
 * @param {string} prompt
 * @param {{ timeoutMs?: number, config?: object, models?: string[] }} [opts]
 * @returns {Promise<string>} the model's raw text
 */
export const generateText = async (apiKey, prompt, opts = {}) => {
  const { timeoutMs = 20_000, config, models = RADAR_TEXT_MODEL_CHAIN } = opts;

  const key = (apiKey || '').trim();
  if (!key) {
    throw new LlmUnavailableError('Chưa có API key Gemini. Vào mục Tích hợp để dán key, rồi thử lại.');
  }

  const ai = new GoogleGenAI({ apiKey: key });
  let lastError;
  const skipped = [];

  for (const model of models) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...(config ? { config } : {}),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return response?.text || '';
    } catch (err) {
      lastError = err;

      if (isModelUnavailable(err)) {
        skipped.push(`${model} (không khả dụng với tài khoản này)`);
        continue;
      }
      if (isQuotaOrOverload(err)) {
        skipped.push(`${model} (hết quota hoặc quá tải)`);
        continue;
      }
      // Anything else - a bad prompt, a malformed request - would fail the same
      // way on every model, so stop rather than burn the chain.
      break;
    }
  }

  if (skipped.length) console.log(`[radar] bỏ qua model: ${skipped.join(', ')}`);

  if (isModelUnavailable(lastError) || isQuotaOrOverload(lastError)) {
    const reason = isModelUnavailable(lastError)
      ? 'không model nào trong danh sách khả dụng với API key này'
      : 'mọi model đều đã hết hạn ngạch hôm nay';
    throw new LlmUnavailableError(
      `Gemini không dùng được: ${reason}. Thử dán một API key Gemini khác ở mục Tích hợp. ` +
      'Bạn vẫn gõ từ khoá thủ công và quét bình thường được.'
    );
  }
  if (/timeout/i.test(lastError?.message || '')) {
    throw new LlmUnavailableError('Gemini phản hồi quá chậm. Thử lại sau ít phút.');
  }
  throw new LlmUnavailableError(
    `Gemini báo lỗi: ${String(lastError?.message || 'không xác định').slice(0, 200)}`
  );
};
