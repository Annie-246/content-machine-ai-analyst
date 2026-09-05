// Cổng HTTP cho việc dựng ảnh carousel.
//
// Để riêng khỏi handlers.mjs: file đó đã 1700 dòng và đang gánh mọi tính năng
// cũ. Tính năng ảnh mới nằm gọn ở đây, hỏng thì chỉ hỏng một mình nó.

import { renderCarousel, canRenderCarousel } from './carousel.mjs';

// Một bộ 10 slide kèm ảnh chụp nhúng data URI có thể lên tới vài chục MB.
const MAX_BODY_BYTES = 120 * 1024 * 1024;

const readJsonBody = (req, limit) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Nội dung gửi lên quá lớn. Bớt ảnh hoặc giảm số slide rồi thử lại.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Dữ liệu gửi lên không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
};

export const handleCarouselRender = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Chỉ hỗ trợ POST.' });

  if (!canRenderCarousel()) {
    return sendJson(res, 503, {
      error: 'Máy này chưa có Chrome hoặc Edge để dựng ảnh. Cài một trong hai rồi thử lại.',
    });
  }

  let body;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const html = String(body.html || '');
  if (!html.trim()) return sendJson(res, 400, { error: 'Thiếu nội dung cần dựng.' });

  try {
    const started = Date.now();
    const { slides, rhythm } = await renderCarousel(html);
    console.log(`[carousel] dựng ${slides.length} slide trong ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return sendJson(res, 200, {
      slides: slides.map((data) => `data:image/png;base64,${data}`),
      rhythm,
    });
  } catch (err) {
    console.error('[carousel]', err);
    return sendJson(res, 500, { error: err?.message || 'Không dựng được ảnh.' });
  }
};

export const handleCarouselHealth = async (_req, res) =>
  sendJson(res, 200, { ok: true, canRender: canRenderCarousel() });
