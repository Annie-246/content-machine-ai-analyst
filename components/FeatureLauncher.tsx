import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowRight, ArrowUpRight, Sparkles, Video, FileText } from 'lucide-react';
import { AnalysisMode } from '../types';
import { Feature, FeatureTab, VIDEO_FEATURES, ARTICLE_FEATURES } from '../data/features';

export type { FeatureTab };

// The picker reads as an index: a numbered list of everything on the left, and a
// panel on the right that fills in as you move down it. Nothing is hidden behind
// a card, and the three stages of a feature are visible before committing to it.

const IndexRow: React.FC<{
  feature: Feature;
  index: number;
  active: boolean;
  onHover: () => void;
  onOpen: () => void;
}> = ({ feature, index, active, onHover, onOpen }) => (
  <button
    onMouseEnter={onHover}
    onFocus={onHover}
    onClick={onOpen}
    className={`group relative w-full text-left flex items-baseline gap-5 py-5 pl-6 pr-5 border-b border-slate-100 transition-colors
      ${active ? 'bg-[#fef7f8]' : 'hover:bg-slate-50/80'}`}
  >
    <span
      className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors ${active ? 'bg-[#A4145E]' : 'bg-transparent'}`}
    />
    <span
      className={`text-sm font-semibold tabular-nums shrink-0 transition-colors ${active ? 'text-[#A4145E]' : 'text-slate-300'}`}
    >
      {String(index + 1).padStart(2, '0')}
    </span>

    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2.5 flex-wrap">
        <span className={`text-[19px] font-bold leading-tight transition-colors ${active ? 'text-[#A4145E]' : 'text-slate-900'}`}>
          {feature.title}
        </span>
        {feature.soon && (
          <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
            Sắp có
          </span>
        )}
      </span>
      <span className="text-[13px] text-slate-500 leading-snug mt-1 line-clamp-1">{feature.desc}</span>
    </span>

    <ArrowUpRight
      className={`w-5 h-5 shrink-0 self-center transition-all ${active ? 'text-[#A4145E] translate-x-0' : 'text-slate-300 -translate-x-1 group-hover:translate-x-0'}`}
    />
  </button>
);

const PreviewPanel: React.FC<{ feature: Feature; onOpen: () => void }> = ({ feature, onOpen }) => {
  const Icon = feature.icon;
  return (
    <div className="sticky top-8 rounded-3xl border border-[#f8d3e0] bg-gradient-to-b from-[#FDF2F7] to-white p-8 overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <span className="w-20 h-20 rounded-2xl bg-white border border-[#f8d3e0] flex items-center justify-center shrink-0">
          <Icon className="w-10 h-10 text-[#A4145E]" strokeWidth={1.4} />
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#A4145E] bg-white border border-[#f8d3e0] rounded-full px-3 py-1.5">
          <Sparkles className="w-3.5 h-3.5" /> {feature.tab === 'video' ? 'Video' : 'Bài viết'}
        </span>
      </div>

      <h2 className="mt-6 text-[26px] leading-tight font-bold text-slate-900">{feature.title}</h2>
      <p className="mt-2.5 text-[15px] text-slate-600 leading-relaxed">{feature.desc}</p>

      <div className="mt-7 space-y-0">
        {feature.steps.map(([label, hint], i) => (
          <div key={label} className="flex gap-4">
            <div className="flex flex-col items-center shrink-0">
              <span className="w-8 h-8 rounded-full bg-white border border-[#f0c9d8] text-[#A4145E] flex items-center justify-center text-[13px] font-bold">
                {i + 1}
              </span>
              {i < feature.steps.length - 1 && <span className="w-px flex-1 bg-[#f0c9d8] my-1" />}
            </div>
            <div className={i < feature.steps.length - 1 ? 'pb-5' : ''}>
              <p className="text-[15px] font-semibold text-slate-900 leading-tight">{label}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{hint}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onOpen}
        className="mt-7 w-full inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl bg-[#A4145E] hover:bg-[#86104D] text-white font-semibold transition-colors"
      >
        {feature.soon ? 'Xem trước tính năng' : 'Bắt đầu'} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};

export const FeatureLauncher = ({ onSelectFeature }: { onSelectFeature: (mode: AnalysisMode) => void }) => {
  const [tab, setTab] = useState<FeatureTab>('video');
  const [query, setQuery] = useState('');
  const [previewMode, setPreviewMode] = useState<AnalysisMode | null>(null);

  const features = tab === 'video' ? VIDEO_FEATURES : ARTICLE_FEATURES;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features;
    return features.filter((f) => (f.title + ' ' + f.desc).toLowerCase().includes(q));
  }, [features, query]);

  // Keep the panel showing something that is actually in the list.
  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((f) => f.mode === previewMode)) {
      setPreviewMode((filtered.find((f) => f.featured) || filtered[0]).mode);
    }
  }, [filtered, previewMode]);

  const preview = filtered.find((f) => f.mode === previewMode) || filtered[0];

  return (
    <div className="max-w-[1180px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[26px] sm:text-[32px] lg:text-[40px] leading-tight font-bold text-slate-900">Bạn muốn tạo gì hôm nay?</h1>
          <p className="mt-2.5 text-[15px] text-slate-600">
            Rê chuột qua từng dòng để xem trước, bấm để bắt đầu.
          </p>
        </div>

        {/* Underlined tabs, so the switch reads as a section header rather than a control. */}
        <div className="flex items-center gap-7">
          {([['video', 'Video', Video], ['article', 'Bài viết', FileText]] as const).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); setPreviewMode(null); }}
                className={`relative inline-flex items-center gap-2 pb-2.5 text-[17px] font-semibold transition-colors
                  ${active ? 'text-[#A4145E]' : 'text-slate-400 hover:text-slate-700'}`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {label}
                <span
                  className={`absolute left-0 right-0 bottom-0 h-[3px] rounded-full transition-colors ${active ? 'bg-[#A4145E]' : 'bg-transparent'}`}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 min-w-0">
          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'video' ? 'Tìm tính năng video...' : 'Tìm tính năng bài viết...'}
              className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors"
            />
          </div>

          {filtered.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {filtered.map((feature, i) => (
                <IndexRow
                  key={feature.mode}
                  feature={feature}
                  index={i}
                  active={preview?.mode === feature.mode}
                  onHover={() => setPreviewMode(feature.mode)}
                  onOpen={() => onSelectFeature(feature.mode)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 py-20 text-center text-slate-500 text-sm">
              Không tìm thấy tính năng nào khớp với "{query}".
            </div>
          )}
        </div>

        <div className="lg:col-span-5 min-w-0">
          {preview && <PreviewPanel feature={preview} onOpen={() => onSelectFeature(preview.mode)} />}
        </div>
      </div>
    </div>
  );
};
