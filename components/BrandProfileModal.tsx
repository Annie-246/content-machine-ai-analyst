import React, { useRef, useState } from 'react';
import { X, Sparkles, Check, Building2, MessageSquare, Volume2, ShieldAlert, Target, Lightbulb, Save, ChevronRight, BookOpen, Download, Upload, Trash2, Hash, AlignLeft, Wand2 } from 'lucide-react';
import { BrandProfile } from '../types';
import { SAMPLE_BRAND_PRESETS, normalizeBrand } from '../data/brandPresets';
import { BrandLearnModal } from './BrandLearnModal';

interface BrandProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeBrand: BrandProfile;
  onSaveBrand: (updated: BrandProfile) => void;
  brandList: BrandProfile[];
  onImportBrand: (brand: BrandProfile) => void;
  onDeleteBrand: (brandId: string) => void;
}

const FOOTER_PLACEHOLDER = `VD:
Tên thương hiệu - Slogan
Website: ...
Hotline: ...`;

const INPUT_CLASS =
  'w-full bg-red-50/40 border border-red-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white transition-colors';

export const BrandProfileModal: React.FC<BrandProfileModalProps> = ({
  isOpen,
  onClose,
  activeBrand,
  onSaveBrand,
  brandList,
  onImportBrand,
  onDeleteBrand,
}) => {
  const [formData, setFormData] = useState<BrandProfile>({ ...activeBrand });
  const [savedAlert, setSavedAlert] = useState(false);
  const [importError, setImportError] = useState('');
  const [isLearnOpen, setIsLearnOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setFormData({ ...activeBrand });
    setImportError('');
  }, [activeBrand]);

  if (!isOpen) return null;

  const handleChange = (key: keyof BrandProfile, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveBrand(formData);
    setSavedAlert(true);
    setTimeout(() => {
      setSavedAlert(false);
      onClose();
    }, 800);
  };

  // Nạp nội dung từ mẫu trung tính vào form, giữ nguyên id và tên thương hiệu đang sửa.
  const handleFillFromSample = (sampleId: string) => {
    const sample = SAMPLE_BRAND_PRESETS.find(s => s.id === sampleId);
    if (!sample) return;
    setFormData(prev => ({ ...sample, id: prev.id, name: prev.name.trim() || sample.name }));
  };

  // Fields the AI read out of the brand's own material, merged into the form so
  // the user still reviews and saves them by hand.
  const handleApplyLearned = (fields: Partial<BrandProfile>) => {
    setFormData(prev => ({ ...prev, ...fields }));
  };

  const handleExport = () => {
    const { id, ...exportable } = formData;
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `brand-dna-${(formData.name || 'khong-ten').toLowerCase().replace(/\s+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setImportError('');
    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const brands = list.map(item => normalizeBrand(item)).filter((b): b is BrandProfile => b !== null);
      if (brands.length === 0) {
        setImportError('File không chứa Brand DNA hợp lệ (thiếu trường name).');
        return;
      }
      brands.forEach(onImportBrand);
    } catch {
      setImportError('Không đọc được file. Hãy chọn đúng file .json đã export từ ứng dụng này.');
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white border border-red-200 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-100 text-red-700 rounded-xl border border-red-300 shadow-sm">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                Bộ Quy Tắc Thương Hiệu (Brand DNA)
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300">
                  AI sẽ áp dụng 100%
                </span>
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Nạp giọng văn, quy tắc xưng hô, điểm cốt lõi và cấm kỵ để AI remake nội dung chuẩn chất thương hiệu
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-red-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 bg-white border-b border-red-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Chưa biết điền gì?</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Đưa website, link mạng xã hội hoặc file PDF / tài liệu của thương hiệu vào, AI sẽ đọc và đề xuất nội dung cho từng mục bên dưới.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsLearnOpen(true)}
            className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm flex items-center gap-2 transition-all border border-red-500 active:scale-95 shrink-0"
          >
            <Wand2 className="w-4 h-4" /> Học từ nguồn thật
          </button>
        </div>

        <div className="px-6 py-3 bg-red-50/40 border-b border-red-200 flex items-center gap-2 overflow-x-auto custom-scrollbar">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider shrink-0 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-red-600" /> Điền nhanh từ mẫu:
          </span>
          {SAMPLE_BRAND_PRESETS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => handleFillFromSample(sample.id)}
              className="text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap transition-all bg-white text-slate-700 border-red-200 hover:border-red-400 hover:bg-red-50"
            >
              {sample.name}
            </button>
          ))}
          <span className="text-[11px] text-slate-400 shrink-0 pl-1">(giữ nguyên tên thương hiệu của bạn)</span>
        </div>

        <form onSubmit={handleSave} className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-red-600" /> 1. Tên Thương Hiệu
              </label>
              <input type="text" required value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="VD: Tên thương hiệu / kênh của bạn" className={INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-red-600" /> 2. Ngành Hàng & Lĩnh Vực
              </label>
              <input type="text" value={formData.industry} onChange={(e) => handleChange('industry', e.target.value)} placeholder="VD: Mỹ phẩm, F&B, Giáo dục, Thời trang..." className={INPUT_CLASS} />
            </div>
          </div>

          <div className="p-4 bg-red-50/70 border border-red-300 rounded-xl space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-red-900 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-red-600" /> 3. Quy Tắc Xưng Hô Bắt Buộc
              </label>
              <span className="text-[11px] text-red-800 bg-red-100 font-semibold px-2 py-0.5 rounded border border-red-300">
                AI sẽ tuân thủ tuyệt đối
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-xs text-slate-700 block font-semibold">Người nói / Chủ kênh xưng là:</span>
                <input type="text" required value={formData.addressingSpeaker} onChange={(e) => handleChange('addressingSpeaker', e.target.value)} placeholder="VD: Mình / Chúng mình / Em / Tên thương hiệu..." className="w-full bg-white border border-red-300 rounded-lg px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-red-500 font-semibold" />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-700 block font-semibold">Khán giả / Khách hàng gọi là:</span>
                <input type="text" required value={formData.addressingAudience} onChange={(e) => handleChange('addressingAudience', e.target.value)} placeholder="VD: Bạn / Các bạn / Anh chị / Nàng..." className="w-full bg-white border border-red-300 rounded-lg px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-red-500 font-semibold" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-red-600" /> 4. Giọng Văn & Sắc Thái (Tone of Voice)
              </label>
              <textarea rows={2} value={formData.brandVoiceTone} onChange={(e) => handleChange('brandVoiceTone', e.target.value)} placeholder="VD: Gần gũi, tích cực, minh bạch, truyền cảm hứng..." className={`${INPUT_CLASS} resize-none`} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-red-600" /> 5. Hình Tượng Người Nói (Speaker Persona)
              </label>
              <textarea rows={2} value={formData.speakerPersona} onChange={(e) => handleChange('speakerPersona', e.target.value)} placeholder="VD: Chuyên gia thân thiện, người bạn am hiểu, người đi trước chia sẻ kinh nghiệm..." className={`${INPUT_CLASS} resize-none`} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-red-600" /> 6. Khách Hàng Mục Tiêu & Insight
              </label>
              <textarea rows={2} value={formData.targetAudience} onChange={(e) => handleChange('targetAudience', e.target.value)} placeholder="VD: Nữ 18-35 tuổi ở thành phố, quan tâm tới..." className={`${INPUT_CLASS} resize-none`} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-red-600" /> 7. Điểm Cốt Lõi / Lợi Thế (USPs)
              </label>
              <textarea rows={2} value={formData.coreUSPs} onChange={(e) => handleChange('coreUSPs', e.target.value)} placeholder="VD: Công nghệ độc quyền, nguyên liệu chọn lọc, cam kết dịch vụ..." className={`${INPUT_CLASS} resize-none`} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 text-red-600" /> 8. Lời Kêu Gọi Hành Động (CTA)
              </label>
              <input type="text" value={formData.callToAction} onChange={(e) => handleChange('callToAction', e.target.value)} placeholder="VD: Nhắn tin ngay để được tư vấn miễn phí nhé!" className={INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-red-800 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-600" /> 9. Điều Cấm Kỵ & Từ Ngữ Không Dùng
              </label>
              <input type="text" value={formData.forbiddenKeywords} onChange={(e) => handleChange('forbiddenKeywords', e.target.value)} placeholder="VD: Không claim quá đà, không dìm đối thủ, không giật gân sai sự thật..." className={INPUT_CLASS} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">10. Slogan / Khẩu Hiệu (Nếu có)</label>
              <input type="text" value={formData.tagline} onChange={(e) => handleChange('tagline', e.target.value)} placeholder="VD: Khẩu hiệu ngắn gọn của thương hiệu" className={INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">11. Ghi Chú Riêng Khác</label>
              <input type="text" value={formData.customNotes || ''} onChange={(e) => handleChange('customNotes', e.target.value)} placeholder="VD: Luôn nhấn mạnh yếu tố... / Tránh nhắc tới..." className={INPUT_CLASS} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <AlignLeft className="w-3.5 h-3.5 text-red-600" /> 12. Khối Footer Cố Định (Tùy chọn)
              </label>
              <textarea rows={4} value={formData.footerBlock || ''} onChange={(e) => handleChange('footerBlock', e.target.value)} placeholder={FOOTER_PLACEHOLDER} className={`${INPUT_CLASS} resize-none font-mono text-xs`} />
              <p className="text-[11px] text-slate-500">Nếu điền, AI sẽ chèn nguyên văn khối này ở cuối bài đăng social.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-red-600" /> 13. Bộ Hashtag Mặc Định (Tùy chọn)
              </label>
              <textarea rows={4} value={formData.hashtags || ''} onChange={(e) => handleChange('hashtags', e.target.value)} placeholder="VD: #TenThuongHieu #ChienDich2025 #TuKhoaNganh" className={`${INPUT_CLASS} resize-none font-mono text-xs`} />
            </div>
          </div>

          {importError && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</p>
          )}
        </form>

        <div className="px-6 py-4 bg-red-50/60 border-t border-red-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-slate-700 hover:text-slate-900 font-semibold flex items-center gap-1.5 py-2 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Nhập JSON
            </button>
            <button type="button" onClick={handleExport} className="text-xs text-slate-700 hover:text-slate-900 font-semibold flex items-center gap-1.5 py-2 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Xuất JSON
            </button>
            {brandList.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Xóa thương hiệu "${activeBrand.name}"?`)) {
                    onDeleteBrand(activeBrand.id);
                    onClose();
                  }
                }}
                className="text-xs text-red-700 hover:text-red-900 font-semibold flex items-center gap-1.5 py-2 px-3 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Xóa brand này
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-red-50 rounded-lg transition-colors border border-red-200">
              Hủy
            </button>
            <button type="button" onClick={handleSave} className="px-5 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm flex items-center gap-2 transition-all border border-red-500 active:scale-95">
              {savedAlert ? (
                <>
                  <Check className="w-4 h-4 text-emerald-200" /> Đã Lưu Quy Tắc!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Lưu & Áp Dụng Ngay
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>

    <BrandLearnModal
      isOpen={isLearnOpen}
      onClose={() => setIsLearnOpen(false)}
      brand={formData}
      onApply={handleApplyLearned}
    />
    </>
  );
};
