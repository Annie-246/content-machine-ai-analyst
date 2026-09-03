// Instagram provider, backed by TikHub.
//
// Instagram is the odd one out. It has no public keyword-to-video search the way
// Douyin, TikTok and YouTube do, so a keyword scan runs against REELS SEARCH
// instead - the closest thing available. Results are therefore reels only, not
// every post type, and the endpoint list carries no hashtag-free text search
// beyond that.
//
// Instagram also publishes no share count and no follower count on a post, so
// those come back null and the Radar Score renormalises around them rather than
// scoring the platform down for it.
//
// NOT YET VERIFIED against a live response.

import {
  tikhubRequest, findArray, normalizeList, get, pick, str, num, firstUrl, toIso,
  RadarProviderError,
} from './tikhubClient.mjs';

const ENDPOINTS = {
  // The nearest thing to keyword video search Instagram exposes.
  reelSearch: '/api/v1/instagram/v2/search_reels',
  // $0.008/request.
  userSearch: '/api/v1/instagram/v3/search_users',
  // $0.002/request.
  userReels: '/api/v1/instagram/v2/fetch_user_reels',
};

const isMediaRow = (x) =>
  'shortcode' in x || 'code' in x || 'media' in x || ('id' in x && ('like_count' in x || 'play_count' in x));

const isUserRow = (x) => 'username' in x && ('pk' in x || 'id' in x || 'full_name' in x);

const unwrapMedia = (row) => {
  if (!row || typeof row !== 'object') return null;
  return row.media || row.node || row;
};

const captionOf = (media) =>
  str(pick(media, ['caption.text', 'caption', 'edge_media_to_caption.edges[0].node.text', 'title']));

const hashtagsFrom = (text) => {
  const out = [];
  for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= 12) break;
  }
  return out;
};

export const normalizeContent = (row) => {
  const media = unwrapMedia(row);
  if (!media || typeof media !== 'object') return null;

  // The shortcode is what a public URL is built from, so it is the useful id.
  const shortcode = str(pick(media, ['code', 'shortcode']));
  const id = shortcode || str(pick(media, ['id', 'pk']));
  if (!id) return null;

  const user = get(media, 'user') || get(media, 'owner') || {};
  const caption = captionOf(media);
  const username = str(pick(user, ['username', 'handle']));

  return {
    id,
    platform: 'instagram',
    caption,
    publishedAt: toIso(pick(media, ['taken_at', 'taken_at_timestamp', 'device_timestamp'])),

    creator: {
      id: str(pick(user, ['pk', 'id'])),
      username,
      nickname: str(pick(user, ['full_name', 'username'])),
      // Absent from a post payload; only a profile fetch carries it.
      followerCount: num(pick(user, ['follower_count', 'edge_followed_by.count'])),
      avatarUrl: firstUrl(pick(user, ['profile_pic_url', 'profile_pic_url_hd'])),
      profileUrl: username ? `https://www.instagram.com/${username}/` : null,
    },

    metrics: {
      views: num(pick(media, ['play_count', 'view_count', 'video_view_count', 'ig_play_count'])),
      likes: num(pick(media, ['like_count', 'edge_liked_by.count', 'edge_media_preview_like.count'])) ?? 0,
      comments: num(pick(media, ['comment_count', 'edge_media_to_comment.count'])) ?? 0,
      // Instagram publishes neither publicly.
      shares: 0,
      collects: null,
    },

    thumbnailUrl: firstUrl(
      pick(media, [
        'image_versions2.candidates', 'thumbnail_url', 'display_url',
        'image_versions.items', 'thumbnail_src',
      ])
    ),

    videoUrl: shortcode ? `https://www.instagram.com/reel/${shortcode}/` : `https://www.instagram.com/p/${id}/`,
    hashtags: hashtagsFrom(caption),
    duration: (() => {
      const seconds = num(pick(media, ['video_duration', 'duration']));
      return seconds === null ? null : Math.round(seconds > 1000 ? seconds / 1000 : seconds);
    })(),
    isAd: typeof media.is_paid_partnership === 'boolean' ? media.is_paid_partnership : null,
  };
};

export const normalizeCreator = (row) => {
  const u = row?.user || row;
  const username = str(pick(u, ['username', 'handle']));
  if (!username) return null;

  return {
    ref: `https://www.instagram.com/${username}/`,
    id: str(pick(u, ['pk', 'id'])),
    username,
    nickname: str(pick(u, ['full_name', 'username'])),
    followerCount: num(pick(u, ['follower_count', 'edge_followed_by.count'])),
    avatarUrl: firstUrl(pick(u, ['profile_pic_url', 'profile_pic_url_hd'])),
    profileUrl: `https://www.instagram.com/${username}/`,
  };
};

const IG_PROFILE_RE = /instagram\.com\/([A-Za-z0-9._]+)/i;

const usernameFromRef = (ref) => {
  const value = str(ref);
  if (!value) return null;

  const matched = value.match(IG_PROFILE_RE);
  // Reject the reserved paths that are not profiles.
  if (matched && !['p', 'reel', 'reels', 'explore', 'stories'].includes(matched[1].toLowerCase())) {
    return matched[1];
  }
  return /^@?[A-Za-z0-9._]{2,30}$/.test(value) ? value.replace(/^@/, '') : null;
};

export const instagramTikhubProvider = {
  id: 'instagram:tikhub',
  platform: 'instagram',
  source: 'tikhub',
  label: 'Instagram (TikHub)',
  billing: 'per-row',
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true },

  parseCreatorRef(input) {
    const username = usernameFromRef(input);
    return username ? `https://www.instagram.com/${username}/` : null;
  },

  async searchByKeyword({ query, apiKey }) {
    const json = await tikhubRequest(ENDPOINTS.reelSearch, { apiKey, query: { keyword: query } });
    const rows = normalizeList(findArray(json, isMediaRow), normalizeContent, 'instagram');
    return { rows, cursor: 0, searchId: '', hasMore: false };
  },

  async searchCreators({ query, apiKey }) {
    const json = await tikhubRequest(ENDPOINTS.userSearch, { apiKey, query: { keyword: query } });

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

  async getCreatorVideos({ ref, limit, apiKey }) {
    const username = usernameFromRef(ref);
    if (!username) {
      throw new RadarProviderError(
        'Link đối thủ không hợp lệ. Dán link dạng https://www.instagram.com/ten-tai-khoan/ .',
        { status: 400 }
      );
    }

    const json = await tikhubRequest(ENDPOINTS.userReels, {
      apiKey,
      query: { username, count: Math.min(Math.max(limit, 1), 20) },
    });

    return normalizeList(findArray(json, isMediaRow), normalizeContent, 'instagram');
  },
};
