// Technical spike (provider #2): kiểm tra Apify Douyin search có trả đủ dữ liệu
// cho Content Radar hay không. Song song với scripts/tikhub-douyin-spike.mjs để
// so sánh cùng một schema normalize.
//
// Chạy:  node scripts/apify-douyin-spike.mjs
// Tuỳ chọn: --keyword=... --limit=10 --actor=zen-studio~douyin-search-scraper --dump=<file.json>
//
// Đúng 1 actor run. Không download video, không download cover (đều tính phí thêm).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR = 'zen-studio~douyin-search-scraper';
// Actor run chậm hơn REST API nhiều; run-sync của Apify tối đa 300s.
const TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------- env

const loadToken = async () => {
  if (process.env.APIFY_API_TOKEN) return process.env.APIFY_API_TOKEN.trim();
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?APIFY_API_TOKEN\s*=\s*(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* không có file thì thôi */ }
  return '';
};

// ---------------------------------------------------------------- helpers

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const get = (obj, dotted) => {
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const m = key.match(/^(.*)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(m[2])];
    } else {
      cur = cur[key];
    }
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

const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  if (Array.isArray(v)) return firstUrl(v.find((x) => x));
  if (typeof v === 'object') return firstUrl(v.url_list) || firstUrl(v.urlList) || firstUrl(v.url) || firstUrl(v.uri);
  return null;
};

const toIso = (v) => {
  const n = num(v);
  if (n === null) {
    const s = str(v);
    if (!s) return null;
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? s : new Date(parsed).toISOString();
  }
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));

// ---------------------------------------------------------------- normalize

// Scraper trên Apify đặt tên field tự do, nên thử cả snake_case gốc của Douyin
// lẫn camelCase mà scraper hay dùng.
const extractHashtags = (v) => {
  const out = [];
  const push = (s) => {
    const t = str(s);
    if (!t) return;
    const clean = t.replace(/^#/, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  };

  for (const key of ['hashtags', 'tags', 'challenges', 'text_extra', 'textExtra', 'cha_list', 'chaList']) {
    const arr = get(v, key);
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (typeof e === 'string') push(e);
      else if (e && typeof e === 'object') push(e.hashtag_name || e.hashtagName || e.cha_name || e.chaName || e.name || e.title);
    }
  }
  return out;
};

const normalize = (v) => {
  if (!v || typeof v !== 'object') return null;

  return {
    id: str(pick(v, ['aweme_id', 'awemeId', 'video_id', 'videoId', 'item_id', 'itemId', 'id'])),

    caption: str(pick(v, ['desc', 'description', 'caption', 'title', 'text', 'content'])),

    publishedAt: toIso(
      pick(v, ['create_time', 'createTime', 'createTimeISO', 'publishedAt', 'publish_time', 'publishTime', 'createdAt', 'created_at'])
    ),

    creator: {
      id: str(
        pick(v, [
          'authorMeta.id', 'authorMeta.secUid',
          'author.uid', 'author.id', 'author.sec_uid', 'author.secUid', 'authorId', 'user.id',
        ])
      ),
      // customUsername là handle Douyin; username là short id dạng số.
      username: str(
        pick(v, [
          'authorMeta.customUsername', 'authorMeta.username',
          'author.unique_id', 'author.uniqueId', 'author.short_id', 'uniqueId', 'user.uniqueId',
        ])
      ),
      nickname: str(
        pick(v, ['authorMeta.name', 'author.nickname', 'author.nickName', 'author.name', 'authorName', 'user.nickname'])
      ),
      followerCount: num(
        pick(v, [
          'authorMeta.followersCount', 'authorMeta.fans', 'authorMeta.followerCount',
          'author.follower_count', 'author.followerCount', 'authorFollowers', 'user.followerCount',
        ])
      ),
      avatarUrl: firstUrl(
        pick(v, [
          'authorMeta.avatarMedium', 'authorMeta.avatarThumb', 'authorMeta.avatar300', 'authorMeta.avatarLarge',
          'author.avatar_thumb', 'author.avatarThumb', 'authorAvatar',
        ])
      ),
    },

    metrics: {
      // Douyin không phát hành play count trong kết quả search - statistics.playCount
      // luôn là 0. Giữ nguyên 0 thay vì bịa, và báo rõ ở phần coverage.
      views: num(
        pick(v, [
          'statistics.playCount', 'statistics.play_count', 'stats.playCount',
          'playCount', 'viewCount', 'views',
        ])
      ),
      likes: num(pick(v, ['statistics.diggCount', 'statistics.digg_count', 'stats.diggCount', 'diggCount', 'likeCount', 'likes'])),
      comments: num(pick(v, ['statistics.commentCount', 'statistics.comment_count', 'stats.commentCount', 'commentCount', 'comments'])),
      shares: num(pick(v, ['statistics.shareCount', 'statistics.share_count', 'stats.shareCount', 'shareCount', 'shares'])),
    },

    thumbnailUrl: firstUrl(
      pick(v, [
        'videoMeta.cover', 'videoMeta.originCover', 'videoMeta.dynamicCover', 'videoMeta.animatedCover',
        'video.cover', 'video.origin_cover', 'cover', 'coverUrl', 'thumbnail', 'images[0]',
      ])
    ),

    // `url` là link trang Douyin sạch; shareUrl là link iesdouyin kèm tracking param.
    videoUrl:
      str(pick(v, ['url', 'shareUrl', 'share_url', 'webVideoUrl', 'postUrl', 'videoUrl', 'link'])) ||
      firstUrl(pick(v, ['videoMeta.playUrl', 'videoMeta.downloadUrl', 'video.play_addr', 'playUrl'])),

    hashtags: extractHashtags(v),
  };
};

// ---------------------------------------------------------------- run actor

const runActor = async (token, actor, input) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  // run-sync-get-dataset-items: chạy actor và trả thẳng dataset, không phải poll.
  const url = `${BASE}/acts/${actor}/run-sync-get-dataset-items`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    const elapsed = Date.now() - started;
    const text = await res.text();

    let json = null;
    let parseError = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      parseError = err.message;
    }

    return { status: res.status, ok: res.ok, elapsed, text, json, parseError };
  } catch (err) {
    const elapsed = Date.now() - started;
    if (err.name === 'AbortError') {
      throw new Error(`Actor run timeout sau ${TIMEOUT_MS} ms (${elapsed} ms trôi qua).`);
    }
    throw new Error(`Lỗi mạng khi gọi Apify: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};

const providerMessage = (result) => {
  const j = result.json;
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const msg = pick(j, ['error.message', 'error', 'message']);
    if (typeof msg === 'string') return msg;
    if (msg) return JSON.stringify(msg).slice(0, 300);
  }
  return (result.text || '').slice(0, 300) || '(không có nội dung)';
};

// ---------------------------------------------------------------- main

const main = async () => {
  const keyword = arg('keyword', '人工智能');
  const limit = Number(arg('limit', '10')) || 10;
  const actor = arg('actor', DEFAULT_ACTOR);
  const dumpPath = arg('dump', '');
  // --from=<file>: chuẩn hoá lại dataset đã lưu, không chạy actor (không tốn credit).
  const fromPath = arg('from', '');

  if (fromPath) {
    const items = JSON.parse(await readFile(fromPath, 'utf8'));
    console.log('Apify Douyin Search Test (offline re-normalize)');
    console.log('');
    console.log(`Nguồn: ${fromPath}`);
    console.log(`Keyword: ${keyword}`);
    return report(Array.isArray(items) ? items : []);
  }

  const token = await loadToken();
  if (!token) {
    console.error('Thiếu APIFY_API_TOKEN trong .env.local hoặc process.env.');
    process.exitCode = 1;
    return;
  }

  const input = {
    keywords: [keyword],
    maxResultsPerQuery: limit,
    sort: 'general',          // ≡ sort_type = 0
    publishTime: 'one_week',  // ≡ publish_time = 7
    duration: 'unlimited',    // ≡ filter_duration = 0
    // Mọi tuỳ chọn download đều tính phí thêm - spike không cần.
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
  };

  console.log('Apify Douyin Search Test');
  console.log('');
  console.log(`Actor: ${actor}`);
  console.log(`Keyword: ${keyword}`);
  console.log(`sort: ${input.sort}   publishTime: ${input.publishTime}   maxResults: ${limit}`);
  console.log('');
  console.log('Đang chạy actor (có thể mất 30-120s)...');

  let result;
  try {
    result = await runActor(token, actor, input);
  } catch (err) {
    console.log('');
    console.error(`THẤT BẠI: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`HTTP status: ${result.status}`);
  console.log(`Response time: ${result.elapsed} ms`);

  if (!result.ok) {
    console.log('');
    console.error(`Provider trả lỗi HTTP ${result.status}: ${providerMessage(result)}`);
    process.exitCode = 1;
    return;
  }

  if (result.parseError || result.json === null) {
    console.log('');
    console.error(`Response không phải JSON hợp lệ: ${result.parseError || 'body rỗng'}`);
    process.exitCode = 1;
    return;
  }

  // run-sync-get-dataset-items trả thẳng một mảng.
  const rawItems = Array.isArray(result.json) ? result.json : get(result.json, 'items') || [];
  if (!Array.isArray(rawItems)) {
    console.log('');
    console.error('Response không phải mảng dataset như mong đợi.');
    process.exitCode = 1;
    return;
  }

  if (dumpPath) {
    await writeFile(dumpPath, JSON.stringify(rawItems, null, 2), 'utf8');
    console.log(`Raw dataset đã ghi vào: ${dumpPath}`);
  }

  return report(rawItems);
};

// Dùng chung cho cả actor run lẫn chế độ --from.
const report = (rawItems) => {
  console.log(`Video list JSON path: <dataset root array> (run-sync-get-dataset-items)`);
  if (rawItems[0] && typeof rawItems[0] === 'object') {
    console.log(`Field có trong item thô: ${Object.keys(rawItems[0]).join(', ')}`);
  }

  const normalized = [];
  const failures = [];
  for (const item of rawItems) {
    try {
      const n = normalize(item);
      if (n && n.id) normalized.push(n);
      else failures.push('item không có id');
    } catch (err) {
      failures.push(err.message);
    }
  }

  const shown = normalized.slice(0, 10);

  console.log(`Raw results: ${rawItems.length}`);
  console.log(`Valid video results: ${normalized.length}`);
  if (failures.length) {
    console.log(`Bỏ qua: ${failures.length} item (${[...new Set(failures)].slice(0, 3).join('; ')})`);
  }

  console.log('');
  console.log('----------------------------------');

  shown.forEach((v, i) => {
    console.log('');
    console.log(`#${i + 1}`);
    console.log('');
    console.log(`Caption:    ${fmt(v.caption)}`);
    console.log(`Creator:    ${fmt(v.creator.nickname)} (@${fmt(v.creator.username)} / id ${fmt(v.creator.id)})`);
    console.log(`Followers:  ${fmt(v.creator.followerCount)}`);
    console.log('');
    console.log(`Views:      ${fmt(v.metrics.views)}`);
    console.log(`Likes:      ${fmt(v.metrics.likes)}`);
    console.log(`Comments:   ${fmt(v.metrics.comments)}`);
    console.log(`Shares:     ${fmt(v.metrics.shares)}`);
    console.log('');
    console.log(`Published:  ${fmt(v.publishedAt)}`);
    console.log(`Hashtags:   ${v.hashtags.length ? v.hashtags.map((h) => '#' + h).join(' ') : '—'}`);
    console.log('');
    console.log(`Video URL:  ${fmt(v.videoUrl)}`);
    console.log(`Thumbnail:  ${fmt(v.thumbnailUrl)}`);
    console.log('');
    console.log('----------------------------------');
  });

  const fields = {
    caption: (v) => v.caption,
    publishedAt: (v) => v.publishedAt,
    'creator name': (v) => v.creator.nickname,
    'creator ID': (v) => v.creator.id,
    'creator username': (v) => v.creator.username,
    'follower count': (v) => v.creator.followerCount,
    views: (v) => v.metrics.views,
    likes: (v) => v.metrics.likes,
    comments: (v) => v.metrics.comments,
    shares: (v) => v.metrics.shares,
    thumbnail: (v) => v.thumbnailUrl,
    'video URL': (v) => v.videoUrl,
    hashtags: (v) => (v.hashtags.length ? v.hashtags : null),
  };

  console.log('');
  console.log(`FIELD COVERAGE (trên ${shown.length} video)`);
  console.log('');
  for (const [name, fn] of Object.entries(fields)) {
    const vals = shown.map(fn);
    const hit = vals.filter((v) => v !== null && v !== undefined).length;
    let mark = shown.length && hit === shown.length ? 'x' : hit === 0 ? ' ' : '~';
    // Field số mà mọi video đều bằng 0 là bị provider giấu, không phải dữ liệu thật.
    let note = '';
    if (hit === shown.length && shown.length && vals.every((v) => v === 0)) {
      mark = '!';
      note = '  <- toàn 0, coi như KHÔNG có dữ liệu';
    }
    console.log(`[${mark}] ${name.padEnd(18)} ${hit}/${shown.length}${note}`);
  }

  console.log('');
  console.log('NORMALIZED SAMPLES (3 đầu tiên)');
  console.log('');
  console.log(JSON.stringify(shown.slice(0, 3), null, 2));
};

main().catch((err) => {
  console.error('Lỗi không lường trước:', err.message);
  process.exitCode = 1;
});
