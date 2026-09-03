// Request handlers shared by the Vite dev middleware and the production server.
// Plain JavaScript so the production server can run under node without a build step.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { douyinCookieArgs, hasBrowser } from './douyinCookies.mjs';
import { renderPage, canRender, hasCookieJar } from './browserPage.mjs';
import * as radar from './radar/radarService.mjs';

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
  'tiktok.com', 'douyin.com', 'iesdouyin.com',
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
  if (host.includes('douyin')) return 'Douyin';
  if (host.includes('tiktok')) return 'TikTok';
  if (host.includes('facebook') || host.includes('fb.')) return 'Facebook';
  if (host.includes('instagram')) return 'Instagram';
  if (host.includes('youtu')) return 'YouTube';
  if (host.includes('x.com') || host.includes('twitter')) return 'X (Twitter)';
  if (host.includes('threads')) return 'Threads';
  return 'Social';
};

// yt-dlp only needs cookies for private or age-gated content; opt in via env.
const DOUYIN_HOST_RE = /(^|\.)(?:douyin|iesdouyin)\.com$/i;
const DOUYIN_ID_RE = /\/(?:share\/)?video\/(\d{6,})/;
const DOUYIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const resolveDouyinUrl = async (raw) => {
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return raw;
  }
  if (!DOUYIN_HOST_RE.test(host)) return raw;

  const direct = raw.match(DOUYIN_ID_RE);
  if (direct) return `https://www.douyin.com/video/${direct[1]}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(raw, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': DOUYIN_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });

    const fromUrl = res.url.match(DOUYIN_ID_RE);
    if (fromUrl) return `https://www.douyin.com/video/${fromUrl[1]}`;

    const body = (await res.text()).slice(0, 300_000);
    const fromBody = body.match(/"aweme_id"\s*:\s*"(\d{6,})"/) || body.match(DOUYIN_ID_RE);
    if (fromBody) return `https://www.douyin.com/video/${fromBody[1]}`;
  } catch {
    // Keep the original link and let yt-dlp report what it makes of it.
  } finally {
    clearTimeout(timer);
  }
  return raw;
};

const cookieArgs = async (url = '') => {
  if (process.env.YTDLP_COOKIES_FILE) return ['--cookies', process.env.YTDLP_COOKIES_FILE];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ['--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER];

  // Douyin refuses every session-less client, so mint an anonymous one.
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a url, nothing to do */ }
  if (host && DOUYIN_HOST_RE.test(host)) return await douyinCookieArgs(url);

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
      ...(await cookieArgs(url)),
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
      ...(await cookieArgs(url)),
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
  if (/Fresh cookies/i.test(text) || (/douyin/i.test(text) && /cookies/i.test(text))) {
    return hasBrowser()
      ? 'Không tạo được phiên Douyin lần này. Thử lại sau một phút; nếu vẫn lỗi, đặt YTDLP_COOKIES_FILE trỏ tới file cookies.txt xuất từ trình duyệt đã vào douyin.com.'
      : 'Douyin chỉ trả nội dung cho phiên đã có cookie. Máy chủ này không tìm thấy Chrome hoặc Edge để tự tạo phiên - cài một trong hai (hoặc đặt biến CHROME_PATH trỏ tới file thực thi), hoặc đặt YTDLP_COOKIES_FILE trỏ tới file cookies.txt xuất từ trình duyệt đã vào douyin.com.';
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
      return sendJson(res, 400, { error: 'Chỉ chấp nhận link từ TikTok, Douyin, Facebook, Instagram, YouTube, X hoặc Threads.' });
    }
    if (!effectiveKey) {
      return sendJson(res, 400, { error: 'Chưa có API key. Vào mục Tích hợp để dán API key Gemini.' });
    }

    const target = await resolveDouyinUrl(url);
    if (target !== url) console.log(`[fetch-video] link rút gọn Douyin -> ${target}`);
    if (DOUYIN_HOST_RE.test(new URL(target).hostname) && !DOUYIN_ID_RE.test(target)) {
      return sendJson(res, 400, {
        error: 'Link Douyin này không dẫn tới một video cụ thể (có thể đã hết hạn hoặc là link chia sẻ trang chủ). Mở link trên trình duyệt rồi copy lại địa chỉ dạng douyin.com/video/... nhé.',
      });
    }

    const cacheKey = effectiveKey.slice(-8) + '|' + target;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return sendJson(res, 200, { ...cached, cached: true });
    }

    let info;
    try {
      info = await probe(target);
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
      filePath = await download(target, workDir);
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

    const entry = { ...uploaded, meta: toMeta(info, target, size), at: Date.now() };
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

// A model that does not implement the server-side search tool rejects the whole
// request because of it. The answer is still worth having without the tool.
const isToolUnsupported = (error) => {
  const text = (error?.message || '') + JSON.stringify(error?.error || '');
  return /Tool call context circulation|not enabled for models|does not support tool|toolConfig|INVALID_ARGUMENT.*tool/i.test(text);
};

const generateWithFallback = async (ai, models, params) => {
  let lastError;
  for (const model of models) {
    try {
      return await withRetry(() => ai.models.generateContent({ ...params, model }));
    } catch (error) {
      lastError = error;

      if (isToolUnsupported(error) && params.config?.tools) {
        const { tools, toolConfig, ...withoutTools } = params.config;
        console.log(`[gemini] ${model} không hỗ trợ công cụ tìm kiếm, chạy lại không kèm công cụ...`);
        try {
          return await withRetry(() => ai.models.generateContent({ ...params, config: withoutTools, model }));
        } catch (retryError) {
          lastError = retryError;
        }
      }

      // Only a quota/overload problem is worth trying the next model for.
      if (!isOverloaded(lastError)) throw lastError;
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
          // Gemini refuses JSON mode together with the search tool, so a caller
          // asking for both gets search and has to parse the text itself.
          ...(body.responseJson && !body.useSearch ? { responseMimeType: 'application/json' } : {}),
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

// ---------------------------------------------------------------------------
// Brand source ingestion: turns a website, a social profile, a single post of any
// format or a linked PDF into material the model can actually read, so Brand DNA
// suggestions are grounded in the brand's real wording instead of guesswork.

const SOURCE_TIMEOUT_MS = 25_000;
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_MAX_CHARS = 40_000;
const SOURCE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// A page is worth reading only if it carries some actual prose.
const MIN_USEFUL_CHARS = 60;
// How many distinct copy blocks to lift out of one app-shell page.
const MAX_EMBEDDED_BLOCKS = 150;
// Logged out, Facebook embeds about seven; a signed-in read returns far more, so
// the ceiling is here to bound the prompt rather than to match what FB gives.
const MAX_FB_COMMENTS = 300;

// Facebook, Instagram, Threads and most app-shell sites hand a plain reader an
// empty frame, but serve the full copy to the crawlers that build search results
// and link previews. Reading a brand's own public page therefore means asking for
// it the way those crawlers do. The honest browser identity is tried first and
// this list is only reached when a page returns nothing readable without it.
const CRAWLER_UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'facebookexternalhit/1.1',
];

// Unlike /api/fetch-video, this endpoint accepts any public site. That makes it a
// generic outbound fetcher, so it has to refuse the addresses that only exist
// inside the server's own network - otherwise a pasted link could be used to
// probe whatever runs next to it.
const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return /^f[cd]/.test(v6) || v6.startsWith('fe80');
};

const assertPublicHttpUrl = async (raw) => {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Đường dẫn không hợp lệ. Nhớ kèm https:// ở đầu.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Chỉ nhận đường dẫn http hoặc https.');
  }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Không truy cập được địa chỉ nội bộ.');
    return u;
  }
  if (/^localhost$/i.test(host) || /\.(local|internal|localdomain)$/i.test(host)) {
    throw new Error('Không truy cập được địa chỉ nội bộ.');
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Không phân giải được tên miền "${host}". Kiểm tra lại đường dẫn.`);
  }
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error('Không truy cập được địa chỉ nội bộ.');
  }
  return u;
};

// Stops reading once the cap is hit instead of buffering a whole huge page.
const readCapped = async (response, maxBytes) => {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer()).subarray(0, maxBytes);

  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  try {
    await reader.cancel();
  } catch { /* the stream already finished on its own */ }
  return Buffer.concat(chunks).subarray(0, maxBytes);
};

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ' '; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; }
    });

const readMeta = (html, names) => {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      'i',
    );
    const m = html.match(re);
    const value = (m?.[1] ?? m?.[2] ?? '').trim();
    if (value) return decodeEntities(value);
  }
  return '';
};

// A gallery post declares one og:image per picture, so the first match alone
// throws away everything after the cover.
const readMetaAll = (html, names) => {
  const values = [];
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      'gi',
    );
    for (const m of html.matchAll(re)) {
      const value = (m[1] ?? m[2] ?? '').trim();
      if (value) values.push(decodeEntities(value));
    }
  }
  return values;
};

const htmlToText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|td|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => decodeEntities(line).replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim();

// Login walls, cookie banners and app-install nags, matched at the start of a
// line. These sit right next to the real posts on every social platform and
// would otherwise be read as brand copy.
const UI_PREFIX = new RegExp(
  '^(' + [
    'bình luận đã bị tắt', 'xem bản dịch', 'xem tất cả', 'xem thêm bình luận',
    'đăng nhập', 'đăng ký', 'tạo tài khoản', 'mở ứng dụng', 'tải ứng dụng',
    'tận hưởng trải nghiệm', 'xem toàn bộ trang cá nhân', 'hãy dùng ứng dụng',
    'bằng cách tiếp tục', 'chính sách quyền riêng tư', 'điều khoản sử dụng',
    'có lỗi xảy ra', 'không bao giờ bỏ lỡ', 'thêm các bài viết',
    'tải thông tin người liên hệ', 'meta đã xác minh', 'xem chuyện gì đang xảy ra',
    'tiếp tục với', 'continue with', 'người liên quan', 'đang nổi bật',
    'log in', 'sign up', 'privacy policy', 'terms of service',
    'something went wrong', 'open app', 'download the app', 'see all comments',
  ].join('|') + ')',
  'i',
);

// Navigation words and footer links, matched as a whole line so a real post that
// merely starts with one of these words survives.
const UI_EXACT = new RegExp(
  '^(' + [
    'meta', 'blog', 'việc làm', 'trợ giúp', 'api', 'vị trí', 'phổ biến',
    'giới thiệu', 'instagram lite', 'meta ai', 'threads', 'tiếng việt',
    'trang chủ', 'thông báo', 'tin nhắn', 'khám phá', 'thử lại', 'cookie',
    'đăng', 'theo dõi', 'đang theo dõi', 'người theo dõi', 'đề cập',
    'thích', 'trả lời', 'thích trả lời', 'chia sẻ', 'bình luận',
    'see more', 'learn more', 'try again', 'follow', 'following', 'followers',
    'home', 'explore', 'messages', 'notifications', 'about', 'help', 'jobs',
  ].join('|') + ')$',
  'i',
);

// Relative timestamps and reaction counters that fill the gaps between posts:
// "3 giây", "2 ngày trước", "945,5K", "18 N".
const COUNTER_LINE = /^[\d.,]+\s*(giây|phút|giờ|ngày|tuần|tháng|năm|k|tr|n|m|nghìn|triệu)?(\s*trước)?$/i;

// The language switcher ships every language name on one line.
const LANGUAGE_LIST = /Afrikaans|Bahasa Indonesia|中文\(简体\)/;

const isChrome = (line) => {
  const value = line.trim();
  if (!value) return true;
  if (COUNTER_LINE.test(value) || UI_EXACT.test(value)) return true;
  if (LANGUAGE_LIST.test(value)) return true;
  if (/^Mozilla\/5\.0/.test(value)) return true;
  // A bare handle with no spaces is a commenter, not brand copy.
  if (value.length <= 30 && /^[a-z0-9._-]+$/.test(value)) return true;
  // Only short lines are judged by prefix: a long paragraph that happens to open
  // with "Đăng ký" is still a real post.
  return value.length < 90 && UI_PREFIX.test(value);
};

const dropChrome = (text) =>
  text
    .split('\n')
    .filter((line) => !isChrome(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// An app-shell page keeps its real copy in the JSON it ships to the browser, so
// the visible-text pass finds nothing. These are the post captions, the intro
// blurb and the about section - and, on a post page, the reader comments.
const extractEmbeddedBlocks = (html) => {
  const seen = new Set();
  const lines = [];

  for (const match of html.matchAll(/"(?:text|full_text|caption|message)":"((?:[^"\\]|\\.){25,})"/g)) {
    let value;
    try {
      value = JSON.parse('"' + match[1] + '"');
    } catch {
      continue;
    }
    value = value.trim();
    if (!value || seen.has(value) || isChrome(value)) continue;
    // Anything without a space is a token, an id or a class name, not prose.
    if (!/\s/.test(value)) continue;
    seen.add(value);
    lines.push(value);
    if (lines.length >= MAX_EMBEDDED_BLOCKS) break;
  }

  return lines;
};

const extractEmbeddedText = (html) => extractEmbeddedBlocks(html).join('\n\n');

const fetchPage = async (url, userAgent) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.9',
      },
    });
    const buffer = await readCapped(response, SOURCE_MAX_BYTES);
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
};

// Turns one fetched response into either a PDF payload or readable page text.
const interpretPage = (url, raw, response, buffer) => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/pdf') || buffer.subarray(0, 5).toString() === '%PDF-') {
    return {
      url: raw,
      kind: 'pdf',
      title: url.pathname.split('/').filter(Boolean).pop() || raw,
      base64: buffer.toString('base64'),
      mimeType: 'application/pdf',
    };
  }

  if (contentType && !/text\/|json|xml|javascript|markdown/.test(contentType)) {
    // The content type will not change with a different identity, so there is no
    // point downloading this again under every crawler UA.
    const err = new Error(`Đường dẫn này trả về "${contentType}", không phải trang web hay PDF.`);
    err.fatal = true;
    throw err;
  }

  const html = buffer.toString('utf8');
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(html);

  const title = isHtml
    ? decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()) ||
      readMeta(html, ['og:title', 'twitter:title'])
    : url.pathname.split('/').filter(Boolean).pop() || raw;

  const description = isHtml ? readMeta(html, ['description', 'og:description', 'twitter:description']) : '';
  const visible = isHtml ? dropChrome(htmlToText(html)) : html.trim();
  // Only dig into the shipped JSON when the page itself rendered little, so a
  // normal site is never polluted with its own script payload.
  const embedded = isHtml && visible.replace(/\s/g, '').length < 4000 ? extractEmbeddedText(html) : '';

  const seen = new Set();
  const body = [visible, embedded]
    .filter((part) => part && part.trim())
    .join('\n\n')
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');

  return {
    url: raw,
    kind: 'web',
    title: title || raw,
    imageUrls: isHtml ? collectImageUrls(html, response.url || raw) : [],
    text: [
      `NGUỒN: ${raw}`,
      title ? `TIÊU ĐỀ TRANG: ${title}` : '',
      description ? `MÔ TẢ TRANG: ${description}` : '',
      '',
      body,
    ].filter(Boolean).join('\n').slice(0, SOURCE_MAX_CHARS),
    // How much real prose came back, so the caller can decide to try harder.
    weight: body.replace(/\s/g, '').length,
  };
};

// Tries the honest browser identity first and only falls back to crawler
// identities for pages that hand a plain reader nothing at all.
const readPage = async (url, raw) => {
  const attempts = [SOURCE_UA, ...CRAWLER_UAS];
  let best = null;
  let lastError = '';

  for (const userAgent of attempts) {
    let result;
    try {
      result = await fetchPage(url, userAgent);
    } catch (err) {
      lastError = err?.name === 'AbortError'
        ? `Trang không phản hồi trong ${SOURCE_TIMEOUT_MS / 1000} giây.`
        : `Không mở được trang này: ${err?.message || 'lỗi kết nối'}.`;
      continue;
    }

    const { response, buffer } = result;
    if (!response.ok) {
      lastError = response.status === 401 || response.status === 403
        ? 'Trang này chặn truy cập tự động. Hãy lưu nội dung thành PDF rồi tải lên.'
        : `Trang trả về lỗi ${response.status}.`;
      continue;
    }

    let page;
    try {
      page = interpretPage(url, raw, response, buffer);
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err.message;
      continue;
    }

    if (page.kind === 'pdf') return page;
    // Keep going while a richer identity might return more of the timeline.
    if (!best || page.weight > best.weight) best = page;
    if (page.weight >= 1500) return best;
  }

  if (best && best.weight >= MIN_USEFUL_CHARS) return best;
  if (best && best.weight > 0) return best;
  throw new Error(
    lastError ||
    'Trang này gần như không có chữ trong mã nguồn (thường gặp với trang dựng bằng JavaScript). Hãy lưu trang thành PDF rồi tải lên.',
  );
};

// ----- Post photos ---------------------------------------------------------
// Creators regularly put the real message on the image rather than in the
// caption, so a post is only half read without its pictures. Articles are the
// same story: the infographic, the chart and the screenshot inside them carry
// text that never appears in the prose.

const MAX_POST_IMAGES = 8;
const MAX_IMAGE_ATTEMPTS = 24;
// Downloading one at a time made a picture-heavy article crawl.
const IMAGE_FETCH_CONCURRENCY = 4;
// Anything smaller is an avatar, an icon or a tracking pixel.
const POST_IMAGE_MIN_BYTES = 12_000;
const POST_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

const STATIC_ASSET_RE =
  /\/rsrc\.php\/|static\.(?:xx\.fbcdn\.net|cdninstagram\.com|licdn\.com)|\/emoji|sprite|favicon|\/static\//i;

// Site furniture, not content: every article page carries these and none of
// them says anything about the story.
const CHROME_IMAGE_RE =
  /\b(?:logo|icon|avatar|placeholder|banner|advert|ads?|pixel|tracking|blank|loading|spinner|button|badge|watermark|qr[-_]?code|share|social)\b/i;

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;

const IMAGE_URL_RE =
  /"(?:image|image_url|display_url|thumbnail_src|src|uri|url)"\s*:\s*"(https:(?:\\?\/){2}[^"]{30,500}?\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi;

// <img> and <source> hold the article's own photos, and lazy-loading sites keep
// the real address in a data- attribute with src pointing at a grey placeholder.
const IMG_TAG_RE = /<(?:img|source)\b[^>]*>/gi;
const ATTR_RE =
  /\b(?:src|data-src|data-original|data-lazy-src|data-lazy|data-echo|data-url|data-image|content)\s*=\s*["']([^"']+)["']/i;
const SRCSET_ATTR_RE = /\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/i;
const PRELOAD_IMAGE_RE =
  /<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']image["'][^>]*>/gi;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/i;

// A srcset lists the same picture at several widths; the widest is the one
// worth reading text off.
const widestFromSrcset = (value) => {
  let best = '';
  let bestWidth = -1;
  for (const candidate of value.split(',')) {
    const [href, descriptor = ''] = candidate.trim().split(/\s+/);
    if (!href) continue;
    const width = Number((descriptor.match(/^(\d+)w$/) || [])[1] || 0);
    if (width > bestWidth) { bestWidth = width; best = href; }
  }
  return best;
};

// The same photo shows up as a thumbnail, a resized variant and the original,
// so the file name minus its size prefix is what tells two pictures apart.
const imageIdentity = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    const file = pathname.split('/').filter(Boolean).pop() || pathname;
    return `${hostname}/${file.replace(/^\d{2,4}px-/i, '').toLowerCase()}`;
  } catch {
    return url;
  }
};

const collectImageUrls = (html, pageUrl = '') => {
  const urls = [];
  const seen = new Set();
  // A declared preview image is the page's own cover, so it is taken at its
  // word even when the address carries no file extension.
  const add = (raw, declared = false) => {
    if (!raw) return;
    const cleaned = raw.replace(/\\\//g, '/').replace(/&amp;/gi, '&').trim();
    if (!cleaned || cleaned.startsWith('data:')) return;

    // Articles routinely use "/photo/x.jpg" or "//cdn/x.jpg" rather than a full
    // address, and those are exactly the in-body photos we were missing.
    let url;
    try {
      url = pageUrl ? new URL(cleaned, pageUrl).href : cleaned;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(url)) return;
    if (!declared && !IMAGE_EXT_RE.test(url)) return;
    if (STATIC_ASSET_RE.test(url)) return;
    if (!declared && CHROME_IMAGE_RE.test(url)) return;

    const key = imageIdentity(url);
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  // The preview image is the post's main photo on every one of these platforms,
  // and a gallery article declares one og:image per picture.
  for (const value of readMetaAll(html, ['og:image', 'og:image:url', 'twitter:image'])) add(value, true);

  for (const tag of html.match(IMG_TAG_RE) || []) {
    const srcset = tag.match(SRCSET_ATTR_RE)?.[1];
    if (srcset) add(widestFromSrcset(srcset));
    add(tag.match(ATTR_RE)?.[1]);
    if (urls.length >= 40) return urls;
  }

  for (const tag of html.match(PRELOAD_IMAGE_RE) || []) add(tag.match(HREF_RE)?.[1]);

  for (const m of html.matchAll(IMAGE_URL_RE)) {
    add(m[1]);
    if (urls.length >= 40) break;
  }
  return urls;
};

const fetchImageAs = async (url, userAgent, referer) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = { 'User-Agent': userAgent, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' };
    if (referer) headers.Referer = referer;

    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase().split(';')[0];
    if (!type.startsWith('image/') || type === 'image/svg+xml') return null;

    const buffer = await readCapped(res, POST_IMAGE_MAX_BYTES);
    if (buffer.length < POST_IMAGE_MIN_BYTES) return null;
    return { buffer, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Facebook's collage asks its CDN for a thumbnail: "ctp" caps delivery at the
// size the page happened to display, so a photo full of text arrives at 268px
// wide and unreadable. The signature covers the rest of the query, which is why
// dropping that one parameter still returns the full-size photo.
const fullSizeVariant = (raw) => {
  try {
    const url = new URL(raw);
    if (!/(^|\.)fbcdn\.net$/i.test(url.hostname) || !url.searchParams.has('ctp')) return '';
    url.searchParams.delete('ctp');
    return url.href;
  } catch {
    return '';
  }
};

const downloadImage = async (raw, referer) => {
  try {
    await assertPublicHttpUrl(raw);
  } catch {
    return null;
  }

  // Facebook answers a plain browser with an empty HTML page here and only hands
  // the real photo to a crawler, so try that identity first.
  for (const url of [fullSizeVariant(raw), raw].filter(Boolean)) {
    for (const userAgent of [CRAWLER_UAS[0], SOURCE_UA]) {
      const got = await fetchImageAs(url, userAgent, referer);
      if (!got) continue;
      return {
        base64: got.buffer.toString('base64'),
        mimeType: got.type,
        url,
        // News sites serve one photo from several CDN shards under different
        // addresses, so only the bytes prove two pictures are the same.
        digest: createHash('sha1').update(got.buffer).digest('hex'),
      };
    }
  }
  return null;
};

const downloadPostImages = async (urls, referer) => {
  const candidates = urls.slice(0, MAX_IMAGE_ATTEMPTS);
  const images = [];
  const digests = new Set();

  // Page order is meaningful - the cover and the first in-body photos matter
  // most - so keep it, but fetch a batch at a time instead of one by one.
  for (let i = 0; i < candidates.length && images.length < MAX_POST_IMAGES; i += IMAGE_FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + IMAGE_FETCH_CONCURRENCY);
    const got = await Promise.all(batch.map((url) => downloadImage(url, referer)));
    for (const image of got) {
      if (!image || images.length >= MAX_POST_IMAGES) continue;
      if (digests.has(image.digest)) continue;
      digests.add(image.digest);
      images.push({ base64: image.base64, mimeType: image.mimeType, url: image.url });
    }
  }
  return images;
};

// ----- X (Twitter) ---------------------------------------------------------
// X shows a logged-out reader nothing but a bio, yet the endpoints its own embed
// widgets call are public and return the post text in full.

const X_STATUS = /^\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d+)/;
const X_PROFILE = /^\/([A-Za-z0-9_]{1,20})\/?$/;
const X_RESERVED = /^(home|explore|search|notifications|messages|i|settings|about|tos|privacy)$/i;

// The token the syndication endpoint expects is derived from the post id.
const syndicationToken = (id) =>
  ((Number(id) / 1e6) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': SOURCE_UA, Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const readXStatus = async (user, id) => {
  const data = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=vi`,
  );
  if (!data?.text) return null;

  const handle = data.user?.screen_name || user;
  const media = [
    data.photos?.length ? `${data.photos.length} ảnh` : '',
    data.video ? 'có video' : '',
  ].filter(Boolean).join(', ');

  return {
    imageUrls: (data.photos || []).map((p) => p && p.url).filter(Boolean),
    title: `@${handle}: ${String(data.text).replace(/\s+/g, ' ').slice(0, 70)}`,
    text: [
      `NGUỒN: X (Twitter) - https://x.com/${handle}/status/${id}`,
      `TÀI KHOẢN: ${data.user?.name || ''} (@${handle})`,
      data.created_at ? `NGÀY ĐĂNG: ${data.created_at}` : '',
      media ? `ĐÍNH KÈM: ${media}` : '',
      '',
      `NỘI DUNG BÀI ĐĂNG:`,
      data.text,
      data.favorite_count ? `\nLƯỢT THÍCH: ${data.favorite_count}` : '',
    ].filter(Boolean).join('\n'),
  };
};

// The embedded-timeline widget is the only public way to read a profile's posts.
// It rate-limits hard, so a miss here is normal and simply falls through.
const readXTimeline = async (user) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${user}`, {
      headers: { 'User-Agent': SOURCE_UA, 'Accept-Language': 'vi,en;q=0.9' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const seen = new Set();
  const posts = [];
  for (const m of html.matchAll(/"full_text":"((?:[^"\\]|\\.){10,})"/g)) {
    let value;
    try { value = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    value = value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    posts.push(value);
    if (posts.length >= 20) break;
  }
  if (!posts.length) return null;

  return {
    hasPosts: true,
    title: `@${user} trên X`,
    text: [
      `NGUỒN: X (Twitter) - https://x.com/${user}`,
      '',
      'CÁC BÀI ĐĂNG GẦN ĐÂY:',
      ...posts.map((p, i) => `${i + 1}. ${p}`),
    ].join('\n'),
  };
};

const readX = async (url) => {
  const status = url.pathname.match(X_STATUS);
  if (status) return await readXStatus(status[1], status[2]);

  const profile = url.pathname.match(X_PROFILE);
  if (profile && !X_RESERVED.test(profile[1])) return await readXTimeline(profile[1]);

  return null;
};

// ----- Douyin ---------------------------------------------------------------
// yt-dlp cannot touch Douyin without session cookies, but the page Douyin serves
// to search crawlers carries a full schema.org VideoObject: caption, author,
// counts, duration, cover image and even top comments. That is enough to read a
// post without asking anyone to configure cookies.

const readJsonLd = (html) => {
  const found = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      found.push(JSON.parse(m[1].trim()));
    } catch { /* a malformed block is not worth failing over */ }
  }
  return found;
};

// "PT0H1M49S" -> "1 phút 49 giây"
const humanDuration = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return '';
  const total = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  if (!total) return '';
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins ? `${mins} phút ${secs} giây` : `${secs} giây`;
};

const countOf = (stats, action) => {
  const list = Array.isArray(stats) ? stats : stats ? [stats] : [];
  const hit = list.find((s) => JSON.stringify(s.interactionType || '').includes(action));
  return hit ? hit.userInteractionCount : null;
};

const readDouyin = async (raw) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(raw, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': CRAWLER_UAS[0], 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const video = readJsonLd(html).find((b) => b['@type'] === 'VideoObject');
  if (!video) return null;

  const caption = String(video.name || '').replace(/\s*-\s*抖音\s*$/, '').trim();
  const author = video.creator?.name || '';
  const followers = countOf(video.creator?.interactionStatistic, 'FollowAction');
  const likes = countOf(video.creator?.interactionStatistic, 'LikeAction');
  const comments = Array.isArray(video.comment)
    ? video.comment.map((c) => String(c?.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10)
    : [];

  const lines = [
    `NGUỒN: Douyin - ${raw}`,
    author ? `TÀI KHOẢN: ${author}${followers ? ` (${followers} người theo dõi)` : ''}` : '',
    video.uploadDate ? `NGÀY ĐĂNG: ${String(video.uploadDate).slice(0, 10)}` : '',
    humanDuration(video.duration) ? `THỜI LƯỢNG: ${humanDuration(video.duration)}` : '',
    likes ? `LƯỢT THÍCH: ${likes}` : '',
    video.commentCount ? `BÌNH LUẬN: ${video.commentCount}` : '',
    video.keywords ? `TỪ KHOÁ / HASHTAG: ${video.keywords}` : '',
    '',
    'CAPTION GỐC:',
    caption || '(không có caption)',
  ];

  if (comments.length) {
    lines.push('', 'BÌNH LUẬN NỔI BẬT (phản ứng thật của người xem):');
    comments.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  }

  const thumbs = Array.isArray(video.thumbnailUrl)
    ? video.thumbnailUrl
    : video.thumbnailUrl ? [video.thumbnailUrl] : [];

  return {
    title: caption || author || raw,
    text: lines.filter((l) => l !== undefined).join('\n'),
    imageUrls: thumbs.slice(0, 2),
    hasPosts: true,
    // Structured and complete: the scraped page would only add duplicates.
    exclusive: true,
  };
};

// ----- Social platforms via yt-dlp -----------------------------------------

// A channel URL comes back as a list of tabs (Videos, Shorts, Live), each holding
// the real posts, so the captions we want sit one level down.
const flattenEntries = (node, out = [], depth = 0) => {
  for (const entry of node?.entries || []) {
    if (!entry) continue;
    if (Array.isArray(entry.entries) && depth < 2) flattenEntries(entry, out, depth + 1);
    else out.push(entry);
  }
  return out;
};

// yt-dlp is the only source of real engagement numbers, and it reads video posts
// of every format. It knows nothing about text-only posts, hence the page read
// that runs alongside it.
const socialToText = async (url) => {
  const { stdout } = await runYtdlp(
    [
      '--dump-single-json', '--no-warnings', '--flat-playlist',
      '--playlist-items', '1-12',
      '--socket-timeout', '30', '--retries', '2',
      ...(await cookieArgs(url)),
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  );

  const info = JSON.parse(stdout.toString());
  const entries = flattenEntries(info).slice(0, 12);
  const header = [
    `NGUỒN: ${platformOf(url)} - ${url}`,
    info.uploader || info.channel || info.title ? `TÀI KHOẢN: ${info.uploader || info.channel || info.title}` : '',
    info.description ? `GIỚI THIỆU / NỘI DUNG: ${info.description}` : '',
    info.follower_count ? `NGƯỜI THEO DÕI: ${info.follower_count}` : '',
  ].filter(Boolean);

  if (!entries.length) {
    // A link to a single post: the caption and hashtags are the brand's own words.
    const single = [
      info.title && info.title !== info.description ? `TIÊU ĐỀ: ${info.title}` : '',
      extractHashtags(`${info.title || ''}\n${info.description || ''}`).join(' '),
      info.view_count ? `LƯỢT XEM: ${info.view_count}` : '',
      info.like_count ? `LƯỢT THÍCH: ${info.like_count}` : '',
      info.upload_date ? `NGÀY ĐĂNG: ${info.upload_date}` : '',
    ].filter(Boolean);
    return { title: info.title || info.uploader || url, text: [...header, ...single].join('\n') };
  }

  const posts = entries.map((entry, i) => {
    const caption = entry.title || entry.description || '(không có caption)';
    const views = entry.view_count ? ` [${entry.view_count} lượt xem]` : '';
    return `${i + 1}. ${caption}${views}`;
  });

  return {
    title: info.title || info.uploader || url,
    text: [...header, '', 'CÁC BÀI ĐĂNG GẦN ĐÂY:', ...posts].join('\n'),
  };
};

// These three build their photo collage in the browser and hand a plain reader
// one og:image, so a post with ten pictures arrives looking like it has one.
const SCRIPTED_PHOTO_HOST_RE = /(^|\.)(?:facebook\.com|fb\.com|fb\.watch|instagram\.com|threads\.(?:net|com))$/i;

// The rendered page is read for its pictures, and - when a cookie jar lets the
// browser in - for the comments too. Its prose is still ignored: that is the same
// post the cheaper readers already returned, wrapped in login prompts and menus.
const readRendered = async (raw, { withComments = false } = {}) => {
  const rendered = await renderPage(raw, { withComments }).catch(() => null);
  if (!rendered) return null;
  const comments = withComments ? rendered.comments || [] : [];
  if (!rendered.imageUrls?.length && !comments.length) return null;
  return { imageUrls: rendered.imageUrls || [], comments, rendered: true };
};

// Facebook's preview image is its crawler re-encoding the post's first photo, so
// once the page itself has been rendered it is a duplicate wearing a new name.
const FB_CRAWLER_MEDIA_RE = /lookaside\.fbsbx\.com\/lookaside\/crawler\/media/i;

// ----- Facebook comments ---------------------------------------------------
// Comments are where a buyer says the thing the caption never will - the real
// objection, the price question, the workaround. Measured against a live post:
// the browser identity is answered with HTTP 400, facebookexternalhit gets a
// 351KB shell holding no comment at all, and only Googlebot is served the post
// with its comments embedded in the shipped JSON. So this one identity is the
// whole story, and `readPage` cannot be relied on to reach it - it stops at the
// first identity returning 1500 characters, which on many posts is not this one.
const FB_HOST_RE = /(^|\.)(?:facebook\.com|fb\.com|fb\.watch)$/i;
const GOOGLEBOT_UA = CRAWLER_UAS[0];

// Facebook ships these in the very same JSON fields as the comments, so without
// naming them they arrive looking like things a reader said.
const FB_COMMENT_NOISE_RE = new RegExp(
  '^(' + [
    'bình luận đã bị tắt', 'bất kỳ ai cũng có thể nhìn thấy',
    'chỉ những thành viên trong nhóm', 'bạn hiện không xem được nội dung này',
    'đăng nhập vào facebook', 'bạn quên tài khoản',
    'a server error', 'check server logs',
  ].join('|') + ')',
  'i',
);

const sameOpening = (a, b) => {
  const key = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase();
  return !!a && !!b && key(a) === key(b);
};

/**
 * The post's reader comments, in the order Facebook ranks them. Returns an empty
 * list rather than throwing: a post with comments turned off, a login-walled
 * group or a plain fetch failure all mean the same thing to the caller.
 */
const readFacebookComments = async (url, raw) => {
  let html;
  try {
    const { response, buffer } = await fetchPage(url, GOOGLEBOT_UA);
    if (!response.ok) return { comments: [] };
    html = buffer.toString('utf8');
  } catch {
    return { comments: [] };
  }

  // The caption rides in the same JSON fields as the comments; og:description is
  // how we tell the two apart.
  const caption = readMeta(html, ['og:description', 'description', 'twitter:description']);

  const comments = extractEmbeddedBlocks(html)
    .filter((block) => !FB_COMMENT_NOISE_RE.test(block))
    .filter((block) => !sameOpening(block, caption))
    .slice(0, MAX_FB_COMMENTS);

  return { comments, caption };
};

// Every reader that can say something about this link, merged. yt-dlp brings the
// engagement numbers, the page read brings text posts and the full captions, and
// X needs its own widget endpoints - no single one covers every post format.
const readSocial = async (url, raw, { withComments = false } = {}) => {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isX = /(^|\.)(x|twitter)\.com$/.test(host);
  const isDouyin = DOUYIN_HOST_RE.test(host);
  // Identifying the comments is worth doing either way - with the switch on they
  // become a labelled section, with it off they are what gets removed. Only the
  // signed-in browser read is gated, because that one costs a page load.
  const isFacebook = FB_HOST_RE.test(host);
  const wantsComments = withComments && isFacebook;

  const readers = [
    isX ? readX(url).catch(() => null) : null,
    isDouyin ? readDouyin(raw).catch(() => null) : null,
    SCRIPTED_PHOTO_HOST_RE.test(host) && canRender()
      ? readRendered(raw, { withComments: wantsComments && hasCookieJar() })
      : null,
    socialToText(raw).then((r) => r, (err) => ({ ytdlpError: explainYtdlpError(err) })),
    readPage(url, raw).then((r) => r, (err) => ({ pageError: err.message })),
  ].filter(Boolean);

  // Runs alongside the readers rather than through them: `readPage` returns the
  // first identity that yields enough text, which is often not the one Facebook
  // gives comments to.
  const commentRead = isFacebook
    ? readFacebookComments(url, raw).catch(() => ({ comments: [] }))
    : Promise.resolve({ comments: [] });

  const [results, commentResult] = await Promise.all([Promise.all(readers), commentRead]);

  // When one reader returns the post in structured form, the looser readers add
  // noise rather than information.
  const hasExclusive = results.some((r) => r && r.exclusive && r.text);

  const blocks = [];
  const imageUrls = [];
  let title = '';
  const problems = [];
  let gotPosts = false;

  for (const result of results) {
    if (!result) continue;
    if (result.ytdlpError) { problems.push(`yt-dlp: ${result.ytdlpError}`); continue; }
    if (result.pageError) { problems.push(`đọc trang: ${result.pageError}`); continue; }
    if (result.kind === 'pdf') return result;
    if (hasExclusive && !result.exclusive) continue;
    if (Array.isArray(result.imageUrls)) imageUrls.push(...result.imageUrls);
    if (result.text) {
      blocks.push(result.text.trim());
      if (result.hasPosts) gotPosts = true;
      if (!title) title = result.title || '';
    }
  }

  if (!blocks.length) {
    throw new Error(problems.join(' | ') || 'Không đọc được nội dung nào từ liên kết này.');
  }

  // The readers overlap, so identical lines are dropped rather than sent twice.
  const seen = new Set();
  const merged = blocks
    .join('\n\n')
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (key.length < 15) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // Those same comments already arrived through the page read - unlabelled, and
  // sitting flush against the caption, so the model had no way to tell a reader's
  // objection from the brand's own words. They are therefore always lifted out,
  // whichever way the switch is set: naming them is what makes them usable, and
  // removing them is what makes "off" mean off. Leaving them in place unnamed is
  // the one outcome that helps nobody.
  // Two ways in, and they do not overlap in strength: signed in, the browser sees
  // every comment; signed out, Googlebot's copy is all there is. Whichever came
  // back richer is the one worth sending.
  const rendered = results.flatMap((r) => (Array.isArray(r?.comments) ? r.comments : []));
  const crawled = commentResult.comments || [];
  const comments = rendered.length > crawled.length ? rendered : crawled;
  let body = merged;

  if (comments.length) {
    const spoken = new Set(
      comments.flatMap((c) => c.split('\n').map((l) => l.trim()).filter((l) => l.length >= 15)),
    );
    body = merged
      .split('\n')
      .filter((line) => {
        const key = line.trim();
        // Facebook's own interjections - the group blurb, a stray server error -
        // read as post copy once the comments around them are gone.
        return !spoken.has(key) && !FB_COMMENT_NOISE_RE.test(key);
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (withComments) {
      body += `\n\nBÌNH LUẬN CỦA NGƯỜI ĐỌC (${comments.length}):\n` +
        comments.map((c, i) => `${i + 1}. ${c.replace(/\s+/g, ' ').trim()}`).join('\n');
      console.log(`[fetch-source] đọc kèm ${comments.length} bình luận`);
    } else {
      console.log(`[fetch-source] bỏ ${comments.length} bình luận theo lựa chọn của người dùng`);
    }
  }

  const gotRendered = results.some((r) => r?.rendered && r.imageUrls?.length);
  const candidates = [...new Set(imageUrls)].filter((u) => !gotRendered || !FB_CRAWLER_MEDIA_RE.test(u));

  const images = await downloadPostImages(candidates, raw);
  if (images.length) console.log(`[fetch-source] tải kèm ${images.length} ảnh trong bài`);

  const isProfile = isX && X_PROFILE.test(url.pathname);
  return {
    url: raw,
    kind: 'social',
    title: title || raw,
    text: body.slice(0, SOURCE_MAX_CHARS),
    // The pictures that came with the post, so the model can read what the
    // caption leaves out.
    images,
    // Shown in the UI so a thin read is visible rather than guessed at. Zero when
    // the switch is off, because none of them were sent.
    commentCount: withComments ? comments.length : 0,
    // Shown to the user, never sent to the model: X only serves its timeline to
    // logged-in readers, so a profile link yields the bio and little else.
    note: isProfile && !gotPosts && merged.length < 900
      ? 'X chỉ mở một phần dòng thời gian cho người chưa đăng nhập, nên bài đăng lấy được rất ít. Dán thêm link từng bài cụ thể, hoặc đặt YTDLP_COOKIES_FROM_BROWSER trên máy chủ để đọc đầy đủ.'
      : undefined,
  };
};

export const handleFetchSource = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  try {
    const body = await readJsonBody(req, 100_000);
    const raw = String(body.url || '').trim();
    if (!raw) return sendJson(res, 400, { error: 'Thiếu đường dẫn cần đọc.' });

    const url = await assertPublicHttpUrl(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const isSocial = isAllowedUrl(raw) || /(^|\.)(x|twitter)\.com$/.test(host);
    const withComments = body.withComments === true;

    if (isSocial) {
      try {
        return sendJson(res, 200, await readSocial(url, raw, { withComments }));
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    try {
      const page = await readPage(url, raw);
      if (page.kind !== 'web') return sendJson(res, 200, page);

      // An article's infographics, charts and screenshots carry wording the
      // prose never repeats, so they travel with the text.
      const images = await downloadPostImages(page.imageUrls || [], raw);
      if (images.length) console.log(`[fetch-source] tải kèm ${images.length} ảnh trong bài`);
      return sendJson(res, 200, { ...page, images });
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  } catch (err) {
    console.error('[fetch-source]', err);
    sendJson(res, 400, { error: err?.message || 'Không đọc được nguồn này.' });
  }
};

// ---------------------------------------------------------------------------
// Content Radar. Discovery only: finds content worth studying, never downloads
// or analyses it. The Apify token stays on this side of the wire.

const radarRoute = (run) => async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  try {
    const body = await readJsonBody(req, 100_000);
    const payload = await run(body);
    sendJson(res, 200, payload);
  } catch (err) {
    // RadarRequestError (bad input) and RadarProviderError (upstream) both carry
    // a message written for the user; anything else must not leak outwards.
    const status = typeof err?.status === 'number' ? err.status : 500;
    const known = err?.name === 'RadarRequestError' || err?.name === 'RadarProviderError';
    if (!known) console.error('[radar]', err);
    sendJson(res, status, {
      error: known ? err.message : 'Không quét được lúc này. Thử lại sau ít phút.',
    });
  }
};

export const handleRadarSearch = (req, res, fallbackApiKey = '') =>
  radarRoute((body) =>
    radar.searchByKeyword(body, { geminiApiKey: (body.apiKey || '').trim() || fallbackApiKey })
  )(req, res);

export const handleRadarSuggest = (req, res, fallbackApiKey = '') =>
  radarRoute((body) =>
    radar.suggestKeywords(body, { geminiApiKey: (body.apiKey || '').trim() || fallbackApiKey })
  )(req, res);

export const handleRadarCreators = radarRoute((body) => radar.searchCreators(body));

// Carries the Gemini key for the same reason the search route does: a keyword
// aimed at a Douyin creator has to be translated before it can match anything.
export const handleRadarCreatorVideos = (req, res, fallbackApiKey = '') =>
  radarRoute((body) =>
    radar.getCreatorVideos(body, { geminiApiKey: (body.apiKey || '').trim() || fallbackApiKey })
  )(req, res);
