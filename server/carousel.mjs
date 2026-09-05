// Dựng ảnh carousel: HTML -> PNG 1080x1080.
//
// Toàn bộ tính năng ảnh nằm gọn trong file này và không đụng vào bất kỳ đường
// dẫn nào đang chạy. Nó mượn đúng một thứ của phần cũ - hàm tìm Chrome trong
// douyinCookies.mjs - và không sửa gì ở đó.
//
// Vì sao tự render thay vì gọi Playwright như script gốc của Tabcom: app đóng
// gói bằng Electron nên máy người dùng luôn có sẵn Chromium, còn Playwright thì
// phải cài riêng. Cùng một cơ chế CDP, không thêm phụ thuộc nào.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBrowser } from './douyinCookies.mjs';

const LAUNCH_TIMEOUT_MS = 20_000;
const SLIDE = 1080;
// Nền và ảnh chụp là file lớn; Chrome cần một nhịp vẽ để giải mã xong.
const PAINT_SETTLE_MS = 350;
const MAX_SLIDES = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Một trình duyệt tại một thời điểm, giống browserPage.mjs: mỗi lần mở tốn một
// tiến trình và khoảng 200MB.
let queue = Promise.resolve();

const readAssignedPort = async (profile) => {
  const { readFile } = await import('node:fs/promises');
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < LAUNCH_TIMEOUT_MS / 300; i++) {
    try {
      const port = Number((await readFile(file, 'utf8')).split('\n')[0].trim());
      if (port > 0) return port;
    } catch { /* Chrome chưa ghi xong */ }
    await sleep(300);
  }
  return 0;
};

const openPage = async (port) => {
  for (let i = 0; i < LAUNCH_TIMEOUT_MS / 400; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const target = (await res.json()).find((t) => t.type === 'page');
        if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
      }
    } catch { /* đang khởi động */ }
    await sleep(400);
  }
  return null;
};

/** Đếm slide và đo khoảng trống còn lại dưới đáy từng slide. */
const MEASURE = `JSON.stringify(
  Array.prototype.map.call(document.querySelectorAll('.slide'), function (slide) {
    var box = slide.querySelector('.content');
    if (!box) return { freeBottom: null };

    // Bố cục hai cột: cột ảnh luôn cao hết khung nên đo nó thì lúc nào cũng ra 0
    // và chỉ số báo "vừa đẹp" cho một slide trống nửa dưới. Phải đo cột chữ.
    var target = box.classList.contains('side') ? box.querySelector('.col') : box;
    if (!target) return { freeBottom: null };

    var boxRect = box.getBoundingClientRect();
    var last = target.lastElementChild;
    if (!last) return { freeBottom: Math.round(boxRect.height) };
    var lastRect = last.getBoundingClientRect();
    return { freeBottom: Math.round(boxRect.bottom - lastRect.bottom) };
  })
)`;

const renderInBrowser = async (html) => {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(
      'Không tìm thấy Chrome hoặc Edge trên máy để dựng ảnh. Cài một trong hai, ' +
      'hoặc đặt biến CHROME_PATH trỏ tới file thực thi.'
    );
  }
  if (typeof WebSocket === 'undefined') {
    throw new Error('Phiên bản Node này không có WebSocket, không điều khiển được trình duyệt.');
  }

  const work = await mkdtemp(path.join(tmpdir(), 'cm-carousel-'));
  const htmlPath = path.join(work, 'carousel.html');
  await writeFile(htmlPath, html, 'utf8');

  const profile = await mkdtemp(path.join(tmpdir(), 'cm-carousel-profile-'));
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    '--force-device-scale-factor=1',
    // Ảnh nền và font nạp từ data URI ngay trong trang, nhưng người dùng vẫn có
    // thể trỏ tới file trên máy nên trang cần đọc được file cục bộ.
    '--allow-file-access-from-files',
    `--window-size=${SLIDE},${SLIDE}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const port = await readAssignedPort(profile);
    if (!port) throw new Error('Trình duyệt không khởi động được để dựng ảnh.');

    const endpoint = await openPage(port);
    if (!endpoint) throw new Error('Không mở được kênh điều khiển trình duyệt.');

    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Không mở được kênh điều khiển trình duyệt.'));
      setTimeout(() => reject(new Error('Hết thời gian chờ trình duyệt.')), LAUNCH_TIMEOUT_MS);
    });

    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve(null); }
      }, LAUNCH_TIMEOUT_MS);
    });

    const evaluate = async (expression) => {
      const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (out?.result?.exceptionDetails) {
        throw new Error(`Lỗi khi dựng trang: ${out.result.exceptionDetails.text || 'không rõ'}`);
      }
      return out?.result?.result?.value;
    };

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: SLIDE, height: SLIDE, deviceScaleFactor: 1, mobile: false,
    });

    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    await send('Page.navigate', { url: fileUrl });
    // Đợi trang và font sẵn sàng thay vì đoán bằng một khoảng chờ cố định.
    await evaluate('document.readyState === "complete" ? true : new Promise(r => window.addEventListener("load", () => r(true)))');
    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
    await sleep(PAINT_SETTLE_MS);

    const count = await evaluate('document.querySelectorAll(".slide").length');
    if (!count) throw new Error('Nội dung không có slide nào (thiếu phần tử .slide).');
    if (count > MAX_SLIDES) throw new Error(`Quá nhiều slide (${count}). Tối đa ${MAX_SLIDES}.`);

    const rhythm = JSON.parse(await evaluate(MEASURE) || '[]');

    const slides = [];
    for (let i = 0; i < count; i++) {
      // Tách riêng từng slide rồi chụp cả khung nhìn: đơn giản và chắc hơn là
      // cắt theo toạ độ, vì slide nào cũng đúng 1080x1080.
      await evaluate(`(function(){
        var all = document.querySelectorAll('.slide');
        var one = all[${i}].cloneNode(true);
        document.body.replaceChildren(one);
        document.body.style.margin = '0';
        document.body.style.gap = '0';
        document.body.style.background = '#fff';
        return true;
      })()`);
      await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
      await sleep(PAINT_SETTLE_MS);

      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: SLIDE, height: SLIDE, scale: 1 },
        captureBeyondViewport: true,
      });
      const data = shot?.result?.data;
      if (!data) throw new Error(`Không chụp được slide ${i + 1}.`);
      slides.push(data);

      // Nạp lại trang cho lần chụp kế, vì DOM vừa bị thay bằng một slide.
      if (i < count - 1) {
        await send('Page.navigate', { url: fileUrl });
        await evaluate('document.readyState === "complete" ? true : new Promise(r => window.addEventListener("load", () => r(true)))');
      }
    }

    return { slides, rhythm };
  } finally {
    try { ws?.close(); } catch { /* đã đóng */ }
    child.kill();
    rm(profile, { recursive: true, force: true }).catch(() => {});
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
};

/** Xếp hàng để hai yêu cầu dựng ảnh không mở hai Chrome cùng lúc. */
export const renderCarousel = (html) => {
  const run = queue.then(() => renderInBrowser(html), () => renderInBrowser(html));
  queue = run.then(() => {}, () => {});
  return run;
};

export const canRenderCarousel = () => !!findBrowser() && typeof WebSocket !== 'undefined';
