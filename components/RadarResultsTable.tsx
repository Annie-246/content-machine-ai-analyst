import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { RadarContent } from '../types';
import { EXPORT_COLUMNS, isNumericColumn, toExportRow } from '../services/radar/exportRows.mjs';

// The table shows exactly the columns the CSV and the Sheet carry, built by the
// same function - so what a user sees is what they get when they export.
//
// Wide by nature, so it scrolls inside its own container rather than pushing the
// page sideways, and the first two columns stay pinned while it does.

const LINK_COLUMNS = new Set(['Link video', 'Trang cá nhân']);

export const RadarResultsTable: React.FC<{ items: RadarContent[] }> = ({ items }) => {
  const rows = items.map((item, i) => ({ item, cells: toExportRow(item, i) }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {EXPORT_COLUMNS.map((header, i) => (
                <th
                  key={header}
                  className={`px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap
                    ${isNumericColumn(header) ? 'text-right' : 'text-left'}
                    ${i === 0 ? 'sticky left-0 bg-slate-50 z-10' : ''}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map(({ item, cells }) => (
              <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                {cells.map((value, i) => {
                  const header = EXPORT_COLUMNS[i];
                  const numeric = isNumericColumn(header);

                  return (
                    <td
                      key={header}
                      className={`px-3 py-2.5 align-top
                        ${numeric ? 'text-right tabular-nums text-slate-700' : 'text-slate-700'}
                        ${i === 0 ? 'sticky left-0 bg-white z-10 text-slate-400' : ''}`}
                    >
                      {LINK_COLUMNS.has(header) && value ? (
                        <a
                          href={String(value)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#A4145E] hover:underline whitespace-nowrap"
                        >
                          Mở <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : header === 'Caption' ? (
                        // The one column allowed to wrap - everything else stays
                        // on one line so the grid reads like a spreadsheet.
                        <span className="block max-w-[380px] line-clamp-2 leading-snug">{String(value) || '—'}</span>
                      ) : header === 'Hashtag' ? (
                        <span className="block max-w-[220px] truncate text-slate-500">{String(value) || '—'}</span>
                      ) : header === 'Radar Score' ? (
                        <span className="font-bold text-slate-900">{value === '' ? '—' : Math.round(Number(value))}</span>
                      ) : typeof value === 'number' ? (
                        value.toLocaleString('en-US')
                      ) : (
                        <span className="whitespace-nowrap">{String(value) || '—'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
