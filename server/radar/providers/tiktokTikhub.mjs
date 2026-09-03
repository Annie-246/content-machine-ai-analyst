// TikTok provider, backed by TikHub.
//
// TikTok's app API returns the same "aweme" shape Douyin does - unsurprising,
// same parent company - so the field mapping mirrors the Douyin provider.
//
// Two differences that matter:
//   - The search endpoint takes `count`, so one request can cover the whole
//     limit. No pagination loop is needed up to 20.
//   - It costs $0.001 per request against Douyin's $0.01.
//
// NOT YET VERIFIED against a live response. The mapping follows TikTok's
// documented aweme schema and the array-finding walk tolerates a wrapper key
// guessed wrong, but the field names have not been confirmed against a payload.

import {
  tikhubRequest, findArray, normalizeList, get, pick, str, num, firstUrl, toIso,
  RadarProviderError,
} from './tikhubClient.mjs';

const ENDPOINTS = {
  // $0.001/request, accepts `count` up to ~20.
  videoSearch: '/api/v1/tiktok/app/v3/fetch_video_search_result',
  // $0.001/request.
  userSearch: '/api/v1/tiktok/web/fetch_search_user',
  // $0.001/request, takes sec_user_id or unique_id.
  userPosts: '/api/v1/tiktok/app/v3/fetch_user_post_videos',
};

// TikTok's sort_type: 0 relevance, 1 most liked, 2 newest.
const SORT_MAP = { recommended: 0, engagement: 1, latest: 2 };

// TikTok's publish_time: 0 any, 1 day, 7 week, 30 month, 90 three months.
// Always map to a window at least as wide as ours; the exact cut is local.
const PUBLISH_TIME_MAP = {
  '24h': 1, '72h': 7, '7d': 7, '14d': 30, '28d': 30, '90d': 90, all: 0,
};

const MAX_COUNT = 20;

const isVideoRow = (x) => 'aweme_id' in x || 'aweme_info' in x || ('desc' in x && 'statistics' in x);
const isUserRow = (x) => 'sec_uid' in x || 'user_info' in x || ('nickname' in x && 'uid' in x);

const unwrapVideo = (row) => (row && typeof row === 'object' ? row.aweme_info || row.aweme || row : null);
const unwrapUser = (row) => (row && typeof row === 'object' ? row.user_info || row.user || row : null);

const profileUrlFor = (author) => {
  const handle = str(pick(author, ['unique_id', 'uniqueId', 'nickname']));
  return handle ? `https://www.tiktok.com/@${handle}` : null;
};

export const normalizeContent = (row) => {
  const v = unwrapVideo(row);
  if (!v || typeof v !== 'object') return null;

  const id = str(pick(v, ['aweme_id', 'group_id', 'item_id']));
  if (!id) return null;

  const author = get(v, 'author') || {};
  const handle = str(pick(author, ['unique_id', 'uniqueId']));

  // Milliseconds in TikTok's schema, same as Douyin.
  const durationMs = num(pick(v, ['video.duration', 'duration']));

  return {
    id,
    platform: 'tiktok',
    caption: str(pick(v, ['desc', 'content_desc'])),
    publishedAt: toIso(pick(v, ['create_time', 'createTime'])),

    creator: {
      id: str(pick(author, ['uid', 'sec_uid'])),
      username: handle,
      nickname: str(pick(author, ['nickname', 'remark_name'])),
      followerCount: num(pick(author, ['follower_count', 'followerCount', 'fans_count'])),
      avatarUrl: firstUrl(pick(author, ['avatar_medium', 'avatar_thumb', 'avatar_larger', 'avatar_168x168'])),
      profileUrl: profileUrlFor(author),
    },

    metrics: {
      // TikTok search rows do carry play_count, but it is frequently 0 for the
      // same reason Douyin's is, so a zero is reported as unknown.
      views: num(get(v, 'statistics.play_count')) || null,
      likes: num(get(v, 'statistics.digg_count')) ?? 0,
      comments: num(get(v, 'statistics.comment_count')) ?? 0,
      shares: num(get(v, 'statistics.share_count')) ?? 0,
      collects: num(pick(v, ['statistics.collect_count'])),
    },

    thumbnailUrl: firstUrl(
      pick(v, ['video.dynamic_cover', 'video.animated_cover', 'video.cover', 'video.origin_cover'])
    ),

    // Built from the handle rather than taken from share_url: the latter arrives
    // with a dozen tracking parameters (_r, u_code, share_item_id...) that would
    // be stored and exported verbatim. play_addr is a signed CDN link that
    // expires, so it is never used either.
    videoUrl: handle
      ? `https://www.tiktok.com/@${handle}/video/${id}`
      : str(pick(v, ['share_url', 'share_info.share_url'])) || `https://www.tiktok.com/video/${id}`,

    hashtags: (get(v, 'text_extra') || [])
      .map((e) => str(e?.hashtag_name))
      .filter(Boolean)
      .filter((tag, i, all) => all.indexOf(tag) === i),

    duration: durationMs === null ? null : Math.round(durationMs > 1000 ? durationMs / 1000 : durationMs),
    isAd: typeof v.is_ads === 'boolean' ? v.is_ads : null,
  };
};

export const normalizeCreator = (row) => {
  const u = unwrapUser(row);
  if (!u || typeof u !== 'object') return null;

  const handle = str(pick(u, ['unique_id', 'uniqueId']));
  const ref = handle || str(pick(u, ['sec_uid', 'uid']));
  if (!ref) return null;

  return {
    ref: handle ? `https://www.tiktok.com/@${handle}` : ref,
    id: str(pick(u, ['uid', 'sec_uid'])),
    username: handle,
    nickname: str(pick(u, ['nickname', 'remark_name'])),
    followerCount: num(pick(u, ['follower_count', 'followerCount', 'fans_count'])),
    avatarUrl: firstUrl(pick(u, ['avatar_medium', 'avatar_thumb', 'avatar_larger'])),
    profileUrl: handle ? `https://www.tiktok.com/@${handle}` : null,
  };
};

const TIKTOK_PROFILE_RE = /tiktok\.com\/@([A-Za-z0-9._-]+)/i;

const handleFromRef = (ref) => {
  const value = str(ref);
  if (!value) return null;
  const matched = value.match(TIKTOK_PROFILE_RE);
  if (matched) return matched[1];
  return /^@?[A-Za-z0-9._]{2,24}$/.test(value) ? value.replace(/^@/, '') : null;
};

export const tiktokTikhubProvider = {
  id: 'tiktok:tikhub',
  platform: 'tiktok',
  source: 'tikhub',
  label: 'TikTok (TikHub)',
  // The search endpoint takes `count`, so the limit rides in the request and one
  // page covers it - no extra billed pages.
  billing: 'per-row',
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true },

  parseCreatorRef(input) {
    const handle = handleFromRef(input);
    return handle ? `https://www.tiktok.com/@${handle}` : null;
  },

  async searchByKeyword({ query, limit, sort, windowId, apiKey }) {
    const json = await tikhubRequest(ENDPOINTS.videoSearch, {
      apiKey,
      query: {
        keyword: query,
        offset: 0,
        count: Math.min(Math.max(limit, 1), MAX_COUNT),
        sort_type: SORT_MAP[sort] ?? 0,
        publish_time: PUBLISH_TIME_MAP[windowId] ?? 0,
      },
    });

    const rows = normalizeList(findArray(json, isVideoRow), normalizeContent, 'tiktok');
    return { rows, cursor: 0, searchId: '', hasMore: false };
  },

  async searchCreators({ query, apiKey }) {
    const json = await tikhubRequest(ENDPOINTS.userSearch, { apiKey, query: { keyword: query, count: 10 } });

    const seen = new Set();
    const out = [];
    for (const row of findArray(json, isUserRow)) {
      const creator = normalizeCreator(row);
      if (!creator || seen.has(creator.ref)) continue;
      seen.add(creator.ref);
      out.push(creator);
      if (out.length >= 10) break;
    }
    return out;
  },

  /**
   * One page of a creator's posts. The endpoint ignores a `count` above its own
   * page size, so reading further back means following max_cursor - which the
   * keyword filter needs, since a single page is only ~10 videos.
   */
  async getCreatorVideos({ ref, limit, apiKey, cursor = 0 }) {
    const handle = handleFromRef(ref);
    if (!handle) {
      throw new RadarProviderError(
        'Link đối thủ không hợp lệ. Dán link dạng https://www.tiktok.com/@ten-kenh .',
        { status: 400 }
      );
    }

    const json = await tikhubRequest(ENDPOINTS.userPosts, {
      apiKey,
      query: { unique_id: handle, max_cursor: cursor, count: Math.min(Math.max(limit, 1), MAX_COUNT) },
    });

    const rows = normalizeList(findArray(json, isVideoRow), normalizeContent, 'tiktok');
    const nextCursor = num(pick(json, ['data.max_cursor', 'max_cursor', 'data.cursor']));
    const hasMore = Boolean(pick(json, ['data.has_more', 'has_more'])) && rows.length > 0;

    return { rows, cursor: nextCursor ?? 0, hasMore };
  },
};
