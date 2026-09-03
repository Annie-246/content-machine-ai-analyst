// YouTube provider, backed by Google's own Data API v3.
//
// The only provider here that costs no money: a Google API key gets 10,000
// quota units a day for free. Quota is the constraint instead, and the calls are
// priced very unevenly:
//
//   search.list    100 units   <- the expensive one
//   videos.list      1 unit    <- statistics live here, NOT in search results
//   channels.list    1 unit    <- subscriber counts live here
//
// So one keyword scan costs ~102 units, and the free daily quota is about 98
// scans. Worth knowing: search.list is 100x the cost of everything else, which
// is why nothing here searches twice.
//
// YouTube is also the one platform that reports a real view count, so this is
// the provider that fills metrics.views.
//
// NOT YET VERIFIED against a live response - it needs a Google API key, which
// only the user has. The shapes follow Google's documented schema.

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 30_000;

// search.list caps at 50 per call and the Radar's own limit is 50, so one call
// always covers it.
const MAX_RESULTS = 50;

const SORT_MAP = { recommended: 'relevance', engagement: 'viewCount', latest: 'date' };

class RadarProviderError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'RadarProviderError';
    this.status = status;
  }
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const str = (v) => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
};

/** ISO 8601 duration (PT1M30S) -> seconds. */
const parseDuration = (value) => {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(value || '');
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x === undefined ? 0 : Number(x)));
  const total = d * 86400 + h * 3600 + min * 60 + s;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
};

const requireKey = (apiKey) => {
  const key = (apiKey || '').trim() || (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) {
    throw new RadarProviderError(
      'Chưa có API key YouTube. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key Google API.',
      { status: 400 }
    );
  }
  return key;
};

const explainStatus = (status, json) => {
  const reason = json?.error?.errors?.[0]?.reason || '';
  const message = json?.error?.message || '';

  if (reason === 'quotaExceeded' || /quota/i.test(message)) {
    return 'Hết hạn ngạch YouTube API hôm nay (10.000 đơn vị/ngày). Quota reset theo giờ Thái Bình Dương, hoặc dùng project Google khác.';
  }
  if (status === 400 && /API key not valid/i.test(message)) {
    return 'API key YouTube không hợp lệ. Kiểm tra lại ở mục Tích hợp, phần Nguồn dữ liệu.';
  }
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message)) {
    return 'YouTube Data API v3 chưa được bật cho project này. Bật nó trong Google Cloud Console rồi thử lại.';
  }
  if (status === 403) return 'Google từ chối yêu cầu YouTube. Kiểm tra key và giới hạn của nó (HTTP referrer / IP).';
  return message ? `YouTube báo lỗi: ${message}`.slice(0, 250) : `YouTube trả về lỗi ${status}.`;
};

const request = async (path, params, apiKey) => {
  const key = requireKey(apiKey);
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* handled below */ }

    if (!res.ok) throw new RadarProviderError(explainStatus(res.status, json), { status: 502 });
    return json || {};
  } catch (err) {
    if (err instanceof RadarProviderError) throw err;
    if (err.name === 'AbortError') {
      throw new RadarProviderError('Quá thời gian chờ khi gọi YouTube. Thử lại sau ít phút.', { status: 504 });
    }
    throw new RadarProviderError('Không kết nối được tới YouTube. Kiểm tra kết nối mạng của máy chủ.', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};

/** Hashtags are not a field on YouTube; they live inline in the description. */
const hashtagsFrom = (text) => {
  const out = [];
  for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1];
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
};

const bestThumbnail = (thumbnails) =>
  thumbnails?.maxres?.url || thumbnails?.standard?.url || thumbnails?.high?.url ||
  thumbnails?.medium?.url || thumbnails?.default?.url || null;

/**
 * Joins the three responses into RadarContent.
 *
 * search.list gives titles and channel ids but no numbers at all; videos.list
 * carries statistics; channels.list carries subscriber counts. Merging them is
 * the whole reason this provider makes three calls instead of one.
 */
const buildContent = (video, channel) => {
  const id = str(video?.id);
  if (!id) return null;

  const snippet = video.snippet || {};
  const stats = video.statistics || {};
  const channelId = str(snippet.channelId);

  return {
    id,
    platform: 'youtube',
    caption: str(snippet.title),
    publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt).toISOString() : null,

    creator: {
      id: channelId,
      username: str(channel?.snippet?.customUrl)?.replace(/^@/, '') || null,
      nickname: str(snippet.channelTitle),
      // Hidden by the channel owner on some accounts - null, never a fake 0.
      followerCount: channel?.statistics?.hiddenSubscriberCount
        ? null
        : num(channel?.statistics?.subscriberCount),
      avatarUrl: bestThumbnail(channel?.snippet?.thumbnails),
      profileUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
    },

    metrics: {
      // The one platform that publishes a real view count.
      views: num(stats.viewCount),
      likes: num(stats.likeCount) ?? 0,
      comments: num(stats.commentCount) ?? 0,
      // YouTube exposes neither shares nor saves publicly.
      shares: 0,
      collects: null,
    },

    thumbnailUrl: bestThumbnail(snippet.thumbnails),
    videoUrl: `https://www.youtube.com/watch?v=${id}`,
    hashtags: hashtagsFrom(`${snippet.title || ''} ${snippet.description || ''}`),
    duration: parseDuration(video.contentDetails?.duration),
    isAd: null,
  };
};

/** videos.list and channels.list both take up to 50 ids in one billed unit. */
const fetchByIds = async (path, ids, part, apiKey) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();

  const found = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const json = await request(path, { part, id: unique.slice(i, i + 50).join(','), maxResults: 50 }, apiKey);
    for (const item of json.items || []) found.set(item.id, item);
  }
  return found;
};

/** search.list takes an RFC 3339 lower bound, so the window is applied upstream. */
const publishedAfterFor = (windowHours) => {
  if (windowHours === null || windowHours === undefined) return undefined;
  return new Date(Date.now() - windowHours * 3_600_000).toISOString();
};

const collectVideos = async ({ searchParams, limit, apiKey, windowHours }) => {
  const search = await request(
    'search',
    {
      part: 'snippet',
      type: 'video',
      maxResults: Math.min(Math.max(limit, 1), MAX_RESULTS),
      publishedAfter: publishedAfterFor(windowHours),
      ...searchParams,
    },
    apiKey
  );

  const videoIds = (search.items || []).map((item) => item?.id?.videoId).filter(Boolean);
  if (!videoIds.length) return [];

  const videos = await fetchByIds('videos', videoIds, 'snippet,statistics,contentDetails', apiKey);
  const channelIds = [...videos.values()].map((v) => v?.snippet?.channelId);
  const channels = await fetchByIds('channels', channelIds, 'snippet,statistics', apiKey);

  const out = [];
  // Keep search's own ordering: it is what the chosen sort asked for.
  for (const id of videoIds) {
    const video = videos.get(id);
    if (!video) continue;
    try {
      const item = buildContent(video, channels.get(video.snippet?.channelId));
      if (item) out.push(item);
    } catch (err) {
      console.error('[radar] youtube: bỏ qua item không đọc được:', err.message);
    }
  }
  return out;
};

const CHANNEL_URL_RE = /youtube\.com\/(?:channel\/(UC[\w-]{20,})|@([\w.-]+))/i;

export const youtubeProvider = {
  id: 'youtube:google',
  platform: 'youtube',
  source: 'google',
  label: 'YouTube (Google API)',
  // Free, and search.list already takes maxResults, so one call covers the limit.
  billing: 'per-row',
  // `creatorKeyword` says the provider filters a creator's videos upstream, so
  // the service must not filter the rows again locally: search.list matches the
  // description and tags too, and a caption-only re-filter would throw away
  // rows YouTube was right to return.
  capabilities: { searchByKeyword: true, searchCreators: true, getCreatorVideos: true, creatorKeyword: true },

  parseCreatorRef(input) {
    const value = str(input);
    if (!value) return null;

    const matched = value.match(CHANNEL_URL_RE);
    if (matched) return matched[1] ? `https://www.youtube.com/channel/${matched[1]}` : `https://www.youtube.com/@${matched[2]}`;
    if (/^UC[\w-]{20,}$/.test(value)) return `https://www.youtube.com/channel/${value}`;
    return null;
  },

  async searchByKeyword({ query, limit, sort, windowId, apiKey, windowHours }) {
    const rows = await collectVideos({
      searchParams: { q: query, order: SORT_MAP[sort] || 'relevance' },
      limit,
      apiKey,
      windowHours,
    });
    return { rows, cursor: 0, searchId: '', hasMore: false };
  },

  async searchCreators({ query, apiKey }) {
    const search = await request('search', { part: 'snippet', type: 'channel', q: query, maxResults: 10 }, apiKey);

    const ids = (search.items || []).map((item) => item?.id?.channelId).filter(Boolean);
    const channels = await fetchByIds('channels', ids, 'snippet,statistics', apiKey);

    return ids.map((id) => {
      const channel = channels.get(id);
      const snippet = channel?.snippet || {};
      return {
        ref: `https://www.youtube.com/channel/${id}`,
        id,
        username: str(snippet.customUrl)?.replace(/^@/, '') || null,
        nickname: str(snippet.title),
        followerCount: channel?.statistics?.hiddenSubscriberCount ? null : num(channel?.statistics?.subscriberCount),
        avatarUrl: bestThumbnail(snippet.thumbnails),
        profileUrl: `https://www.youtube.com/channel/${id}`,
      };
    });
  },

  async getCreatorVideos({ ref, limit, apiKey, windowHours, query = '' }) {
    const matched = str(ref)?.match(CHANNEL_URL_RE);
    const channelId = matched?.[1];

    if (!channelId) {
      throw new RadarProviderError(
        'Link kênh YouTube không hợp lệ. Dán link dạng youtube.com/channel/UC... , hoặc tìm theo tên rồi chọn từ danh sách.',
        { status: 400 }
      );
    }

    const keyword = str(query);

    return collectVideos({
      // search.list takes channelId and q together, so a keyword costs the same
      // one call and searches the channel's whole back catalogue rather than
      // just the page we could have downloaded.
      searchParams: {
        channelId,
        order: keyword ? 'relevance' : 'date',
        ...(keyword ? { q: keyword } : {}),
      },
      limit,
      apiKey,
      windowHours,
    });
  },
};

export { RadarProviderError as YouTubeProviderError };
