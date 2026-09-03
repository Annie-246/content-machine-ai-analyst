import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck, Check, Aperture, Plus } from 'lucide-react';
import { BrandProfile } from '../types';

export const TopBar = ({
  activeBrand,
  brandList,
  onSelectBrand,
  onManageBrand,
  onAddBrand,
}: {
  activeBrand: BrandProfile;
  brandList: BrandProfile[];
  onSelectBrand: (id: string) => void;
  onManageBrand: () => void;
  onAddBrand: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 bg-[#A4145E] border-b border-[#86104D]">
      <div className="flex items-center justify-between gap-4 px-10 py-4">
        <div className="relative" ref={wrapRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-3 pl-4 pr-4 py-2.5 rounded-xl bg-transparent border border-white/60 hover:bg-white/10 transition-colors min-w-[340px] group"
          >
            <Aperture className="w-[18px] h-[18px] text-white shrink-0" />
            <span className="flex-1 text-left min-w-0">
              <span className="block text-[11px] uppercase tracking-wide text-white/70 font-semibold leading-tight">
                Thương hiệu · bấm để đổi
              </span>
              <span className="block text-[15px] font-bold text-white truncate leading-tight">
                {activeBrand.name}
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-white/70 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute left-0 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg py-1.5 z-40 max-h-80 overflow-y-auto custom-scrollbar">
              {brandList.map((brand) => (
                <button
                  key={brand.id}
                  onClick={() => {
                    onSelectBrand(brand.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-900 truncate">{brand.name}</span>
                    {brand.industry && (
                      <span className="block text-xs text-slate-500 truncate">{brand.industry}</span>
                    )}
                  </span>
                  {brand.id === activeBrand.id && <Check className="w-4 h-4 text-[#A4145E] shrink-0" />}
                </button>
              ))}
              <button
                onClick={() => {
                  onAddBrand();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-t border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <Plus className="w-4 h-4 text-[#A4145E] shrink-0" />
                <span className="text-sm font-medium text-[#A4145E]">Thêm thương hiệu mới</span>
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onManageBrand}
          className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl bg-transparent border border-white/60 text-white font-semibold hover:bg-white/10 transition-colors"
        >
          <ShieldCheck className="w-[18px] h-[18px]" />
          Quản lý Brand
        </button>
      </div>
    </header>
  );
};
