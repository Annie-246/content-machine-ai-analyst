// Douyin provider, backed by TikHub's REST API.
//
// Why a second Douyin provider: Apify bills per delivered row ($0.00499/video)
// and its Douyin search actors gate search behind a paid Apify plan. TikHub
// bills per request ($0.01 for a whole page of results) and runs the endpoints
// itself, so a 20-result scan costs ~$0.01 instead of ~$0.10.
//
// Verified against a live video-search response. The payload confirmed the field
// names below, and corrected one guess: search rows arrive as
// data.business_data[] where each row wraps the video at .data.aweme_info, one
// level deeper than the shape the rest of Douyin's API uses. Rows with no
// aweme_info (type 66668 carries related search words) are skipped.
//
// Two fields the schema documents are absent from search responses and are left
// as null: author.mplatform_followers_count and is_ads. statistics.play_count is
// present but always 0, so it stays ignored.
//
// Creator search needed the same treatment for a different shape - see
// userFromDynamicPatch below.

const TIKHUB_BASE = 'https://api.tikhub.io';
const REQUEST_TIMEOUT_MS = 60_000;

const ENDPOINTS = {
  // $0.01/request, does not accept free credit.
  videoSearch: '/api/v1/douyin/search/fetch_video_search_v2',
  // $0.01/request, does not accept free credit.
  userSearch: '/api/v1/douyin/search/fetch_user_search',
  // The /web/ variant of this endpoint answers 403 "API Token lacks required
  // permissions" on a standard token; the /app/v3/ one is in scope and returns
  // the same aweme_list. Verified live against both.
  userPosts: '/api/v1/douyin/app/v3/fetch_user_post_videos',
};

// Our sort ids -> Douyin's sort_type. 0 general, 1 most liked, 2 newest.
const SORT_MAP = { recommended: '0', engagement: '1', latest: '2' };

// Our windows -> Douyin's publish_time. Only 1/7/180 days exist, so map to a
// window at least as wide as ours and make the exact cut locally.
const PUBLISH_TIME_MAP = {
  '24h': '1', '72h': '7', '7d': '7', '14d': '180', '28d': '180', '90d': '180', all: '0',
};

// Measured, not assumed: this endpoint returns about 7 rows per request and
// takes no page-size parameter. A limit above that needs a second page, which is
// a second $0.01 charge - so the service decides how many pages to ask for, caps
// them, and shows the count before the user clicks.

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

/**
 * Creator rows carry no inline user object. Douyin returns them as a render
 * payload: data.user_list[] where every field is null except dynamic_patch,
 * whose raw_data is a JSON *string* holding user_info. Confirmed against a live
 * response; the inline shapes below still cover the other endpoints.
 */
const userFromDynamicPatch = (row) => {
  const raw = row && row.dynamic_patch && row.dynamic_patch.raw_data;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed.user_info || null : null;
  } catch {
    return null;
  }
};

const isVideoRow = (x) =>
  'aweme_id' in x ||
  'aweme_info' in x ||
  // Search results nest the video one level deeper than every other endpoint.
  (x.data && typeof x.data === 'object' && 'aweme_info' in x.data) ||
  ('desc' in x && 'statistics' in x);
const isUserRow = (x) =>
  'sec_uid' in x || 'user_info' in x || ('nickname' in x && 'uid' in x) || !!userFromDynamicPatch(x);

/**
 * Search rows arrive as { data_id, type, data: { aweme_info }, card_id }; the
 * user-posts endpoint returns the aweme object directly.
 */
const unwrapVideo = (row) => {
  if (!row || typeof row !== 'object') return null;
  return row.aweme_info || row.aweme_detail || row.data?.aweme_info || row.data?.aweme_detail || row;
};
const unwrapUser = (row) => {
  if (!row || typeof row !== 'object') return null;
  return row.user_info || row.user || userFromDynamicPatch(row) || row;
};

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
      // Douyin reports play_count = 0 on every search row, so it is reported as
      // unknown rather than as a real zero.
      views: null,
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
  // Billed per request, not per row: one call returns a whole page whatever
  // the user's limit is. So the page comes back untrimmed and the service
  // picks the best `limit` rows AFTER filtering - throwing rows away here
  // would discard data already paid for.
  billing: 'per-request',
  // Measured: this endpoint returns 7 rows and takes no page-size parameter.
  pageSize: 7,
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true },

  parseCreatorRef(input) {
    const secUid = secUidFromRef(input);
    return secUid ? `https://www.douyin.com/user/${secUid}` : null;
  },

  /**
   * One billed page. The caller decides whether to ask for another, passing the
   * cursor and search_id it got back - Douyin keys a search session on those,
   * and page two without them just repeats page one.
   */
  async searchByKeyword({ query, sort, windowId, apiKey, cursor = 0, searchId = '' }) {
    const json = await request(ENDPOINTS.videoSearch, {
      method: 'POST',
      apiKey,
      body: {
        keyword: query,
        cursor,
        sort_type: SORT_MAP[sort] || '0',
        publish_time: PUBLISH_TIME_MAP[windowId] || '0',
        filter_duration: '0',
        content_type: '1',
        search_id: searchId,
        backtrace: '',
      },
    });

    const rows = normalizeContentList(findArray(json, isVideoRow));
    const data = json?.data || {};

    return {
      // Deliberately NOT trimmed to `limit` - see `billing` above.
      rows,
      // The envelope carries no cursor of its own, so advance by what we read.
      cursor: cursor + rows.length,
      // There is no data.search_id despite the request field being called that:
      // the session id comes back as log_pb.impr_id (extra.logid on some
      // responses). Sending page two without it is rejected outright.
      searchId: str(get(data, 'log_pb.impr_id')) || str(get(data, 'extra.logid')) || searchId,
      hasMore: rows.length > 0,
    };
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

  async getCreatorVideos({ ref, limit, apiKey, cursor = 0 }) {
    const secUid = secUidFromRef(ref);
    if (!secUid) {
      throw new RadarProviderError(
        'Link đối thủ không hợp lệ. Dán link dạng https://www.douyin.com/user/... .',
        { status: 400 }
      );
    }

    // This endpoint spells the page size "counts"; "count" is accepted but
    // ignored, and omitting sec_user_id's companions answers 400.
    const json = await request(ENDPOINTS.userPosts, {
      apiKey,
      query: { sec_user_id: secUid, max_cursor: cursor, counts: Math.min(Math.max(limit, 1), 20) },
    });

    // Page size is asked for above; trimming to `limit` is left to the service,
    // which does it after the time filter so the rows kept are the best ones.
    const rows = normalizeContentList(findArray(json, isVideoRow));
    const data = json?.data || {};
    const nextCursor = num(pick(data, ['max_cursor', 'cursor']));

    return { rows, cursor: nextCursor ?? 0, hasMore: Boolean(data.has_more) && rows.length > 0 };
  },
};

export { RadarProviderError as TikHubProviderError };
