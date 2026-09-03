// Facebook, Instagram and Threads answer a plain HTTP reader with a login wall
// carrying a single og:image - the post's first photo and nothing else. Every
// other picture is only ever built by the page's own scripts, so no amount of
// HTML parsing can recover it.
//
// A real browser, still logged out, does render the post: the collage, its
// photos and the full caption. So the pictures a reader cannot see are fetched
// the way a visitor sees them - one headless page load, no login, no account.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBrowser } from './douyinCookies.mjs';

const LAUNCH_TIMEOUT_MS = 20_000;
// Long enough for the collage to load; the post itself renders well before this.
const PAGE_WAIT_MS = 9_000;
// A page's own avatar is a large file shown in a tiny circle, so the box it
// occupies on screen tells post photos from furniture better than the file does.
const MIN_DISPLAYED_PX = 160;
const MIN_NATURAL_PX = 200;
const MAX_IMAGES = 24;
// Each round clicks whatever "view more comments" buttons are on screen and
// scrolls; Facebook loads one page of replies per round.
const COMMENT_ROUNDS = 6;
const COMMENT_ROUND_WAIT_MS = 2_200;
const MAX_RENDERED_COMMENTS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cookies exported from a signed-in browser, in the Netscape format yt-dlp
 * already uses here, turned into what CDP wants. Logged out, Facebook answers a
 * headless browser with a 236-character login wall and no comments at all, so
 * this file is the difference between seven comments and all of them.
 */
const loadCookieJar = async () => {
  const file = process.env.FB_COOKIES_FILE || process.env.YTDLP_COOKIES_FILE;
  if (!file) return [];

  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    console.log('[render] không đọc được file cookie:', file);
    return [];
  }

  const cookies = [];
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    // domain, includeSubdomains, path, secure, expires, name, value
    const parts = text.split('\t');
    if (parts.length < 7) continue;
    const [domain, , cookiePath, secure, expires, name, value] = parts;
    if (!name) continue;
    cookies.push({
      name,
      value: value ?? '',
      domain,
      path: cookiePath || '/',
      secure: secure === 'TRUE',
      expires: Number(expires) > 0 ? Number(expires) : undefined,
    });
  }
  return cookies;
};

export const hasCookieJar = () => !!(process.env.FB_COOKIES_FILE || process.env.YTDLP_COOKIES_FILE);

// One browser at a time: a page load costs a process and ~200MB, and two links
// read at once must not turn into two Chromes.
let queue = Promise.resolve();

/** Chrome writes the port it actually bound to into the profile directory. */
const readAssignedPort = async (profile) => {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < LAUNCH_TIMEOUT_MS / 300; i++) {
    try {
      const port = Number((await readFile(file, 'utf8')).split('\n')[0].trim());
      if (port > 0) return port;
    } catch { /* not written yet */ }
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
    } catch { /* browser still starting */ }
    await sleep(400);
  }
  return null;
};

// Runs inside the page. Reads what a visitor actually sees: the rendered photos
// at their displayed size, and the post text with the login prompt still in it -
// the caller keeps only what the cheaper readers missed.
const COLLECT = `JSON.stringify({
  title: document.title,
  text: (document.body && document.body.innerText || '').slice(0, 20000),
  images: [...document.images]
    .map((img) => {
      const box = img.getBoundingClientRect();
      return { src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, bw: box.width, bh: box.height };
    })
    .filter((i) => i.src && i.src.startsWith('http')
      && i.w >= ${MIN_NATURAL_PX} && i.h >= ${MIN_NATURAL_PX}
      && i.bw >= ${MIN_DISPLAYED_PX} && i.bh >= ${MIN_DISPLAYED_PX})
    .map((i) => i.src),
  // Facebook marks every comment as its own article and names it in the
  // aria-label ("Bình luận của ..."), which is also how it tells them apart from
  // the post itself - the post is an article too.
  comments: [...document.querySelectorAll('div[role="article"]')]
    .filter((el) => /^(b\\u00ecnh lu\\u1eadn|comment)/i.test(el.getAttribute('aria-label') || ''))
    .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter((t) => t.length > 10)
    .slice(0, ${MAX_RENDERED_COMMENTS})
})`;

// Opens whatever is collapsed and asks for the next page of replies. Returns how
// many buttons it pressed so the caller can stop once nothing is left to open.
const EXPAND = `(function () {
  var pressed = 0;
  var wanted = /xem th\\u00eam b\\u00ecnh lu\\u1eadn|xem t\\u1ea5t c\\u1ea3 b\\u00ecnh lu\\u1eadn|b\\u00ecnh lu\\u1eadn tr\\u01b0\\u1edbc|xem th\\u00eam c\\u00e2u tr\\u1ea3 l\\u1eddi|view more comments|previous comments|more replies|xem th\\u00eam/i;
  var buttons = document.querySelectorAll('div[role="button"], span[role="button"]');
  for (var i = 0; i < buttons.length; i++) {
    var label = (buttons[i].innerText || '').trim();
    if (label && label.length < 60 && wanted.test(label)) {
      try { buttons[i].click(); pressed++; } catch (e) { /* detached */ }
    }
  }
  window.scrollTo(0, document.body.scrollHeight);
  return pressed;
})()`;

const render = async (pageUrl, { withComments = false } = {}) => {
  const browser = findBrowser();
  if (!browser) return null;
  if (typeof WebSocket === 'undefined') return null;

  const profile = await mkdtemp(path.join(tmpdir(), 'cm-page-'));
  const child = spawn(browser, [
    '--headless=new',
    // 0 means "pick any free port"; the real one is read back below.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    '--lang=vi-VN',
    // Tall enough that a photo collage renders without scrolling.
    '--window-size=1280,2400',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const port = await readAssignedPort(profile);
    if (!port) return null;

    const endpoint = await openPage(port);
    if (!endpoint) return null;

    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('không mở được kênh điều khiển trình duyệt'));
      setTimeout(() => reject(new Error('hết thời gian chờ trình duyệt')), LAUNCH_TIMEOUT_MS);
    });

    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
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

    await send('Page.enable');

    // Must land before the first navigation, or Facebook serves the login wall
    // and never re-reads the jar.
    if (withComments) {
      const cookies = await loadCookieJar();
      if (cookies.length) {
        await send('Network.enable');
        await send('Network.setCookies', { cookies });
        console.log(`[render] nạp ${cookies.length} cookie đăng nhập`);
      }
    }

    await send('Page.navigate', { url: pageUrl });
    await sleep(PAGE_WAIT_MS);

    // Facebook shows a handful of comments and hides the rest behind a button,
    // so the rest only exist after somebody asks for them.
    if (withComments) {
      for (let round = 0; round < COMMENT_ROUNDS; round++) {
        const opened = await send('Runtime.evaluate', { expression: EXPAND, returnByValue: true });
        await sleep(COMMENT_ROUND_WAIT_MS);
        if (!opened?.result?.value) break;
      }
    }

    const evaluated = await send('Runtime.evaluate', { expression: COLLECT, returnByValue: true });
    const value = evaluated?.result?.value;
    if (!value) return null;

    const data = JSON.parse(value);
    const images = [...new Set(data.images || [])].slice(0, MAX_IMAGES);
    return {
      title: data.title || '',
      text: data.text || '',
      imageUrls: images,
      comments: data.comments || [],
    };
  } catch (err) {
    console.log('[render] không dựng được trang:', err?.message || err);
    return null;
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    child.kill();
    // The profile is only a scratch area for one page load.
    rm(profile, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * The post as a browser renders it, or null when no browser is installed or the
 * load failed. Callers treat it as a bonus reader, never as the only one.
 */
export const renderPage = (pageUrl, opts = {}) => {
  const run = queue.then(() => render(pageUrl, opts), () => render(pageUrl, opts));
  // The queue must survive a failed render, so it tracks completion only.
  queue = run.then(() => {}, () => {});
  return run;
};

/** Used by callers that only want to pay for a browser when there is one. */
export const canRender = () => !!findBrowser() && typeof WebSocket !== 'undefined';
