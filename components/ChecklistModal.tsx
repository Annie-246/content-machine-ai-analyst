import React, { useRef, useState } from 'react';
import {
  X, Plus, Trash2, ClipboardList, Save, FileUp, FileText, Loader2, AlertTriangle, Wand2,
} from 'lucide-react';
import { ScoringChecklist } from '../types';
import { loadChecklists, saveChecklist, removeChecklist, newChecklistId } from '../services/checklistStore';
import { BrandSource, readLocalFile, newSourceId } from '../services/brandLearnService';
import { extractCriteriaFromSources, joinSourceText, countFileOnlySources } from '../services/checklistImport';

// Định dạng nhận vào giống Brand DNA: PDF đọc bằng model, còn lại là file chữ.
const ACCEPTED = '.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.srt,.vtt,.log,.rtf';

/**
 * Kho bộ tiêu chí chấm điểm.
 *
 * Một người có thể chấm bài bán hàng bằng bộ này, bài chia sẻ kiến thức bằng bộ
 * khác, video bằng bộ thứ ba - nên đây là danh sách chứ không phải một ô cấu
 * hình duy nhất. Ô nhập tiêu chí để trống định dạng: người dùng dán thẳng bộ
 * tiêu chí họ vốn đang dùng vào, không phải gõ lại cho vừa một cái form.
 */
export const ChecklistModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ isOpen, onClose, onChanged }) => {
  const [list, setList] = useState<ScoringChecklist[]>(() => loadChecklists());
  const [editing, setEditing] = useState<ScoringChecklist | null>(null);
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const refresh = () => {
    setList(loadChecklists());
    onChanged?.();
  };

  const resetImport = () => {
    setSources([]);
    setImportError('');
    setIsExtracting(false);
  };

  const startNew = () => {
    resetImport();
    setEditing({
      id: newChecklistId(),
      name: '',
      kind: 'article',
      description: '',
      criteria: '',
      updatedAt: Date.now(),
    });
  };

  const upsertSource = (source: BrandSource) =>
    setSources((prev) => {
      const i = prev.findIndex((s) => s.id === source.id);
      if (i === -1) return [...prev, source];
      const next = [...prev];
      next[i] = source;
      return next;
    });

  const handleAddFiles = async (files: FileList) => {
    setImportError('');
    for (const file of Array.from(files)) {
      const pending: BrandSource = { id: newSourceId(), kind: 'file', label: file.name, status: 'reading' };
      upsertSource(pending);
      const done = await readLocalFile(file);
      upsertSource({ ...done, id: pending.id });
    }
  };

  // Nối thêm vào ô tiêu chí thay vì ghi đè, để tài liệu thứ hai không xoá mất tài liệu thứ nhất.
  const appendCriteria = (text: string) => {
    if (!editing || !text.trim()) return;
    const current = editing.criteria.trim();
    setEditing({ ...editing, criteria: current ? `${current}\n\n${text.trim()}` : text.trim() });
  };

  const handleInsertRaw = () => {
    const text = joinSourceText(sources);
    if (!text) {
      setImportError('Chưa có tài liệu chữ nào đọc được. File PDF cần dùng nút nhờ AI rút gọn.');
      return;
    }
    appendCriteria(text);
  };

  const handleExtract = async () => {
    setImportError('');
    setIsExtracting(true);
    try {
      appendCriteria(await extractCriteriaFromSources(sources));
    } catch (err) {
      setImportError((err as Error).message || 'Không rút được tiêu chí từ tài liệu.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = () => {
    if (!editing || !editing.name.trim() || !editing.criteria.trim()) return;
    saveChecklist(editing);
    setEditing(null);
    resetImport();
    refresh();
  };

  const handleDelete = (id: string) => {
    removeChecklist(id);
    if (editing?.id === id) setEditing(null);
    refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-3xl bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-7 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-5 h-5 text-[#A4145E]" />
            <h2 className="text-lg font-bold text-slate-900">Bộ tiêu chí chấm điểm</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-7">
          {editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Tên bộ tiêu chí</label>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="VD: Chấm bài bán hàng Facebook"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#A4145E] outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Dùng cho</label>
                  <select
                    value={editing.kind}
                    onChange={(e) => setEditing({ ...editing, kind: e.target.value as ScoringChecklist['kind'] })}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#A4145E] outline-none"
                  >
                    <option value="article">Bài viết</option>
                    <option value="video">Video</option>
                    <option value="both">Cả hai</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Ghi chú ngắn (không bắt buộc)</label>
                <input
                  value={editing.description || ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="VD: Dùng cho bài đăng chốt đơn, không dùng cho bài chia sẻ kiến thức"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#A4145E] outline-none"
                />
              </div>

              {/* Nạp bộ tiêu chí từ tài liệu có sẵn */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileUp className="w-4 h-4 text-[#A4145E]" /> Nạp từ tài liệu có sẵn
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Đã có bộ tiêu chí trong file rồi thì tải lên đây, không cần gõ lại. Nhận PDF và
                      file văn bản (txt, md, csv, json, html). File Word cần lưu thành PDF trước.
                    </p>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                  >
                    Chọn tài liệu
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) handleAddFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>

                {sources.length > 0 && (
                  <div className="space-y-2">
                    {sources.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5"
                      >
                        {s.status === 'reading' ? (
                          <Loader2 className="w-4 h-4 text-[#A4145E] animate-spin shrink-0" />
                        ) : s.status === 'error' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-[#A4145E] shrink-0" />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-slate-800 truncate">{s.label}</span>
                          {s.status === 'error' && (
                            <span className="block text-xs text-amber-700">{s.error}</span>
                          )}
                        </span>
                        <button
                          onClick={() => setSources((prev) => prev.filter((x) => x.id !== s.id))}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                          title="Bỏ tài liệu này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        onClick={handleExtract}
                        disabled={isExtracting || !sources.some((s) => s.status === 'ready')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
                      >
                        {isExtracting ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Đang đọc tài liệu...</>
                        ) : (
                          <><Wand2 className="w-4 h-4" /> Nhờ AI rút thành bộ tiêu chí</>
                        )}
                      </button>
                      {joinSourceText(sources) && (
                        <button
                          onClick={handleInsertRaw}
                          disabled={isExtracting}
                          className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 transition-colors"
                        >
                          Chèn nguyên văn
                        </button>
                      )}
                      {countFileOnlySources(sources) > 0 && (
                        <span className="text-xs text-slate-500">
                          File PDF chỉ đọc được qua AI, nút chèn nguyên văn không áp dụng.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {!!importError && (
                  <p className="text-xs text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {importError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Các tiêu chí chấm điểm
                </label>
                <p className="text-xs text-slate-500">
                  Dán thẳng bộ tiêu chí bạn đang dùng vào đây. Viết kiểu gì cũng được - thang điểm 10,
                  đạt/không đạt, có trọng số hay chỉ là gạch đầu dòng. AI sẽ chấm đúng theo cách bạn viết.
                </p>
                <textarea
                  value={editing.criteria}
                  onChange={(e) => setEditing({ ...editing, criteria: e.target.value })}
                  rows={12}
                  placeholder={'VD:\n1. Hook trong 2 dòng đầu có chặn được người lướt không? (30 điểm)\n2. Có nêu rõ nỗi đau cụ thể của khách, không nói chung chung? (20 điểm)\n3. Có bằng chứng hoặc ví dụ thật, không hô khẩu hiệu? (20 điểm)\n4. CTA rõ ràng, dẫn tới một hành động duy nhất? (15 điểm)\n5. Trình bày dễ đọc trên điện thoại, đoạn ngắn? (15 điểm)\n\nTrừ điểm nếu: dùng từ sáo rỗng, bịa số liệu, sai giọng thương hiệu.'}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:border-[#A4145E] outline-none font-mono"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!editing.name.trim() || !editing.criteria.trim()}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:opacity-40 text-white font-semibold transition-colors"
                >
                  <Save className="w-4 h-4" /> Lưu bộ tiêu chí
                </button>
                <button
                  onClick={() => { setEditing(null); resetImport(); }}
                  className="px-6 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={startNew}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors font-semibold"
              >
                <Plus className="w-5 h-5" /> Tạo bộ tiêu chí mới
              </button>

              {list.length === 0 ? (
                <p className="mt-6 text-center text-sm text-slate-500">
                  Chưa có bộ tiêu chí nào. Khi chưa có, AI sẽ chấm theo Brand DNA và bộ tiêu chí
                  chuẩn có sẵn của app.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {list.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-2xl border border-slate-200 p-5 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900 truncate">{c.name}</p>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                              {c.kind === 'article' ? 'Bài viết' : c.kind === 'video' ? 'Video' : 'Cả hai'}
                            </span>
                          </div>
                          {!!c.description && (
                            <p className="mt-1 text-sm text-slate-500 truncate">{c.description}</p>
                          )}
                          <p className="mt-2 text-xs text-slate-400">
                            {c.criteria.split('\n').filter((l) => l.trim()).length} dòng tiêu chí
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => { resetImport(); setEditing(c); }}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                            title="Xoá bộ tiêu chí"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
