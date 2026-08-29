import { getServerUrl, getServerToken } from './apiKeyStore';

// The dev server serves index.html for any path its middleware does not handle,
// so a request sent while Vite is restarting comes back as HTML. Parsing that as
// JSON throws "Unexpected token '<'", which tells the user nothing useful.
export const postJson = async <T = any>(url: string, body: unknown): Promise<T> => {
  const base = getServerUrl();
  const token = getServerToken();
  const target = base ? base + url : url;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['x-api-token'] = token;

  let res: Response;
  try {
    res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error(
      base
        ? `Không kết nối được tới máy chủ ${base}. Kiểm tra máy chủ có đang bật và địa chỉ có đúng không.`
        : 'Không kết nối được tới máy chủ của app. Kiểm tra xem máy chủ còn đang chạy không.'
    );
  }

  const raw = await res.text();
  const looksLikeHtml = raw.trimStart().startsWith('<');

  if (looksLikeHtml) {
    throw new Error(
      base
        ? `Địa chỉ ${base} trả về trang web chứ không phải API. Kiểm tra lại địa chỉ máy chủ ở mục Tích hợp.`
        : 'Nơi đang chạy app này không có máy chủ xử lý (thường gặp khi deploy lên Vercel hoặc Netlify). Vào mục Tích hợp để trỏ tới máy chủ của bạn.'
    );
  }

  let payload: any;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Máy chủ trả về dữ liệu không hợp lệ: ${raw.slice(0, 120)}`);
  }

  if (!res.ok) {
    throw new Error(payload?.error || `Máy chủ báo lỗi ${res.status}.`);
  }

  return payload as T;
};

// GET helper used to probe a server before saving its address.
export const getJson = async <T = any>(url: string, base?: string, token?: string): Promise<T> => {
  const root = (base ?? getServerUrl()).replace(/\/+$/, '');
  const key = token ?? getServerToken();
  const headers: Record<string, string> = {};
  if (key) headers['x-api-token'] = key;

  const res = await fetch(root + url, { headers });
  const raw = await res.text();
  if (raw.trimStart().startsWith('<')) {
    throw new Error('Địa chỉ này trả về trang web chứ không phải API.');
  }
  const payload = raw ? JSON.parse(raw) : {};
  if (!res.ok) throw new Error(payload?.error || `Máy chủ báo lỗi ${res.status}.`);
  return payload as T;
};
