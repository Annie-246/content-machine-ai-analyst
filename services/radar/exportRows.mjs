// One definition of "what a Radar result looks like as a table", shared by the
// on-screen table, the CSV file and the Google Sheet. Formatting a column once
// means the three can never disagree about what a column holds.

const NUMERIC = new Set(['Radar Score', 'Follower', 'View', 'Like', 'Bình luận', 'Chia sẻ', 'Lưu', 'Giây']);

/** Columns, in order. `numeric` drives right-alignment and Sheets cell types. */
export const EXPORT_COLUMNS = [
  '#', 'Radar Score', 'Nền tảng', 'Caption', 'Creator', 'Username', 'Follower',
  'View', 'Like', 'Bình luận', 'Chia sẻ', 'Lưu', 'Like/Follower %',
  'Đăng lúc', 'Giây', 'Hashtag', 'Link video', 'Trang cá nhân',
];

export const isNumericColumn = (header) => NUMERIC.has(header) || header === '#' || header === 'Like/Follower %';

const iso = (value) => {
  if (!value) return '';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '';
  // Local, minute precision: a spreadsheet reader wants a date, not a timestamp.
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ratio = (value) => (value === null || value === undefined ? '' : Math.round(value * 1000) / 10);

const blankToEmpty = (value) => (value === null || value === undefined ? '' : value);

/**
 * One RadarContent -> one row, aligned to EXPORT_COLUMNS.
 * Values stay typed: numbers stay numbers so a sheet can sum and sort them.
 */
export const toExportRow = (item, index) => [
  index + 1,
  item.radarScore ?? '',
  item.platform || '',
  item.caption || '',
  item.creator?.nickname || '',
  item.creator?.username ? `@${item.creator.username}` : '',
  blankToEmpty(item.creator?.followerCount),
  blankToEmpty(item.metrics?.views),
  blankToEmpty(item.metrics?.likes),
  blankToEmpty(item.metrics?.comments),
  blankToEmpty(item.metrics?.shares),
  blankToEmpty(item.metrics?.collects),
  ratio(item.radarSignals?.likeFollowerRatio),
  iso(item.publishedAt),
  blankToEmpty(item.duration),
  (item.hashtags || []).map((h) => `#${h}`).join(' '),
  item.videoUrl || '',
  item.creator?.profileUrl || '',
];

export const toExportRows = (items) => items.map(toExportRow);

/** Headers plus rows, which is what every exporter actually wants. */
export const buildExportTable = (items) => ({
  headers: EXPORT_COLUMNS,
  rows: toExportRows(items),
});

// ---------------------------------------------------------------------------
// CSV

/**
 * RFC 4180 quoting. A field is quoted when it holds a comma, a quote, a newline
 * or leading/trailing spaces; inner quotes are doubled.
 */
export const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text) && text.trim() === text) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * A CSV Excel will open correctly.
 *
 * The BOM is not decoration: without it Excel reads the file as the system
 * codepage and every Chinese caption and Vietnamese label turns to mojibake.
 * CRLF for the same reason - it is what Excel expects.
 */
export const buildCsv = (items) => {
  const { headers, rows } = buildExportTable(items);
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
};

/** A filesystem-safe, dated name so repeated exports do not overwrite silently. */
export const exportFilename = (label, extension) => {
  const slug = (label || 'content-radar')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'content-radar';

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `radar-${slug}-${stamp}.${extension}`;
};
