import React, { useRef, useState } from 'react';
import { PlusCircle, Upload, BookOpen, ArrowRight } from 'lucide-react';
import { BrandProfile } from '../types';
import { SAMPLE_BRAND_PRESETS, normalizeBrand, createBrandId } from '../data/brandPresets';
import { APP_CONFIG } from '../data/appConfig';
import { AppLogo } from './AppLogo';

interface OnboardingWizardProps {
  onCreateBlank: (name: string) => void;
  onUseSample: (sample: BrandProfile) => void;
  onImportBrands: (brands: BrandProfile[]) => void;
}

/**
 * Màn hình khởi đầu khi chưa có Brand DNA nào.
 * Ứng dụng không kèm sẵn thương hiệu nào - người dùng tự tạo, nhập hoặc chọn mẫu.
 */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onCreateBlank,
  onUseSample,
  onImportBrands,
}) => {
  const [brandName, setBrandName] = useState('');
  const [importError, setImportError] = useState('');
  const [showSamples, setShowSamples] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      onImportBrands(brands);
    } catch {
      setImportError('Không đọc được file. Hãy chọn đúng file .json đã export từ ứng dụng này.');
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="flex justify-center mb-8">
          <AppLogo />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
            Chào mừng đến với {APP_CONFIG.name}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Tạo Brand DNA đầu tiên để AI biết viết theo giọng văn và quy tắc của thương hiệu bạn.
          </p>
        </div>

        <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Tên thương hiệu / kênh của bạn
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && brandName.trim()) onCreateBlank(brandName.trim());
                }}
                placeholder="VD: Cửa hàng ABC, Kênh review XYZ..."
                className="flex-1 bg-red-50/40 border border-red-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white transition-colors"
              />
              <button
                type="button"
                disabled={!brandName.trim()}
                onClick={() => onCreateBlank(brandName.trim())}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                <PlusCircle className="w-4 h-4" /> Tạo mới từ đầu
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400 uppercase tracking-wider">hoặc</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-3 p-4 rounded-xl border border-red-200 bg-white hover:border-red-400 hover:bg-red-50 text-left transition-colors"
            >
              <Upload className="w-5 h-5 text-red-600 shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Nhập file JSON</span>
                <span className="block text-xs text-slate-500">Brand DNA đã export từ máy khác</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowSamples(v => !v)}
              className="flex items-center gap-3 p-4 rounded-xl border border-red-200 bg-white hover:border-red-400 hover:bg-red-50 text-left transition-colors"
            >
              <BookOpen className="w-5 h-5 text-red-600 shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Dùng preset mẫu</span>
                <span className="block text-xs text-slate-500">Bắt đầu nhanh rồi sửa lại</span>
              </span>
            </button>
          </div>

          {showSamples && (
            <div className="space-y-2 pt-1">
              {SAMPLE_BRAND_PRESETS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => onUseSample({ ...sample, id: createBrandId() })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-red-400 hover:bg-red-50 text-left transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{sample.name}</span>
                    <span className="block text-xs text-slate-500 truncate">{sample.industry}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-red-600 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {importError && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {importError}
            </p>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          Mọi Brand DNA được lưu trong trình duyệt của bạn. Có thể tạo nhiều thương hiệu và chuyển qua lại bất cứ lúc nào.
        </p>
      </div>
    </div>
  );
};
