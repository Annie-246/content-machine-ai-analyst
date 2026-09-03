// Douyin provider, backed by Apify actors.
//
// Everything Apify-shaped lives in this file: actor ids, actor input, response
// schema and normalization. Nothing above this layer knows what an "aweme" or
// an "authorMeta" is.
//
// Field mapping was taken from a real dataset captured during the technical
// spike (scripts/apify-douyin-spike.mjs), not from documentation.

import { getTimeWindow } from '../../../services/radar/constants.mjs';

const APIFY_BASE = 'https://api.apify.com/v2';

// Actor ids are configuration, not code. sian.agency/douyin-scraper exposes a
// richer operation set, but it refuses API runs on Apify's free plan
// ("Free-tier API access is disabled for this actor"), so the default is the
// pair that verifiably runs over the API today. Override once you upgrade.
const SEARCH_ACTOR = process.env.RADAR_DOUYIN_SEARCH_ACTOR || 'zen-studio~douyin-search-scraper';
const PROFILE_ACTOR = process.env.RADAR_DOUYIN_PROFILE_ACTOR || 'zen-studio~douyin-profile-scraper';

// One actor run is billed per delivered row, so an over-long wait is cheaper to
// abort than to let hang; the spike measured a 10-result run at ~10.5s.
const RUN_TIMEOUT_MS = 180_000;

// Competitor mode finds creators by sampling a keyword search and collecting
// the distinct authors. Every sampled row is billed, so keep it small.
const CREATOR_SEARCH_SAMPLE_SIZE = 20;

// Our sort ids -> the actor's own enum. Narrowing what the actor returns up
// front means more of the rows we pay for are ones the user wanted.
const SORT_MAP = { recommended: 'general', engagement: 'most_liked', latest: 'latest' };

// Our windows -> the actor's coarser publishTime enum. Always map to a window
// at least as wide as ours: a narrower one would drop rows we asked for. The
// exact cut is then made locally.
const PUBLISH_TIME_MAP = {
  '24h': 'one_day',
  '72h': 'one_week',
  '7d': 'one_week',
  '14d': 'half_year',
  '28d': 'half_year',
  '90d': 'half_year',
  all: 'unlimited',
};

// ---------------------------------------------------------------------------
// small helpers

const get = (obj, dotted) => {
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
};

const pick = (obj, paths) => {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

const str = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
};

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const httpUrl = (v) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

const toIso = (v) => {
  const n = num(v);
  if (n === null) {
    const s = str(v);
    if (!s) return null;
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  // createTime is seconds; a few fields elsewhere are milliseconds.
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------------------
// Apify transport

class RadarProviderError extends Error {
  constructor(message, { status = 502, detail = '' } = {}) {
    super(message);
    this.name = 'RadarProviderError';
    this.status = status;
    this.detail = detail;
  }
}

// The key the user saved in Tích hợp wins; APIFY_API_TOKEN on the server is only
// a fallback for a self-hosted deployment that wants to supply its own.
export const resolveToken = (apiKey) => {
  const token = (apiKey || '').trim() || (process.env.APIFY_API_TOKEN || '').trim();
  if (!token) {
    throw new RadarProviderError(
      'Chưa có API key Apify. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.',
      { status: 400 }
    );
  }
  return token;
};

const apifyFetch = async (path, { method = 'GET', body, timeoutMs = 30_000, apiKey } = {}) => {
  const token = resolveToken(apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(APIFY_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* handled by caller */ }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new RadarProviderError(
        'Quá thời gian chờ khi quét Douyin. Thử lại với số kết quả nhỏ hơn.',
        { status: 504 }
      );
    }
    throw new RadarProviderError('Không kết nối được tới Apify. Kiểm tra kết nối mạng của máy chủ.', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * An actor that fails after startup still answers 200 with an empty dataset, so
 * an empty result is ambiguous. Read the run's status and the tail of its log to
 * tell "nothing matched" apart from "the actor refused to run".
 */
const diagnoseEmptyRun = async (actor, apiKey) => {
  try {
    const runs = await apifyFetch(`/acts/${actor}/runs?limit=1&desc=true`, { timeoutMs: 15_000, apiKey });
    const run = runs.ok && runs.json?.data?.items?.[0];
    if (!run) return null;

    const log = await apifyFetch(`/logs/${run.id}`, { timeoutMs: 15_000, apiKey });
    const fatal = (log.text || '')
      .split('\n')
      .filter((line) => /FATAL|❌|⛔/.test(line))
      .pop();

    if (!fatal) return run.status === 'SUCCEEDED' ? null : `Actor kết thúc với trạng thái ${run.status}.`;
    return fatal.replace(/^\S+\s+/, '').trim().slice(0, 300);
  } catch {
    return null;
  }
};

const explainApifyStatus = (status, json, text) => {
  const message = json?.error?.message || json?.message || (text || '').slice(0, 200);
  if (status === 401 || status === 403) {
    return 'API key Apify không hợp lệ hoặc không đủ quyền. Kiểm tra lại ở mục Tích hợp, phần Nguồn dữ liệu.';
  }
  if (status === 402) return 'Tài khoản Apify đã hết hạn mức tháng này. Nạp thêm credit để tiếp tục quét.';
  if (status === 404) return 'Không tìm thấy actor Apify được cấu hình. Kiểm tra RADAR_DOUYIN_SEARCH_ACTOR / RADAR_DOUYIN_PROFILE_ACTOR.';
  if (status === 429) return 'Apify đang giới hạn tần suất. Chờ một lát rồi quét lại.';
  if (status >= 500) return 'Apify đang gặp sự cố phía máy chủ. Thử lại sau ít phút.';
  return message ? `Apify báo lỗi: ${message}` : `Apify trả về lỗi ${status}.`;
};

/**
 * Some actors report a refusal as a normal dataset row rather than a failed run
 * - a quota notice like `{ limit_reached: true, message: "You have used all 3
 * free runs..." }`. Such a row carries no video id, so normalization would drop
 * it and the scan would look like "nothing matched", blaming the user's filters
 * for the provider's refusal. Catch it and say what actually happened.
 */
export const detectProviderNotice = (rows) => {
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;

  const looksLikeVideo = first.id || first.awemeId || first.aweme_id || first.videoId;
  if (looksLikeVideo) return null;

  const message = str(pick(first, ['message', 'error', 'msg', 'detail']));
  if (!message && first.limit_reached !== true) return null;

  if (first.limit_reached === true) {
    const used = num(first.free_runs_used);
    const cap = num(first.free_runs_limit);
    const counted = used !== null && cap !== null ? ` (${used}/${cap})` : '';
    return (
      `Actor Apify đã hết lượt chạy miễn phí${counted}. ` +
      'Nâng cấp gói Apify, hoặc trỏ sang actor khác qua biến môi trường ' +
      'RADAR_DOUYIN_SEARCH_ACTOR / RADAR_DOUYIN_PROFILE_ACTOR.'
    );
  }

  return `Nhà cung cấp dữ liệu từ chối yêu cầu: ${message}`;
};

/** Runs an actor and returns its dataset rows. Exactly one run per call. */
const runActor = async (actor, input, apiKey) => {
  const result = await apifyFetch(`/acts/${actor}/run-sync-get-dataset-items`, {
    method: 'POST',
    body: input,
    timeoutMs: RUN_TIMEOUT_MS,
    apiKey,
  });

  if (!result.ok) {
    throw new RadarProviderError(explainApifyStatus(result.status, result.json, result.text), { status: 502 });
  }

  if (!Array.isArray(result.json)) {
    throw new RadarProviderError('Apify trả về dữ liệu không đúng định dạng.', { status: 502 });
  }

  const notice = detectProviderNotice(result.json);
  if (notice) {
    console.error(`[radar] actor ${actor} từ chối: ${JSON.stringify(result.json[0]).slice(0, 300)}`);
    throw new RadarProviderError(notice, { status: 502 });
  }

  if (result.json.length === 0) {
    const reason = await diagnoseEmptyRun(actor, apiKey);
    if (reason) {
      // Surfaced to the operator in the server log; the user gets the short form.
      console.error(`[radar] actor ${actor} trả về rỗng: ${reason}`);
      throw new RadarProviderError(`Nhà cung cấp dữ liệu không chạy được: ${reason}`, { status: 502, detail: reason });
    }
  }

  return result.json;
};

// ---------------------------------------------------------------------------
// normalization

const extractHashtags = (raw) => {
  const out = [];
  const push = (value) => {
    const t = str(value);
    if (!t) return;
    const clean = t.replace(/^#/, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  };

  for (const key of ['hashtags', 'textExtra', 'text_extra', 'challenges']) {
    const arr = get(raw, key);
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (typeof entry === 'string') push(entry);
      else if (entry && typeof entry === 'object') push(entry.name || entry.hashtag_name || entry.title);
    }
  }
  return out;
};

/** Douyin profile pages are addressed by secUid, which the row always carries. */
const profileUrlFor = (author) => {
  const secUid = str(pick(author, ['secUid', 'sec_uid']));
  return secUid ? `https://www.douyin.com/user/${secUid}` : null;
};

/**
 * One raw Apify row -> RadarContent. Returns null for anything without an id or
 * a usable page URL, so a single malformed row cannot poison the result set.
 */
export const normalizeContent = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const id = str(pick(raw, ['id', 'awemeId', 'aweme_id', 'videoId', 'groupId']));
  if (!id) return null;

  const author = get(raw, 'authorMeta') || get(raw, 'author') || {};

  // Prefer the clean canonical page URL. shareUrl carries tracking params and an
  // expiry; videoMeta.playUrl is a CDN link that dies within the hour, so it is
  // never stored.
  const videoUrl =
    httpUrl(pick(raw, ['url', 'webVideoUrl', 'postUrl'])) ||
    httpUrl(pick(raw, ['shareUrl', 'share_url'])) ||
    `https://www.douyin.com/video/${id}`;

  // videoMeta.duration is milliseconds; the UI wants seconds.
  const durationMs = num(pick(raw, ['videoMeta.duration', 'duration']));

  return {
    id,
    platform: 'douyin',
    caption: str(pick(raw, ['text', 'caption', 'desc', 'itemTitle', 'description'])),
    publishedAt: toIso(pick(raw, ['createTime', 'create_time', 'createDate', 'publishedAt'])),

    creator: {
      id: str(pick(author, ['id', 'uid', 'secUid'])),
      username: str(pick(author, ['customUsername', 'username', 'uniqueId', 'unique_id'])),
      nickname: str(pick(author, ['name', 'nickname', 'nickName'])),
      followerCount: num(pick(author, ['followersCount', 'followerCount', 'follower_count', 'fans'])),
      avatarUrl: httpUrl(pick(author, ['avatarMedium', 'avatarThumb', 'avatar300', 'avatarLarge', 'avatar'])),
      profileUrl: profileUrlFor(author),
    },

    metrics: {
      // playCount is deliberately ignored: Douyin reports 0 for every search row.
      views: null,
      likes: num(pick(raw, ['statistics.diggCount', 'statistics.digg_count', 'diggCount'])) ?? 0,
      comments: num(pick(raw, ['statistics.commentCount', 'statistics.comment_count', 'commentCount'])) ?? 0,
      shares: num(pick(raw, ['statistics.shareCount', 'statistics.share_count', 'shareCount'])) ?? 0,
      collects: num(pick(raw, ['statistics.collectCount', 'statistics.collect_count', 'collectCount'])),
    },

    // dynamicCover/animatedCover come back as image/webp; cover and originCover
    // are image/heic, which Chrome and Firefox will not decode. The signed URLs
    // cannot be rewritten to another format (the signature covers the path), so
    // the webp variants are picked first and heic is only a last resort.
    thumbnailUrl: httpUrl(
      pick(raw, [
        'videoMeta.dynamicCover', 'videoMeta.animatedCover',
        'videoMeta.cover', 'videoMeta.originCover', 'cover', 'coverUrl',
      ])
    ),

    videoUrl,
    hashtags: extractHashtags(raw),
    duration: durationMs === null ? null : Math.round(durationMs > 1000 ? durationMs / 1000 : durationMs),
    isAd: typeof raw.isAd === 'boolean' ? raw.isAd : null,
  };
};

export const normalizeContentList = (rows) => {
  const out = [];
  for (const row of rows) {
    // One bad row must never take the whole scan down.
    try {
      const item = normalizeContent(row);
      if (item) out.push(item);
    } catch (err) {
      console.error('[radar] bỏ qua item không đọc được:', err.message);
    }
  }
  return out;
};

/** Rolls the authors of a sampled search up into pickable creator candidates. */
export const creatorCandidatesFrom = (contents) => {
  const seen = new Map();

  for (const item of contents) {
    const ref = item.creator.profileUrl || item.creator.id;
    if (!ref || seen.has(ref)) continue;
    seen.set(ref, {
      ref,
      id: item.creator.id,
      username: item.creator.username,
      nickname: item.creator.nickname,
      followerCount: item.creator.followerCount,
      avatarUrl: item.creator.avatarUrl,
      profileUrl: item.creator.profileUrl,
    });
  }

  return [...seen.values()].sort((a, b) => (b.followerCount ?? 0) - (a.followerCount ?? 0));
};

// ---------------------------------------------------------------------------
// provider

const DOUYIN_PROFILE_RE = /douyin\.com\/user\/([A-Za-z0-9_-]+)/i;

export const douyinApifyProvider = {
  id: 'douyin:apify',
  platform: 'douyin',
  source: 'apify',
  label: 'Douyin (Apify)',
  // Billed per delivered row, so the limit has to be enforced in the request
  // itself. Asking for more and trimming locally would simply cost more.
  billing: 'per-row',
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true },

  /** Accepts a pasted profile URL or a bare secUid; anything else needs a search. */
  parseCreatorRef(input) {
    const value = str(input);
    if (!value) return null;

    const matched = value.match(DOUYIN_PROFILE_RE);
    if (matched) return `https://www.douyin.com/user/${matched[1]}`;

    // Douyin secUids are long opaque MS4wLjABAAAA... strings.
    if (/^MS4w[A-Za-z0-9_-]{20,}$/.test(value)) return `https://www.douyin.com/user/${value}`;

    return null;
  },

  async searchByKeyword({ query, limit, sort, windowId, apiKey }) {
    const rows = await runActor(SEARCH_ACTOR, {
      keywords: [query],
      // Hard ceiling on billed rows. Never raised to compensate for local filtering.
      maxResultsPerQuery: limit,
      sort: SORT_MAP[sort] || 'general',
      publishTime: PUBLISH_TIME_MAP[windowId] || 'unlimited',
      duration: 'unlimited',
      // Every download option is charged extra and the Radar never needs the file.
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false,
    }, apiKey);

    // Billed per row, so the request already carried the limit: one page only.
    return { rows: normalizeContentList(rows), cursor: 0, searchId: '', hasMore: false };
  },

  async searchCreators({ query, apiKey }) {
    const rows = await runActor(SEARCH_ACTOR, {
      keywords: [query],
      maxResultsPerQuery: CREATOR_SEARCH_SAMPLE_SIZE,
      sort: 'general',
      publishTime: 'unlimited',
      duration: 'unlimited',
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false,
    }, apiKey);

    return creatorCandidatesFrom(normalizeContentList(rows));
  },

  async getCreatorVideos({ ref, limit, windowId, apiKey }) {
    const win = getTimeWindow(windowId);

    const rows = await runActor(PROFILE_ACTOR, {
      profileUrls: [ref],
      maxPostsPerProfile: limit,
      // Narrowing at the source means fewer billed rows get thrown away locally.
      ...(win ? { recentDays: Math.ceil(win.hours / 24) } : {}),
      excludePinnedPosts: false,
    }, apiKey);

    return normalizeContentList(rows);
  },
};

export { RadarProviderError };
