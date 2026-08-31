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
import { RESULT_LIMITS, MAX_RESULT_LIMIT, TIME_WINDOWS, getTimeWindow } from './constants.mjs';
import {
  normalizeContent, normalizeContentList, creatorCandidatesFrom, douyinApifyProvider, detectProviderNotice,
} from '../../server/radar/providers/douyinApify.mjs';
import { searchByKeyword, searchCreators, getCreatorVideos } from '../../server/radar/radarService.mjs';
import { parseJsonArray, acceptSuggestions } from '../../server/radar/suggest.mjs';
import { getProvidersForPlatform } from '../../server/radar/providers/index.mjs';
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

  assert.equal('views' in item.metrics, false);
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
  assert.equal(getProvidersForPlatform('tiktok').length, 0);

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
  assert.equal('views' in item.metrics, false);
  assert.equal(item.duration, 15);
  assert.equal(item.thumbnailUrl, 'https://p3.douyinpic.com/c.webp');
  assert.deepEqual(item.hashtags, ['ai']);
});

// ---------------------------------------------------------------------------
// Keyword suggestions
//
// The LLM call itself is not exercised here; what is tested is everything that
// decides whether a model's answer becomes a chip the user can click.

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

test('chỉ nhận gợi ý dùng được làm truy vấn Douyin', () => {
  const accepted = acceptSuggestions([
    { keyword: 'AI营销', note: 'AI marketing' },
    { keyword: '#电商', note: 'Thương mại điện tử' },   // bỏ dấu # ở đầu
    { keyword: 'AI营销', note: 'trùng' },                // loại trùng
    { keyword: 'digital marketing', note: 'không CJK' }, // loại: Douyin cần tiếng Trung
    { keyword: '', note: 'rỗng' },
    { keyword: '这是一个非常长的关键词根本不可能有人这样搜索的', note: 'quá dài' },
    null,
    'không phải object',
  ]);

  assert.deepEqual(accepted.map((s) => s.keyword), ['AI营销', '电商']);
  assert.equal(accepted[0].note, 'AI marketing');
});

test('gợi ý không note thì note là null, không phải chuỗi rỗng', () => {
  const accepted = acceptSuggestions([{ keyword: '美妆' }]);
  assert.equal(accepted[0].note, null);
});

test('không bao giờ trả quá 6 gợi ý', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ keyword: `关键词${i}`, note: 'x' }));
  assert.equal(acceptSuggestions(many).length, 6);
});

// ---------------------------------------------------------------------------
// Limits

test('chỉ chấp nhận 10/20/50 và trần cứng là 50', () => {
  assert.deepEqual(RESULT_LIMITS, [10, 20, 50]);
  assert.equal(MAX_RESULT_LIMIT, 50);
  assert.ok(RESULT_LIMITS.every((n) => n <= MAX_RESULT_LIMIT));
});

test('đủ 5 khoảng thời gian mà sản phẩm yêu cầu', () => {
  assert.deepEqual(TIME_WINDOWS.map((w) => w.id), ['24h', '72h', '7d', '14d', '28d']);
  assert.equal(getTimeWindow('7d').hours, 168);
  assert.equal(getTimeWindow('không có'), null);
});
