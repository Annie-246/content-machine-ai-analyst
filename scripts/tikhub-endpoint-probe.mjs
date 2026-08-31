// Spike phụ: tìm xem endpoint Douyin nào chạy được bằng free credit.
// Không gọi mù - hỏi thẳng TikHub về balance và bảng giá từng endpoint.
//
// Chạy: node scripts/tikhub-endpoint-probe.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://api.tikhub.io';
const TIMEOUT_MS = 30_000;

const loadApiKey = async () => {
  if (process.env.TIKHUB_API_KEY) return process.env.TIKHUB_API_KEY.trim();
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?TIKHUB_API_KEY\s*=\s*(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* bỏ qua */ }
  return '';
};

const call = async (apiKey, method, pathname, { query, body } = {}) => {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* giữ text thô */ }
    return { status: res.status, ok: res.ok, elapsed: Date.now() - started, json, text };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : err.message;
    return { status: 0, ok: false, elapsed: Date.now() - started, json: null, text: why };
  } finally {
    clearTimeout(timer);
  }
};

const get = (obj, dotted) => {
  let cur = obj;
  for (const k of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
};

// Endpoint Douyin có thể dùng cho discovery của Content Radar.
const CANDIDATES = [
  ['POST', '/api/v1/douyin/search/fetch_video_search_v1'],
  ['POST', '/api/v1/douyin/search/fetch_video_search_v2'],
  ['POST', '/api/v1/douyin/search/fetch_video_search_v3'],
  ['POST', '/api/v1/douyin/search/fetch_video_search_v4'],
  ['POST', '/api/v1/douyin/search/fetch_video_search_v5'],
  ['POST', '/api/v1/douyin/search/fetch_general_search_v1'],
  ['POST', '/api/v1/douyin/search/fetch_general_search_v3'],
  ['GET', '/api/v1/douyin/web/fetch_hot_search_result'],
  ['GET', '/api/v1/douyin/app/v3/fetch_hot_search_list'],
  ['GET', '/api/v1/douyin/app/v3/fetch_hashtag_video_list'],
];

const main = async () => {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    console.error('Thiếu TIKHUB_API_KEY trong .env.local hoặc process.env.');
    process.exitCode = 1;
    return;
  }

  console.log('TikHub Account & Pricing Probe');
  console.log('');

  // ---- 1. Balance / free credit ----
  const info = await call(apiKey, 'GET', '/api/v1/tikhub/user/get_user_info');
  console.log(`GET get_user_info -> HTTP ${info.status} (${info.elapsed} ms)`);
  if (info.ok && info.json) {
    const d = get(info.json, 'data') || info.json;
    const interesting = ['email', 'balance', 'free_credit', 'account_status', 'email_verified', 'api_key_status'];
    for (const k of Object.keys(d || {})) {
      // Không in email đầy đủ và không in bất kỳ thứ gì trông giống key.
      if (/key|token|secret|password/i.test(k)) continue;
      const v = d[k];
      if (typeof v === 'object' && v !== null) continue;
      const masked = k === 'email' && typeof v === 'string' ? v.replace(/(.).*(@.*)/, '$1***$2') : v;
      console.log(`  ${k}: ${masked}`);
    }
    void interesting;
  } else {
    console.log(`  lỗi: ${(info.text || '').slice(0, 200)}`);
  }

  // ---- 2. Giá từng endpoint ----
  console.log('');
  console.log('PRICE PER REQUEST (theo TikHub)');
  console.log('');
  const prices = new Map();
  for (const [, pathname] of CANDIDATES) {
    const r = await call(apiKey, 'GET', '/api/v1/tikhub/user/get_endpoint_info', { endpoint: pathname });
    const d = r.ok ? (get(r.json, 'data') || r.json) : null;
    const price = d ? (d.endpoint_price ?? d.price ?? d.cost ?? null) : null;
    const freeOk = d ? (d.accept_free_credit ?? d.free_credit ?? d.is_free ?? null) : null;
    prices.set(pathname, { price, freeOk, status: r.status });
    const name = pathname.replace('/api/v1/douyin/', '');
    console.log(
      `  ${name.padEnd(40)} HTTP ${String(r.status).padEnd(4)} price=${price ?? '?'}  free_credit=${freeOk ?? '?'}`
    );
    if (r.ok && d && prices.size === 1) {
      console.log(`    (các field trả về: ${Object.keys(d).join(', ')})`);
    }
  }

  // ---- 3. Probe thật: endpoint nào chịu chạy với balance hiện tại ----
  console.log('');
  console.log('LIVE PROBE (keyword = 人工智能)');
  console.log('');

  const bodyFor = (pathname) => {
    if (/fetch_video_search_v3$/.test(pathname)) return { query: '人工智能', date_type: 7, label_type: 0, duration_type: 0 };
    if (/fetch_video_search_v4$/.test(pathname)) return { keyword: '人工智能', cursor: 0 };
    if (/(fetch_video_search_v5|fetch_general_search_v3)$/.test(pathname)) {
      return { keyword: '人工智能', offset: 0, page: 1, search_id: '', backtrace: '' };
    }
    return {
      keyword: '人工智能', cursor: 0, sort_type: '0', publish_time: '7',
      filter_duration: '0', content_type: '1', search_id: '', backtrace: '',
    };
  };

  const queryFor = (pathname) => {
    if (/fetch_hashtag_video_list$/.test(pathname)) return { challenge_id: '1571726682840082', cursor: 0, count: 10 };
    return undefined;
  };

  const working = [];
  for (const [method, pathname] of CANDIDATES) {
    const opts = method === 'POST' ? { body: bodyFor(pathname) } : { query: queryFor(pathname) };
    const r = await call(apiKey, method, pathname, opts);

    let note = '';
    if (r.ok) {
      // Đếm nhanh xem có mảng nào trông giống list video không.
      let count = 0;
      const seen = new Set();
      const walk = (n, depth) => {
        if (!n || typeof n !== 'object' || depth > 7 || seen.has(n)) return;
        seen.add(n);
        if (Array.isArray(n)) {
          if (n.some((x) => x && typeof x === 'object' && ('aweme_id' in x || 'aweme_info' in x))) {
            count = Math.max(count, n.length);
          }
          n.slice(0, 3).forEach((c) => walk(c, depth + 1));
          return;
        }
        for (const v of Object.values(n)) walk(v, depth + 1);
      };
      walk(r.json, 0);
      note = `OK, video-like items: ${count}`;
      working.push({ method, pathname, count });
    } else {
      const msg =
        get(r.json, 'detail.message') || get(r.json, 'detail') || get(r.json, 'message') || (r.text || '').slice(0, 90);
      note = typeof msg === 'string' ? msg.slice(0, 90) : JSON.stringify(msg).slice(0, 90);
    }

    console.log(`  ${method.padEnd(4)} ${pathname.replace('/api/v1/douyin/', '').padEnd(40)} HTTP ${String(r.status).padEnd(4)} ${note}`);
  }

  console.log('');
  if (working.length) {
    console.log('CHẠY ĐƯỢC với balance hiện tại:');
    for (const w of working) console.log(`  - ${w.method} ${w.pathname} (${w.count} video-like items)`);
  } else {
    console.log('Không endpoint nào chạy được với balance hiện tại.');
  }
};

main().catch((err) => {
  console.error('Lỗi không lường trước:', err.message);
  process.exitCode = 1;
});
