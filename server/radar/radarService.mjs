// Content Radar orchestration.
//
// Order is deliberate and cost-driven:
//   normalize keyword -> ONE provider run -> local time filter -> score -> sort
//
// The provider is asked for exactly the number of rows the user picked. When
// the local time filter removes some, we return fewer. We never go back for
// more: every extra row is billed, and "up to N" is what the UI promises.

import {
  DEFAULT_PLATFORM, DEFAULT_RESULT_LIMIT, DEFAULT_SORT_MODE, DEFAULT_TIME_WINDOW,
  MAX_RESULT_LIMIT, RESULT_LIMITS, SORT_MODES, TIME_WINDOWS,
} from '../../services/radar/constants.mjs';
import { filterByTimeWindow } from '../../services/radar/timeWindow.mjs';
import { sortRadarContent } from '../../services/radar/sorting.mjs';
import { withRadarScore } from '../../services/radar/ranking.mjs';
import { getProvidersForPlatform, getProviderBySource } from './providers/index.mjs';
import { RadarProviderError } from './providers/douyinApify.mjs';
import { normalizeKeyword } from './translate.mjs';
import { suggestKeywords as suggestKeywordsImpl } from './suggest.mjs';
import { cacheGet, cacheSet, withInflight } from './cache.mjs';

// Long enough to absorb an accidental re-scan, short enough that "quét lại"
// still feels like it fetched something current.
const RESULT_TTL_MS = 30 * 60 * 1000;

const MAX_QUERY_LENGTH = 100;

// A Douyin profile URL is a secUid (~55 chars) on top of the host, so competitor
// input needs far more room than a keyword does.
const MAX_REF_LENGTH = 300;

export class RadarRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RadarRequestError';
    this.status = 400;
  }
}

// ---------------------------------------------------------------------------
// validation

const validQuery = (raw, label, maxLength = MAX_QUERY_LENGTH) => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new RadarRequestError(`Chưa nhập ${label}.`);
  if (value.length > maxLength) {
    throw new RadarRequestError(`${label} quá dài (tối đa ${maxLength} ký tự).`);
  }
  return value;
};

const validPlatform = (raw) => {
  const id = typeof raw === 'string' && raw ? raw : DEFAULT_PLATFORM;
  if (!getProvidersForPlatform(id).length) {
    throw new RadarRequestError(`Nền tảng "${id}" chưa được hỗ trợ.`);
  }
  return id;
};

const validWindow = (raw) => {
  const id = typeof raw === 'string' && raw ? raw : DEFAULT_TIME_WINDOW;
  if (!TIME_WINDOWS.some((w) => w.id === id)) throw new RadarRequestError('Khoảng thời gian không hợp lệ.');
  return id;
};

/** The server enforces the ceiling too - the browser is not the last word on spend. */
const validLimit = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || !RESULT_LIMITS.includes(value)) return DEFAULT_RESULT_LIMIT;
  return Math.min(value, MAX_RESULT_LIMIT);
};

const validSort = (raw) => (SORT_MODES.some((s) => s.id === raw) ? raw : DEFAULT_SORT_MODE);

/**
 * Picks the data source for a platform and returns it with the key that pays
 * for it.
 *
 * `dataKeys` maps source id -> key, exactly what the user saved in Tích hợp.
 * When they pinned a source we honour it and say so if its key is missing;
 * otherwise the first source with a key wins, in registry order (cheapest
 * first). Resolved before the cache lookup, so "no key configured" is never
 * masked by someone else's earlier scan.
 */
const resolveSource = (platform, body) => {
  const raw = body && typeof body.dataKeys === 'object' && body.dataKeys ? body.dataKeys : {};
  const keys = { ...raw };
  // Older clients sent a single Apify key under dataApiKey.
  if (typeof body?.dataApiKey === 'string' && body.dataApiKey && !keys.apify) keys.apify = body.dataApiKey;

  const available = getProvidersForPlatform(platform);
  const pinned = typeof body?.source === 'string' && body.source ? body.source : '';

  if (pinned) {
    const provider = getProviderBySource(platform, pinned);
    if (!provider) throw new RadarRequestError(`Nguồn dữ liệu "${pinned}" không phục vụ nền tảng này.`);
    const key = String(keys[pinned] || '').trim();
    if (!key) {
      throw new RadarRequestError(
        `Chưa có API key cho nguồn ${provider.label}. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.`
      );
    }
    return { provider, apiKey: key };
  }

  for (const provider of available) {
    const key = String(keys[provider.source] || '').trim();
    if (key) return { provider, apiKey: key };
  }

  const names = available.map((p) => p.label).join(' hoặc ');
  throw new RadarRequestError(
    `Chưa có API key cho nguồn dữ liệu nào (${names}). Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.`
  );
};

// ---------------------------------------------------------------------------

const finish = (items, windowId, sort, now) => {
  const inWindow = filterByTimeWindow(items, windowId, now);
  const scored = inWindow.map((item) => withRadarScore(item, now));
  return sortRadarContent(scored, sort);
};

const wrapProviderCall = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RadarProviderError || err instanceof RadarRequestError) throw err;
    // Never let a raw provider stack trace reach the browser.
    console.error('[radar] lỗi nhà cung cấp:', err);
    throw new RadarProviderError('Không quét được Douyin lúc này. Thử lại sau ít phút.', { status: 502 });
  }
};

/**
 * Mode A - scan by keyword.
 * Exactly one actor run per call (plus a cheap translation call when needed).
 */
export const searchByKeyword = async (body, { geminiApiKey = '' } = {}) => {
  const platform = validPlatform(body.platform);
  const rawKeyword = validQuery(body.query, 'từ khoá');
  const windowId = validWindow(body.timeWindow);
  const limit = validLimit(body.limit);
  const sort = validSort(body.sort);

  // Resolved after input validation (so the user hears about the field they
  // left blank first) but before translation and before the cache lookup.
  const { provider, apiKey } = resolveSource(platform, body);

  const keyword = await normalizeKeyword(rawKeyword, geminiApiKey);

  const cacheKey = ['search', provider.id, keyword.query.toLowerCase(), windowId, limit, sort].join('|');
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  return withInflight(cacheKey, async () => {
    const raw = await wrapProviderCall(() =>
      provider.searchByKeyword({ query: keyword.query, limit, sort, windowId, apiKey })
    );

    const now = Date.now();
    const payload = {
      mode: 'keyword',
      platform,
      source: provider.source,
      query: { original: keyword.original, effective: keyword.query, translated: keyword.translated },
      timeWindow: windowId,
      limit,
      sort,
      fetchedCount: raw.length,
      items: finish(raw, windowId, sort, now),
      cached: false,
    };

    cacheSet(cacheKey, payload, RESULT_TTL_MS);
    return payload;
  });
};

/**
 * Mode B step 1 - find candidate creators.
 * Never auto-picks: the user chooses before we spend a run on their videos.
 */
export const searchCreators = async (body) => {
  const platform = validPlatform(body.platform);
  const rawQuery = validQuery(body.query, 'tên hoặc link đối thủ', MAX_REF_LENGTH);

  // A pasted profile URL needs no search, so it needs no key and costs nothing.
  for (const candidate of getProvidersForPlatform(platform)) {
    const direct = candidate.parseCreatorRef?.(rawQuery);
    if (direct) {
      return {
        platform,
        resolved: true,
        candidates: [{ ref: direct, id: null, username: null, nickname: rawQuery, followerCount: null, avatarUrl: null, profileUrl: direct }],
      };
    }
  }

  const { provider, apiKey } = resolveSource(platform, body);

  if (!provider.capabilities.searchCreators) {
    throw new RadarRequestError('Nguồn dữ liệu này chưa hỗ trợ tìm đối thủ theo tên. Hãy dán link trang cá nhân.');
  }

  const cacheKey = ['creators', provider.id, rawQuery.toLowerCase()].join('|');
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  return withInflight(cacheKey, async () => {
    const candidates = await wrapProviderCall(() => provider.searchCreators({ query: rawQuery, apiKey }));

    const payload = { platform, source: provider.source, resolved: false, candidates, cached: false };
    cacheSet(cacheKey, payload, RESULT_TTL_MS);
    return payload;
  });
};

/** Mode B step 2 - the chosen creator's recent videos. One actor run. */
export const getCreatorVideos = async (body) => {
  const platform = validPlatform(body.platform);
  const ref = validQuery(body.ref, 'đối thủ', MAX_REF_LENGTH);
  const windowId = validWindow(body.timeWindow);
  const limit = validLimit(body.limit);
  const sort = validSort(body.sort);

  const { provider, apiKey } = resolveSource(platform, body);

  if (!provider.capabilities.getCreatorVideos) {
    throw new RadarRequestError('Nguồn dữ liệu này chưa hỗ trợ quét theo đối thủ.');
  }

  const cacheKey = ['creator-videos', provider.id, ref, windowId, limit, sort].join('|');
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  return withInflight(cacheKey, async () => {
    const raw = await wrapProviderCall(() => provider.getCreatorVideos({ ref, limit, windowId, apiKey }));

    const now = Date.now();
    const payload = {
      mode: 'creator',
      platform,
      source: provider.source,
      query: { original: ref, effective: ref, translated: false },
      timeWindow: windowId,
      limit,
      sort,
      fetchedCount: raw.length,
      items: finish(raw, windowId, sort, now),
      cached: false,
    };

    cacheSet(cacheKey, payload, RESULT_TTL_MS);
    return payload;
  });
};

/**
 * Keyword ideas for a broad topic. Costs one cheap LLM call and no Apify run,
 * so it stays available even when the data source is unavailable.
 */
export const suggestKeywords = async (body, { geminiApiKey = '' } = {}) => {
  const topic = validQuery(body.query, 'chủ đề');
  return suggestKeywordsImpl(topic, geminiApiKey);
};
