// Douyin hands nothing to a client that has no session - yt-dlp fails every
// request with "Fresh cookies (not necessarily logged in) are needed". The
// cookies it wants are the ordinary anonymous ones any visitor receives, but
// they are only issued after the page's own scripts run.
//
// So we mint a session the one way that needs nothing from the user: load the
// page once in a headless browser and reuse the cookies it was given. No login,
// no account, no manual export. The jar is cached because minting it costs a
// browser launch.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const LAUNCH_TIMEOUT_MS = 20_000;
const PAGE_WAIT_MS = 9_000;
// The short-lived cookies in the jar (__ac_nonce) age out well before this.
const JAR_TTL_MS = 15 * 60 * 1000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const findBrowser = () => CHROME_CANDIDATES.find((p) => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
});

// One in-flight mint at a time; a second caller waits for the first.
let cached = null;
let inFlight = null;

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

const connect = async (port) => {
  for (let i = 0; i < LAUNCH_TIMEOUT_MS / 400; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch { /* browser still starting */ }
    await sleep(400);
  }
  return null;
};

const mint = async (pageUrl) => {
  const browser = findBrowser();
  if (!browser) return null;
  if (typeof WebSocket === 'undefined') return null;

  const profile = await mkdtemp(path.join(tmpdir(), 'cm-douyin-'));
  const child = spawn(browser, [
    '--headless=new',
    // 0 means "pick any free port"; the real one is read back below.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    '--lang=zh-CN',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const port = await readAssignedPort(profile);
    if (!port) {
      console.log('[douyin] trình duyệt không mở được cổng điều khiển');
      return null;
    }

    const endpoint = await connect(port);
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

    await send('Network.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: pageUrl });
    await sleep(PAGE_WAIT_MS);

    const result = await send('Network.getCookies', {
      urls: ['https://www.douyin.com/', 'https://www.iesdouyin.com/'],
    });
    const cookies = result?.cookies || [];
    if (!cookies.length) {
      console.log('[douyin] trình duyệt không nhận được cookie nào từ douyin.com');
      return null;
    }

    const jarDir = await mkdtemp(path.join(tmpdir(), 'cm-douyin-jar-'));
    const jar = path.join(jarDir, 'cookies.txt');
    const fallbackExpiry = Math.floor(Date.now() / 1000) + 86_400;
    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
      const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
      const expires = c.expires > 0 ? Math.floor(c.expires) : fallbackExpiry;
      lines.push([domain, 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expires), c.name, c.value].join('\t'));
    }
    await writeFile(jar, lines.join('\n') + '\n', 'utf8');

    console.log(`[douyin] tạo phiên ẩn danh: ${cookies.length} cookie`);
    return { jar, dir: jarDir, at: Date.now() };
  } catch (err) {
    console.log('[douyin] không tạo được phiên:', err?.message || err);
    return null;
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    child.kill();
    // The profile is only a scratch area for one launch.
    rm(profile, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * yt-dlp arguments carrying a usable Douyin session, or [] when none could be
 * made (no browser installed, or the mint failed). Callers fall back to their
 * normal error path in that case.
 */
export const douyinCookieArgs = async (pageUrl) => {
  if (cached && Date.now() - cached.at < JAR_TTL_MS) return ['--cookies', cached.jar];

  if (!inFlight) {
    inFlight = mint(pageUrl).finally(() => { inFlight = null; });
  }
  const minted = await inFlight;
  if (!minted) return [];

  if (cached?.dir && cached.dir !== minted.dir) {
    rm(cached.dir, { recursive: true, force: true }).catch(() => {});
  }
  cached = minted;
  return ['--cookies', cached.jar];
};

/** Used by the error message so it can say whether a browser was even available. */
export const hasBrowser = () => !!findBrowser();

// Keeps the module honest if it is ever run directly.
export const _selfTest = async (url) => {
  const args = await douyinCookieArgs(url);
  if (!args.length) return 'không tạo được cookie';
  const { stdout } = await execFileAsync('yt-dlp',
    ['--dump-single-json', '--no-warnings', '--no-playlist', ...args, url],
    { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  const info = JSON.parse(stdout.toString());
  return `${info.title} | ${info.duration}s | ${(info.formats || []).length} formats`;
};
