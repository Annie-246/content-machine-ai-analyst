// Douyin provider, backed by TikHub's REST API.
//
// Why a second Douyin provider: Apify bills per delivered row ($0.00499/video)
// and its Douyin search actors gate search behind a paid Apify plan. TikHub
// bills per request ($0.01 for a whole page of results) and runs the endpoints
// itself, so a 20-result scan costs ~$0.01 instead of ~$0.10.
//
// NOT YET VERIFIED AGAINST A LIVE RESPONSE. Every call so far stopped at 402
// (no balance) or 403 (token scope), so the field mapping below is written
// against Douyin's own aweme schema - which TikHub passes through - rather than
// against a captured payload. The array-finding walk is deliberately generic so
// a wrapper key we guessed wrong does not break extraction.

const TIKHUB_BASE = 'https://api.tikhub.io';
const REQUEST_TIMEOUT_MS = 60_000;

const ENDPOINTS = {
  // $0.01/request, does not accept free credit.
  videoSearch: '/api/v1/douyin/search/fetch_video_search_v2',
  // $0.01/request, does not accept free credit.
  userSearch: '/api/v1/douyin/search/fetch_user_search',
  // $0.001/request, DOES accept free credit.
  userPosts: '/api/v1/douyin/web/fetch_user_post_videos',
};

// Our sort ids -> Douyin's sort_type. 0 general, 1 most liked, 2 newest.
const SORT_MAP = { recommended: '0', engagement: '1', latest: '2' };

// Our windows -> Douyin's publish_time. Only 1/7/180 days exist, so map to a
// window at least as wide as ours and make the exact cut locally.
const PUBLISH_TIME_MAP = { '24h': '1', '72h': '7', '7d': '7', '14d': '180', '28d': '180' };

// Douyin pages this endpoint around 10-20 items; ask for enough to cover the
// user's limit in ONE request, since the request is what is billed.
const SEARCH_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// helpers (same shapes as the Apify provider, kept local so the two files stay
// independently replaceable)

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

/** Douyin returns images as { url_list: [...] }, sometimes as a bare string. */
const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//i.test(v) ? v : null;
  if (Array.isArray(v)) return firstUrl(v.find(Boolean));
  if (typeof v === 'object') return firstUrl(v.url_list) || firstUrl(v.urlList) || firstUrl(v.url);
  return null;
};

const toIso = (v) => {
  const n = num(v);
  if (n === null) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------------------
// transport

class RadarProviderError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'RadarProviderError';
    this.status = status;
  }
}

const requireToken = (apiKey) => {
  const token = (apiKey || '').trim() || (process.env.TIKHUB_API_KEY || '').trim();
  if (!token) {
    throw new RadarProviderError(
      'Chưa có API key TikHub. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.',
      { status: 400 }
    );
  }
  return token;
};

/** Turns TikHub's own error envelope into something a user can act on. */
const explainStatus = (status, json, text) => {
  const message =
    str(get(json, 'detail.message')) ||
    (typeof get(json, 'detail') === 'string' ? get(json, 'detail') : null) ||
    str(get(json, 'message')) ||
    (text || '').slice(0, 200);

  if (status === 401) return 'API key TikHub không hợp lệ. Kiểm tra lại ở mục Tích hợp, phần Nguồn dữ liệu.';
  if (status === 403) {
    return 'API key TikHub thiếu quyền cho endpoint này. Mở rộng scope của token tại user.tikhub.io/dashboard/api.';
  }
  if (status === 402) {
    return 'Tài khoản TikHub không đủ số dư. Nạp thêm tại user.tikhub.io/users/add_credit rồi quét lại.';
  }
  if (status === 429) return 'TikHub đang giới hạn tần suất. Chờ một lát rồi quét lại.';
  if (status >= 500) return 'TikHub đang gặp sự cố phía máy chủ. Thử lại sau ít phút.';
  return message ? `TikHub báo lỗi: ${message}` : `TikHub trả về lỗi ${status}.`;
};

const request = async (path, { method = 'GET', query, body, apiKey } = {}) => {
  const token = requireToken(apiKey);
  const url = new URL(TIKHUB_BASE + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
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
    try { json = text ? JSON.parse(text) : null; } catch { /* handled below */ }

    if (!res.ok) throw new RadarProviderError(explainStatus(res.status, json, text), { status: 502 });
    if (!json || typeof json !== 'object') {
      throw new RadarProviderError('TikHub trả về dữ liệu không đúng định dạng.', { status: 502 });
    }
    return json;
  } catch (err) {
    if (err instanceof RadarProviderError) throw err;
    if (err.name === 'AbortError') {
      throw new RadarProviderError('Quá thời gian chờ khi gọi TikHub. Thử lại sau ít phút.', { status: 504 });
    }
    throw new RadarProviderError('Không kết nối được tới TikHub. Kiểm tra kết nối mạng của máy chủ.', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// finding the payload
//
// TikHub wraps Douyin's response and the wrapper key differs per endpoint
// (data.data, data.aweme_list, data.business_data...). Rather than betting on
// one path, walk the tree for the largest array whose items look like the thing
// we want. This is the same approach the technical spike used successfully.

const findArray = (root, looksRight, maxDepth = 8) => {
  let best = null;
  const seen = new Set();

  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > maxDepth || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.some((x) => x && typeof x === 'object' && looksRight(x))) {
        if (!best || node.length > best.length) best = node;
      }
      node.slice(0, 3).forEach((child) => walk(child, depth + 1));
      return;
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  walk(root, 0);
  return best || [];
};

const isVideoRow = (x) => 'aweme_id' in x || 'aweme_info' in x || ('desc' in x && 'statistics' in x);
const isUserRow = (x) => 'sec_uid' in x || 'user_info' in x || ('nickname' in x && 'uid' in x);

/** Search rows arrive wrapped as { type, aweme_info: {...} }. */
const unwrapVideo = (row) => (row && typeof row === 'object' ? row.aweme_info || row.aweme_detail || row : null);
const unwrapUser = (row) => (row && typeof row === 'object' ? row.user_info || row.user || row : null);

// ---------------------------------------------------------------------------
// normalization

const extractHashtags = (v) => {
  const out = [];
  const push = (value) => {
    const t = str(value);
    if (!t) return;
    const clean = t.replace(/^#/, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  };

  for (const entry of get(v, 'text_extra') || []) {
    if (entry && entry.hashtag_name) push(entry.hashtag_name);
  }
  for (const entry of get(v, 'cha_list') || []) {
    if (entry && entry.cha_name) push(entry.cha_name);
  }
  return out;
};

const profileUrlFor = (author) => {
  const secUid = str(pick(author, ['sec_uid', 'secUid']));
  return secUid ? `https://www.douyin.com/user/${secUid}` : null;
};

export const normalizeContent = (row) => {
  const v = unwrapVideo(row);
  if (!v || typeof v !== 'object') return null;

  const id = str(pick(v, ['aweme_id', 'group_id', 'item_id']));
  if (!id) return null;

  const author = get(v, 'author') || {};

  // video.duration is milliseconds in Douyin's own schema.
  const durationMs = num(pick(v, ['video.duration', 'duration']));

  return {
    id,
    platform: 'douyin',
    caption: str(pick(v, ['desc', 'content_desc', 'share_info.share_title'])),
    publishedAt: toIso(pick(v, ['create_time', 'createTime'])),

    creator: {
      id: str(pick(author, ['uid', 'sec_uid'])),
      username: str(pick(author, ['unique_id', 'short_id', 'custom_verify_id'])),
      nickname: str(pick(author, ['nickname', 'remark_name'])),
      followerCount: num(pick(author, ['follower_count', 'mplatform_followers_count', 'fans_count'])),
      avatarUrl: firstUrl(pick(author, ['avatar_medium', 'avatar_thumb', 'avatar_larger', 'avatar_168x168'])),
      profileUrl: profileUrlFor(author),
    },

    metrics: {
      // play_count is ignored on purpose: Douyin reports 0 for search results.
      likes: num(get(v, 'statistics.digg_count')) ?? 0,
      comments: num(get(v, 'statistics.comment_count')) ?? 0,
      shares: num(get(v, 'statistics.share_count')) ?? 0,
      collects: num(get(v, 'statistics.collect_count')),
    },

    // dynamic_cover is a webp/gif; cover is often heic, which Chrome will not
    // decode - the same trap the Apify provider hit.
    thumbnailUrl: firstUrl(
      pick(v, ['video.dynamic_cover', 'video.animated_cover', 'video.cover', 'video.origin_cover'])
    ),

    // Canonical page URL. play_addr is a signed CDN link that expires, so it is
    // never stored.
    videoUrl: str(pick(v, ['share_url', 'share_info.share_url'])) || `https://www.douyin.com/video/${id}`,

    hashtags: extractHashtags(v),
    duration: durationMs === null ? null : Math.round(durationMs > 1000 ? durationMs / 1000 : durationMs),
    isAd: typeof v.is_ads === 'boolean' ? v.is_ads : null,
  };
};

export const normalizeContentList = (rows) => {
  const out = [];
  for (const row of rows) {
    // One malformed row must never take the whole scan down.
    try {
      const item = normalizeContent(row);
      if (item) out.push(item);
    } catch (err) {
      console.error('[radar] tikhub: bỏ qua item không đọc được:', err.message);
    }
  }
  return out;
};

export const normalizeCreator = (row) => {
  const u = unwrapUser(row);
  if (!u || typeof u !== 'object') return null;

  const profileUrl = profileUrlFor(u);
  const ref = profileUrl || str(pick(u, ['sec_uid', 'uid']));
  if (!ref) return null;

  return {
    ref,
    id: str(pick(u, ['uid', 'sec_uid'])),
    username: str(pick(u, ['unique_id', 'short_id'])),
    nickname: str(pick(u, ['nickname', 'remark_name'])),
    followerCount: num(pick(u, ['follower_count', 'mplatform_followers_count', 'fans_count'])),
    avatarUrl: firstUrl(pick(u, ['avatar_medium', 'avatar_thumb', 'avatar_larger'])),
    profileUrl,
  };
};

// ---------------------------------------------------------------------------
// provider

const DOUYIN_PROFILE_RE = /douyin\.com\/user\/([A-Za-z0-9_-]+)/i;

/** The user-posts endpoint is addressed by sec_user_id, not by URL. */
const secUidFromRef = (ref) => {
  const value = str(ref);
  if (!value) return null;
  const matched = value.match(DOUYIN_PROFILE_RE);
  if (matched) return matched[1];
  return /^MS4w[A-Za-z0-9_-]{20,}$/.test(value) ? value : null;
};

export const tikhubDouyinProvider = {
  id: 'douyin:tikhub',
  platform: 'douyin',
  source: 'tikhub',
  label: 'Douyin (TikHub)',
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true },

  parseCreatorRef(input) {
    const secUid = secUidFromRef(input);
    return secUid ? `https://www.douyin.com/user/${secUid}` : null;
  },

  async searchByKeyword({ query, limit, sort, windowId, apiKey }) {
    // One billed request. `limit` caps what we keep, never how many requests we
    // make - there is no pagination loop here by design.
    const json = await request(ENDPOINTS.videoSearch, {
      method: 'POST',
      apiKey,
      body: {
        keyword: query,
        cursor: 0,
        sort_type: SORT_MAP[sort] || '0',
        publish_time: PUBLISH_TIME_MAP[windowId] || '0',
        filter_duration: '0',
        content_type: '1',
        search_id: '',
        backtrace: '',
      },
    });

    const rows = findArray(json, isVideoRow);
    return normalizeContentList(rows).slice(0, Math.max(limit, 0) || SEARCH_PAGE_SIZE);
  },

  async searchCreators({ query, apiKey }) {
    const json = await request(ENDPOINTS.userSearch, {
      method: 'POST',
      apiKey,
      body: { keyword: query, cursor: 0, douyin_user_fans: '', douyin_user_type: '', search_id: '' },
    });

    const rows = findArray(json, isUserRow);
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const creator = normalizeCreator(row);
      if (!creator || seen.has(creator.ref)) continue;
      seen.add(creator.ref);
      out.push(creator);
      if (out.length >= 10) break;
    }
    return out;
  },

  async getCreatorVideos({ ref, limit, apiKey }) {
    const secUid = secUidFromRef(ref);
    if (!secUid) {
      throw new RadarProviderError(
        'Link đối thủ không hợp lệ. Dán link dạng https://www.douyin.com/user/... .',
        { status: 400 }
      );
    }

    const json = await request(ENDPOINTS.userPosts, {
      apiKey,
      query: { sec_user_id: secUid, max_cursor: 0, count: Math.min(Math.max(limit, 1), 20), filter_type: 0 },
    });

    const rows = findArray(json, isVideoRow);
    return normalizeContentList(rows).slice(0, Math.max(limit, 0) || 20);
  },
};

export { RadarProviderError as TikHubProviderError };
