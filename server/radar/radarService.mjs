// Content Radar orchestration.
//
// Order is deliberate and cost-driven:
//   normalize keyword -> provider page(s) -> local time filter -> score -> sort
//
// How many pages depends on how the provider bills. Billed per row (Apify), the
// limit rides in the request and one page is all there is. Billed per request
// (TikHub), a page is a fixed ~7 rows whatever the limit, so reaching a larger
// limit costs another page - capped hard, and the count is shown before the
// user clicks. Nothing is ever re-fetched to make up for rows the time filter
// removed: "tối đa N" is what the UI promises.

import {
  CREATOR_KEYWORD_MAX_PAGES, CREATOR_KEYWORD_SCAN_LIMIT, DEFAULT_PLATFORM, DEFAULT_SORT_MODE, DEFAULT_TIME_WINDOW,
  MAX_KEYWORDS, MAX_PAGES_PER_KEYWORD, SORT_MODES, TIME_WINDOWS,
  clampLimit, getTimeWindow, pagesNeeded, recencyHalfLife,
} from '../../services/radar/constants.mjs';
import {
  countMissingViews, countUndated, filterByKeyword, filterByThresholds,
} from '../../services/radar/relevance.mjs';
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

/**
 * The server enforces the ceiling too - the browser is not the last word on
 * spend. Clamps rather than resetting, so a typed 35 stays 35 instead of
 * silently becoming the default.
 */
const validLimit = (raw) => clampLimit(raw);

/**
 * Accepts either one keyword or a list. Blank entries and duplicates are
 * dropped, and the count is capped: every keyword is a separately billed
 * provider call, so this is the ceiling on what one click can spend.
 */
const validKeywords = (body) => {
  const raw = Array.isArray(body?.queries) ? body.queries : [body?.query];

  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim() : '';
    if (!value) continue;
    if (value.length > MAX_QUERY_LENGTH) {
      throw new RadarRequestError(`Từ khoá quá dài (tối đa ${MAX_QUERY_LENGTH} ký tự).`);
    }
    const dedupe = value.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(value);
  }

  if (!out.length) throw new RadarRequestError('Chưa nhập từ khoá.');
  if (out.length > MAX_KEYWORDS) {
    throw new RadarRequestError(`Tối đa ${MAX_KEYWORDS} từ khoá mỗi lần quét.`);
  }
  return out;
};

const validSort = (raw) => (SORT_MODES.some((s) => s.id === raw) ? raw : DEFAULT_SORT_MODE);

/**
 * A floor on a metric: "their videos that broke 100k views". Zero and anything
 * unreadable mean "no floor" - a typo must not silently empty the list.
 */
const validThreshold = (raw) => {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 1_000_000_000);
};

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
// A self-hosted server can carry its own key in .env.local instead of making
// every browser paste one. A key sent with the request still wins.
const ENV_KEY_FOR_SOURCE = { tikhub: 'TIKHUB_API_KEY', apify: 'APIFY_API_TOKEN' };

const resolveSource = (platform, body) => {
  const raw = body && typeof body.dataKeys === 'object' && body.dataKeys ? body.dataKeys : {};
  const keys = { ...raw };
  // Older clients sent a single Apify key under dataApiKey.
  if (typeof body?.dataApiKey === 'string' && body.dataApiKey && !keys.apify) keys.apify = body.dataApiKey;

  const keyFor = (source) =>
    String(keys[source] || '').trim() ||
    String(process.env[ENV_KEY_FOR_SOURCE[source]] || '').trim();

  const available = getProvidersForPlatform(platform);
  const pinned = typeof body?.source === 'string' && body.source ? body.source : '';

  if (pinned) {
    const provider = getProviderBySource(platform, pinned);
    if (!provider) throw new RadarRequestError(`Nguồn dữ liệu "${pinned}" không phục vụ nền tảng này.`);
    const key = keyFor(pinned);
    if (!key) {
      throw new RadarRequestError(
        `Chưa có API key cho nguồn ${provider.label}. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.`
      );
    }
    return { provider, apiKey: key };
  }

  for (const provider of available) {
    const key = keyFor(provider.source);
    if (key) return { provider, apiKey: key };
  }

  const names = available.map((p) => p.label).join(' hoặc ');
  throw new RadarRequestError(
    `Chưa có API key cho nguồn dữ liệu nào (${names}). Dán key ở mục Tích hợp, phần Nguồn dữ liệu, hoặc đặt TIKHUB_API_KEY / APIFY_API_TOKEN trong .env.local của máy chủ.`
  );
};

// ---------------------------------------------------------------------------

const finish = (items, windowId, sort, now) => {
  const inWindow = filterByTimeWindow(items, windowId, now);

  // Recency is judged against the window the user chose. On "Không giới hạn"
  // there is no window, so the score answers "how strong is this video" rather
  // than "how strong and how recent".
  const halfLife = recencyHalfLife(getTimeWindow(windowId)?.hours);

  const scored = inWindow.map((item) => withRadarScore(item, now, halfLife));
  return sortRadarContent(scored, sort);
};

/**
 * Narrows one keyword's rows down to what the user asked for.
 *
 * Filter, score and sort BEFORE trimming, so `limit` means "the best N that
 * survive the time window" rather than "the first N the provider happened to
 * list". For a per-request provider that is free extra quality: the whole page
 * was paid for regardless, so choosing from all of it costs nothing.
 */
const takeBest = (rows, windowId, sort, limit, now) => finish(rows, windowId, sort, now).slice(0, limit);

const wrapProviderCall = async (fn, label = 'nền tảng này') => {
  try {
    return await fn();
  } catch (err) {
    // A provider error already carries a message written for the user; only an
    // unexpected one gets the generic text, and it must not name the wrong
    // platform.
    if (err?.name === 'RadarProviderError' || err instanceof RadarRequestError) throw err;
    console.error('[radar] lỗi nhà cung cấp:', err);
    throw new RadarProviderError(`Không quét được ${label} lúc này. Thử lại sau ít phút.`, { status: 502 });
  }
};

/**
 * Runs one keyword and returns its raw rows. Cached per keyword, so adding a
 * sixth keyword to a five-keyword scan only pays for the new one, and a repeat
 * scan pays for nothing.
 */
const runOneKeyword = async ({ provider, apiKey, keyword, limit, sort, windowId }) => {
  // YouTube filters upstream by publishedAfter, so it needs the window in hours.
  const windowHours = getTimeWindow(windowId)?.hours ?? null;
  const perRow = provider.billing === 'per-row';

  // A per-row provider carries the limit in the request, so the limit belongs in
  // its key. A per-request provider returns a fixed page, so its key records how
  // many PAGES were fetched - asking for fewer pages later re-uses the cache,
  // asking for more tops it up.
  const pages = perRow ? 1 : pagesNeeded(limit);
  const cacheKey = ['search', provider.id, keyword.query.toLowerCase(), windowId, sort, perRow ? limit : `p${pages}`].join('|');

  const cached = cacheGet(cacheKey);
  if (cached) return { rows: cached, cached: true, calls: 0 };

  return withInflight(cacheKey, async () => {
    const collected = [];
    const seen = new Set();
    let cursor = 0;
    let searchId = '';
    let calls = 0;

    for (let page = 0; page < Math.min(pages, MAX_PAGES_PER_KEYWORD); page++) {
      let result;
      try {
        result = await wrapProviderCall(() =>
          provider.searchByKeyword({ query: keyword.query, limit, sort, windowId, apiKey, cursor, searchId, windowHours })
        );
      } catch (err) {
        // Page one failing means the keyword failed. A later page failing must
        // not throw away the earlier pages - they were already paid for.
        if (!collected.length) throw err;
        console.error(`[radar] dừng phân trang sau trang ${page}: ${err.message}`);
        break;
      }
      calls += 1;

      // Pages overlap by a row or two, so de-duplicate as we go rather than
      // letting a repeat count towards the limit.
      for (const row of result.rows || []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collected.push(row);
      }

      // Nothing new, or the provider says it is done - stop paying for pages.
      if (!result.hasMore || !(result.rows || []).length) break;
      if (collected.length >= limit) break;

      cursor = result.cursor;
      searchId = result.searchId || searchId;
    }

    cacheSet(cacheKey, collected, RESULT_TTL_MS);
    return { rows: collected, cached: false, calls };
  });
};

/**
 * Mode A - scan by keyword.
 *
 * One provider call per keyword, run in sequence rather than in parallel: the
 * providers rate-limit, and a serial loop keeps a partial failure from wasting
 * calls that already succeeded.
 *
 * `limit` is per keyword, because that is what the provider takes. Results are
 * merged and de-duplicated by video id, so the same video found by two keywords
 * is shown once.
 */
export const searchByKeyword = async (body, { geminiApiKey = '' } = {}) => {
  const platform = validPlatform(body.platform);
  const rawKeywords = validKeywords(body);
  const windowId = validWindow(body.timeWindow);
  const limit = validLimit(body.limit);
  const sort = validSort(body.sort);

  // Resolved after input validation (so the user hears about the field they
  // left blank first) but before translation and before any cache lookup.
  const { provider, apiKey } = resolveSource(platform, body);

  // Douyin is a Chinese-language platform, so a Vietnamese or English keyword is
  // translated first. The others index the user's own language, and translating
  // there would actively hurt the results.
  const translates = platform === 'douyin';

  const keywords = [];
  for (const raw of rawKeywords) {
    keywords.push(
      translates ? await normalizeKeyword(raw, geminiApiKey) : { query: raw, original: raw, translated: false }
    );
  }

  const byId = new Map();
  const queries = [];
  let fetchedCount = 0;
  let billedCalls = 0;
  const failures = [];

  for (const keyword of keywords) {
    let result;
    try {
      result = await runOneKeyword({ provider, apiKey, keyword, limit, sort, windowId });
    } catch (err) {
      // One dead keyword must not throw away the keywords that worked.
      failures.push({ keyword: keyword.original, error: err?.message || 'không quét được' });
      queries.push({ ...keywordSummary(keyword), matched: 0, failed: true });
      continue;
    }

    fetchedCount += result.rows.length;
    billedCalls += result.calls || 0;

    // Trimmed per keyword, not across the merged set, because `limit` is what
    // each keyword is allowed to contribute.
    let matched = 0;
    for (const row of takeBest(result.rows, windowId, sort, limit, Date.now())) {
      if (byId.has(row.id)) continue;
      byId.set(row.id, row);
      matched += 1;
    }
    queries.push({ ...keywordSummary(keyword), matched, failed: false });
  }

  // Every keyword failed - there is nothing to show, so surface the reason.
  if (!byId.size && failures.length === keywords.length) {
    throw new RadarProviderError(failures[0].error, { status: 502 });
  }

  const now = Date.now();
  return {
    mode: 'keyword',
    platform,
    source: provider.source,
    // Kept for callers that still read a single query.
    query: queries[0] ? { original: queries[0].original, effective: queries[0].effective, translated: queries[0].translated } : null,
    queries,
    failures,
    timeWindow: windowId,
    limit,
    sort,
    fetchedCount,
    billedCalls,
    items: finish([...byId.values()], windowId, sort, now),
    cached: billedCalls === 0,
  };
};

const keywordSummary = (keyword) => ({
  original: keyword.original,
  effective: keyword.query,
  translated: keyword.translated,
});

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
    const candidates = await wrapProviderCall(() => provider.searchCreators({ query: rawQuery, apiKey }), provider.label);

    const payload = { platform, source: provider.source, resolved: false, candidates, cached: false };
    cacheSet(cacheKey, payload, RESULT_TTL_MS);
    return payload;
  });
};

/**
 * Mode B step 2 - the chosen creator's videos. One actor run.
 *
 * Two ways to read a creator, both one call:
 *   - no keyword: their recent videos, ranked by the Radar Score.
 *   - a keyword: only the videos that talk about that topic.
 *
 * How the keyword is applied depends on the provider. YouTube takes it in the
 * request (`creatorKeyword`), so it searches the whole channel. The others only
 * list recent posts, so the Radar pulls a full page and filters the captions
 * here - which is why the response reports how many videos were read.
 */
export const getCreatorVideos = async (body, { geminiApiKey = '' } = {}) => {
  const platform = validPlatform(body.platform);
  const ref = validQuery(body.ref, 'đối thủ', MAX_REF_LENGTH);
  const windowId = validWindow(body.timeWindow);
  const limit = validLimit(body.limit);
  const sort = validSort(body.sort);

  const rawKeyword = typeof body.query === 'string' ? body.query.trim() : '';
  if (rawKeyword.length > MAX_QUERY_LENGTH) {
    throw new RadarRequestError(`Từ khoá quá dài (tối đa ${MAX_QUERY_LENGTH} ký tự).`);
  }

  const minViews = validThreshold(body.minViews);
  const minLikes = validThreshold(body.minLikes);
  const hasThreshold = minViews > 0 || minLikes > 0;

  const { provider, apiKey } = resolveSource(platform, body);

  if (!provider.capabilities.getCreatorVideos) {
    throw new RadarRequestError('Nguồn dữ liệu này chưa hỗ trợ quét theo đối thủ.');
  }

  // A Douyin creator captions in Chinese, so a Vietnamese keyword has to be
  // translated before it is matched against anything - same rule as mode A.
  const keyword = rawKeyword
    ? platform === 'douyin'
      ? await normalizeKeyword(rawKeyword, geminiApiKey)
      : { query: rawKeyword, original: rawKeyword, translated: false }
    : null;

  const filtersUpstream = !!keyword && provider.capabilities.creatorKeyword === true;
  // Any local filter needs something to filter: asking for the user's 3 rows
  // and then dropping the ones that miss the keyword - or the view floor -
  // would almost always end at zero. A page costs the same whatever its size,
  // so ask for the whole page.
  const filtersLocally = (!!keyword && !filtersUpstream) || hasThreshold;
  const fetchLimit = filtersLocally ? Math.max(limit, CREATOR_KEYWORD_SCAN_LIMIT) : limit;

  const cacheKey = [
    'creator-videos', provider.id, ref, windowId, fetchLimit, sort,
    keyword?.query.toLowerCase() || '', minViews, minLikes,
  ].join('|');
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  return withInflight(cacheKey, async () => {
    // One page unless a local filter needs more to work with: TikHub returns
    // ~10 videos a page, and "has this creator ever covered X" cannot be
    // answered from the last ten posts.
    const maxPages = filtersLocally ? CREATOR_KEYWORD_MAX_PAGES : 1;
    const now = Date.now();

    const raw = [];
    const seen = new Set();
    let cursor = 0;
    let calls = 0;

    for (let page = 0; page < maxPages; page++) {
      let result;
      try {
        result = await wrapProviderCall(
          () => provider.getCreatorVideos({
            ref,
            limit: fetchLimit,
            windowId,
            apiKey,
            windowHours: getTimeWindow(windowId)?.hours ?? null,
            query: filtersUpstream ? keyword.query : '',
            cursor,
          }),
          provider.label
        );
      } catch (err) {
        // Page one failing is the scan failing; a later page must not throw away
        // pages already paid for.
        if (!raw.length) throw err;
        console.error(`[radar] dừng phân trang đối thủ sau trang ${page}: ${err.message}`);
        break;
      }
      calls += 1;

      // A provider that cannot paginate still answers with a plain array.
      const page_ = Array.isArray(result) ? { rows: result, cursor: 0, hasMore: false } : result || {};
      for (const row of page_.rows || []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        raw.push(row);
      }

      if (!page_.hasMore || !(page_.rows || []).length) break;
      if (raw.length >= fetchLimit) break;
      // A creator's feed comes back newest first, so once a whole page sits
      // outside the window every later page does too. Stop paying for them.
      if (!filterByTimeWindow(page_.rows, windowId, now).length) break;
      // No cursor movement means page two would repeat page one.
      if (!page_.cursor || page_.cursor === cursor) break;
      cursor = page_.cursor;
    }

    const byKeyword = keyword && !filtersUpstream ? filterByKeyword(raw, keyword.query) : raw;
    // The floor is applied before the time window so `fetchedCount` answers
    // "how many of their videos qualify", and takeBest still does the rest.
    const matched = filterByThresholds(byKeyword, { minViews, minLikes });

    const payload = {
      mode: 'creator',
      platform,
      source: provider.source,
      // null when the scan was not narrowed - the caller reads this as "no
      // keyword", so it must not be filled with the creator ref.
      query: keyword
        ? { original: keyword.original, effective: keyword.query, translated: keyword.translated }
        : null,
      timeWindow: windowId,
      limit,
      sort,
      fetchedCount: matched.length,
      // How many of the creator's videos were read to find them. Only worth
      // reporting when something narrowed the list.
      scannedCount: keyword || hasThreshold ? raw.length : undefined,
      thresholds: hasThreshold ? { minViews, minLikes } : undefined,
      // Rows the platform reported no view count for. Without this a view floor
      // returning nothing looks like the creator has no popular videos, when in
      // fact the numbers were never supplied.
      missingViews: minViews > 0 ? countMissingViews(byKeyword) : undefined,
      // Rows with no publish date: any bounded window drops these silently, and
      // that is worth saying out loud rather than reporting an empty scan.
      undatedCount: countUndated(matched),
      billedCalls: calls,
      items: takeBest(matched, windowId, sort, limit, now),
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
  const platform = validPlatform(body.platform);
  const windowId = body.timeWindow ? validWindow(body.timeWindow) : DEFAULT_TIME_WINDOW;

  // Filtering one creator's videos needs shorter, plainer keywords than
  // searching a platform does - and their own captions to draw them from.
  const scope = body.scope === 'creator' ? 'creator' : 'search';
  const samples = Array.isArray(body.samples)
    ? body.samples.filter((s) => typeof s === 'string' && s.trim()).slice(0, 12).map((s) => s.slice(0, 200))
    : [];

  return suggestKeywordsImpl(
    { topic, platform, brand: sanitizeBrand(body.brand), windowId, scope, samples },
    geminiApiKey
  );
};

/**
 * Only the brand fields that inform a keyword, each capped.
 *
 * The browser sends whatever the active brand holds; taking a fixed subset here
 * keeps an oversized profile from bloating the prompt, and keeps fields the
 * suggester has no business seeing out of it.
 */
const sanitizeBrand = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const clip = (value) => String(value ?? '').trim().slice(0, 300) || undefined;
  const brand = {
    id: clip(raw.id),
    industry: clip(raw.industry),
    targetAudience: clip(raw.targetAudience),
    coreUSPs: clip(raw.coreUSPs),
    tagline: clip(raw.tagline),
    customNotes: clip(raw.customNotes),
  };

  return Object.values(brand).some(Boolean) ? brand : null;
};
