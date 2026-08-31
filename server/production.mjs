// Production server: serves the built frontend and the same /api routes the dev
// server exposes, so a deployed build behaves exactly like local development.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFetchVideo, handleFetchSource, handleLlm, handleGemini, sendJson,
  applyCors, checkAccess, handlePreflight, serverInfo,
  handleRadarSearch, handleRadarCreators, handleRadarCreatorVideos, handleRadarSuggest,
} from './handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const FALLBACK_KEY = process.env.GEMINI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const serveFile = async (res, filePath, cacheable) => {
  const ext = path.extname(filePath).toLowerCase();
  const info = await stat(filePath);

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', info.size);
  // Hashed asset filenames are safe to cache hard; index.html must not be.
  res.setHeader('Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache');

  createReadStream(filePath).pipe(res);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      // A browser on another origin sends OPTIONS before the real request.
      if (req.method === 'OPTIONS') return handlePreflight(req, res);
      applyCors(req, res);
      // /api/health stays open so the app can probe the server before setup.
      if (pathname !== '/api/health' && !checkAccess(req, res)) return;
    }

    if (pathname === '/api/fetch-video') return await handleFetchVideo(req, res, FALLBACK_KEY);
    if (pathname === '/api/fetch-source') return await handleFetchSource(req, res);
    if (pathname === '/api/llm') return await handleLlm(req, res);
    if (pathname === '/api/gemini') return await handleGemini(req, res, FALLBACK_KEY);
    if (pathname === '/api/radar/search') return await handleRadarSearch(req, res, FALLBACK_KEY);
    if (pathname === '/api/radar/suggest-keywords') return await handleRadarSuggest(req, res, FALLBACK_KEY);
    if (pathname === '/api/radar/creators') return await handleRadarCreators(req, res);
    if (pathname === '/api/radar/creator-videos') return await handleRadarCreatorVideos(req, res);
    if (pathname === '/api/health') return sendJson(res, 200, serverInfo());

    // Any other /api path is a real 404, never the SPA shell - otherwise the
    // browser would try to parse index.html as JSON.
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: `Không có endpoint ${pathname}.` });
    }

    // Block path traversal before touching the filesystem.
    const requested = path.normalize(path.join(DIST_DIR, pathname));
    if (!requested.startsWith(DIST_DIR)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }

    try {
      const info = await stat(requested);
      if (info.isFile()) {
        return await serveFile(res, requested, pathname.startsWith('/assets/'));
      }
    } catch { /* fall through to the SPA shell */ }

    const indexPath = path.join(DIST_DIR, 'index.html');
    const html = await readFile(indexPath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(html);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Lỗi máy chủ. Kiểm tra log để biết chi tiết.');
  }
});

// Long uploads and slow yt-dlp downloads must not be cut off mid-flight.
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 16 * 60 * 1000;

const start = async () => {
  try {
    await stat(path.join(DIST_DIR, 'index.html'));
  } catch {
    console.error('Chưa có thư mục dist. Chạy "npm run build" trước khi "npm start".');
    process.exit(1);
  }

  // A port clash should print one clear line, not an unhandled crash dump.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Cổng ${PORT} đang được dùng bởi tiến trình khác. Đặt PORT=<số khác> rồi chạy lại.`);
    } else {
      console.error('Không khởi động được máy chủ:', err.message);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Content Machine đang chạy tại http://localhost:${PORT}`);
    if (!FALLBACK_KEY) {
      console.log('Chưa đặt GEMINI_API_KEY - người dùng sẽ tự dán API key ở mục Tích hợp.');
    }
  });
};

start();

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
