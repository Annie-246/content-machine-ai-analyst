/**
 * Utility functions for exporting HTML analysis tables to CSV, Excel, or opening in Google Sheets
 */

export const extractAnalysisTableData = (htmlString: string): { headers: string[]; rows: string[][] } | null => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    
    // Find the first detailed table (either analysis table or script table)
    const table = doc.querySelector('table');
    if (!table) return null;

    const headers: string[] = [];
    table.querySelectorAll('thead th').forEach(th => {
      headers.push(th.textContent?.trim() || '');
    });

    const rows: string[][] = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
      const row: string[] = [];
      tr.querySelectorAll('td').forEach(td => {
        // Clean line breaks and formatting
        row.push(td.textContent?.replace(/\s+/g, ' ').trim() || '');
      });
      if (row.length > 0) rows.push(row);
    });

    return { headers, rows };
  } catch (err) {
    console.error('Error extracting table data:', err);
    return null;
  }
};

/**
 * Extracts all tables and structured breakdown sections to build a comprehensive Excel/CSV report
 */
export const exportToExcelCsv = (htmlString: string, filename: string = 'bang-phan-tich-video-viral.csv') => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    let csvContent = '\uFEFF'; // UTF-8 BOM for Excel Vietnamese compatibility

    // Check if there are tables
    const tables = doc.querySelectorAll('table');
    if (tables.length > 0) {
      tables.forEach((table, index) => {
        csvContent += `=== BẢNG DỮ LIỆU ${index + 1} ===\r\n`;
        
        // Headers
        const headerRow: string[] = [];
        table.querySelectorAll('thead th').forEach(th => {
          const cleanText = (th.textContent || '').replace(/"/g, '""').trim();
          headerRow.push(`"${cleanText}"`);
        });
        if (headerRow.length > 0) {
          csvContent += headerRow.join(',') + '\r\n';
        }

        // Rows
        table.querySelectorAll('tbody tr').forEach(tr => {
          const row: string[] = [];
          tr.querySelectorAll('td').forEach(td => {
            const cleanText = (td.textContent || '').replace(/\s+/g, ' ').replace(/"/g, '""').trim();
            row.push(`"${cleanText}"`);
          });
          if (row.length > 0) {
            csvContent += row.join(',') + '\r\n';
          }
        });
        csvContent += '\r\n\r\n';
      });
    } else {
      // Fallback: extract plain text paragraphs
      const text = doc.body.textContent || '';
      csvContent += `"${text.replace(/"/g, '""')}"`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Export CSV error', e);
  }
};

/**
 * Serialises a whole result - headings, paragraphs, lists and every table - into
 * the tab-separated form Google Sheets pastes straight into cells, so what lands
 * in the spreadsheet is laid out the way the app shows it.
 *
 * Google has no public way to create a pre-filled spreadsheet from a URL, so a
 * fully automatic hand-off would mean asking the user to authorise the app
 * against their Google account. Copying the rows and opening a blank sheet keeps
 * it to one paste and needs no account linking at all.
 */
const cell = (text: string): string =>
  (text || '')
    .replace(/\s+/g, ' ')
    .replace(/\t/g, ' ')
    .trim();

const serialiseNode = (node: Element, rows: string[][]): void => {
  const tag = node.tagName.toLowerCase();

  if (tag === 'table') {
    const headers: string[] = [];
    node.querySelectorAll('thead th').forEach((th) => headers.push(cell(th.textContent || '')));
    // Some models emit a table with no thead; fall back to the first row.
    if (!headers.length) {
      node.querySelectorAll('tr:first-child th').forEach((th) => headers.push(cell(th.textContent || '')));
    }
    if (headers.length) rows.push(headers);

    node.querySelectorAll('tbody tr, tr').forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll('td').forEach((td) => cells.push(cell(td.textContent || '')));
      if (cells.length) rows.push(cells);
    });
    rows.push([]);
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const text = cell(node.textContent || '');
    if (text) {
      rows.push([]);
      rows.push([text.toUpperCase()]);
    }
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    node.querySelectorAll(':scope > li').forEach((li, i) => {
      const text = cell(li.textContent || '');
      if (text) rows.push([`${tag === 'ol' ? `${i + 1}.` : '•'} ${text}`]);
    });
    rows.push([]);
    return;
  }

  if (tag === 'p' || tag === 'blockquote' || tag === 'pre') {
    const text = cell(node.textContent || '');
    if (text) rows.push([text]);
    return;
  }

  // A wrapper: walk into it so nested tables and headings keep their order.
  const children = Array.from(node.children);
  if (children.length) {
    children.forEach((child) => serialiseNode(child, rows));
    return;
  }

  const text = cell(node.textContent || '');
  if (text) rows.push([text]);
};

export const resultToTsv = (htmlString: string, title = ''): string => {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const rows: string[][] = [];

  if (title) {
    rows.push([title]);
    rows.push([]);
  }

  Array.from(doc.body.children).forEach((child) => serialiseNode(child, rows));

  // Nothing structured came back: keep the plain text rather than an empty sheet.
  if (!rows.some((r) => r.length)) {
    const text = (doc.body.textContent || '').trim();
    text.split('\n').forEach((line) => rows.push([cell(line)]));
  }

  // Trim the trailing blank rows the block separators leave behind.
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();

  return rows.map((r) => r.join('\t')).join('\n');
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs focus and a secure context; fall back to the old way.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
};

/**
 * Copies the formatted result and opens a brand-new blank Google Sheet.
 * Resolves to true when the rows made it onto the clipboard, so the caller can
 * tell the user whether a plain Ctrl+V is enough.
 */
export const openInGoogleSheets = async (htmlString: string, title = ''): Promise<boolean> => {
  const tsv = resultToTsv(htmlString, title);
  const copied = await copyText(tsv);
  window.open('https://sheets.new', '_blank', 'noopener');
  return copied;
};
