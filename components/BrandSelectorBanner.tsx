import React from 'react';
import { SlidersHorizontal, Sparkles, Check, MessageSquare, Volume2, ShieldCheck, Plus } from 'lucide-react';
import { BrandProfile } from '../types';

interface BrandSelectorBannerProps {
  activeBrand: BrandProfile;
  brandList: BrandProfile[];
  onOpenModal: () => void;
  onSelectBrand: (brandId: string) => void;
  onAddBrand: () => void;
}

export const BrandSelectorBanner: React.FC<BrandSelectorBannerProps> = ({
  activeBrand,
  brandList,
  onOpenModal,
  onSelectBrand,
  onAddBrand,
}) => {
  return (
    <div className="bg-gradient-to-r from-white via-pink-50/50 to-pink-50/70 border border-pink-200 rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden">
      {/* Background subtle glow */}
      <div className="absolute -right-10 -top-10 w-48 h-48 bg-pink-200/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -left-10 -bottom-10 w-48 h-48 bg-pink-200/30 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Active Brand Information */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-pink-100 text-pink-800 border border-pink-300">
              <ShieldCheck className="w-3.5 h-3.5 text-pink-600" /> Đang Áp Dụng Quy Tắc Brand:
            </span>
            <h2 className="text-base md:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              {activeBrand.name}
            </h2>
            <span className="text-xs text-slate-500 font-medium">({activeBrand.industry})</span>
          </div>

          {/* Key DNA Badges */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-pink-200 text-amber-900 shadow-sm">
              <MessageSquare className="w-3 h-3 text-amber-600" />
              <span>Xưng hô: <strong>{activeBrand.addressingSpeaker}</strong> ➔ <strong>{activeBrand.addressingAudience}</strong></span>
            </div>

            <div className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-pink-200 text-pink-900 shadow-sm">
              <Volume2 className="w-3 h-3 text-pink-600" />
              <span className="truncate max-w-xs md:max-w-md">Giọng văn: <strong>{activeBrand.brandVoiceTone}</strong></span>
            </div>

            {activeBrand.coreUSPs && (
              <div className="hidden lg:inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-pink-200 text-emerald-900 shadow-sm">
                <Sparkles className="w-3 h-3 text-emerald-600" />
                <span className="truncate max-w-xs">USP: {activeBrand.coreUSPs}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
          <button
            onClick={onOpenModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] border border-pink-400/30"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Tùy Chỉnh Quy Tắc Brand
          </button>
        </div>
      </div>

      {/* Quick Brand Switcher Pill Bar */}
      <div className="mt-3.5 pt-3 border-t border-pink-200/80 flex items-center gap-2 overflow-x-auto custom-scrollbar">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider shrink-0">
          Chuyển nhanh Brand:
        </span>
        <div className="flex items-center gap-1.5">
          {brandList.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onSelectBrand(preset.id)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap ${
                activeBrand.id === preset.id
                  ? 'bg-pink-100 text-pink-900 border-pink-400 font-semibold shadow-xs'
                  : 'bg-white text-slate-600 border-pink-200 hover:text-slate-900 hover:border-pink-300'
              }`}
            >
              {activeBrand.id === preset.id && <Check className="w-3 h-3 text-pink-600" />}
              {preset.name.split(' - ')[0]}
            </button>
          ))}
          <button
            onClick={onAddBrand}
            className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-pink-300 text-pink-700 bg-white hover:bg-pink-50 transition-all flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3 h-3" /> Thêm brand
          </button>
        </div>
      </div>
    </div>
  );
};


