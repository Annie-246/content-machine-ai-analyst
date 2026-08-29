import React, { useMemo, useState } from 'react';
import {
  Search, ArrowRight, Sparkles, Video, FileText,
  FileVideo, BarChart3, FileSearch, Clapperboard, Image as ImageIcon, Newspaper, Gauge,
} from 'lucide-react';
import { AnalysisMode } from '../types';

export type FeatureTab = 'video' | 'article';

interface Feature {
  mode: AnalysisMode;
  title: string;
  desc: string;
  icon: React.ElementType;
  featured?: boolean;
  steps?: [string, string][];
  soon?: boolean;
}

const VIDEO_FEATURES: Feature[] = [
  {
    mode: AnalysisMode.REMAKE_SCRIPT,
    title: 'Remake kịch bản video',
    desc: 'Biến video gốc thành kịch bản mới theo đúng Brand DNA và giọng văn của bạn.',
    icon: FileVideo,
    featured: true,
    steps: [
      ['Nguồn video', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Nội dung & giọng văn'],
      ['Kết quả', 'Kịch bản mới sẵn sàng'],
    ],
  },
  {
    mode: AnalysisMode.DEEP_ANALYSIS,
    title: 'Phân tích sâu video',
    desc: 'Phân tích chi tiết: kịch bản, hình ảnh, âm thanh, hook, CTA và hiệu suất.',
    icon: BarChart3,
  },
  {
    mode: AnalysisMode.SCRIPT_EXTRACT,
    title: 'Trích script video',
    desc: 'Trích xuất kịch bản (script) từ video nhanh chóng và chính xác.',
    icon: FileSearch,
  },
  {
    mode: AnalysisMode.SCRIPT_GENERATION,
    title: 'Tạo kịch bản từ ý tưởng',
    desc: 'Từ ý tưởng nháp thô thành kịch bản viral chuẩn thương hiệu.',
    icon: Clapperboard,
  },
  {
    mode: AnalysisMode.VIDEO_SCORING,
    title: 'Chấm điểm nội dung',
    desc: 'Chấm điểm video theo bộ tiêu chí của thương hiệu.',
    icon: Gauge,
    soon: true,
  },
];

const ARTICLE_FEATURES: Feature[] = [
  {
    mode: AnalysisMode.CONTENT_AUDIT,
    title: 'Remake bài viết',
    desc: 'Chuyển đổi một bài viết hiện có thành phiên bản mới, phù hợp với Brand DNA và giọng văn của bạn.',
    icon: Newspaper,
    featured: true,
    steps: [
      ['Nguồn bài viết', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Nội dung & giọng văn'],
      ['Kết quả', 'Bài viết mới sẵn sàng'],
    ],
  },
  {
    mode: AnalysisMode.ARTICLE_ANALYSIS,
    title: 'Phân tích sâu bài viết',
    desc: 'Mổ xẻ bài viết hay để học: hook, tâm lý người đọc, cấu trúc, hình thức và CTA.',
    icon: BarChart3,
  },
  {
    mode: AnalysisMode.THUMBNAIL_AUDIT,
    title: 'Tạo hình ảnh',
    desc: 'Tạo hình ảnh minh họa, đồ họa hỗ trợ cho bài viết và nội dung mạng xã hội.',
    icon: ImageIcon,
    soon: true,
  },
  {
    mode: AnalysisMode.ARTICLE_SCORING,
    title: 'Chấm điểm nội dung',
    desc: 'Chấm điểm bài viết theo bộ tiêu chí của thương hiệu.',
    icon: Gauge,
    soon: true,
  },
];

const FeaturedCard = ({ feature, onStart }: { feature: Feature; onStart: () => void }) => {
  const Icon = feature.icon;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#f8d3e0] bg-gradient-to-r from-[#fef2f2] via-[#fdf3f7] to-white p-8">
      {/* Decorative botanical wash, kept behind the content */}
      <div className="pointer-events-none absolute -right-10 top-0 bottom-0 w-1/2 opacity-[0.18]">
        <svg viewBox="0 0 200 200" className="h-full w-full text-[#dc2626]" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M100 190 C100 120 60 90 30 60" />
          <path d="M100 150 C120 130 150 120 175 118" />
          <ellipse cx="60" cy="70" rx="34" ry="17" transform="rotate(-40 60 70)" />
          <ellipse cx="140" cy="110" rx="38" ry="19" transform="rotate(20 140 110)" />
          <ellipse cx="95" cy="40" rx="30" ry="15" transform="rotate(-75 95 40)" />
        </svg>
      </div>

      <div className="relative flex flex-col lg:flex-row lg:items-center gap-8">
        <div className="shrink-0">
          <div className="relative w-36 h-36 rounded-2xl bg-[#fbdce7]/60 flex items-center justify-center">
            <Icon className="w-20 h-20 text-[#dc2626]" strokeWidth={1.5} />
            <Sparkles className="absolute -top-1 right-2 w-6 h-6 text-[#dc2626]" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#dc2626] mb-2">
            <Sparkles className="w-3.5 h-3.5" /> Nổi bật
          </p>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">{feature.title}</h2>
          <p className="text-[15px] text-slate-600 max-w-xl leading-relaxed">{feature.desc}</p>

          {feature.steps && (
            <div className="mt-7 flex items-start gap-3 max-w-2xl">
              {feature.steps.map(([label, hint], i) => (
                <React.Fragment key={label}>
                  <div className="text-center w-32">
                    <span className="mx-auto mb-2 w-9 h-9 rounded-full bg-[#fbdce7] text-[#dc2626] flex items-center justify-center text-sm font-semibold">
                      {i + 1}
                    </span>
                    <p className="text-sm font-medium text-slate-800">{label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">{hint}</p>
                  </div>
                  {i < feature.steps!.length - 1 && (
                    <span className="hidden sm:block flex-1 h-px bg-[#f0c9d8] mt-4" />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#dc2626] hover:bg-[#c70045] text-white font-semibold transition-colors shadow-sm"
          >
            Bắt đầu <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const SmallCard: React.FC<{ feature: Feature; onStart: () => void }> = ({ feature, onStart }) => {
  const Icon = feature.icon;
  return (
    <button
      onClick={onStart}
      className="group text-left w-full rounded-2xl border border-slate-200 bg-white hover:border-[#f0c9d8] hover:shadow-sm transition-all p-6 flex items-center gap-5"
    >
      <span className="shrink-0 w-14 h-14 rounded-xl bg-[#fef2f2] flex items-center justify-center">
        <Icon className="w-7 h-7 text-[#dc2626]" strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 mb-1">
          <span className="text-lg font-bold text-slate-900">{feature.title}</span>
          {feature.soon && (
            <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
              Sắp có
            </span>
          )}
        </span>
        <span className="block text-sm text-slate-600 leading-snug">{feature.desc}</span>
      </span>
      <span className="shrink-0 w-10 h-10 rounded-full border border-slate-200 group-hover:border-[#dc2626] flex items-center justify-center transition-colors">
        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#dc2626]" />
      </span>
    </button>
  );
};

export const FeatureLauncher = ({ onSelectFeature }: { onSelectFeature: (mode: AnalysisMode) => void }) => {
  const [tab, setTab] = useState<FeatureTab>('video');
  const [query, setQuery] = useState('');

  const features = tab === 'video' ? VIDEO_FEATURES : ARTICLE_FEATURES;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features;
    return features.filter((f) => (f.title + ' ' + f.desc).toLowerCase().includes(q));
  }, [features, query]);

  const featured = filtered.find((f) => f.featured);
  const rest = filtered.filter((f) => !f.featured);

  return (
    <div className="max-w-5xl">
      <h1 className="text-[40px] leading-tight font-bold text-slate-900">Bạn muốn tạo gì hôm nay?</h1>
      <p className="mt-3 text-[15px] text-slate-600">
        Chọn một tính năng để bắt đầu. Thiết lập chi tiết sẽ mở ở bước tiếp theo.
      </p>

      <div className="mt-8 flex items-center gap-3">
        {([['video', 'Video', Video], ['article', 'Bài viết', FileText]] as const).map(([id, label, Icon]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2.5 px-6 py-3 rounded-full border font-medium transition-colors
                ${active
                  ? 'bg-[#fef2f2] border-[#dc2626] text-[#dc2626]'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
            >
              <Icon className={`w-[18px] h-[18px] ${active ? 'text-[#dc2626]' : 'text-slate-500'}`} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'video' ? 'Tìm kiếm tính năng video...' : 'Tìm kiếm tính năng bài viết...'}
          className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#dc2626] transition-colors"
        />
      </div>

      <div className="mt-6 space-y-5">
        {featured && <FeaturedCard feature={featured} onStart={() => onSelectFeature(featured.mode)} />}

        {rest.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {rest.map((f) => (
              <SmallCard key={f.mode} feature={f} onStart={() => onSelectFeature(f.mode)} />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500 text-sm">
            Không tìm thấy tính năng nào khớp với "{query}".
          </div>
        )}
      </div>
    </div>
  );
};
