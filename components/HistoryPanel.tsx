import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History, Search, Download, HardDrive, Trash2, X, ExternalLink, Loader2, AlertTriangle,
  Check, FileText, Image as ImageIcon, Waves, Radar, CloudOff, Clock,
} from 'lucide-react';
import { BrandProfile } from '../types';
import {
  listEntries, removeEntry, clearAll, purgeExpired, getAsset, estimateUsage,
  formatBytes, daysLeft, KIND_LABELS,
  type HistoryEntry, type HistoryKind,
} from '../services/historyStore';
import { downloadEntry, downloadHistoryZip } from '../services/historyExport';
import { backupAll, type BackupProgress } from '../services/historyBackup';
import { getConnectedEmail, getGoogleClientId } from '../services/googleDrive';

// Lịch sử nội dung.
//
// The panel has one job beyond listing: make the expiry impossible to miss.
// Content disappears after a week by design, so every screen here says how long
// is left and offers the two ways out - a ZIP on this machine, or a copy in the
// user's own Drive.

const KIND_ICONS: Record<HistoryKind, React.ElementType> = {
  analysis: FileText,
  image: ImageIcon,
  waterfall: Waves,
  radar: Radar,
};

const KIND_FILTERS: { id: HistoryKind | 'all'; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'analysis', label: KIND_LABELS.analysis },
  { id: 'image', label: KIND_LABELS.image },
  { id: 'waterfall', label: KIND_LABELS.waterfall },
  { id: 'radar', label: KIND_LABELS.radar },
];

const formatWhen = (ms: number): string => {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const HistoryPanel: React.FC<{ brand: BrandProfile }> = ({ brand }) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'brand' | 'all'>('brand');
  const [kind, setKind] = useState<HistoryKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null);

  const [busy, setBusy] = useState<'zip' | 'drive' | ''>('');
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const [opened, setOpened] = useState<HistoryEntry | null>(null);
  const [openedImages, setOpenedImages] = useState<{ name: string; url: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    // Sweep on the way in: an app that sat closed for a week should not show
    // content it has already promised to delete.
    await purgeExpired();
    const rows = await listEntries({
      brandId: scope === 'brand' ? brand.id : undefined,
      ownerEmail: getConnectedEmail() || undefined,
    });
    setEntries(rows);
    setUsage(await estimateUsage());
    setLoading(false);
  }, [brand.id, scope]);

  useEffect(() => { load(); }, [load]);

  // Object URLs for the open entry, released when it closes.
  useEffect(() => {
    let cancelled = false;

    const loadImages = async () => {
      if (!opened) { setOpenedImages([]); return; }
      const images: { name: string; url: string }[] = [];
      for (const asset of opened.assets || []) {
        const blob = await getAsset(asset.id);
        if (blob) images.push({ name: asset.name, url: URL.createObjectURL(blob) });
      }
      if (cancelled) {
        images.forEach((image) => URL.revokeObjectURL(image.url));
        return;
      }
      setOpenedImages(images);
    };

    loadImages();
    return () => { cancelled = true; };
  }, [opened]);

  useEffect(() => () => { openedImages.forEach((image) => URL.revokeObjectURL(image.url)); }, [openedImages]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kind !== 'all' && entry.kind !== kind) return false;
      if (!needle) return true;
      return `${entry.title} ${entry.preview} ${entry.brandName}`.toLowerCase().includes(needle);
    });
  }, [entries, kind, query]);

  const expiringSoon = useMemo(() => entries.filter((entry) => daysLeft(entry) <= 2), [entries]);
  const notBackedUp = useMemo(() => entries.filter((entry) => !entry.drive), [entries]);
  const totalBytes = useMemo(() => entries.reduce((sum, entry) => sum + (entry.size || 0), 0), [entries]);

  const flash = (message: string) => {
    setNote(message);
    setTimeout(() => setNote(''), 12000);
  };

  const handleDownloadAll = async () => {
    if (!visible.length) return;
    setBusy('zip');
    setError('');
    try {
      const count = await downloadHistoryZip(visible, getAsset, scope === 'brand' ? brand.name : 'tat-ca');
      flash(`Đã tải ${count} nội dung về máy dưới dạng file ZIP.`);
    } catch (err: any) {
      setError(err?.message || 'Không tạo được file ZIP.');
    } finally {
      setBusy('');
    }
  };

  const handleBackupAll = async () => {
    if (!entries.length) return;
    setBusy('drive');
    setError('');
    setProgress(null);
    try {
      const summary = await backupAll(entries, getAsset, setProgress);
      await load();

      const parts = [`Đã đẩy ${summary.uploaded} nội dung lên Drive.`];
      if (summary.skipped) parts.push(`${summary.skipped} mục đã có sẵn nên bỏ qua.`);
      if (summary.failed.length) parts.push(`${summary.failed.length} mục lỗi: ${summary.failed[0].error}`);
      flash(parts.join(' '));
    } catch (err: any) {
      setError(err?.message || 'Không đẩy được lên Google Drive.');
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const handleDelete = async (entry: HistoryEntry) => {
    await removeEntry(entry.id);
    if (opened?.id === entry.id) setOpened(null);
    load();
  };

  const handleClearAll = async () => {
    const warning = notBackedUp.length
      ? `Xoá toàn bộ ${entries.length} mục? Có ${notBackedUp.length} mục chưa sao lưu lên Drive và sẽ mất hẳn.`
      : `Xoá toàn bộ ${entries.length} mục trong lịch sử?`;
    if (!window.confirm(warning)) return;
    await clearAll();
    load();
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <h1 className="text-[40px] leading-tight font-bold text-slate-900 flex items-center gap-3">
            <History className="w-9 h-9 text-[#A4145E]" strokeWidth={1.5} /> Lịch sử nội dung
          </h1>
          <p className="mt-3 text-[15px] text-slate-600 max-w-2xl leading-relaxed">
            Mọi nội dung bạn tạo được lưu lại ngay trên máy này. Phần chữ giữ <strong>7 ngày</strong>, hình ảnh giữ{' '}
            <strong>3 ngày</strong>, sau đó tự xoá. Muốn giữ lâu hơn thì tải về hoặc đẩy lên Google Drive.
          </p>
        </div>
      </div>

      {/* Cảnh báo sắp hết hạn - lý do tồn tại của cả màn hình này */}
      {expiringSoon.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 flex items-start gap-3.5">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900">
              {expiringSoon.length} nội dung sắp bị xoá trong 2 ngày tới
            </p>
            <p className="mt-1 text-[13px] text-slate-700 leading-relaxed">
              {expiringSoon.filter((e) => !e.drive).length > 0
                ? `Trong đó ${expiringSoon.filter((e) => !e.drive).length} mục chưa có bản sao trên Drive. Sao lưu ngay để khỏi mất.`
                : 'Tất cả đều đã có bản sao trên Drive, bạn không mất gì cả.'}
            </p>
          </div>
        </div>
      )}

      {/* Thanh hành động */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleBackupAll}
            disabled={!!busy || !entries.length}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold transition-colors"
          >
            {busy === 'drive' ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
            {busy === 'drive' ? 'Đang đẩy lên Drive…' : 'Đẩy hết qua Google Drive'}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={!!busy || !visible.length}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-50 transition-colors"
          >
            {busy === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Tải tất cả về máy (.zip)
          </button>

          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={!!busy}
              className="ml-auto inline-flex items-center gap-2 px-4 py-3 rounded-xl text-slate-500 hover:text-pink-600 font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Xoá toàn bộ
            </button>
          )}
        </div>

        {!getGoogleClientId() && (
          <p className="mt-3 text-[13px] text-amber-700 flex items-start gap-1.5">
            <CloudOff className="w-4 h-4 shrink-0 mt-0.5" />
            Chưa kết nối Google Drive nên chưa sao lưu tự động được. Vào mục <strong>Tích hợp</strong> để thiết lập một lần.
          </p>
        )}

        {progress && progress.total > 0 && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#A4145E] transition-all duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-slate-500 truncate">
              {progress.done}/{progress.total} — {progress.title}
            </p>
          </div>
        )}

        {note && (
          <p className="mt-3 text-[13px] text-emerald-700 font-medium flex items-start gap-1.5">
            <Check className="w-4 h-4 shrink-0 mt-0.5" /> {note}
          </p>
        )}
        {error && (
          <p className="mt-3 text-[13px] text-red-700 flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </p>
        )}
      </div>

      {/* Bộ lọc */}
      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm trong lịch sử…"
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1 bg-white">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setKind(filter.id)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                kind === filter.id ? 'bg-[#FDF2F7] text-[#A4145E]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setScope((prev) => (prev === 'brand' ? 'all' : 'brand'))}
          className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
        >
          {scope === 'brand' ? `Chỉ ${brand.name}` : 'Tất cả thương hiệu'}
        </button>
      </div>

      <p className="mt-3 text-[12px] text-slate-500">
        {visible.length} nội dung · {formatBytes(totalBytes)} đang lưu
        {usage?.quotaBytes ? ` · trình duyệt cho phép tối đa ${formatBytes(usage.quotaBytes)}` : ''}
      </p>

      {/* Danh sách */}
      <div className="mt-4 space-y-3 pb-10">
        {loading && (
          <div className="rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        )}

        {!loading && !visible.length && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-14 text-center">
            <History className="w-10 h-10 text-slate-300 mx-auto" strokeWidth={1.5} />
            <h3 className="mt-4 text-lg font-bold text-slate-900">
              {entries.length ? 'Không có mục nào khớp bộ lọc' : 'Chưa có nội dung nào được lưu'}
            </h3>
            <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
              {entries.length
                ? 'Thử đổi từ khoá hoặc bỏ bớt bộ lọc.'
                : 'Mỗi lần bạn chạy Content Creator, Waterfall hay Radar, kết quả sẽ tự xuất hiện ở đây.'}
            </p>
          </div>
        )}

        {!loading && visible.map((entry) => {
          const Icon = KIND_ICONS[entry.kind];
          const remaining = daysLeft(entry);
          return (
            <div
              key={entry.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#f8d3e0] transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#FDF2F7] border border-[#f8d3e0] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-[#A4145E]" />
                </div>

                <button onClick={() => setOpened(entry)} className="flex-1 min-w-0 text-left">
                  <h3 className="font-semibold text-slate-900 truncate">{entry.title}</h3>
                  <p className="mt-1 text-[13px] text-slate-500 line-clamp-2 leading-relaxed">{entry.preview}</p>

                  <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[12px]">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {entry.modeLabel || KIND_LABELS[entry.kind]}
                    </span>
                    {scope === 'all' && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{entry.brandName}</span>
                    )}
                    <span className="text-slate-400">{formatWhen(entry.createdAt)}</span>
                    <span className={`inline-flex items-center gap-1 ${remaining <= 2 ? 'text-amber-700 font-medium' : 'text-slate-400'}`}>
                      <Clock className="w-3.5 h-3.5" />
                      {remaining === 0 ? 'Xoá trong hôm nay' : `Còn ${remaining} ngày`}
                    </span>
                    {entry.drive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <Check className="w-3.5 h-3.5" /> Đã lưu Drive
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <CloudOff className="w-3.5 h-3.5" /> Chưa sao lưu
                      </span>
                    )}
                    {entry.assetsPurged && (
                      <span className="text-slate-400">Ảnh đã hết hạn</span>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {entry.drive && (
                    <a
                      href={entry.drive.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Mở bản lưu trên Drive"
                      className="p-2.5 rounded-xl text-slate-400 hover:text-[#A4145E] hover:bg-[#FDF2F7] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => downloadEntry(entry, getAsset)}
                    title="Tải nội dung này về máy"
                    className="p-2.5 rounded-xl text-slate-400 hover:text-[#A4145E] hover:bg-[#FDF2F7] transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    title="Xoá khỏi lịch sử"
                    className="p-2.5 rounded-xl text-slate-400 hover:text-pink-600 hover:bg-pink-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Xem lại nội dung */}
      {opened && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
          onClick={() => setOpened(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 p-6 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-slate-900">{opened.title}</h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  {opened.modeLabel || KIND_LABELS[opened.kind]} · {opened.brandName} · {formatWhen(opened.createdAt)}
                </p>
              </div>
              <button
                onClick={() => downloadEntry(opened, getAsset)}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-medium text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
              >
                <Download className="w-4 h-4" /> Tải về
              </button>
              <button
                onClick={() => setOpened(null)}
                className="shrink-0 p-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {opened.sourceUrl && (
                <a
                  href={opened.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mb-4 text-[13px] text-[#A4145E] hover:underline break-all"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" /> {opened.sourceUrl}
                </a>
              )}

              {opened.html && (
                <div
                  className="prose prose-slate max-w-none text-slate-800"
                  dangerouslySetInnerHTML={{ __html: opened.html }}
                />
              )}

              {openedImages.map((image) => (
                <img key={image.url} src={image.url} alt={image.name} className="mt-4 rounded-xl border border-slate-200 w-full" />
              ))}

              {opened.assetsPurged && (opened.assets || []).length > 0 && (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">
                  Hình ảnh của mục này đã hết hạn 3 ngày và bị xoá để tiết kiệm dung lượng.
                  {opened.drive
                    ? ' Bản lưu trên Google Drive vẫn còn đầy đủ.'
                    : ' Không có bản sao trên Drive nên ảnh không khôi phục được.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
