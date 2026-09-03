// Shared TikHub transport and shape helpers.
//
// tikhubDouyin.mjs predates this and keeps its own copy on purpose: it is
// verified against live responses and not worth destabilising for tidiness.
// Everything added after it builds on this instead.

export const TIKHUB_BASE = 'https://api.tikhub.io';
const REQUEST_TIMEOUT_MS = 60_000;

export class RadarProviderError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'RadarProviderError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// value helpers

export const get = (obj, dotted) => {
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
};

export const pick = (obj, paths) => {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

export const str = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
};

export const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** These APIs return images as a string, an array, or { url_list: [...] }. */
export const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//i.test(v) ? v : null;
  if (Array.isArray(v)) return firstUrl(v.find(Boolean));
  if (typeof v === 'object') return firstUrl(v.url_list) || firstUrl(v.urlList) || firstUrl(v.url) || firstUrl(v.uri);
  return null;
};

export const toIso = (v) => {
  const n = num(v);
  if (n !== null) {
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = str(v);
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

/**
 * Walk the response for the largest array whose items look like what we want.
 *
 * TikHub wraps each upstream API differently - data.data, data.aweme_list,
 * data.business_data, data.items - and the wrapper changes between endpoint
 * versions. Betting on one path breaks silently; searching for the shape does
 * not.
 */
export const findArray = (root, looksRight, maxDepth = 9) => {
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

// ---------------------------------------------------------------------------
// transport

export const requireTikhubToken = (apiKey) => {
  const token = (apiKey || '').trim() || (process.env.TIKHUB_API_KEY || '').trim();
  if (!token) {
    throw new RadarProviderError(
      'Chưa có API key TikHub. Vào mục Tích hợp, phần Nguồn dữ liệu, để dán key.',
      { status: 400 }
    );
  }
  return token;
};

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

export const tikhubRequest = async (path, { method = 'GET', query, body, apiKey } = {}) => {
  const token = requireTikhubToken(apiKey);
  const url = new URL(TIKHUB_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

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

/** Skips a row that cannot be read rather than losing the whole page. */
export const normalizeList = (rows, normalizeOne, label) => {
  const out = [];
  for (const row of rows) {
    try {
      const item = normalizeOne(row);
      if (item) out.push(item);
    } catch (err) {
      console.error(`[radar] ${label}: bỏ qua item không đọc được:`, err.message);
    }
  }
  return out;
};
