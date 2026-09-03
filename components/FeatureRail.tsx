import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowRight, CheckCircle2, Video, FileText } from 'lucide-react';
import { AnalysisMode } from '../types';
import { VIDEO_FEATURES, ARTICLE_FEATURES, FeatureTab, getFeature } from '../data/features';

// The feature library, kept beside the workspace so switching tools never costs
// a trip back to the launcher screen.
export const FeatureRail: React.FC<{
  activeMode: AnalysisMode;
  onSelect: (mode: AnalysisMode) => void;
}> = ({ activeMode, onSelect }) => {
  const [tab, setTab] = useState<FeatureTab>(getFeature(activeMode).tab);
  const [query, setQuery] = useState('');

  // Following the workspace keeps the list on the right shelf when the user
  // jumps to a feature from somewhere else.
  useEffect(() => {
    setTab(getFeature(activeMode).tab);
  }, [activeMode]);

  const features = tab === 'video' ? VIDEO_FEATURES : ARTICLE_FEATURES;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features;
    return features.filter((f) => (f.title + ' ' + f.desc).toLowerCase().includes(q));
  }, [features, query]);

  return (
    <aside className="w-[380px] shrink-0 border-l border-slate-200 bg-white h-[calc(100vh-73px)] sticky top-[73px] overflow-y-auto custom-scrollbar">
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-50 border border-slate-200">
          {([['video', 'Video', Video], ['article', 'Bài viết', FileText]] as const).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors
                  ${active ? 'bg-white border border-[#A4145E] text-[#A4145E] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-[#A4145E]' : 'text-slate-400'}`} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tính năng..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors"
          />
        </div>

        <div>
          <p className="text-[13px] font-semibold text-slate-500 mb-3">Content Creator</p>
          <div className="space-y-2.5">
            {filtered.map((feature) => {
              const Icon = feature.icon;
              const active = feature.mode === activeMode;
              return (
                <button
                  key={feature.mode}
                  onClick={() => onSelect(feature.mode)}
                  className={`group w-full text-left rounded-2xl border p-4 transition-all flex gap-3.5
                    ${active
                      ? 'border-[#A4145E] bg-[#fef7f8] shadow-sm'
                      : 'border-slate-200 bg-white hover:border-[#f0c9d8] hover:shadow-sm'}`}
                >
                  <span
                    className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center
                      ${active ? 'bg-white border border-[#f8d3e0]' : 'bg-[#FDF2F7]'}`}
                  >
                    <Icon className="w-[22px] h-[22px] text-[#A4145E]" strokeWidth={1.75} />
                  </span>

                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-bold text-slate-900 leading-tight">{feature.title}</span>
                      {feature.soon && (
                        <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                          Sắp có
                        </span>
                      )}
                    </span>
                    <span className="block text-[13px] text-slate-600 leading-snug mt-1">{feature.desc}</span>
                  </span>

                  <span className="shrink-0 self-center">
                    {active ? (
                      <CheckCircle2 className="w-6 h-6 text-[#A4145E]" />
                    ) : (
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-[#A4145E] transition-colors" />
                    )}
                  </span>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
                Không có tính năng nào khớp "{query}".
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
