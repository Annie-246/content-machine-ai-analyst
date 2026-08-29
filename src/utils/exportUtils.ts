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
 * Copies table tab-separated values to clipboard and opens Google Sheets in a new tab
 */
export const openInGoogleSheets = (htmlString: string) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const table = doc.querySelector('table');

    let tsvData = '';
    if (table) {
      const headerRow: string[] = [];
      table.querySelectorAll('thead th').forEach(th => {
        headerRow.push((th.textContent || '').replace(/\s+/g, ' ').trim());
      });
      tsvData += headerRow.join('\t') + '\n';

      table.querySelectorAll('tbody tr').forEach(tr => {
        const row: string[] = [];
        tr.querySelectorAll('td').forEach(td => {
          row.push((td.textContent || '').replace(/\s+/g, ' ').trim());
        });
        tsvData += row.join('\t') + '\n';
      });
    } else {
      tsvData = doc.body.textContent || '';
    }

    // Copy to clipboard so user can just press Ctrl+V / Cmd+V in Google Sheets
    navigator.clipboard.writeText(tsvData).then(() => {
      // Open blank Google Sheets
      window.open('https://sheets.new', '_blank');
    }).catch(() => {
      window.open('https://sheets.new', '_blank');
    });
  } catch (e) {
    console.error('Open in Google Sheets error', e);
    window.open('https://sheets.new', '_blank');
  }
};
