// Content Machine as a desktop app.
//
// The whole app already exists as a web app plus a plain Node server, so this
// file adds the smallest thing that turns the pair into something a person can
// double-click: it starts the very same server on a private port and points one
// window at it. No feature knows it is running inside Electron.
//
// Two deliberate differences from `npm start`:
//
//  1. The server binds 127.0.0.1, not 0.0.0.0. On a personal machine a server
//     reachable from the local network is a way in that nobody asked for.
//  2. The port is chosen at run time. A fixed 3100 collides with whatever else
//     the user happens to be running, and a desktop app that refuses to open
//     because of a port clash is a bug report waiting to happen.

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');

// How long to let the server come up before admitting something is wrong.
const SERVER_READY_TIMEOUT_MS = 20_000;
const SERVER_POLL_MS = 200;

// Cổng phải ổn định giữa các lần mở app.
//
// Brand DNA, bộ tiêu chí chấm điểm, lịch sử nội dung và key tích hợp đều nằm
// trong localStorage của trang, mà trình duyệt gắn localStorage vào origin
// `http://127.0.0.1:<cổng>`. Lấy cổng ngẫu nhiên mỗi lần chạy nghĩa là mỗi lần
// mở app lại là một origin khác, và người dùng thấy toàn bộ dữ liệu của mình
// biến mất dù không ai xoá gì. Vì vậy ở đây thử một dải cổng cố định trước, chỉ
// khi cả dải đều bận mới rơi về cổng ngẫu nhiên.
const PREFERRED_PORTS = [41337, 41338, 41339, 41340, 41341];

/** True nếu cổng này đang trống. */
const canListen = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/** Một cổng ngẫu nhiên OS đang để trống, dùng làm phương án cuối. */
const findRandomPort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Cổng cố định nếu còn trống, để dữ liệu người dùng không đổi chỗ sau mỗi lần mở. */
const findFreePort = async () => {
  for (const port of PREFERRED_PORTS) {
    if (await canListen(port)) return port;
  }
  return findRandomPort();
};

/** Resolves once the server answers, so the window never opens on a dead port. */
const waitForServer = async (port) => {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const alive = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (alive) return true;
    await new Promise((r) => setTimeout(r, SERVER_POLL_MS));
  }
  return false;
};

/**
 * Starts the production server inside this process.
 *
 * It is imported rather than spawned because Electron's main process is already
 * Node - a second process would mean shipping a Node binary and keeping it
 * alive. The trade-off is that `production.mjs` calls `process.exit(1)` when the
 * build is missing, which here would close the app with no explanation, so that
 * one case is checked first and reported properly.
 */
const startServer = async (port) => {
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';

  const { stat } = require('node:fs/promises');
  try {
    await stat(path.join(ROOT, 'dist', 'index.html'));
  } catch {
    throw new Error(
      'Không tìm thấy giao diện đã build (thư mục dist).\n\n' +
      'Nếu bạn đang chạy từ mã nguồn, chạy lệnh "npm run build" trước.'
    );
  }

  await import('../server/production.mjs');
};

const createWindow = (port) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f8fafc',
    show: false,
    title: 'Content Machine',
    webPreferences: {
      // The page is our own build served over loopback, but it still has no
      // reason to reach into Node - and every reason not to, since it renders
      // text fetched from arbitrary websites.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);

  // Anything aimed elsewhere - a Calendly booking, a Google AI Studio key page,
  // a source article - belongs in the real browser, not in a chromeless window
  // the user cannot navigate.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
};

// Mở app lần thứ hai sẽ chiếm cổng khác, tức là một kho dữ liệu khác. Thà đưa
// người dùng về đúng cửa sổ đang mở còn hơn để họ làm việc trên một bản trống.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  try {
    const port = await findFreePort();
    await startServer(port);

    if (!await waitForServer(port)) {
      throw new Error('Máy chủ nội bộ không phản hồi sau 20 giây.');
    }

    createWindow(port);

    // macOS keeps the app running with no windows; clicking the dock icon is
    // how a window comes back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (err) {
    dialog.showErrorBox('Không khởi động được Content Machine', err?.message || String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
