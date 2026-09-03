// Google Drive / Sheets connection.
//
// Uses Google Identity Services in the browser, not a server-side OAuth
// exchange. That choice matters: GIS needs only a Client ID, never a client
// secret, so nothing confidential has to live on this machine or in the repo.
// The access token stays in memory for the tab's lifetime and is never written
// to localStorage.
//
// Scope is drive.file - the narrowest one that can do the job. It grants access
// ONLY to files this app itself creates. It cannot read, list or touch anything
// else in the user's Drive, which is exactly the promise the Integrations panel
// makes.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const STORAGE_KEY = 'cm_google_drive';

declare global {
  interface Window {
    google?: any;
  }
}

export interface GoogleConnection {
  clientId: string;
  /** Email of the connected account, when Google told us. */
  email?: string;
  connectedAt?: number;
  /**
   * Whether a finished piece of content is copied to Drive on its own.
   * On by default: local history expires within a week, so a backup that waits
   * for someone to remember a button is a backup that will not be there.
   */
  autoBackup?: boolean;
}

// ---------------------------------------------------------------------------
// settings

const read = (): GoogleConnection => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return { clientId: '' };
  }
};

const write = (patch: Partial<GoogleConnection>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
  } catch (e) {
    console.error('Không lưu được cấu hình Google', e);
  }
};

export const getGoogleClientId = (): string => (read().clientId || '').trim();
export const setGoogleClientId = (clientId: string): void => write({ clientId: clientId.trim() });
export const getGoogleConnection = (): GoogleConnection => read();

/** The account Drive is connected to. Empty until a first successful call. */
export const getConnectedEmail = (): string => (read().email || '').trim();

export const isAutoBackupEnabled = (): boolean => read().autoBackup !== false;
export const setAutoBackupEnabled = (enabled: boolean): void => write({ autoBackup: enabled });

export const clearGoogleConnection = (): void => {
  accessToken = null;
  tokenExpiresAt = 0;
  write({ email: undefined, connectedAt: undefined });
};

// ---------------------------------------------------------------------------
// token

// Deliberately module-scope and not persisted: a Drive token is a bearer
// credential, and localStorage is readable by anything that gets script access.
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let gisPromise: Promise<void> | null = null;

export const isConnected = (): boolean => !!accessToken && Date.now() < tokenExpiresAt;

const loadGis = (): Promise<void> => {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;

  gisPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('load failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(script);
  }).catch(() => {
    // Let a later attempt retry instead of caching the failure forever.
    gisPromise = null;
    throw new Error('Không tải được thư viện đăng nhập của Google. Kiểm tra kết nối mạng rồi thử lại.');
  });

  return gisPromise;
};

/**
 * Opens Google's consent popup and keeps the resulting token in memory.
 *
 * @param interactive false re-uses an existing grant without showing a popup,
 *   which is what an export should try first so it does not interrupt the user.
 */
export const connectGoogle = async (interactive = true): Promise<void> => {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Chưa có Google Client ID. Vào mục Tích hợp, phần Google Drive, để dán vào.');
  }

  await loadGis();

  await new Promise<void>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? 'consent' : '',
      callback: (response: any) => {
        if (response?.error) {
          reject(new Error(explainOauthError(response.error)));
          return;
        }
        accessToken = response.access_token;
        // Google returns seconds; renew a minute early so a long export does not
        // die mid-flight.
        tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
        write({ connectedAt: Date.now() });
        resolve();
      },
      error_callback: (err: any) => {
        reject(new Error(explainOauthError(err?.type || err?.message || '')));
      },
    });

    client.requestAccessToken();
  });
};

const explainOauthError = (code: string): string => {
  const text = String(code || '');
  if (/popup_closed|popup_failed_to_open|user_cancel/i.test(text)) {
    return 'Bạn đã đóng cửa sổ đăng nhập Google. Thử lại và cho phép popup cho trang này.';
  }
  if (/access_denied/i.test(text)) return 'Bạn đã từ chối quyền truy cập Google Drive.';
  if (/invalid_client|unauthorized_client/i.test(text)) {
    return 'Google Client ID không hợp lệ, hoặc địa chỉ trang này chưa được thêm vào "Authorized JavaScript origins".';
  }
  return `Google từ chối kết nối: ${text || 'không rõ nguyên nhân'}`;
};

/** A token for an API call: silent if a grant already exists, popup otherwise. */
const requireToken = async (): Promise<string> => {
  if (isConnected()) return accessToken as string;

  try {
    await connectGoogle(false);
  } catch {
    // No existing grant to reuse - ask properly.
    await connectGoogle(true);
  }

  if (!accessToken) throw new Error('Chưa kết nối được Google Drive.');
  return accessToken;
};

// ---------------------------------------------------------------------------
// Sheets

const googleFetch = async (url: string, init: RequestInit): Promise<any> => {
  const token = await requireToken();

  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* handled below */ }

  if (!res.ok) {
    const message = json?.error?.message || text.slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      accessToken = null;
      tokenExpiresAt = 0;
      if (/API has not been used|is disabled/i.test(message)) {
        throw new Error(
          'Google Sheets API chưa được bật cho project này. Bật "Google Sheets API" và "Google Drive API" trong Google Cloud Console rồi thử lại.'
        );
      }
      throw new Error('Google từ chối yêu cầu. Bấm Kết nối lại ở mục Tích hợp rồi thử lại.');
    }
    throw new Error(`Google báo lỗi: ${message}`);
  }

  return json;
};

/**
 * Creates a spreadsheet, writes the table into it and returns its URL.
 *
 * Three calls rather than one giant create payload: create, write values, then
 * format. Splitting them keeps a formatting failure from losing the data.
 */
export const exportToGoogleSheet = async (
  title: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<string> => {
  const created = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Content Radar', gridProperties: { frozenRowCount: 1 } } }],
    }),
  });

  const spreadsheetId = created?.spreadsheetId;
  const sheetId = created?.sheets?.[0]?.properties?.sheetId ?? 0;
  if (!spreadsheetId) throw new Error('Google không trả về id của bảng tính.');

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [headers, ...rows] }) }
  );

  // Cosmetic only - a failure here still leaves a usable sheet.
  try {
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length },
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.error('[radar] không định dạng được bảng tính, dữ liệu vẫn đầy đủ:', err);
  }

  return created?.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
};

// ---------------------------------------------------------------------------
// Drive files
//
// What the history backup needs on top of Sheets: a folder to put things in,
// and two kinds of upload. Everything here stays inside drive.file, so the app
// can only ever see the folder and files it made itself.

export interface DriveFile {
  id: string;
  url: string;
}

/**
 * The email of the connected account, cached in settings once known.
 *
 * about.get is allowed under drive.file, so this needs no extra scope and no
 * consent screen beyond the one already shown. The history uses it to keep two
 * people who share one office browser from seeing each other's work.
 */
export const ensureUserEmail = async (): Promise<string> => {
  const cached = getConnectedEmail();
  if (cached) return cached;

  try {
    const about = await googleFetch('https://www.googleapis.com/drive/v3/about?fields=user', { method: 'GET' });
    const email = String(about?.user?.emailAddress || '').trim();
    if (email) write({ email });
    return email;
  } catch (err) {
    // Not knowing the email costs only the per-account filter, never the backup.
    console.error('[drive] không lấy được email tài khoản', err);
    return '';
  }
};

/**
 * multipart/related upload: one request carrying the file's metadata and its
 * bytes. Resumable upload would be the right call for large media, but history
 * files are HTML and thumbnails - well under the 5MB where simple upload stops
 * being appropriate.
 */
const driveUpload = async (metadata: Record<string, unknown>, body: Blob | string, contentType: string): Promise<DriveFile> => {
  const token = await requireToken();
  const boundary = `cm${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const form = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    body,
    `\r\n--${boundary}--\r\n`,
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: form,
    }
  );

  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* handled below */ }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      accessToken = null;
      tokenExpiresAt = 0;
    }
    throw new Error(json?.error?.message || `Google từ chối tải file lên (HTTP ${res.status}).`);
  }

  const id = json?.id;
  if (!id) throw new Error('Google không trả về id của file vừa tạo.');
  return { id, url: json?.webViewLink || `https://drive.google.com/file/d/${id}/view` };
};

/**
 * The backup folder, reused across sessions rather than recreated.
 *
 * files.list under drive.file only ever returns files this app created, so this
 * finds our own folder and cannot discover anything else in the Drive.
 */
export const findOrCreateFolder = async (name: string): Promise<DriveFile> => {
  const escaped = name.replace(/'/g, "\\'");
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`
  );

  const found = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,webViewLink)&pageSize=1`,
    { method: 'GET' }
  );

  const existing = found?.files?.[0];
  if (existing?.id) {
    return { id: existing.id, url: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}` };
  }

  const created = await googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });

  if (!created?.id) throw new Error('Không tạo được thư mục trên Drive.');
  return { id: created.id, url: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}` };
};

/**
 * HTML in, a real Google Doc out.
 *
 * Naming the target mimeType makes Drive convert on the way in, so headings,
 * tables and bold text survive as document structure. Uploading the same HTML
 * without conversion would leave a file that opens as source code.
 */
export const uploadHtmlAsGoogleDoc = async (name: string, html: string, folderId: string): Promise<DriveFile> =>
  driveUpload(
    { name, parents: [folderId], mimeType: 'application/vnd.google-apps.document' },
    html,
    'text/html; charset=UTF-8'
  );

/** An image or any other blob, stored as-is. */
export const uploadFileToDrive = async (name: string, blob: Blob, folderId: string): Promise<DriveFile> =>
  driveUpload({ name, parents: [folderId] }, blob, blob.type || 'application/octet-stream');

/**
 * CSV in, a Google Sheet out, inside the given folder.
 *
 * The Sheets API used by the Radar export creates spreadsheets at the Drive
 * root with no way to name a parent, so the index sheet goes up this way
 * instead - one call, and it lands in the folder with everything else.
 */
export const uploadCsvAsGoogleSheet = async (name: string, csv: string, folderId: string): Promise<DriveFile> =>
  driveUpload(
    { name, parents: [folderId], mimeType: 'application/vnd.google-apps.spreadsheet' },
    csv,
    'text/csv; charset=UTF-8'
  );
