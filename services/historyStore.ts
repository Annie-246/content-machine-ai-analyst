// Lịch sử nội dung - kho lưu trên máy người dùng.
//
// IndexedDB, not localStorage, and not the server. Three reasons, in order of
// weight:
//
//  1. Privacy without auth. The app is deployed on a shared VPS behind a single
//     shared serverToken, so the server cannot tell one user from another.
//     Anything stored server-side would be visible to everyone. Keeping history
//     in the browser makes "only I can see my history" true by construction
//     rather than by a permission check nobody wrote yet.
//  2. Size. A generated thumbnail is a 1-3MB data URL. localStorage caps out
//     around 5MB total, so a single image would fill it. IndexedDB stores Blobs
//     and scales to hundreds of MB.
//  3. Nothing to deploy. No volume, no database, no migration - the container
//     stays stateless.
//
// The trade-off is real and deliberate: clearing browser data wipes the
// history. That is what the Google Drive backup exists for.

const DB_NAME = 'content-machine-history';
const DB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const STORE_ASSETS = 'assets';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Text lives a week, images three days.
 *
 * Images are ~95% of the bytes, so expiring them early is what keeps the store
 * small. The entry itself survives either way: an expired image leaves its
 * metadata behind so the UI can say "ảnh đã hết hạn" and link to the Drive copy
 * instead of silently showing a broken frame.
 */
export const TEXT_TTL_MS = 7 * DAY_MS;
export const ASSET_TTL_MS = 3 * DAY_MS;

export type HistoryKind = 'analysis' | 'image' | 'waterfall' | 'radar';

export interface HistoryAsset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface DriveBackup {
  fileId: string;
  url: string;
  uploadedAt: number;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  brandId: string;
  brandName: string;
  kind: HistoryKind;
  /** AnalysisMode for 'analysis' runs; absent for Radar and Waterfall. */
  mode?: string;
  /**
   * The feature name as the user saw it. Stored rather than looked up, because
   * a renamed or removed feature must not make old history unreadable.
   */
  modeLabel?: string;
  title: string;
  /** First couple of lines as plain text, so the list renders without parsing HTML. */
  preview: string;
  sourceUrl?: string;
  /** The result exactly as the model returned it - the app's own format is HTML. */
  html?: string;
  /** Structured payload for kinds that are not prose, e.g. Radar rows. */
  data?: unknown;
  assets: HistoryAsset[];
  /**
   * Google account this belongs to, when Drive is connected. Two people sharing
   * one office browser would otherwise share one history; filtering on this
   * separates them without the app needing a login of its own.
   */
  ownerEmail?: string;
  drive?: DriveBackup;
  /** Roughly how many bytes this entry occupies, for the storage readout. */
  size: number;
  assetsExpireAt: number;
  expiresAt: number;
  /** True once the blobs are gone but the entry remains. */
  assetsPurged?: boolean;
}

export interface SaveEntryInput {
  brandId: string;
  brandName: string;
  kind: HistoryKind;
  mode?: string;
  modeLabel?: string;
  title?: string;
  sourceUrl?: string;
  html?: string;
  data?: unknown;
  ownerEmail?: string;
  assets?: { name: string; mimeType: string; blob: Blob }[];
}

// ---------------------------------------------------------------------------
// connection

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trình duyệt này không hỗ trợ lưu lịch sử (IndexedDB không khả dụng).'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const entries = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
        // Listing is always "newest first", optionally narrowed to one brand.
        entries.createIndex('createdAt', 'createdAt');
        entries.createIndex('brandId', 'brandId');
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không mở được kho lịch sử.'));
    // Private windows and some locked-down profiles block IndexedDB outright.
    request.onblocked = () => reject(new Error('Kho lịch sử đang bị khoá bởi một tab khác. Đóng bớt tab rồi thử lại.'));
  }).catch((err) => {
    // Do not cache the failure - a later call should get a fresh attempt.
    dbPromise = null;
    throw err;
  });

  return dbPromise;
};

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Ghi lịch sử bị huỷ.'));
  });

/** Every read and write goes through here so a dead IndexedDB never breaks a run. */
const safely = async <T>(work: () => Promise<T>, fallback: T, label: string): Promise<T> => {
  try {
    return await work();
  } catch (err) {
    console.error(`[history] ${label}`, err);
    return fallback;
  }
};

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

// ---------------------------------------------------------------------------
// text helpers

/** Plain text out of the model's HTML, whitespace collapsed. */
export const htmlToText = (html: string): string => {
  if (!html) return '';
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return (holder.textContent || '').replace(/\s+/g, ' ').trim();
};

/**
 * A name for the entry: the first heading if the model wrote one, otherwise the
 * opening sentence. Falls back to the feature name so a row is never blank.
 */
const deriveTitle = (html: string | undefined, fallback: string): string => {
  if (html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const heading = holder.querySelector('h1, h2, h3, h4, h5');
    const text = (heading?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 90);

    const body = (holder.textContent || '').replace(/\s+/g, ' ').trim();
    if (body) return body.slice(0, 90);
  }
  return fallback;
};

// ---------------------------------------------------------------------------
// write

export const saveEntry = async (input: SaveEntryInput): Promise<HistoryEntry | null> =>
  safely(async () => {
    const db = await openDb();
    const now = Date.now();

    const assetRecords: { id: string; blob: Blob }[] = [];
    const assets: HistoryAsset[] = (input.assets || []).map(({ name, mimeType, blob }) => {
      const id = newId();
      assetRecords.push({ id, blob });
      return { id, name, mimeType, size: blob.size };
    });

    const html = input.html || '';
    const entry: HistoryEntry = {
      id: newId(),
      createdAt: now,
      brandId: input.brandId,
      brandName: input.brandName,
      kind: input.kind,
      mode: input.mode,
      modeLabel: input.modeLabel,
      title: (input.title || '').trim() || deriveTitle(html, input.modeLabel || 'Kết quả không có tiêu đề'),
      preview: htmlToText(html).slice(0, 200),
      sourceUrl: input.sourceUrl,
      html: html || undefined,
      data: input.data,
      assets,
      ownerEmail: input.ownerEmail,
      size: html.length + assets.reduce((sum, a) => sum + a.size, 0),
      assetsExpireAt: now + ASSET_TTL_MS,
      expiresAt: now + TEXT_TTL_MS,
    };

    const tx = db.transaction([STORE_ENTRIES, STORE_ASSETS], 'readwrite');
    tx.objectStore(STORE_ENTRIES).put(entry);
    const assetStore = tx.objectStore(STORE_ASSETS);
    for (const record of assetRecords) assetStore.put(record);
    await txDone(tx);

    return entry;
  }, null, 'không lưu được vào lịch sử');

/** Records where the Drive copy landed, so a later backup skips this entry. */
export const markDriveBackup = async (id: string, drive: DriveBackup): Promise<void> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const store = tx.objectStore(STORE_ENTRIES);
    const entry = await promisify<HistoryEntry | undefined>(store.get(id));
    if (entry) store.put({ ...entry, drive });
    await txDone(tx);
  }, undefined, 'không ghi được trạng thái sao lưu Drive');

// ---------------------------------------------------------------------------
// read

export interface ListOptions {
  brandId?: string;
  /** When set, only entries with this owner (or no owner at all) are returned. */
  ownerEmail?: string;
  kind?: HistoryKind;
}

/** Newest first. Blobs stay in their own store, so this reads only metadata. */
export const listEntries = async (options: ListOptions = {}): Promise<HistoryEntry[]> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    const all = await promisify<HistoryEntry[]>(tx.objectStore(STORE_ENTRIES).getAll());
    await txDone(tx);

    return all
      .filter((entry) => {
        if (options.brandId && entry.brandId !== options.brandId) return false;
        if (options.kind && entry.kind !== options.kind) return false;
        // Entries saved before Drive was connected have no owner; they belong to
        // whoever is sitting here now rather than to nobody.
        if (options.ownerEmail && entry.ownerEmail && entry.ownerEmail !== options.ownerEmail) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [], 'không đọc được lịch sử');

export const getEntry = async (id: string): Promise<HistoryEntry | null> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    const entry = await promisify<HistoryEntry | undefined>(tx.objectStore(STORE_ENTRIES).get(id));
    await txDone(tx);
    return entry || null;
  }, null, 'không đọc được nội dung đã lưu');

/** null when the blob has passed its 3-day life, even though the entry remains. */
export const getAsset = async (assetId: string): Promise<Blob | null> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const record = await promisify<{ id: string; blob: Blob } | undefined>(tx.objectStore(STORE_ASSETS).get(assetId));
    await txDone(tx);
    return record?.blob || null;
  }, null, 'không đọc được ảnh đã lưu');

// ---------------------------------------------------------------------------
// delete

export const removeEntry = async (id: string): Promise<void> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_ENTRIES, STORE_ASSETS], 'readwrite');
    const entryStore = tx.objectStore(STORE_ENTRIES);
    const entry = await promisify<HistoryEntry | undefined>(entryStore.get(id));
    if (entry) {
      const assetStore = tx.objectStore(STORE_ASSETS);
      for (const asset of entry.assets || []) assetStore.delete(asset.id);
      entryStore.delete(id);
    }
    await txDone(tx);
  }, undefined, 'không xoá được mục lịch sử');

export const clearAll = async (): Promise<void> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_ENTRIES, STORE_ASSETS], 'readwrite');
    tx.objectStore(STORE_ENTRIES).clear();
    tx.objectStore(STORE_ASSETS).clear();
    await txDone(tx);
  }, undefined, 'không xoá được lịch sử');

export interface PurgeReport {
  entriesRemoved: number;
  assetsRemoved: number;
}

/**
 * Applies both deadlines. Called on start-up and after each save, which is
 * enough - there is no background process in a browser tab, and an app that is
 * never opened has nothing to leak.
 */
export const purgeExpired = async (now = Date.now()): Promise<PurgeReport> =>
  safely(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_ENTRIES, STORE_ASSETS], 'readwrite');
    const entryStore = tx.objectStore(STORE_ENTRIES);
    const assetStore = tx.objectStore(STORE_ASSETS);

    const all = await promisify<HistoryEntry[]>(entryStore.getAll());
    let entriesRemoved = 0;
    let assetsRemoved = 0;

    for (const entry of all) {
      if (now > entry.expiresAt) {
        for (const asset of entry.assets || []) {
          assetStore.delete(asset.id);
          assetsRemoved += 1;
        }
        entryStore.delete(entry.id);
        entriesRemoved += 1;
        continue;
      }

      // Past the image deadline but not the text one: drop the bytes, keep the
      // record so the entry still opens and still reads.
      if (now > entry.assetsExpireAt && !entry.assetsPurged && (entry.assets || []).length > 0) {
        for (const asset of entry.assets) {
          assetStore.delete(asset.id);
          assetsRemoved += 1;
        }
        entryStore.put({
          ...entry,
          assetsPurged: true,
          size: (entry.html || '').length,
        });
      }
    }

    await txDone(tx);
    return { entriesRemoved, assetsRemoved };
  }, { entriesRemoved: 0, assetsRemoved: 0 }, 'không dọn được dữ liệu hết hạn');

// ---------------------------------------------------------------------------
// storage

/**
 * Asks the browser to stop evicting this origin under storage pressure.
 * Chrome usually grants it silently to an installed or frequently used site;
 * Safari never does. Best effort - the answer changes nothing about how the
 * app behaves, so a refusal is not worth reporting.
 */
export const requestPersistence = async (): Promise<boolean> => {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

export const estimateUsage = async (): Promise<{ usedBytes: number; quotaBytes: number } | null> => {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usedBytes: estimate.usage || 0, quotaBytes: estimate.quota || 0 };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// formatting, shared by the panel and the export

export const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Whole days left before the entry is deleted; 0 means "today". */
export const daysLeft = (entry: HistoryEntry, now = Date.now()): number =>
  Math.max(0, Math.ceil((entry.expiresAt - now) / DAY_MS));

export const KIND_LABELS: Record<HistoryKind, string> = {
  analysis: 'Content Creator',
  image: 'Hình ảnh',
  waterfall: 'Content Waterfall',
  radar: 'Content Radar',
};

/** A data: URL back into a Blob, for images the app holds as strings. */
export const dataUrlToBlob = (dataUrl: string): Blob | null => {
  try {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!match) return null;
    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const payload = match[3];

    if (!isBase64) return new Blob([decodeURIComponent(payload)], { type: mimeType });

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  } catch (err) {
    console.error('[history] không đọc được dữ liệu ảnh', err);
    return null;
  }
};
