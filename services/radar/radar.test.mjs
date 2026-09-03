// Content Radar pure-logic tests.
//
// Uses node's built-in test runner so verifying this logic costs no new
// dependency: `npm run test:radar`.
//
// No network. The provider is represented by a captured Apify row, so these
// tests can never spend Apify credit.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRadarScore, computeSignals, engagementVolume, withRadarScore } from './ranking.mjs';
import { filterByTimeWindow } from './timeWindow.mjs';
import { sortRadarContent } from './sorting.mjs';
import { aggregateCreators } from './aggregation.mjs';
import {
  RESULT_LIMITS, MAX_RESULT_LIMIT, MIN_RESULT_LIMIT, DEFAULT_RESULT_LIMIT,
  MAX_KEYWORDS, MAX_PAGES_PER_KEYWORD, TIME_WINDOWS, getTimeWindow, clampLimit, pagesNeeded, recencyHalfLife,
  SUGGESTION_TIERS,
} from './constants.mjs';
import {
  normalizeContent, normalizeContentList, creatorCandidatesFrom, douyinApifyProvider, detectProviderNotice,
} from '../../server/radar/providers/douyinApify.mjs';
import { searchByKeyword, searchCreators, getCreatorVideos } from '../../server/radar/radarService.mjs';
import { parseJsonArray, acceptSuggestions } from '../../server/radar/suggest.mjs';
import { isModelUnavailable, isQuotaOrOverload, RADAR_TEXT_MODEL_CHAIN } from '../../server/radar/llm.mjs';
import {
  EXPORT_COLUMNS, toExportRow, buildExportTable, buildCsv, csvCell, exportFilename,
} from './exportRows.mjs';
import { getProvidersForPlatform, getProviderBySource } from '../../server/radar/providers/index.mjs';
import {
  countMissingViews, countUndated, filterByKeyword, filterByThresholds, keywordTokens,
  matchesKeyword, normalizeText, requiredMatches,
} from './relevance.mjs';
import { CREATOR_KEYWORD_MAX_PAGES, CREATOR_KEYWORD_SCAN_LIMIT, CREATOR_SCAN_MODES } from './constants.mjs';
import { normalizeContent as normalizeTikhubContent } from '../../server/radar/providers/tikhubDouyin.mjs';

const NOW = Date.parse('2026-09-01T00:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

const content = (over = {}) => ({
  id: 'x',
  platform: 'douyin',
  caption: null,
  publishedAt: hoursAgo(12),
  creator: { id: 'c', username: null, nickname: null, followerCount: 1000, avatarUrl: null, profileUrl: null },
  metrics: { likes: 0, comments: 0, shares: 0, collects: null },
  thumbnailUrl: null,
  videoUrl: 'https://www.douyin.com/video/x',
  hashtags: [],
  duration: null,
  isAd: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Radar Score

test('creator nhỏ bùng nổ phải xếp trên creator lớn có tương tác tuyệt đối cao hơn', () => {
  // The two real rows the spike captured, same age so only the signal differs.
  const small = content({
    id: 'small',
    creator: { ...content().creator, id: 'small', followerCount: 1_821 },
    metrics: { likes: 8_862, comments: 309, shares: 1_685, collects: null },
  });
  const huge = content({
    id: 'huge',
    creator: { ...content().creator, id: 'huge', followerCount: 14_866_420 },
    metrics: { likes: 6_815, comments: 281, shares: 92, collects: null },
  });

  const smallScore = computeRadarScore(small, NOW);
  const hugeScore = computeRadarScore(huge, NOW);

  assert.ok(smallScore > hugeScore, `small ${smallScore} phải > huge ${hugeScore}`);
  // "Rõ rệt", not a rounding accident.
  assert.ok(smallScore - hugeScore > 20, `khoảng cách quá nhỏ: ${smallScore} vs ${hugeScore}`);
});

test('radarScore luôn nằm trong 0-100', () => {
  const absurd = content({
    creator: { ...content().creator, followerCount: 1 },
    metrics: { likes: 50_000_000, comments: 9_000_000, shares: 9_000_000, collects: 9_000_000 },
    publishedAt: hoursAgo(0),
  });
  const empty = content({ metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }, publishedAt: hoursAgo(10_000) });

  for (const item of [absurd, empty]) {
    const score = computeRadarScore(item, NOW);
    assert.ok(score >= 0 && score <= 100, `score ngoài khoảng: ${score}`);
  }
});

test('follower = 0 không tạo ra Infinity hay NaN', () => {
  const item = content({
    creator: { ...content().creator, followerCount: 0 },
    metrics: { likes: 500, comments: 5, shares: 10, collects: null },
  });
  const score = computeRadarScore(item, NOW);
  assert.ok(Number.isFinite(score), `score không hữu hạn: ${score}`);

  const signals = computeSignals(item.metrics, 0);
  assert.equal(signals.likeFollowerRatio, 500);
});

test('half-life co giãn theo cửa sổ, và không giới hạn thì bỏ hẳn recency', () => {
  assert.equal(recencyHalfLife(24), 6, '24h -> 6h');
  assert.equal(recencyHalfLife(24 * 7), 42, '7 ngày -> 42h');
  assert.equal(recencyHalfLife(24 * 90), 540, '90 ngày -> 540h');
  assert.equal(recencyHalfLife(null), null, 'không giới hạn -> không chấm recency');
});

test('không giới hạn: video cũ không bị recency dìm điểm', () => {
  // A 155-day-old video scores 0.000000 on a fixed 72h half-life, so recency
  // stops ranking anything and only deflates every score by its weight.
  const old = content({
    publishedAt: hoursAgo(24 * 155),
    creator: { ...content().creator, followerCount: 50_000 },
    metrics: { likes: 9_345, comments: 200, shares: 300, collects: 400 },
  });

  const withRecency = computeRadarScore(old, NOW);
  const withoutRecency = computeRadarScore(old, NOW, null);

  assert.ok(withoutRecency > withRecency, `bỏ recency (${withoutRecency}) phải cao hơn (${withRecency})`);

  // Ranking between two old videos must not depend on which is marginally less
  // ancient once the window is unlimited.
  const older = content({
    publishedAt: hoursAgo(24 * 900),
    creator: { ...content().creator, followerCount: 50_000 },
    metrics: { likes: 9_345, comments: 200, shares: 300, collects: 400 },
  });
  assert.equal(computeRadarScore(older, NOW, null), withoutRecency, 'cùng chỉ số thì cùng điểm');
});

test('trong một cửa sổ có giới hạn, recency vẫn phân biệt được', () => {
  const halfLife = recencyHalfLife(24 * 28);
  const base = { creator: { ...content().creator, followerCount: 1_000 }, metrics: { likes: 500, comments: 10, shares: 20, collects: 5 } };

  const day1 = computeRadarScore(content({ ...base, publishedAt: hoursAgo(24) }), NOW, halfLife);
  const day20 = computeRadarScore(content({ ...base, publishedAt: hoursAgo(24 * 20) }), NOW, halfLife);

  assert.ok(day1 > day20, `mới hơn phải cao hơn: ${day1} vs ${day20}`);
  // The old fixed half-life flattened both to the same near-zero recency.
  assert.ok(day1 - day20 > 1, 'khoảng cách phải thấy được, không bị bẹp về 0');
});

test('nội dung mới hơn ghi điểm recency cao hơn khi mọi thứ khác bằng nhau', () => {
  const base = { metrics: { likes: 1_000, comments: 50, shares: 100, collects: 20 } };
  const fresh = computeRadarScore(content({ ...base, publishedAt: hoursAgo(2) }), NOW);
  const old = computeRadarScore(content({ ...base, publishedAt: hoursAgo(300) }), NOW);
  assert.ok(fresh > old, `fresh ${fresh} phải > old ${old}`);
});

test('thiếu collects không kéo điểm xuống so với collects = 0', () => {
  const base = { metrics: { likes: 1_000, comments: 50, shares: 100 } };
  const missing = computeRadarScore(content({ metrics: { ...base.metrics, collects: null } }), NOW);
  const zero = computeRadarScore(content({ metrics: { ...base.metrics, collects: 0 } }), NOW);
  assert.ok(missing > zero, `bỏ trống (${missing}) phải không bị phạt như 0 (${zero})`);
});

test('withRadarScore gắn cả score lẫn signals', () => {
  const scored = withRadarScore(
    content({ creator: { ...content().creator, followerCount: 100 }, metrics: { likes: 50, comments: 1, shares: 10, collects: 2 } }),
    NOW
  );
  assert.equal(typeof scored.radarScore, 'number');
  assert.equal(scored.radarSignals.likeFollowerRatio, 0.5);
  assert.equal(scored.radarSignals.shareFollowerRatio, 0.1);
});

// ---------------------------------------------------------------------------
// Time filtering

test('lọc thời gian giữ đúng khoảng đã chọn', () => {
  const items = [
    content({ id: 'a', publishedAt: hoursAgo(2) }),
    content({ id: 'b', publishedAt: hoursAgo(30) }),
    content({ id: 'c', publishedAt: hoursAgo(100) }),
    content({ id: 'd', publishedAt: hoursAgo(500) }),
  ];

  assert.deepEqual(filterByTimeWindow(items, '24h', NOW).map((i) => i.id), ['a']);
  assert.deepEqual(filterByTimeWindow(items, '72h', NOW).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(filterByTimeWindow(items, '7d', NOW).map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(filterByTimeWindow(items, '28d', NOW).map((i) => i.id), ['a', 'b', 'c', 'd']);
});

test('lọc thời gian loại bỏ item không có ngày đăng hợp lệ', () => {
  const items = [
    content({ id: 'ok', publishedAt: hoursAgo(1) }),
    content({ id: 'null', publishedAt: null }),
    content({ id: 'rác', publishedAt: 'không phải ngày' }),
  ];
  assert.deepEqual(filterByTimeWindow(items, '24h', NOW).map((i) => i.id), ['ok']);
});

test('lọc thời gian trả ít hơn limit chứ không đi lấy bù', () => {
  // 20 rows fetched, only 3 inside the window - the result is 3.
  const items = Array.from({ length: 20 }, (_, i) =>
    content({ id: `v${i}`, publishedAt: hoursAgo(i < 3 ? 5 : 400) })
  );
  assert.equal(filterByTimeWindow(items, '24h', NOW).length, 3);
});

// ---------------------------------------------------------------------------
// Sorting

test('mỗi kiểu sort xếp đúng thứ tự của nó', () => {
  const a = { ...content({ id: 'a', publishedAt: hoursAgo(1) }), radarScore: 10, metrics: { likes: 900, comments: 0, shares: 0, collects: 0 } };
  const b = { ...content({ id: 'b', publishedAt: hoursAgo(50) }), radarScore: 90, metrics: { likes: 100, comments: 0, shares: 0, collects: 0 } };
  const c = { ...content({ id: 'c', publishedAt: hoursAgo(20) }), radarScore: 50, metrics: { likes: 500, comments: 0, shares: 0, collects: 0 } };
  const items = [a, b, c];

  assert.deepEqual(sortRadarContent(items, 'recommended').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortRadarContent(items, 'engagement').map((i) => i.id), ['a', 'c', 'b']);
  assert.deepEqual(sortRadarContent(items, 'latest').map((i) => i.id), ['a', 'c', 'b']);
});

test('sort không làm thay đổi mảng gốc', () => {
  const items = [
    { ...content({ id: 'a' }), radarScore: 1 },
    { ...content({ id: 'b' }), radarScore: 2 },
  ];
  sortRadarContent(items, 'recommended');
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
});

test('engagement đánh giá share và collect cao hơn like', () => {
  const liker = content({ metrics: { likes: 100, comments: 0, shares: 0, collects: 0 } });
  const sharer = content({ metrics: { likes: 0, comments: 0, shares: 100, collects: 0 } });
  assert.ok(engagementVolume(sharer) > engagementVolume(liker));
});

// ---------------------------------------------------------------------------
// Creator aggregation

test('gộp creator từ đúng dataset đang có', () => {
  const items = [
    { ...content({ id: '1', creator: { ...content().creator, id: 'u1', nickname: 'Một', followerCount: 100 }, metrics: { likes: 100, comments: 0, shares: 10, collects: null } }), radarScore: 40 },
    { ...content({ id: '2', creator: { ...content().creator, id: 'u1', nickname: 'Một', followerCount: 100 }, metrics: { likes: 300, comments: 0, shares: 30, collects: null } }), radarScore: 80 },
    { ...content({ id: '3', creator: { ...content().creator, id: 'u2', nickname: 'Hai', followerCount: 500 }, metrics: { likes: 50, comments: 0, shares: 5, collects: null } }), radarScore: 60 },
  ];

  const creators = aggregateCreators(items);
  assert.equal(creators.length, 2);

  // Sorted by best Radar Score.
  assert.equal(creators[0].id, 'u1');
  assert.equal(creators[0].contentCount, 2);
  assert.equal(creators[0].averageLikes, 200);
  assert.equal(creators[0].totalShares, 40);
  assert.equal(creators[0].bestRadarScore, 80);
  assert.equal(creators[0].bestContent.id, '2');

  assert.equal(creators[1].id, 'u2');
  assert.equal(creators[1].contentCount, 1);
});

test('creator không định danh được thì bỏ qua thay vì gộp nhầm', () => {
  const items = [
    { ...content({ id: '1', creator: { id: null, username: null, nickname: null, followerCount: null, avatarUrl: null, profileUrl: null } }), radarScore: 10 },
  ];
  assert.equal(aggregateCreators(items).length, 0);
});

// ---------------------------------------------------------------------------
// Normalization (real Apify row shape, captured during the spike)

const APIFY_ROW = {
  id: '7680136868909878564',
  url: 'https://www.douyin.com/video/7680136868909878564',
  shareUrl: 'https://www.iesdouyin.com/share/video/7680136868909878564/?region=US&tracking=1',
  text: '#大有学问 #红衣聊AI #芯片',
  createTime: 1788171217,
  authorMeta: {
    id: '4094221637911976',
    secUid: 'MS4wLjABAAAAJ3T5moYwIGWeicRl5wBdfosV7R_dCmIbcmAIVZ_3iLK3aLLrOq9pWQDaZBfU0kpQ',
    name: '红衣大叔周鸿祎',
    customUsername: 'hydszhy',
    followersCount: 14866420,
    avatarMedium: 'https://p3.douyinpic.com/aweme/720x720/avatar.jpeg',
  },
  videoMeta: {
    duration: 206680,
    cover: 'https://p3-sign.douyinpic.com/tos-cn-i-dy/cover.heic',
    playUrl: 'https://v9-s.douyinvod.com/expiring-cdn-url.mp4',
    downloadUrl: 'https://v11-cold.douyinvod.com/expiring-cdn-url.mp4',
  },
  statistics: { diggCount: 6815, shareCount: 92, commentCount: 281, collectCount: 356, playCount: 0 },
  hashtags: [{ id: '1653177006320644', name: '大有学问' }, { id: '2', name: '红衣聊AI' }],
  isAd: false,
};

test('normalize map đúng field từ row Apify thật', () => {
  const item = normalizeContent(APIFY_ROW);

  assert.equal(item.id, '7680136868909878564');
  assert.equal(item.platform, 'douyin');
  assert.equal(item.caption, '#大有学问 #红衣聊AI #芯片');
  assert.equal(item.publishedAt, new Date(1788171217 * 1000).toISOString());

  assert.equal(item.creator.id, '4094221637911976');
  assert.equal(item.creator.username, 'hydszhy');
  assert.equal(item.creator.nickname, '红衣大叔周鸿祎');
  assert.equal(item.creator.followerCount, 14866420);
  assert.equal(item.creator.profileUrl, `https://www.douyin.com/user/${APIFY_ROW.authorMeta.secUid}`);

  assert.equal(item.metrics.likes, 6815);
  assert.equal(item.metrics.comments, 281);
  assert.equal(item.metrics.shares, 92);
  assert.equal(item.metrics.collects, 356);

  // ms -> seconds
  assert.equal(item.duration, 207);
  assert.deepEqual(item.hashtags, ['大有学问', '红衣聊AI']);
  assert.equal(item.isAd, false);
});

test('normalize không mang theo views và không lưu CDN URL hết hạn', () => {
  const item = normalizeContent(APIFY_ROW);

  // Present but null: Douyin publishes no usable view count, and null means
  // "unknown" so the UI renders nothing rather than a fake 0.
  assert.equal(item.metrics.views, null);
  // Canonical page URL, not the tracking share link and not the expiring CDN file.
  assert.equal(item.videoUrl, 'https://www.douyin.com/video/7680136868909878564');
  assert.ok(!JSON.stringify(item).includes('douyinvod.com'));
});

test('thumbnail ưu tiên bản webp vì bản .heic không render được trên Chrome', () => {
  const withBoth = {
    ...APIFY_ROW,
    videoMeta: {
      ...APIFY_ROW.videoMeta,
      cover: 'https://p3-sign.douyinpic.com/cover.heic',
      dynamicCover: 'https://p3-sign.douyinpic.com/dynamic-webp',
    },
  };
  assert.equal(normalizeContent(withBoth).thumbnailUrl, 'https://p3-sign.douyinpic.com/dynamic-webp');

  // Still better than nothing when the provider only gives us the heic one.
  const heicOnly = { ...APIFY_ROW, videoMeta: { ...APIFY_ROW.videoMeta, dynamicCover: undefined } };
  assert.equal(normalizeContent(heicOnly).thumbnailUrl, 'https://p3-sign.douyinpic.com/tos-cn-i-dy/cover.heic');
});

test('normalize dựng videoUrl từ id khi provider không trả link', () => {
  const { url, shareUrl, ...withoutUrl } = APIFY_ROW;
  assert.equal(normalizeContent(withoutUrl).videoUrl, 'https://www.douyin.com/video/7680136868909878564');
});

test('một item hỏng không làm chết cả danh sách', () => {
  const rows = [APIFY_ROW, null, {}, { id: null }, 'không phải object', { ...APIFY_ROW, id: '999' }];
  const items = normalizeContentList(rows);
  assert.deepEqual(items.map((i) => i.id), ['7680136868909878564', '999']);
});

test('field thiếu trả về null chứ không phải dữ liệu bịa', () => {
  const item = normalizeContent({ id: '1' });
  assert.equal(item.caption, null);
  assert.equal(item.publishedAt, null);
  assert.equal(item.creator.followerCount, null);
  assert.equal(item.thumbnailUrl, null);
  assert.equal(item.duration, null);
  assert.deepEqual(item.hashtags, []);
  // Counts default to 0 so arithmetic stays safe; collects stays null.
  assert.equal(item.metrics.likes, 0);
  assert.equal(item.metrics.collects, null);
});

test('creator candidate được gộp không trùng lặp', () => {
  const items = normalizeContentList([APIFY_ROW, { ...APIFY_ROW, id: '2' }]);
  const candidates = creatorCandidatesFrom(items);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].nickname, '红衣大叔周鸿祎');
  assert.ok(candidates[0].ref.startsWith('https://www.douyin.com/user/'));
});

// ---------------------------------------------------------------------------
// Provider refusals disguised as data
//
// The real payload that made a scan silently report "no content in this time
// window" when the actor had actually run out of free runs.

test('thông báo hết lượt của actor được nhận ra, không bị coi là 0 kết quả', () => {
  const notice = detectProviderNotice([
    {
      limit_reached: true,
      message: 'You have used all 3 free runs. Upgrade to a paying plan to continue.',
      free_runs_used: 3,
      free_runs_limit: 3,
    },
  ]);

  assert.ok(notice, 'phải phát hiện được thông báo giới hạn');
  assert.match(notice, /hết lượt chạy miễn phí/);
  assert.match(notice, /3\/3/);
});

test('row thông báo lỗi chung cũng được nhận ra', () => {
  const notice = detectProviderNotice([{ error: 'Rate limited, try again later' }]);
  assert.match(notice, /Rate limited/);
});

test('dataset video thật không bị nhầm thành thông báo lỗi', () => {
  assert.equal(detectProviderNotice([APIFY_ROW]), null);
  assert.equal(detectProviderNotice([]), null);
  // An empty result set is a genuine "nothing matched", handled elsewhere.
  assert.equal(detectProviderNotice([{}]), null);
});

// ---------------------------------------------------------------------------
// Competitor input handling
//
// searchCreators resolves a pasted URL without touching the network, so these
// stay free to run.

test('link trang cá nhân Douyin được nhận thẳng, không cần tìm kiếm', async () => {
  const url = `https://www.douyin.com/user/${APIFY_ROW.authorMeta.secUid}`;
  // 110 characters - an early length cap of 100 silently broke this whole flow.
  assert.ok(url.length > 100);

  const found = await searchCreators({ platform: 'douyin', query: url });
  assert.equal(found.resolved, true);
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].ref, url);
});

test('secUid trần cũng được nhận, và tên thường thì không', async () => {
  const found = await searchCreators({ platform: 'douyin', query: APIFY_ROW.authorMeta.secUid });
  assert.equal(found.resolved, true);
  assert.ok(found.candidates[0].ref.startsWith('https://www.douyin.com/user/'));

  // A plain name is not a ref - it has to go through a creator search first.
  assert.equal(douyinApifyProvider.parseCreatorRef('红衣大叔周鸿祎'), null);
});

test('input đối thủ rỗng bị chặn trước khi tốn một actor run', async () => {
  await assert.rejects(() => searchCreators({ platform: 'douyin', query: '  ' }), /Chưa nhập/);
  await assert.rejects(
    () => getCreatorVideos({ platform: 'douyin', ref: '', timeWindow: '7d', limit: 10 }),
    /Chưa nhập/
  );
});

// ---------------------------------------------------------------------------
// Data-source key

const CREATOR_REF = 'https://www.douyin.com/user/MS4wLjABAAAA' + 'x'.repeat(30);

test('không có key của nguồn nào thì báo lỗi thay vì âm thầm quét', async () => {
  await assert.rejects(
    () => searchByKeyword({ platform: 'douyin', query: '人工智能', timeWindow: '7d', limit: 10, dataKeys: {} }),
    /Chưa có API key cho nguồn dữ liệu nào/
  );
  // A missing key beats a cache hit: the user must be told to configure one.
  await assert.rejects(
    () => getCreatorVideos({ platform: 'douyin', ref: CREATOR_REF, timeWindow: '7d', limit: 10, dataKeys: {} }),
    /Chưa có API key cho nguồn dữ liệu nào/
  );
});

test('ghim một nguồn nhưng thiếu key của chính nguồn đó thì báo đúng tên nguồn', async () => {
  await assert.rejects(
    () => searchByKeyword({
      platform: 'douyin', query: '人工智能', timeWindow: '7d', limit: 10,
      source: 'tikhub', dataKeys: { apify: 'có-key-apify-nhưng-đã-ghim-tikhub' },
    }),
    /Chưa có API key cho nguồn Douyin \(TikHub\)/
  );
});

test('ghim nguồn không phục vụ nền tảng thì bị chặn', async () => {
  await assert.rejects(
    () => searchByKeyword({
      platform: 'douyin', query: '人工智能', timeWindow: '7d', limit: 10,
      source: 'không-có-thật', dataKeys: { apify: 'k' },
    }),
    /không phục vụ nền tảng này/
  );
});

test('lỗi thiếu input được báo trước lỗi thiếu key', async () => {
  // Both are wrong; the blank field is the more actionable message.
  await assert.rejects(
    () => searchByKeyword({ platform: 'douyin', query: '', timeWindow: '7d', limit: 10, dataKeys: {} }),
    /Chưa nhập từ khoá/
  );
});

test('dán link đối thủ thì không cần key và không tốn gì', async () => {
  // Resolving a URL is pure string work, so it must not require a data source.
  const found = await searchCreators({ platform: 'douyin', query: CREATOR_REF, dataKeys: {} });
  assert.equal(found.resolved, true);
  assert.equal(found.candidates[0].ref, CREATOR_REF);
});

test('đăng ký provider: Douyin có hai nguồn, TikHub đứng trước vì rẻ hơn', () => {
  const list = getProvidersForPlatform('douyin');
  assert.deepEqual(list.map((p) => p.source), ['tikhub', 'apify']);
  assert.equal(getProvidersForPlatform('khong-co-that').length, 0);

  // Both must satisfy the same contract, or the layers above would need to care
  // which one answered.
  for (const provider of list) {
    assert.equal(provider.platform, 'douyin');
    assert.equal(typeof provider.searchByKeyword, 'function');
    assert.equal(typeof provider.searchCreators, 'function');
    assert.equal(typeof provider.getCreatorVideos, 'function');
    assert.equal(typeof provider.parseCreatorRef, 'function');
  }
});

test('provider TikHub map đúng shape aweme gốc của Douyin', () => {
  // Not yet verified against a live TikHub response - this pins the mapping we
  // wrote against Douyin's own schema so a future fix is a visible diff.
  const item = normalizeTikhubContent({
    aweme_info: {
      aweme_id: '123',
      desc: 'thử nghiệm',
      create_time: 1788171217,
      author: {
        uid: '9', sec_uid: 'MS4wLjABAAAAtest', unique_id: 'handle', nickname: 'Tên',
        follower_count: 1234, avatar_medium: { url_list: ['https://p3.douyinpic.com/a.jpg'] },
      },
      statistics: { digg_count: 10, comment_count: 2, share_count: 3, collect_count: 4, play_count: 0 },
      video: { duration: 15000, dynamic_cover: { url_list: ['https://p3.douyinpic.com/c.webp'] } },
      text_extra: [{ hashtag_name: 'ai' }],
      share_url: 'https://www.iesdouyin.com/share/video/123/?tracking=1',
    },
  });

  assert.equal(item.id, '123');
  assert.equal(item.creator.nickname, 'Tên');
  assert.equal(item.creator.followerCount, 1234);
  assert.equal(item.creator.profileUrl, 'https://www.douyin.com/user/MS4wLjABAAAAtest');
  assert.equal(item.metrics.likes, 10);
  assert.equal(item.metrics.collects, 4);
  assert.equal(item.metrics.views, null, 'play_count = 0 phải thành null, không phải 0');
  assert.equal(item.duration, 15);
  assert.equal(item.thumbnailUrl, 'https://p3.douyinpic.com/c.webp');
  assert.deepEqual(item.hashtags, ['ai']);
});

// ---------------------------------------------------------------------------
// Keyword suggestions
//
// The LLM call itself is not exercised here; what is tested is everything that
// decides whether a model's answer becomes a chip the user can click.

test('model bị gỡ khỏi tài khoản được coi là đáng thử model khác', () => {
  // The exact failure seen in the app: Google retired gemini-2.5-flash for new
  // accounts and answers 404. That is not a quota error, so a chain that only
  // retried on quota gave up on the first model and the button just failed.
  const retired = {
    status: 404,
    message: '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash"}}',
  };

  assert.equal(isModelUnavailable(retired), true);
  assert.equal(isQuotaOrOverload(retired), false, 'không được nhận nhầm thành lỗi quota');

  // Both conditions must move the chain forward.
  assert.equal(isQuotaOrOverload({ status: 429, message: 'RESOURCE_EXHAUSTED' }), true);
  assert.equal(isModelUnavailable({ status: 503, message: 'overloaded' }), false);
});

test('chuỗi model đặt bản còn phát hành lên trước', () => {
  // gemini-2.5-flash is no longer issued to new accounts, so it must never be
  // the first thing a fresh key tries.
  assert.notEqual(RADAR_TEXT_MODEL_CHAIN[0], 'gemini-2.5-flash');
  assert.ok(RADAR_TEXT_MODEL_CHAIN.length > 1, 'phải có model dự phòng');
});

test('đọc được JSON dù model bọc trong code fence hoặc nói thêm', () => {
  const plain = '[{"keyword":"AI营销","note":"AI marketing"}]';
  const fenced = '```json\n' + plain + '\n```';
  const chatty = 'Đây là gợi ý:\n' + plain + '\nHy vọng giúp được bạn.';

  for (const text of [plain, fenced, chatty]) {
    const rows = parseJsonArray(text);
    assert.equal(rows?.[0]?.keyword, 'AI营销', `không parse được: ${text.slice(0, 30)}`);
  }

  assert.equal(parseJsonArray('không phải json'), null);
  assert.equal(parseJsonArray(''), null);
});

test('Douyin: chỉ nhận từ khoá tiếng Trung', () => {
  const accepted = acceptSuggestions([
    { keyword: 'AI营销', tier: 'chinh', note: 'AI marketing' },
    { keyword: '#电商', tier: 'chinh', note: 'Thương mại điện tử' },  // bỏ dấu # ở đầu
    { keyword: 'AI营销', tier: 'phu', note: 'trùng' },                // loại trùng
    { keyword: 'digital marketing', tier: 'phu', note: 'không CJK' }, // Douyin cần tiếng Trung
    { keyword: '', note: 'rỗng' },
    null,
    'không phải object',
  ], { platform: 'douyin', topic: 'marketing' });

  assert.deepEqual(accepted.map((s) => s.keyword), ['AI营销', '电商']);
  assert.equal(accepted[0].note, 'AI marketing');
});

test('YouTube: loại bỏ từ khoá tiếng Trung khi người dùng gõ tiếng Anh', () => {
  // The exact bug reported: searching YouTube for "chatgpt work" answered with
  // Chinese keywords, because both the prompt and this validator assumed Douyin.
  const accepted = acceptSuggestions([
    { keyword: 'chatgpt for work', tier: 'chinh' },
    { keyword: 'AI办公', tier: 'phu' },
    { keyword: 'chatgpt productivity', tier: 'phu' },
  ], { platform: 'youtube', topic: 'chatgpt work' });

  assert.deepEqual(accepted.map((s) => s.keyword), ['chatgpt for work', 'chatgpt productivity']);
});

test('gõ tiếng Trung trên YouTube thì vẫn nhận từ khoá tiếng Trung', () => {
  const accepted = acceptSuggestions(
    [{ keyword: '人工智能教程', tier: 'chinh' }],
    { platform: 'youtube', topic: '人工智能' }
  );
  assert.equal(accepted.length, 1, 'người dùng gõ tiếng Trung thì tiếng Trung là hợp lệ');
});

test('không lặp lại chính từ khoá người dùng vừa gõ', () => {
  const accepted = acceptSuggestions(
    [{ keyword: 'chatgpt work', tier: 'chinh' }, { keyword: 'chatgpt tips', tier: 'phu' }],
    { platform: 'youtube', topic: 'ChatGPT Work' }
  );
  assert.deepEqual(accepted.map((s) => s.keyword), ['chatgpt tips']);
});

test('gợi ý được nhóm theo tầng và mỗi tầng có trần riêng', () => {
  const many = [
    ...Array.from({ length: 6 }, (_, i) => ({ keyword: 'broad ' + i, tier: 'chinh' })),
    ...Array.from({ length: 6 }, (_, i) => ({ keyword: 'niche ' + i, tier: 'phu' })),
    ...Array.from({ length: 6 }, (_, i) => ({ keyword: 'angle ' + i, tier: 'mo-rong' })),
  ];
  const accepted = acceptSuggestions(many, { platform: 'youtube', topic: 'x' });

  const count = (tier) => accepted.filter((s) => s.tier === tier).length;
  for (const tier of SUGGESTION_TIERS) {
    assert.ok(count(tier.id) <= tier.max, tier.id + ' vượt trần ' + tier.max);
    assert.ok(count(tier.id) > 0, tier.id + ' phải có ít nhất một gợi ý');
  }

  // Grouped in tier order so the UI never has to sort.
  const order = accepted.map((s) => SUGGESTION_TIERS.findIndex((t) => t.id === s.tier));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('tier lạ được xếp vào nhóm phụ thay vì bị vứt', () => {
  const accepted = acceptSuggestions(
    [{ keyword: 'something', tier: 'khong-co-that' }],
    { platform: 'youtube', topic: 'x' }
  );
  assert.equal(accepted[0].tier, 'phu');
});

test('gợi ý không note thì note là null, không phải chuỗi rỗng', () => {
  const accepted = acceptSuggestions([{ keyword: '美妆' }]);
  assert.equal(accepted[0].note, null);
});

test('tổng số gợi ý bị chặn bởi tổng trần của các tầng', () => {
  const cap = SUGGESTION_TIERS.reduce((sum, t) => sum + t.max, 0);
  const many = Array.from({ length: 40 }, (_, i) => ({ keyword: '关键词' + i, tier: 'chinh' }));
  assert.ok(acceptSuggestions(many, { platform: 'douyin', topic: 'x' }).length <= cap);
});

// ---------------------------------------------------------------------------
// Billing shape
//
// A provider billed per request must hand back its whole page so the service
// can pick the best rows from everything already paid for. One billed per row
// has to enforce the limit in the request instead.

test('bốn nền tảng đều có provider và cùng một hợp đồng', () => {
  for (const platform of ['douyin', 'tiktok', 'youtube', 'instagram']) {
    const list = getProvidersForPlatform(platform);
    assert.ok(list.length, `${platform} phải có ít nhất một nguồn`);

    for (const provider of list) {
      assert.equal(provider.platform, platform);
      assert.ok(['per-request', 'per-row'].includes(provider.billing), `${provider.id} thiếu billing`);
      for (const fn of ['searchByKeyword', 'searchCreators', 'getCreatorVideos', 'parseCreatorRef']) {
        assert.equal(typeof provider[fn], 'function', `${provider.id} thiếu ${fn}`);
      }
    }
  }

  // YouTube is the free one, so it must not be wired to a paid source.
  assert.deepEqual(getProvidersForPlatform('youtube').map((p) => p.source), ['google']);
});

test('mỗi provider nhận đúng dạng link trang cá nhân của nền tảng mình', () => {
  const bySource = Object.fromEntries(
    ['douyin', 'tiktok', 'youtube', 'instagram'].map((p) => [p, getProvidersForPlatform(p)[0]])
  );

  assert.ok(bySource.tiktok.parseCreatorRef('https://www.tiktok.com/@charlidamelio'));
  assert.ok(bySource.youtube.parseCreatorRef('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'));
  assert.ok(bySource.instagram.parseCreatorRef('https://www.instagram.com/nasa/'));

  // A post URL is not a profile - accepting it would scan the wrong thing.
  assert.equal(bySource.instagram.parseCreatorRef('https://www.instagram.com/p/Cabc123/'), null);
  // And a platform must not claim another platform's link.
  assert.equal(bySource.youtube.parseCreatorRef('https://www.tiktok.com/@someone'), null);
});

test('mỗi provider khai báo cách tính tiền, và TikHub là per-request', () => {
  const bySource = Object.fromEntries(getProvidersForPlatform('douyin').map((p) => [p.source, p]));

  assert.equal(bySource.tikhub.billing, 'per-request');
  assert.equal(bySource.apify.billing, 'per-row');

  for (const provider of Object.values(bySource)) {
    assert.ok(['per-request', 'per-row'].includes(provider.billing), `${provider.id} thiếu billing hợp lệ`);
  }
});

test('cắt theo limit phải diễn ra SAU khi lọc thời gian, không phải trước', () => {
  // A page of 10: three are inside 24h, the rest are old. Asking for 3 must
  // return those three, not "the first three rows, then filtered down to one".
  const page = [
    content({ id: 'old1', publishedAt: hoursAgo(400) }),
    content({ id: 'old2', publishedAt: hoursAgo(400) }),
    content({ id: 'new1', publishedAt: hoursAgo(2), metrics: { likes: 10, comments: 0, shares: 0, collects: null } }),
    content({ id: 'old3', publishedAt: hoursAgo(400) }),
    content({ id: 'new2', publishedAt: hoursAgo(3), metrics: { likes: 900, comments: 0, shares: 0, collects: null } }),
    content({ id: 'new3', publishedAt: hoursAgo(4), metrics: { likes: 500, comments: 0, shares: 0, collects: null } }),
  ];

  const inWindow = filterByTimeWindow(page, '24h', NOW);
  assert.equal(inWindow.length, 3, 'lọc trước thì còn 3');

  const best = sortRadarContent(
    inWindow.map((i) => withRadarScore(i, NOW)),
    'engagement'
  ).slice(0, 3);

  assert.deepEqual(best.map((i) => i.id), ['new2', 'new3', 'new1'], 'giữ 3 video trong khung, xếp theo tương tác');

  // The old order: slice first, then filter - which is what produced two
  // low-engagement results from a page that held better ones.
  const wrong = filterByTimeWindow(page.slice(0, 3), '24h', NOW);
  assert.equal(wrong.length, 1, 'cắt trước rồi lọc thì chỉ còn 1 - đúng cái lỗi đã sửa');
});

// ---------------------------------------------------------------------------
// Export

const exportable = content({
  id: '77',
  caption: 'Bán hàng, "đỉnh cao"\nxuống dòng',
  publishedAt: hoursAgo(3),
  creator: { id: 'u', username: 'handle', nickname: 'Tên', followerCount: 1000, avatarUrl: null, profileUrl: 'https://www.douyin.com/user/abc' },
  metrics: { likes: 500, comments: 10, shares: 20, collects: null },
  hashtags: ['ai', 'marketing'],
  duration: 42,
});

test('một hàng export khớp đúng thứ tự cột', () => {
  const row = toExportRow({ ...exportable, radarScore: 61.4, radarSignals: { likeFollowerRatio: 0.5, shareFollowerRatio: 0.02 } }, 0);
  assert.equal(row.length, EXPORT_COLUMNS.length, 'số ô phải bằng số cột');

  const at = (name) => row[EXPORT_COLUMNS.indexOf(name)];
  assert.equal(at('#'), 1, 'đánh số từ 1 cho người đọc');
  assert.equal(at('Radar Score'), 61.4);
  assert.equal(at('Creator'), 'Tên');
  assert.equal(at('Username'), '@handle');
  assert.equal(at('Like'), 500);
  assert.equal(at('Lưu'), '', 'collects null phải là ô trống, không phải 0');
  assert.equal(at('Like/Follower %'), 50);
  assert.equal(at('Hashtag'), '#ai #marketing');
  assert.equal(at('Link video'), exportable.videoUrl);

  // Numbers stay numbers so a spreadsheet can sum and sort them.
  assert.equal(typeof at('Like'), 'number');
  assert.equal(typeof at('Follower'), 'number');
});

test('CSV escape đúng dấu phẩy, dấu nháy và xuống dòng', () => {
  assert.equal(csvCell('bình thường'), 'bình thường');
  assert.equal(csvCell('có, phẩy'), '"có, phẩy"');
  assert.equal(csvCell('có "nháy"'), '"có ""nháy"""');
  assert.equal(csvCell('hai\ndòng'), '"hai\ndòng"');
  assert.equal(csvCell(' thừa khoảng trắng '), '" thừa khoảng trắng "');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0', 'số 0 phải giữ, không thành rỗng');
});

test('CSV mở được bằng Excel: có BOM, CRLF, và đủ số dòng', () => {
  const csv = buildCsv([{ ...exportable, radarScore: 10, radarSignals: { likeFollowerRatio: null, shareFollowerRatio: null } }]);

  // Without the BOM, Excel reads the file as the system codepage and every
  // Chinese and Vietnamese character turns to mojibake.
  assert.ok(csv.startsWith('﻿'), 'phải bắt đầu bằng BOM UTF-8');
  assert.ok(csv.includes('\r\n'), 'phải dùng CRLF');

  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines.length, 2, 'một dòng tiêu đề, một dòng dữ liệu');
  assert.ok(lines[0].startsWith('#,Radar Score,Nền tảng,Caption'));

  // The caption holds a comma, a quote and a newline all at once - if quoting
  // were wrong the row count above would already be off.
  assert.ok(csv.includes('"Bán hàng, ""đỉnh cao""\nxuống dòng"'));
});

test('tên file export an toàn và có mốc thời gian', () => {
  const name = exportFilename('AI Marketing / 人工智能', 'csv');
  assert.match(name, /^radar-.+-\d{8}-\d{4}\.csv$/);
  assert.ok(!/[/\\:*?"<>|]/.test(name), 'không được chứa ký tự cấm trong tên file');

  // A label with nothing usable still yields a valid name.
  assert.match(exportFilename('///', 'csv'), /^radar-content-radar-\d{8}-\d{4}\.csv$/);
});

test('bảng export và CSV luôn dùng chung một bộ cột', () => {
  const table = buildExportTable([{ ...exportable, radarScore: 1, radarSignals: {} }]);
  assert.deepEqual(table.headers, EXPORT_COLUMNS);
  assert.equal(table.rows[0].length, EXPORT_COLUMNS.length);
});

// ---------------------------------------------------------------------------
// Limits

test('số kết quả tự nhập được kẹp vào khoảng, không bị đá về mặc định', () => {
  // A typed 35 must stay 35 - silently rewriting it to the default would spend
  // a different amount than the user asked for.
  assert.equal(clampLimit('35'), 35);
  assert.equal(clampLimit(7), 7);

  // Out of range clamps to the nearest end rather than resetting.
  assert.equal(clampLimit(0), MIN_RESULT_LIMIT);
  assert.equal(clampLimit(999), MAX_RESULT_LIMIT);
  assert.equal(clampLimit(-5), MIN_RESULT_LIMIT);

  // Junk falls back to the default.
  assert.equal(clampLimit(''), DEFAULT_RESULT_LIMIT);
  assert.equal(clampLimit('abc'), DEFAULT_RESULT_LIMIT);

  assert.equal(clampLimit('12.9'), 12, 'phải cắt phần thập phân, không làm tròn lên');
});

test('nhiều từ khoá: bỏ trống, bỏ trùng, chặn khi vượt trần', async () => {
  const run = (body) => searchByKeyword({ platform: 'douyin', timeWindow: '7d', limit: 10, dataKeys: {}, ...body });

  // No key configured, so validation is what we are reading here - the error
  // tells us which check fired first.
  await assert.rejects(() => run({ queries: ['  ', ''] }), /Chưa nhập từ khoá/);
  await assert.rejects(() => run({ queries: [] }), /Chưa nhập từ khoá/);

  const tooMany = Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `kw${i}`);
  await assert.rejects(() => run({ queries: tooMany }), new RegExp(`Tối đa ${MAX_KEYWORDS} từ khoá`));

  // Duplicates collapse, so five copies of one word is one keyword, not five
  // billed calls - it must get past the cap check.
  await assert.rejects(
    () => run({ queries: ['ai', 'AI', ' ai ', 'ai', 'ai', 'ai'] }),
    /Chưa có API key/,
    'trùng lặp phải được gộp trước khi đếm'
  );
});

test('vẫn nhận một từ khoá đơn lẻ như trước', async () => {
  await assert.rejects(
    () => searchByKeyword({ platform: 'douyin', query: '人工智能', timeWindow: '7d', limit: 10, dataKeys: {} }),
    /Chưa có API key/
  );
});

test('chỉ chấp nhận 10/20/50 và trần cứng là 50', () => {
  assert.deepEqual(RESULT_LIMITS, [10, 20, 50]);
  assert.equal(MAX_RESULT_LIMIT, 50);
  assert.ok(RESULT_LIMITS.every((n) => n <= MAX_RESULT_LIMIT));
});

test('đủ khoảng thời gian, gồm cả tuỳ chọn không giới hạn', () => {
  assert.deepEqual(TIME_WINDOWS.map((w) => w.id), ['24h', '72h', '7d', '14d', '28d', '90d', 'all']);
  assert.equal(getTimeWindow('7d').hours, 168);
  assert.equal(getTimeWindow('không có'), null);

  // A niche keyword can be popular yet publish rarely, so "everything" has to
  // be reachable - otherwise the Radar calls a live topic dead.
  assert.equal(getTimeWindow('all').hours, null);
});

test('không giới hạn thì giữ hết, kể cả video cũ và video thiếu ngày', () => {
  const items = [
    content({ id: 'moi', publishedAt: hoursAgo(1) }),
    content({ id: 'cu', publishedAt: hoursAgo(24 * 900) }),
    content({ id: 'khong-ngay', publishedAt: null }),
  ];
  assert.equal(filterByTimeWindow(items, 'all', NOW).length, 3);

  // Any bounded window still drops the undated row.
  assert.equal(filterByTimeWindow(items, '90d', NOW).length, 1);
});

test('số trang cần gọi tăng theo limit nhưng bị chặn trần', () => {
  // One page is ~7 rows, so a bigger limit costs more calls - and the cap is
  // what stops a limit of 50 from quietly becoming eight charges.
  assert.equal(pagesNeeded(3), 1);
  assert.equal(pagesNeeded(7), 1);
  assert.equal(pagesNeeded(8), 2);
  assert.equal(pagesNeeded(20), 3);
  assert.equal(pagesNeeded(50), MAX_PAGES_PER_KEYWORD);
  assert.ok(pagesNeeded(MAX_RESULT_LIMIT) <= MAX_PAGES_PER_KEYWORD);
});

// ---------------------------------------------------------------------------
// Quét đối thủ theo từ khoá

const captioned = (caption, hashtags = []) => content({ id: caption, caption, hashtags });

test('lọc từ khoá bỏ dấu ở cả hai phía', () => {
  // Creators caption the same idea both ways, so the filter has to see them as
  // one word or it loses half the matches.
  assert.equal(normalizeText('Kịch Bản Đắt Giá'), 'kich ban dat gia');
  assert.deepEqual(keywordTokens('viết kịch bản'), ['viet', 'kich', 'ban']);

  assert.equal(matchesKeyword(captioned('Hướng dẫn viết kịch bản video'), 'kich ban'), true);
  assert.equal(matchesKeyword(captioned('Huong dan viet kich ban video'), 'kịch bản'), true);
  assert.equal(matchesKeyword(captioned('Vlog ăn sáng ở Đà Lạt'), 'kịch bản'), false);
});

test('từ khoá khớp cả hashtag viết liền', () => {
  // "#kichbanvideo" is one token to the platform and three to the user.
  assert.equal(matchesKeyword(captioned('Bố cục video', ['#kichbanvideo']), 'kịch bản'), true);
});

test('một token trên ba thì không tính là khớp', () => {
  // "Tìm content viral" matching anything tagged #viral is exactly the failure
  // this rule exists to prevent.
  const rows = [
    captioned('Cách viết kịch bản bán hàng'),
    captioned('Video của tôi bỗng viral', ['#viral']),
  ];
  const matched = filterByKeyword(rows, 'kịch bản viral').map((r) => r.id);
  assert.deepEqual(matched, ['Cách viết kịch bản bán hàng']);
  assert.deepEqual(filterByKeyword(rows, 'kịch bản').map((r) => r.id), ['Cách viết kịch bản bán hàng']);
});

test('người viết một kiểu, người tìm một kiểu - hai phần ba token là đủ', () => {
  // The real miss: a channel full of idea videos answered "0 video" because
  // "cách tìm ý tưởng" demanded the word "tìm" that no caption used.
  const rows = [
    captioned('3 cách ra ý tưởng content mỗi ngày'),
    captioned('Ý tưởng quay video cho người mới'),
    captioned('Review máy ảnh giá rẻ'),
  ];
  const matched = filterByKeyword(rows, 'cách tìm ý tưởng').map((r) => r.id);
  assert.equal(matched.includes('3 cách ra ý tưởng content mỗi ngày'), true);
  assert.equal(matched.includes('Review máy ảnh giá rẻ'), false);
});

test('token một chữ cái bị loại khỏi phép khớp', () => {
  // "ý" normalises to "y", which sits inside half the words in a caption; left
  // in, it would count as a hit for anything at all.
  assert.equal(requiredMatches(2), 2);
  assert.equal(requiredMatches(3), 2);
  assert.equal(requiredMatches(4), 3);
  assert.equal(matchesKeyword(captioned('Quy trình quay dựng'), 'ý tưởng'), false);
});

test('đọc nhiều trang khi lọc từ khoá, nhưng có trần', () => {
  // One TikHub page is ~10 videos: enough for "what did they post lately",
  // nowhere near enough for "have they ever covered this".
  assert.ok(CREATOR_KEYWORD_MAX_PAGES > 1);
  assert.ok(CREATOR_KEYWORD_MAX_PAGES <= 5);
});

test('không có từ khoá thì giữ nguyên danh sách', () => {
  const rows = [captioned('a'), captioned('b')];
  assert.equal(filterByKeyword(rows, '').length, 2);
  assert.equal(filterByKeyword(rows, '   ').length, 2);
});

test('quét đối thủ có hai chế độ và mức đọc rộng hơn số kết quả người dùng xin', () => {
  assert.deepEqual(CREATOR_SCAN_MODES.map((m) => m.id), ['best', 'keyword']);
  // Filtering the 3 rows a user asked to see would almost always end at zero,
  // and a page costs the same whatever its size.
  assert.ok(CREATOR_KEYWORD_SCAN_LIMIT >= MAX_RESULT_LIMIT);
});

test('chỉ YouTube lọc từ khoá đối thủ ngay tại nguồn', () => {
  // The others list recent posts only, so their rows must be filtered locally -
  // and marking them `creatorKeyword` would skip that filter entirely.
  assert.equal(getProviderBySource('youtube', 'google').capabilities.creatorKeyword, true);
  for (const [platform, source] of [['douyin', 'tikhub'], ['douyin', 'apify'], ['tiktok', 'tikhub'], ['instagram', 'tikhub']]) {
    assert.notEqual(getProviderBySource(platform, source).capabilities.creatorKeyword, true);
  }
});

test('từ khoá đối thủ quá dài bị chặn trước khi tốn một lần gọi', async () => {
  await assert.rejects(
    () => getCreatorVideos({
      platform: 'douyin', ref: CREATOR_REF, query: 'a'.repeat(101),
      timeWindow: '7d', limit: 10, dataKeys: { apify: 'k' },
    }),
    /Từ khoá quá dài/
  );
});

// ---------------------------------------------------------------------------
// Ngưỡng số liệu

test('ngưỡng lượt xem loại cả video không có số liệu', () => {
  const rows = [
    content({ id: 'to', metrics: { views: 250_000, likes: 9000, comments: 10, shares: 5, collects: 0 } }),
    content({ id: 'nho', metrics: { views: 4_000, likes: 300, comments: 2, shares: 1, collects: 0 } }),
    // TikTok and Douyin often report no play count at all. It cannot be assumed
    // to clear the floor, so it does not - and the UI has to say why.
    content({ id: 'khong-co-view', metrics: { views: null, likes: 80_000, comments: 40, shares: 20, collects: 0 } }),
  ];

  assert.deepEqual(filterByThresholds(rows, { minViews: 100_000 }).map((r) => r.id), ['to']);
  assert.equal(countMissingViews(rows), 1);

  // A like floor still reaches the row whose views are missing.
  assert.deepEqual(filterByThresholds(rows, { minLikes: 50_000 }).map((r) => r.id), ['khong-co-view']);
  // Both floors apply together.
  assert.deepEqual(filterByThresholds(rows, { minViews: 100_000, minLikes: 50_000 }).map((r) => r.id), []);
});

test('không đặt ngưỡng thì giữ nguyên danh sách', () => {
  const rows = [content({ id: 'a' }), content({ id: 'b' })];
  assert.equal(filterByThresholds(rows, {}).length, 2);
  assert.equal(filterByThresholds(rows, { minViews: 0, minLikes: 0 }).length, 2);
});

test('đếm được video thiếu ngày đăng - thứ mà khung thời gian âm thầm loại', () => {
  const rows = [
    content({ id: 'co-ngay', publishedAt: hoursAgo(2) }),
    content({ id: 'khong-ngay', publishedAt: null }),
    content({ id: 'ngay-hong', publishedAt: 'không phải ngày' }),
  ];
  assert.equal(countUndated(rows), 2);
  // Which is exactly how many the window drops.
  assert.equal(filterByTimeWindow(rows, '7d', NOW).length, 1);
});
