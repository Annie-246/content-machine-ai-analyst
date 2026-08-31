import React, { useRef, useState } from 'react';
import {
  X, Link2, FileUp, Sparkles, Loader2, Check, AlertTriangle, Trash2,
  Plus, Wand2, ArrowLeft, FileText, Globe, ClipboardType, Building2,
} from 'lucide-react';
import { BrandProfile } from '../types';
import {
  BrandSource, BrandDnaSuggestion, LearnableField, LEARNABLE_FIELDS, FIELD_LABELS,
  readLink, readLocalFile, makeTextSource, learnBrandDna, describeBilling, newSourceId,
} from '../services/brandLearnService';

interface BrandLearnModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand: BrandProfile;
  onApply: (fields: Partial<BrandProfile>) => void;
}

const ACCEPTED = '.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.srt,.vtt,.log,.rtf';

const SourceIcon: React.FC<{ source: BrandSource }> = ({ source }) => {
  if (source.status === 'reading') return <Loader2 className="w-4 h-4 text-red-600 animate-spin" />;
  if (source.status === 'error') return <AlertTriangle className="w-4 h-4 text-amber-600" />;
  if (source.kind === 'link') return <Globe className="w-4 h-4 text-red-600" />;
  if (source.kind === 'text') return <ClipboardType className="w-4 h-4 text-red-600" />;
  return <FileText className="w-4 h-4 text-red-600" />;
};

export const BrandLearnModal: React.FC<BrandLearnModalProps> = ({ isOpen, onClose, brand, onApply }) => {
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [brandName, setBrandName] = useState(brand.name || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<BrandDnaSuggestion | null>(null);
  const [picked, setPicked] = useState<Partial<Record<LearnableField, boolean>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const upsert = (source: BrandSource) =>
    setSources((prev) => {
      const i = prev.findIndex((s) => s.id === source.id);
      if (i === -1) return [...prev, source];
      const next = [...prev];
      next[i] = source;
      return next;
    });

  const handleAddLink = async () => {
    const url = urlInput.trim();
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    setUrlInput('');
    setError('');

    const pending: BrandSource = { id: newSourceId(), kind: 'link', label: withScheme, status: 'reading' };
    upsert(pending);
    const done = await readLink(withScheme);
    upsert({ ...done, id: pending.id });
  };

  const handleAddFiles = async (files: FileList) => {
    setError('');
    for (const file of Array.from(files)) {
      const pending: BrandSource = { id: newSourceId(), kind: 'file', label: file.name, status: 'reading' };
      upsert(pending);
      const done = await readLocalFile(file);
      upsert({ ...done, id: pending.id });
    }
  };

  const handleAddPaste = () => {
    const text = pasteText.trim();
    if (text.length < 30) {
      setError('Nội dung dán vào quá ngắn để phân tích (cần ít nhất 30 ký tự).');
      return;
    }
    upsert(makeTextSource(text));
    setPasteText('');
    setError('');
  };

  const readySources = sources.filter((s) => s.status === 'ready');
  const hasFile = readySources.some((s) => !!s.base64);

  const handleAnalyze = async () => {
    if (!readySources.length) {
      setError('Thêm ít nhất một nguồn đọc được trước khi phân tích.');
      return;
    }
    setError('');
    setIsAnalyzing(true);
    try {
      const result = await learnBrandDna(readySources, brand);
      if (!Object.keys(result.fields).length) {
        setError('AI không rút ra được mục nào từ các nguồn này. Thử thêm trang "Giới thiệu", hồ sơ năng lực hoặc vài bài đăng tiêu biểu.');
        setIsAnalyzing(false);
        return;
      }
      // Pre-tick what fills a gap; leave overwrites of existing text for the
      // user to opt into, since those are the risky ones.
      if (!brandName.trim() && result.fields.name?.value) {
        setBrandName(result.fields.name.value);
      }

      const defaults: Partial<Record<LearnableField, boolean>> = {};
      for (const key of Object.keys(result.fields) as LearnableField[]) {
        defaults[key] = !(brand[key] || '').toString().trim();
      }
      setPicked(defaults);
      setSuggestion(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApply = () => {
    if (!suggestion) return;
    const fields: Partial<BrandProfile> = {};
    for (const key of Object.keys(suggestion.fields) as LearnableField[]) {
      if (key !== 'name' && picked[key]) fields[key] = suggestion.fields[key]!.value;
    }
    // The name comes from its own box, not from a checkbox.
    if (brandName.trim()) fields.name = brandName.trim();
    onApply(fields);
    onClose();
  };

  const reset = () => {
    setSuggestion(null);
    setPicked({});
    setError('');
  };

  const suggestedKeys = suggestion
    ? (LEARNABLE_FIELDS.filter((k) => k !== 'name' && suggestion.fields[k]) as LearnableField[])
    : [];

  const pickedCount = suggestedKeys.filter((k) => picked[k]).length + (brandName.trim() && brandName.trim() !== brand.name ? 1 : 0);

  const nameField = (
    <div className="space-y-2">
      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5 text-red-600" /> Tên thương hiệu
      </label>
      <input
        type="text"
        value={brandName}
        onChange={(e) => setBrandName(e.target.value)}
        placeholder="VD: Tên thương hiệu / kênh của bạn"
        className="w-full bg-red-50/40 border border-red-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white transition-colors"
      />
      <p className="text-[11px] text-slate-500">
        {suggestion?.fields.name?.value && suggestion.fields.name.value === brandName
          ? `AI đọc được tên này từ nguồn. Sửa lại nếu chưa đúng.`
          : 'Để trống thì AI sẽ tự điền nếu tìm thấy tên trong nguồn.'}
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white border border-red-200 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800">
        <div className="px-6 py-4 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-100 text-red-700 rounded-xl border border-red-300 shadow-sm">
              <Wand2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Học Brand DNA từ nguồn thật</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {suggestion
                  ? 'Chọn những mục bạn muốn đưa vào Bộ Quy Tắc Thương Hiệu.'
                  : 'Dán link trang hoặc link từng bài trên Facebook, Instagram, Threads, X, TikTok, YouTube, link website, hoặc tải PDF / tài liệu lên.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-red-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          {!suggestion && (
            <>
              {nameField}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-red-600" /> Website / Link mạng xã hội
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddLink();
                      }
                    }}
                    placeholder="VD: thuonghieucuaban.vn/gioi-thieu, facebook.com/trangcuaban, x.com/tenban/status/..."
                    className="flex-1 bg-red-50/40 border border-red-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleAddLink}
                    className="px-4 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Thêm
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Nhận cả link trang lẫn link từng bài. Facebook, Instagram, Threads, X (Twitter), TikTok, Douyin, YouTube - mọi định dạng bài viết, ảnh, video, reel. Với website thì trang "Giới thiệu" và trang sản phẩm cho kết quả tốt nhất.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <FileUp className="w-3.5 h-3.5 text-red-600" /> File tài liệu
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) handleAddFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.length) handleAddFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-red-200 hover:border-red-400 hover:bg-red-50/40 rounded-2xl p-5 text-center cursor-pointer transition-all"
                >
                  <FileUp className="w-6 h-6 text-red-500 mx-auto mb-1.5" />
                  <p className="text-sm font-semibold text-slate-700">Kéo thả hoặc bấm để chọn file</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">PDF, TXT, MD, CSV, JSON, HTML - tối đa 12MB mỗi file</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardType className="w-3.5 h-3.5 text-red-600" /> Hoặc dán thẳng nội dung
                </label>
                <textarea
                  rows={3}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Dán bài đăng tiêu biểu, mô tả sản phẩm, brief thương hiệu..."
                  className="w-full bg-red-50/40 border border-red-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white transition-colors resize-none"
                />
                {pasteText.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={handleAddPaste}
                    className="text-xs font-semibold text-red-700 hover:text-red-900 flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm nội dung này làm nguồn
                  </button>
                )}
              </div>

              {sources.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Nguồn đã thêm ({readySources.length}/{sources.length} đọc được)
                  </p>
                  <div className="space-y-1.5">
                    {sources.map((source) => (
                      <div
                        key={source.id}
                        className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-sm ${
                          source.status === 'error' ? 'bg-amber-50 border-amber-200' : 'bg-red-50/50 border-red-200'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          <SourceIcon source={source} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{source.label}</p>
                          {source.status === 'error' && <p className="text-xs text-amber-800 mt-0.5">{source.error}</p>}
                          {source.note && <p className="text-xs text-amber-800 mt-0.5">{source.note}</p>}
                          {source.status === 'ready' && (
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {source.base64 ? 'PDF - gửi thẳng cho AI đọc' : `${(source.text || '').length.toLocaleString('vi-VN')} ký tự`}
                            </p>
                          )}
                          {source.status === 'reading' && <p className="text-[11px] text-slate-500 mt-0.5">Đang đọc...</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSources((prev) => prev.filter((s) => s.id !== source.id))}
                          className="text-slate-400 hover:text-red-700 p-1 rounded-lg hover:bg-red-100 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {suggestion && (
            <>
              {nameField}

              {suggestion.summary && (
                <div className="p-4 bg-red-50/70 border border-red-300 rounded-xl">
                  <p className="text-xs font-bold text-red-900 uppercase tracking-wider mb-1.5">AI hiểu về thương hiệu này</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{suggestion.summary}</p>
                </div>
              )}

              <div className="space-y-2.5">
                {suggestedKeys.map((key) => {
                  const item = suggestion.fields[key]!;
                  const current = (brand[key] || '').toString().trim();
                  const checked = !!picked[key];
                  return (
                    <label
                      key={key}
                      className={`block p-3.5 rounded-xl border cursor-pointer transition-all ${
                        checked ? 'bg-red-50 border-red-400 shadow-xs' : 'bg-white border-red-200 hover:border-red-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [key]: e.target.checked }))}
                          className="mt-1 w-4 h-4 accent-red-600 shrink-0"
                        />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{FIELD_LABELS[key]}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                current
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              }`}
                            >
                              {current ? 'Ghi đè nội dung đang có' : 'Đang trống'}
                            </span>
                          </div>
                          {current && (
                            <p className="text-xs text-slate-500 line-through break-words">{current}</p>
                          )}
                          <p className="text-sm text-slate-900 font-medium whitespace-pre-wrap break-words">{item.value}</p>
                          {item.evidence && (
                            <p className="text-[11px] text-slate-500 italic break-words">Căn cứ: {item.evidence}</p>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {suggestion.gaps.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">Nguồn chưa đủ căn cứ cho</p>
                  <p className="text-xs text-amber-800">
                    {suggestion.gaps.map((g) => FIELD_LABELS[g as LearnableField] || g).join(' · ')}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1.5">Bạn tự điền các mục này, hoặc thêm nguồn rồi phân tích lại.</p>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 bg-red-50/60 border-t border-red-200 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            Chi phí tính vào: <strong className="text-slate-700">{describeBilling(hasFile)}</strong>
          </p>
          <div className="flex items-center gap-3">
            {suggestion ? (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-red-50 rounded-lg transition-colors border border-red-200 flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> Sửa nguồn
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={pickedCount === 0}
                  className="px-5 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-sm flex items-center gap-2 transition-all border border-red-500 active:scale-95"
                >
                  <Check className="w-4 h-4" /> Điền {pickedCount} mục đã chọn
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || readySources.length === 0}
                  className="px-5 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-sm flex items-center gap-2 transition-all border border-red-500 active:scale-95"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> AI đang đọc {readySources.length} nguồn...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Phân tích {readySources.length || ''} nguồn
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
