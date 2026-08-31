// Technical spike: kiểm tra TikHub Douyin keyword search có trả đủ dữ liệu cho
// Content Radar hay không. Script độc lập, KHÔNG phải một phần của app.
//
// Chạy:  node scripts/tikhub-douyin-spike.mjs
// Tuỳ chọn: --keyword=... --publish-time=7 --sort-type=0 --dump=<file.json>
//
// Plain .mjs giống server/, chạy thẳng bằng node không cần build.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENDPOINT = 'https://api.tikhub.io/api/v1/douyin/search/fetch_video_search_v2';
const TIMEOUT_MS = 30_000;
const MAX_ITEMS = 10;

// ---------------------------------------------------------------- env

// Dự án dùng .env.local (vite loadEnv). Ưu tiên process.env, sau đó .env.local.
const loadApiKey = async () => {
  if (process.env.TIKHUB_API_KEY) return process.env.TIKHUB_API_KEY.trim();
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?TIKHUB_API_KEY\s*=\s*(.*)$/);
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
    cur = cur[key];
  }
  return cur;
};

// Lấy giá trị đầu tiên khác undefined/null/'' trong danh sách path.
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

// TikHub trả url dưới nhiều dạng: string, ['url'], {url_list:[...]}, {uri, url_list}.
const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  if (Array.isArray(v)) return firstUrl(v.find((x) => x));
  if (typeof v === 'object') return firstUrl(v.url_list) || firstUrl(v.url) || firstUrl(v.uri);
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
  // create_time của Douyin là giây; một số field khác là mili giây.
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));

// ---------------------------------------------------------------- tìm mảng video

// Không đoán trước JSON path: quét cây response, thu mọi mảng trông giống
// danh sách video Douyin rồi chọn mảng dài nhất.
const findVideoArrays = (root) => {
  const found = [];
  const seen = new Set();

  const walk = (node, p, depth) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      const looksVideo = objs.some(
        (x) => 'aweme_id' in x || 'aweme_info' in x || 'aweme_detail' in x || ('desc' in x && 'statistics' in x)
      );
      if (looksVideo) found.push({ path: p || '<root>', length: node.length, list: node });
      node.slice(0, 3).forEach((child, i) => walk(child, `${p}[${i}]`, depth + 1));
      return;
    }

    for (const [k, v] of Object.entries(node)) walk(v, p ? `${p}.${k}` : k, depth + 1);
  };

  walk(root, '', 0);
  found.sort((a, b) => b.length - a.length);
  return found;
};

const unwrap = (item) => {
  if (!item || typeof item !== 'object') return null;
  return item.aweme_info || item.aweme_detail || item.aweme || item;
};

// ---------------------------------------------------------------- normalize

const extractHashtags = (v) => {
  const out = [];
  const push = (s) => {
    const t = str(s);
    if (!t) return;
    const clean = t.replace(/^#/, '');
    if (clean && !out.includes(clean)) out.push(clean);
  };

  const textExtra = get(v, 'text_extra');
  if (Array.isArray(textExtra)) {
    for (const e of textExtra) if (e && e.hashtag_name) push(e.hashtag_name);
  }
  const chaList = get(v, 'cha_list');
  if (Array.isArray(chaList)) {
    for (const c of chaList) if (c && c.cha_name) push(c.cha_name);
  }
  return out;
};

const normalize = (raw) => {
  const v = unwrap(raw);
  if (!v) return null;

  const author = get(v, 'author') || get(v, 'author_info') || {};

  return {
    id: str(pick(v, ['aweme_id', 'group_id', 'id', 'item_id'])),

    caption: str(pick(v, ['desc', 'caption', 'title', 'share_info.share_title', 'content'])),

    publishedAt: toIso(pick(v, ['create_time', 'createTime', 'publish_time', 'created_at'])),

    creator: {
      id: str(pick(author, ['uid', 'sec_uid', 'user_id', 'id'])),
      username: str(pick(author, ['unique_id', 'short_id', 'custom_verify_id'])),
      nickname: str(pick(author, ['nickname', 'name', 'user_name'])),
      followerCount: num(pick(author, ['follower_count', 'followers_count', 'mplatform_followers_count', 'follower_status_count'])),
      avatarUrl: firstUrl(pick(author, ['avatar_thumb', 'avatar_medium', 'avatar_larger', 'avatar_168x168', 'avatar'])),
    },

    metrics: {
      views: num(pick(v, ['statistics.play_count', 'statistics.vv_count', 'stats.play_count', 'play_count'])),
      likes: num(pick(v, ['statistics.digg_count', 'stats.digg_count', 'digg_count'])),
      comments: num(pick(v, ['statistics.comment_count', 'stats.comment_count', 'comment_count'])),
      shares: num(pick(v, ['statistics.share_count', 'stats.share_count', 'share_count'])),
    },

    thumbnailUrl: firstUrl(
      pick(v, ['video.cover', 'video.origin_cover', 'video.dynamic_cover', 'video.animated_cover', 'video.cover_original_scale', 'cover'])
    ),

    // Ưu tiên URL trang Douyin (bền), CDN media chỉ là fallback (URL có hạn dùng).
    videoUrl:
      str(pick(v, ['share_url', 'share_info.share_url'])) ||
      firstUrl(pick(v, ['video.play_addr', 'video.play_addr_h264', 'video.download_addr'])) ||
      (str(get(v, 'aweme_id')) ? `https://www.douyin.com/video/${str(get(v, 'aweme_id'))}` : null),

    hashtags: extractHashtags(v),
  };
};

// Câu hỏi riêng: videoUrl thực tế là page URL hay CDN? Kiểm tra trên raw item.
const inspectUrls = (raw) => {
  const v = unwrap(raw) || {};
  return {
    share_url: str(pick(v, ['share_url', 'share_info.share_url'])),
    play_addr: firstUrl(get(v, 'video.play_addr')),
    download_addr: firstUrl(get(v, 'video.download_addr')),
  };
};

// ---------------------------------------------------------------- request

const requestSearch = async (apiKey, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
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
      throw new Error(`Request timeout sau ${TIMEOUT_MS} ms (${elapsed} ms trôi qua).`);
    }
    throw new Error(`Lỗi mạng khi gọi TikHub: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};

// Lấy thông điệp lỗi do provider trả về, không dump cả body.
const providerMessage = (result) => {
  const j = result.json;
  if (j && typeof j === 'object') {
    const msg = pick(j, ['detail.message', 'detail', 'message', 'msg', 'error', 'data.message', 'error_message']);
    if (typeof msg === 'string') return msg;
    if (msg) return JSON.stringify(msg).slice(0, 300);
  }
  return (result.text || '').slice(0, 300) || '(không có nội dung)';
};

// ---------------------------------------------------------------- main

const main = async () => {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    console.error('Thiếu TIKHUB_API_KEY.');
    console.error('Đặt vào .env.local (giống GEMINI_API_KEY) hoặc export ra environment rồi chạy lại.');
    process.exitCode = 1;
    return;
  }

  const keyword = arg('keyword', '人工智能');
  const publishTime = arg('publish-time', '7');
  const sortType = arg('sort-type', '0');
  const dumpPath = arg('dump', '');

  const body = {
    keyword,
    cursor: 0,
    sort_type: sortType,
    publish_time: publishTime,
    filter_duration: '0',
    content_type: '1',
    search_id: '',
    backtrace: '',
  };

  console.log('TikHub Douyin Search Test');
  console.log('');
  console.log(`Keyword: ${keyword}`);
  console.log(`sort_type: ${sortType}   publish_time: ${publishTime}`);

  let result;
  try {
    result = await requestSearch(apiKey, body);
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

  if (result.parseError || !result.json || typeof result.json !== 'object') {
    console.log('');
    console.error(`Response không phải JSON hợp lệ: ${result.parseError || 'body rỗng'}`);
    process.exitCode = 1;
    return;
  }

  if (dumpPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(dumpPath, JSON.stringify(result.json, null, 2), 'utf8');
    console.log(`Raw response đã ghi vào: ${dumpPath}`);
  }

  const envelope = result.json;
  console.log(`Top-level keys: ${Object.keys(envelope).join(', ')}`);
  const bizCode = pick(envelope, ['code', 'status_code']);
  if (bizCode !== null) console.log(`Business code: ${bizCode}`);

  const candidates = findVideoArrays(envelope);
  if (!candidates.length) {
    console.log('');
    console.error('Không tìm thấy mảng video nào trong response.');
    console.error(`Provider message: ${providerMessage(result)}`);
    process.exitCode = 1;
    return;
  }

  const chosen = candidates[0];
  console.log(`Video list JSON path: ${chosen.path}`);
  if (candidates.length > 1) {
    console.log(`Path khác cũng khớp: ${candidates.slice(1, 4).map((c) => `${c.path} (${c.length})`).join(', ')}`);
  }

  const rawItems = chosen.list;
  const normalized = [];
  const failures = [];
  for (const item of rawItems) {
    // Một video hỏng không được làm chết cả tiến trình.
    try {
      const n = normalize(item);
      if (n && n.id) normalized.push(n);
      else failures.push('item không có id');
    } catch (err) {
      failures.push(err.message);
    }
  }

  const shown = normalized.slice(0, MAX_ITEMS);

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

  // -------------------------------------------------- field coverage

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
    const hit = shown.filter((v) => fn(v) !== null && fn(v) !== undefined).length;
    const mark = shown.length && hit === shown.length ? 'x' : hit === 0 ? ' ' : '~';
    console.log(`[${mark}] ${name.padEnd(18)} ${hit}/${shown.length}`);
  }

  // -------------------------------------------------- video URL nature

  if (rawItems.length) {
    const urls = inspectUrls(rawItems[0]);
    console.log('');
    console.log('VIDEO URL TYPE (item #1)');
    console.log(`  share_url (page):    ${urls.share_url ? urls.share_url.slice(0, 120) : '—'}`);
    console.log(`  video.play_addr:     ${urls.play_addr ? urls.play_addr.slice(0, 120) : '—'}`);
    console.log(`  video.download_addr: ${urls.download_addr ? urls.download_addr.slice(0, 120) : '—'}`);
  }

  // -------------------------------------------------- samples

  console.log('');
  console.log('NORMALIZED SAMPLES (3 đầu tiên)');
  console.log('');
  console.log(JSON.stringify(shown.slice(0, 3), null, 2));
};

main().catch((err) => {
  console.error('Lỗi không lường trước:', err.message);
  process.exitCode = 1;
});
