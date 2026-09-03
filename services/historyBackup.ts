// Sao lưu lịch sử lên Google Drive của chính người dùng.
//
// This is the counterweight to a history that deletes itself. Local storage is
// the working copy and expires within a week; Drive is where a piece of content
// goes to be kept. Files land in the user's own Drive under the drive.file
// scope, so the VPS never holds anyone's content and two users of the same
// deployment never share a folder.

import {
  findOrCreateFolder, uploadHtmlAsGoogleDoc, uploadFileToDrive, uploadCsvAsGoogleSheet,
  connectGoogle, isConnected, getGoogleClientId, isAutoBackupEnabled, ensureUserEmail,
  getGoogleConnection,
} from './googleDrive';
import { buildStandaloneHtml, buildIndexCsv, timestampSlug, type Attachment } from './historyExport';
import {
  markDriveBackup, saveEntry, purgeExpired, getAsset,
  type DriveBackup, type HistoryEntry, type SaveEntryInput,
} from './historyStore';
import { getConnectedEmail } from './googleDrive';

export type LoadAsset = (assetId: string) => Promise<Blob | null>;

/** One folder per brand, reused across sessions so backups accumulate in place. */
const folderNameFor = (brandName: string): string => `Content Machine — ${brandName || 'Nội dung'}`;

const shortDate = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * A token without a popup, or nothing.
 *
 * Automatic backup must never steal focus: a consent window opening by itself
 * while someone is reading their result is worse than a missed backup, and the
 * manual button is always there to catch up.
 */
const silentToken = async (): Promise<boolean> => {
  if (isConnected()) return true;

  // Without a previous successful grant, Google shows its consent screen even
  // for a non-interactive request - so an account that has never connected is
  // left alone entirely rather than ambushed by a popup mid-session.
  if (!getGoogleConnection().connectedAt) return false;

  try {
    await connectGoogle(false);
    return isConnected();
  } catch {
    return false;
  }
};

/**
 * Uploads one entry: its images first, then the document that links to them.
 *
 * Images go up as separate files rather than inline, because Drive's HTML
 * conversion is not reliable about data: URLs - a doc that references real
 * files always works, an embedded one sometimes silently loses the picture.
 */
export const backupEntry = async (entry: HistoryEntry, loadAsset: LoadAsset): Promise<DriveBackup> => {
  const folder = await findOrCreateFolder(folderNameFor(entry.brandName));

  const attachments: Attachment[] = [];
  for (const asset of entry.assets || []) {
    const blob = await loadAsset(asset.id);
    if (!blob) continue; // already past its three days; the text still goes up
    const uploaded = await uploadFileToDrive(`${entry.title.slice(0, 60)} — ${asset.name}`, blob, folder.id);
    attachments.push({ name: asset.name, href: uploaded.url });
  }

  const html = buildStandaloneHtml(entry, attachments);
  const doc = await uploadHtmlAsGoogleDoc(
    `${entry.title.slice(0, 90)} (${shortDate(entry.createdAt)})`,
    html,
    folder.id
  );

  const backup: DriveBackup = { fileId: doc.id, url: doc.url, uploadedAt: Date.now() };
  await markDriveBackup(entry.id, backup);
  return backup;
};

/**
 * Fire-and-forget backup right after a result appears.
 *
 * Silent by design, including on failure: the entry keeps no drive mark, so the
 * next "Đẩy hết" picks it up. Nothing here is allowed to interrupt or slow the
 * run the user just finished.
 */
export const autoBackupEntry = async (entry: HistoryEntry, loadAsset: LoadAsset): Promise<void> => {
  if (!getGoogleClientId() || !isAutoBackupEnabled()) return;
  if (!(await silentToken())) return;

  try {
    await backupEntry(entry, loadAsset);
  } catch (err) {
    console.error('[backup] không tự sao lưu được lên Drive', err);
  }
};

/**
 * The one call a feature makes when it finishes: file the result, sweep what
 * has expired, start the Drive copy.
 *
 * Safe to leave un-awaited. Nothing in here can fail loudly enough to disturb a
 * run that already succeeded - the store swallows its own errors and the backup
 * simply leaves the entry unmarked for the next manual push.
 */
export const recordAndBackup = async (input: SaveEntryInput): Promise<HistoryEntry | null> => {
  const entry = await saveEntry({ ...input, ownerEmail: input.ownerEmail || getConnectedEmail() || undefined });
  if (!entry) return null;

  await purgeExpired();
  autoBackupEntry(entry, getAsset);
  return entry;
};

export interface BackupProgress {
  done: number;
  total: number;
  title: string;
}

export interface BackupSummary {
  uploaded: number;
  /** Entries already on Drive from an earlier run. */
  skipped: number;
  failed: { title: string; error: string }[];
  folderUrl: string;
  indexUrl?: string;
}

/**
 * Pushes everything not yet on Drive, then writes an index sheet listing the
 * lot. Incremental on purpose: pressing the button twice costs one API call per
 * already-uploaded entry and creates no duplicates.
 */
export const backupAll = async (
  entries: HistoryEntry[],
  loadAsset: LoadAsset,
  onProgress?: (progress: BackupProgress) => void
): Promise<BackupSummary> => {
  if (!getGoogleClientId()) {
    throw new Error('Chưa có Google Client ID. Vào mục Tích hợp, phần Google Drive, để thiết lập.');
  }

  const pending = entries.filter((entry) => !entry.drive);
  const summary: BackupSummary = {
    uploaded: 0,
    skipped: entries.length - pending.length,
    failed: [],
    folderUrl: '',
  };

  // The first upload may open the consent popup; that is expected here, because
  // the user pressed the button.
  const brandName = entries[0]?.brandName || '';
  const folder = await findOrCreateFolder(folderNameFor(brandName));
  summary.folderUrl = folder.url;

  // Knowing the account lets later sessions tell whose history is whose.
  await ensureUserEmail();

  const uploadedEntries: HistoryEntry[] = [];

  for (let i = 0; i < pending.length; i += 1) {
    const entry = pending[i];
    onProgress?.({ done: i, total: pending.length, title: entry.title });
    try {
      const backup = await backupEntry(entry, loadAsset);
      uploadedEntries.push({ ...entry, drive: backup });
      summary.uploaded += 1;
    } catch (err: any) {
      // One bad entry must not abandon the rest of the backup.
      summary.failed.push({ title: entry.title, error: err?.message || 'Lỗi không rõ' });
    }
  }

  onProgress?.({ done: pending.length, total: pending.length, title: '' });

  // The index covers everything in the folder, not just this run's uploads.
  const listed = entries.map((entry) => uploadedEntries.find((u) => u.id === entry.id) || entry);
  if (listed.length) {
    try {
      const csv = buildIndexCsv(listed, (entry) => entry.drive?.url || '(chưa sao lưu)');
      const sheet = await uploadCsvAsGoogleSheet(
        `Mục lục — ${brandName || 'Content Machine'} — ${timestampSlug()}`,
        csv,
        folder.id
      );
      summary.indexUrl = sheet.url;
    } catch (err) {
      // The documents are what matter; a missing index is a cosmetic loss.
      console.error('[backup] không tạo được mục lục', err);
    }
  }

  return summary;
};
