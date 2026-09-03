// Tải lịch sử về máy: một mục lẻ dạng .html, hoặc toàn bộ lịch sử dạng .zip.

import { csvCell } from './radar/exportRows.mjs';
import { zipFiles } from './zip.mjs';
import type { HistoryEntry } from './historyStore';
import { KIND_LABELS, formatBytes } from './historyStore';

// ---------------------------------------------------------------------------
// HTML document

const escapeHtml = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDateTime = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface Attachment {
  name: string;
  /** Where the image lives relative to the document, or a Drive link. */
  href: string;
}

/**
 * One entry as a self-contained HTML page.
 *
 * Two consumers, one function: the file inside the ZIP, and the body handed to
 * Drive for conversion into a Google Doc. The model writes Tailwind classes
 * that mean nothing outside the app, so the stylesheet below re-states the few
 * things that actually matter on a printed page - readable width, real table
 * borders, sane heading rhythm.
 */
export const buildStandaloneHtml = (
  entry: HistoryEntry,
  attachments: Attachment[] = [],
  options: { embedImages?: boolean } = {}
): string => {
  const meta = [
    `Thương hiệu: ${escapeHtml(entry.brandName)}`,
    `Tính năng: ${escapeHtml(entry.modeLabel || KIND_LABELS[entry.kind])}`,
    `Tạo lúc: ${formatDateTime(entry.createdAt)}`,
  ].join(' &nbsp;•&nbsp; ');

  const source = entry.sourceUrl
    ? `<p class="src">Nguồn: <a href="${escapeHtml(entry.sourceUrl)}">${escapeHtml(entry.sourceUrl)}</a></p>`
    : '';

  const images = attachments.length
    ? `<div class="attachments"><h2>Hình ảnh đính kèm</h2>${attachments
        .map(({ name, href }) =>
          options.embedImages
            ? `<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(name)}"><figcaption>${escapeHtml(name)}</figcaption></figure>`
            : `<p><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></p>`
        )
        .join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>${escapeHtml(entry.title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a;
         line-height: 1.7; max-width: 820px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 26px; line-height: 1.3; margin: 0 0 8px; }
  h2, h3, h4 { line-height: 1.35; margin: 28px 0 10px; }
  .meta { color: #64748b; font-size: 13px; }
  .src { color: #64748b; font-size: 13px; word-break: break-all; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0 28px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  figure { margin: 16px 0; }
  figcaption { color: #64748b; font-size: 12px; margin-top: 6px; }
  .attachments { margin-top: 32px; }
</style>
</head>
<body>
<h1>${escapeHtml(entry.title)}</h1>
<p class="meta">${meta}</p>
${source}
<hr>
${entry.html || '<p>(Nội dung này không có phần văn bản.)</p>'}
${images}
</body>
</html>`;
};

/**
 * A table of results as HTML, so a scan can be stored and re-read like any
 * other piece of content. Cells that hold a URL become links - the whole point
 * of keeping a Radar scan is being able to click back to the video later.
 */
export const buildTableHtml = (headers: string[], rows: (string | number)[][]): string => {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const text = String(cell ?? '');
          const value = /^https?:\/\//i.test(text)
            ? `<a href="${escapeHtml(text)}">${escapeHtml(text)}</a>`
            : escapeHtml(text);
          return `<td>${value}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

// ---------------------------------------------------------------------------
// index sheet

export const INDEX_COLUMNS = [
  '#', 'Ngày tạo', 'Thương hiệu', 'Loại', 'Tính năng', 'Tiêu đề', 'Nguồn', 'Tệp', 'Dung lượng',
];

export const buildIndexRows = (entries: HistoryEntry[], fileNameOf: (e: HistoryEntry, i: number) => string) =>
  entries.map((entry, i) => [
    i + 1,
    formatDateTime(entry.createdAt),
    entry.brandName,
    KIND_LABELS[entry.kind],
    entry.modeLabel || '',
    entry.title,
    entry.sourceUrl || '',
    fileNameOf(entry, i),
    formatBytes(entry.size),
  ]);

/** Same BOM and CRLF as the Radar export, for the same reason: Excel. */
export const buildIndexCsv = (entries: HistoryEntry[], fileNameOf: (e: HistoryEntry, i: number) => string): string => {
  const rows = [INDEX_COLUMNS, ...buildIndexRows(entries, fileNameOf)];
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
};

// ---------------------------------------------------------------------------
// download

export const slugify = (value: string, max = 50): string =>
  (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'noi-dung';

export const timestampSlug = (ms = Date.now()): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking straight away cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** One entry as a single HTML file, with its images inlined so it travels alone. */
export const downloadEntry = async (
  entry: HistoryEntry,
  loadAsset: (assetId: string) => Promise<Blob | null>
): Promise<void> => {
  const attachments: Attachment[] = [];

  for (const asset of entry.assets || []) {
    const blob = await loadAsset(asset.id);
    if (!blob) continue;
    attachments.push({ name: asset.name, href: await blobToDataUrl(blob) });
  }

  const html = buildStandaloneHtml(entry, attachments, { embedImages: true });
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slugify(entry.title)}.html`);
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * The whole history as one archive: an index sheet, one HTML file per entry,
 * and the images beside them.
 */
export const downloadHistoryZip = async (
  entries: HistoryEntry[],
  loadAsset: (assetId: string) => Promise<Blob | null>,
  label = 'lich-su'
): Promise<number> => {
  if (!entries.length) return 0;

  const encoder = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const docName = (entry: HistoryEntry, i: number) => `noi-dung/${String(i + 1).padStart(3, '0')}-${slugify(entry.title)}.html`;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const prefix = `${String(i + 1).padStart(3, '0')}-${slugify(entry.title, 40)}`;
    const attachments: Attachment[] = [];

    for (let a = 0; a < (entry.assets || []).length; a += 1) {
      const asset = entry.assets[a];
      const blob = await loadAsset(asset.id);
      if (!blob) continue; // expired after three days - the text still exports
      const extension = (asset.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0];
      const imageName = `hinh-anh/${prefix}-${a + 1}${extension}`;
      files.push({ name: imageName, data: new Uint8Array(await blob.arrayBuffer()) });
      // Relative to the document, which sits one folder deep.
      attachments.push({ name: asset.name, href: `../${imageName}` });
    }

    files.push({
      name: docName(entry, i),
      data: encoder.encode(buildStandaloneHtml(entry, attachments, { embedImages: true })),
    });
  }

  files.unshift({ name: 'muc-luc.csv', data: encoder.encode(buildIndexCsv(entries, docName)) });

  const blob = await zipFiles(files);
  downloadBlob(blob, `content-machine-${slugify(label, 30)}-${timestampSlug()}.zip`);
  return entries.length;
};
