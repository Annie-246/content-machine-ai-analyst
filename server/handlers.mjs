// Request handlers shared by the Vite dev middleware and the production server.
// Plain JavaScript so the production server can run under node without a build step.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const execFileAsync = promisify(execFile);

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const IMPERSONATE = process.env.YTDLP_IMPERSONATE || 'chrome';

const ATTEMPTS = 7;
const MAX_DURATION_SEC = 15 * 60;
const MAX_BYTES = 150 * 1024 * 1024;
// Gemini keeps uploaded files for 48h; expire our cache earlier to stay safe.
const CACHE_TTL_MS = 40 * 60 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

// Only social hosts are accepted, so this endpoint cannot be used as a generic proxy.
const ALLOWED_HOSTS = [
  'tiktok.com', 'douyin.com',
  'facebook.com', 'fb.watch', 'fb.com',
  'instagram.com',
  'youtube.com', 'youtu.be',
  'x.com', 'twitter.com',
  'threads.net', 'threads.com',
];

// TikTok rejects a random share of requests even with a valid challenge cookie,
// so these failures are transient and worth retrying rather than surfacing.
const TRANSIENT = /Unable to extract universal data|Unexpected response from webpage|Unable to find video in feed|HTTP Error 5\d\d|Solving JS challenge/i;

const cache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const readJsonBody = (req, limitBytes = 20_000_000) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limitBytes) reject(new Error('Body quá lớn'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Body không phải JSON hợp lệ'));
      }
    });
    req.on('error', reject);
  });

const isAllowedUrl = (raw) => {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
};

const platformOf = (raw) => {
  const host = new URL(raw).hostname.toLowerCase();
  if (host.includes('tiktok')) return 'TikTok';
  if (host.includes('facebook') || host.includes('fb.')) return 'Facebook';
  if (host.includes('instagram')) return 'Instagram';
  if (host.includes('youtu')) return 'YouTube';
  if (host.includes('x.com') || host.includes('twitter')) return 'X (Twitter)';
  if (host.includes('threads')) return 'Threads';
  return 'Social';
};

// yt-dlp only needs cookies for private or age-gated content; opt in via env.
const cookieArgs = () => {
  if (process.env.YTDLP_COOKIES_FILE) return ['--cookies', process.env.YTDLP_COOKIES_FILE];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ['--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER];
  return [];
};

// TikTok answers plain HTTP clients with a JS WAF challenge instead of the video page.
// Impersonating a real Chrome TLS fingerprint (via curl_cffi) gets through it.
// Falls back to a normal request when curl_cffi is not installed.
const execImpersonated = async (args, opts) => {
  try {
    return await execFileAsync(YTDLP, ['--impersonate', IMPERSONATE, ...args], opts);
  } catch (err) {
    const text = (err?.stderr || '') + (err?.message || '');
    if (/impersonate/i.test(text) && /not available|unsupported|invalid|no such/i.test(text)) {
      return await execFileAsync(YTDLP, args, opts);
    }
    throw err;
  }
};

const runYtdlp = async (args, opts) => {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await execImpersonated(args, opts);
    } catch (err) {
      lastErr = err;
      const text = (err?.stderr || '') + (err?.message || '');
      if (!TRANSIENT.test(text)) throw err;
      if (attempt === ATTEMPTS) {
        // Mark it so the message blames the platform, not the user's network.
        err.exhaustedRetries = true;
        throw err;
      }
      console.log(`[fetch-video] nền tảng từ chối lần ${attempt}/${ATTEMPTS}, thử lại...`);
      // Back off harder each round: the platform is rate-limiting us.
      await sleep(Math.min(2000 * attempt, 12000));
    }
  }
  throw lastErr;
};

const extractHashtags = (text) => [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])];

const toMeta = (info, url, sizeBytes) => {
  const description = info.description || '';
  const title = info.title || info.fulltitle || '';
  return {
    id: String(info.id || ''),
    platform: platformOf(url),
    title,
    description,
    hashtags: extractHashtags(title + '\n' + description),
    durationSec: typeof info.duration === 'number' ? Math.round(info.duration) : null,
    viewCount: info.view_count ?? null,
    likeCount: info.like_count ?? null,
    commentCount: info.comment_count ?? null,
    shareCount: info.repost_count ?? null,
    uploader: info.uploader || info.uploader_id || info.channel || '',
    uploadDate: info.upload_date || '',
    soundtrack: [info.track, info.artist].filter(Boolean).join(' - '),
    thumbnail: info.thumbnail || '',
    webpageUrl: info.webpage_url || url,
    sizeBytes,
  };
};

const probe = async (url) => {
  const { stdout } = await runYtdlp(
    [
      '--dump-single-json', '--no-warnings', '--no-playlist',
      '--socket-timeout', '30', '--retries', '3',
      ...cookieArgs(),
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  );
  return JSON.parse(stdout.toString());
};

const download = async (url, dir) => {
  await runYtdlp(
    [
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4',
      '--no-playlist', '--no-warnings',
      '--socket-timeout', '30', '--retries', '3',
      '--max-filesize', String(MAX_BYTES),
      '-o', path.join(dir, 'source.%(ext)s'),
      ...cookieArgs(),
      url,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
  );

  const files = await readdir(dir);
  const video = files.find((f) => f.startsWith('source.'));
  if (!video) throw new Error('yt-dlp không tạo ra file video nào (có thể bị chặn hoặc vượt giới hạn dung lượng).');
  return path.join(dir, video);
};

const uploadToGemini = async (apiKey, filePath, mimeType) => {
  const ai = new GoogleGenAI({ apiKey });
  let file = await ai.files.upload({
    file: filePath,
    config: { mimeType, displayName: path.basename(filePath) },
  });

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  while (file.state === 'PROCESSING' && Date.now() < deadline) {
    await sleep(2000);
    file = await ai.files.get({ name: file.name });
  }

  if (file.state === 'FAILED') throw new Error('Gemini xử lý video thất bại: ' + (file.error?.message || 'không rõ nguyên nhân'));
  if (file.state === 'PROCESSING') throw new Error('Gemini xử lý video quá lâu, đã hết thời gian chờ.');
  if (!file.uri) throw new Error('Gemini không trả về fileUri.');

  return { fileUri: file.uri, mimeType: file.mimeType || mimeType };
};

const explainYtdlpError = (err) => {
  const text = (err?.stderr || '') + ' ' + (err?.message || '');

  if (err?.exhaustedRetries) {
    return `Nền tảng đang chặn yêu cầu tự động (đã thử ${ATTEMPTS} lần đều bị từ chối). Đây là cơ chế chống bot của họ và thường chỉ diễn ra tạm thời - chờ khoảng một phút rồi bấm lại. Nếu lặp lại nhiều lần, chạy: pip install -U "yt-dlp[default,curl-cffi]"`;
  }
  if (err?.code === 'ENOENT') {
    return 'Không tìm thấy yt-dlp trên máy chủ. Cài bằng: pip install -U "yt-dlp[default,curl-cffi]" (hoặc đặt biến YTDLP_PATH trỏ tới file thực thi).';
  }
  if (/Unexpected response from webpage/i.test(text)) {
    return 'Nền tảng trả về trang kiểm tra bảo mật (WAF challenge) thay vì trang video. Cài thư viện giả lập trình duyệt bằng lệnh: pip install -U "yt-dlp[default,curl-cffi]" rồi thử lại.';
  }
  if (/login required|Sign in|private|not available|cookies/i.test(text)) {
    return 'Video này yêu cầu đăng nhập hoặc ở chế độ riêng tư. Đặt YTDLP_COOKIES_FROM_BROWSER hoặc YTDLP_COOKIES_FILE rồi thử lại, hoặc tải file lên trực tiếp.';
  }
  if (/Unsupported URL/i.test(text)) return 'yt-dlp không hỗ trợ đường dẫn này. Hãy dùng link tới một video cụ thể.';
  if (/File is larger than max-filesize/i.test(text)) return 'Video vượt quá giới hạn ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB.';
  if (/timed out|timeout/i.test(text)) return 'Hết thời gian chờ khi tải video. Kiểm tra kết nối mạng rồi thử lại.';
  return text.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'Không tải được video từ link này.';
};

// Gemini errors arrive as a JSON string; surface only the useful part.
const explainGeminiError = (err) => {
  const raw = err?.message || '';
  let message = raw;
  try {
    message = JSON.parse(raw).error.message;
  } catch { /* not JSON, keep the raw text */ }

  if (/API key not valid|API_KEY_INVALID/i.test(message)) return 'API key không hợp lệ. Kiểm tra lại key ở mục Tích hợp.';
  if (/prepayment credits are depleted/i.test(message)) return 'Tài khoản Gemini đã hết credit trả trước. Nạp thêm hoặc dùng key khác ở mục Tích hợp.';
  if (/quota|RESOURCE_EXHAUSTED/i.test(message)) return 'Key đã hết hạn ngạch (quota). Thử lại sau hoặc dùng key khác ở mục Tích hợp.';
  if (/permission|PERMISSION_DENIED/i.test(message)) return 'Key không có quyền dùng Files API. Kiểm tra lại project trên Google AI Studio.';
  return String(message).slice(0, 300) || 'Không upload được video lên Gemini.';
};

export const handleFetchVideo = async (req, res, fallbackApiKey = '') => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  let workDir = null;
  try {
    const body = await readJsonBody(req, 1_000_000);
    const url = (body.url || '').trim();
    const effectiveKey = (body.apiKey || '').trim() || fallbackApiKey;

    if (!url) return sendJson(res, 400, { error: 'Thiếu URL.' });
    if (!isAllowedUrl(url)) {
      return sendJson(res, 400, { error: 'Chỉ chấp nhận link từ TikTok, Facebook, Instagram, YouTube, X hoặc Threads.' });
    }
    if (!effectiveKey) {
      return sendJson(res, 400, { error: 'Chưa có API key. Vào mục Tích hợp để dán API key Gemini.' });
    }

    const cacheKey = effectiveKey.slice(-8) + '|' + url;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return sendJson(res, 200, { ...cached, cached: true });
    }

    let info;
    try {
      info = await probe(url);
    } catch (err) {
      return sendJson(res, 502, { error: explainYtdlpError(err) });
    }

    if (info._type === 'playlist') {
      return sendJson(res, 400, { error: 'Link này là playlist hoặc kênh. Hãy dán link của một video cụ thể.' });
    }
    if (typeof info.duration === 'number' && info.duration > MAX_DURATION_SEC) {
      return sendJson(res, 400, {
        error: 'Video dài ' + Math.round(info.duration / 60) + ' phút, vượt giới hạn ' + MAX_DURATION_SEC / 60 + ' phút.',
      });
    }

    workDir = await mkdtemp(path.join(tmpdir(), 'cm-video-'));

    let filePath;
    try {
      filePath = await download(url, workDir);
    } catch (err) {
      return sendJson(res, 502, { error: explainYtdlpError(err) });
    }

    const { size } = await stat(filePath);
    if (size === 0) return sendJson(res, 502, { error: 'File tải về rỗng.' });

    let uploaded;
    try {
      uploaded = await uploadToGemini(effectiveKey, filePath, 'video/mp4');
    } catch (err) {
      return sendJson(res, 502, { error: explainGeminiError(err) });
    }

    const entry = { ...uploaded, meta: toMeta(info, url, size), at: Date.now() };
    cache.set(cacheKey, entry);

    sendJson(res, 200, { ...entry, cached: false });
  } catch (err) {
    console.error('[fetch-video]', err);
    sendJson(res, 500, { error: err?.message || 'Lỗi không xác định khi xử lý video.' });
  } finally {
    // The video only ever lives in a temp dir; Gemini holds the copy we analyse.
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// Text generation for the non-Gemini providers. Calls go through the server
// because these APIs are not reachable from the browser (CORS).

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

const LLM_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 16000;

const buildRequest = (provider, apiKey, model, system, prompt) => {
  if (provider === 'anthropic') {
    return {
      url: ENDPOINTS.anthropic,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user', content: prompt }] },
    };
  }

  // OpenAI and DeepSeek share the same chat-completions shape.
  return {
    url: ENDPOINTS[provider],
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    },
  };
};

const extractText = (provider, data) => {
  if (provider === 'anthropic') {
    return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  return (data?.choices?.[0]?.message?.content || '').trim();
};

const explainLlmError = (provider, status, data) => {
  const message = data?.error?.message || data?.message || '';
  const name = provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'DeepSeek';

  if (status === 401 || status === 403) return `API key ${name} không hợp lệ hoặc không có quyền. Kiểm tra lại ở mục Tích hợp.`;
  if (status === 429) return `${name} báo hết hạn ngạch hoặc gọi quá nhanh. Thử lại sau, hoặc đổi provider ở mục Tích hợp.`;
  if (status === 402) return `Tài khoản ${name} không đủ số dư. Nạp thêm hoặc đổi provider ở mục Tích hợp.`;
  if (status === 404 && /model/i.test(message)) return `${name} không có model này. Đổi tên model ở mục Tích hợp.`;
  if (status >= 500) return `${name} đang gặp sự cố phía máy chủ. Thử lại sau ít phút.`;
  return message ? `${name}: ${message}`.slice(0, 300) : `${name} trả về lỗi ${status}.`;
};

export const handleLlm = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  try {
    const body = await readJsonBody(req);
    const provider = body.provider;
    const apiKey = (body.apiKey || '').trim();
    const model = (body.model || '').trim();
    const system = body.system || '';
    const prompt = body.prompt || '';

    if (!ENDPOINTS[provider]) return sendJson(res, 400, { error: 'Nhà cung cấp không hợp lệ.' });
    if (!apiKey) return sendJson(res, 400, { error: 'Chưa có API key cho nhà cung cấp này. Vào mục Tích hợp để thêm.' });
    if (!prompt) return sendJson(res, 400, { error: 'Thiếu nội dung cần xử lý.' });

    const request = buildRequest(provider, apiKey, model, system, prompt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return sendJson(res, 502, { error: explainLlmError(provider, upstream.status, data) });

    const text = extractText(provider, data);
    if (!text) return sendJson(res, 502, { error: 'Nhà cung cấp không trả về nội dung nào.' });

    sendJson(res, 200, { text, provider, model });
  } catch (err) {
    console.error('[llm]', err);
    const message = err?.name === 'AbortError'
      ? 'Hết thời gian chờ phản hồi từ nhà cung cấp.'
      : err?.message || 'Lỗi không xác định khi gọi nhà cung cấp AI.';
    sendJson(res, 500, { error: message });
  }
};

// ---------------------------------------------------------------------------
// Gemini generation. Runs server-side so a deployed app can use the server's
// key and never ship it to the browser.

// Free tier quota is counted per model, and the newest model runs out first.
const TEXT_MODEL_CHAIN = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
const IMAGE_MODEL_CHAIN = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'];

const isOverloaded = (error) => {
  const text = (error?.message || '') + JSON.stringify(error?.error || '');
  return error?.status === 503 || error?.status === 429 ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(text);
};

const withRetry = async (call, attempts = 4) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (!isOverloaded(error) || attempt === attempts) throw error;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
};

const generateWithFallback = async (ai, models, params) => {
  let lastError;
  for (const model of models) {
    try {
      return await withRetry(() => ai.models.generateContent({ ...params, model }));
    } catch (error) {
      lastError = error;
      // Only a quota/overload problem is worth trying the next model for.
      if (!isOverloaded(error)) throw error;
      console.log(`[gemini] ${model} hết quota hoặc quá tải, chuyển model dự phòng...`);
    }
  }
  throw lastError;
};

export const handleGemini = async (req, res, fallbackApiKey = '') => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  try {
    const body = await readJsonBody(req, 60_000_000);
    const apiKey = (body.apiKey || '').trim() || fallbackApiKey;
    if (!apiKey) {
      return sendJson(res, 400, { error: 'Chưa có API key Gemini. Vào mục Tích hợp để dán key.' });
    }

    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length) return sendJson(res, 400, { error: 'Thiếu nội dung cần xử lý.' });

    const ai = new GoogleGenAI({ apiKey });
    const wantsImage = body.kind === 'image';
    const chain = body.model ? [body.model] : (wantsImage ? IMAGE_MODEL_CHAIN : TEXT_MODEL_CHAIN);

    const config = wantsImage
      ? { imageConfig: { aspectRatio: body.aspectRatio || '16:9', imageSize: '1K' } }
      : {
          systemInstruction: body.systemInstruction || '',
          temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
          ...(body.useSearch
            ? { tools: [{ googleSearch: {} }], toolConfig: { includeServerSideToolInvocations: true } }
            : {}),
        };

    let response;
    try {
      response = await generateWithFallback(ai, chain, { contents: { parts }, config });
    } catch (err) {
      return sendJson(res, 502, { error: explainGeminiError(err) });
    }

    if (wantsImage) {
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData) {
            return sendJson(res, 200, { image: `data:image/png;base64,${part.inlineData.data}` });
          }
        }
      }
      return sendJson(res, 502, { error: 'AI không trả về hình ảnh. Thử lại với ảnh khuôn mặt hoặc sản phẩm rõ nét hơn.' });
    }

    if (!response.text) {
      return sendJson(res, 502, {
        error: 'AI không trả về văn bản. Có thể nội dung vi phạm chính sách an toàn hoặc gặp sự cố kết nối.',
      });
    }

    sendJson(res, 200, { text: response.text });
  } catch (err) {
    console.error('[gemini]', err);
    sendJson(res, 500, { error: err?.message || 'Lỗi không xác định khi gọi Gemini.' });
  }
};

// ---------------------------------------------------------------------------
// Cross-origin support, for when the frontend is hosted elsewhere (Vercel,
// Netlify...) and only the API runs on your own machine or VPS.

// Comma-separated list of allowed origins; "*" (default) allows any.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Optional shared secret. When set, every /api call must send the same value in
// the x-api-token header, so a public frontend URL cannot be used by strangers
// to burn your API quota.
const API_TOKEN = process.env.API_TOKEN || '';

const originAllowed = (origin) => {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
};

export const applyCors = (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return false;

  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-token');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
};

// Returns true when the request may proceed.
export const checkAccess = (req, res) => {
  if (!originAllowed(req.headers.origin)) {
    sendJson(res, 403, { error: 'Origin này không được phép gọi máy chủ.' });
    return false;
  }
  if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) {
    sendJson(res, 401, {
      error: 'Sai khoá truy cập máy chủ. Nhập đúng khoá ở mục Tích hợp, phần Máy chủ xử lý.',
    });
    return false;
  }
  return true;
};

export const handlePreflight = (req, res) => {
  if (!applyCors(req, res)) {
    res.statusCode = 403;
    return res.end();
  }
  res.statusCode = 204;
  res.end();
};

export const serverInfo = () => ({
  ok: true,
  requiresToken: !!API_TOKEN,
  hasServerKey: !!process.env.GEMINI_API_KEY,
});
