import React from 'react';
import { Heart, Share2, Film, ExternalLink } from 'lucide-react';
import type { RadarCreatorSummary } from '../types';
import { formatCount } from '../services/radarService';

// Everything here is rolled up from the rows already on screen. Opening this tab
// costs nothing, and the copy says "trong kết quả này" so the numbers are not
// mistaken for whole-channel statistics.
export const RadarCreatorCard: React.FC<{ creator: RadarCreatorSummary }> = ({ creator }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-[#f0c9d8] hover:shadow-sm transition-all">
    <div className="flex items-center gap-3">
      {creator.avatarUrl ? (
        <img
          src={creator.avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-11 h-11 rounded-full object-cover bg-slate-100 shrink-0"
        />
      ) : (
        <span className="w-11 h-11 rounded-full bg-slate-100 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-slate-900 truncate">
          {creator.nickname || creator.username || 'Không rõ'}
        </p>
        <p className="text-[12px] text-slate-500 truncate">
          {creator.username ? `@${creator.username} · ` : ''}
          {formatCount(creator.followerCount)} follower
        </p>
      </div>

      <span
        className="shrink-0 px-2.5 py-1 rounded-lg border border-[#f8d3e0] bg-[#FDF2F7] text-[#A4145E] text-[13px] font-bold tabular-nums"
        title="Radar Score cao nhất trong kết quả này"
      >
        {Math.round(creator.bestRadarScore)}
      </span>
    </div>

    <div className="mt-3.5 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-slate-50 border border-slate-100 py-2">
        <p className="text-[15px] font-bold text-slate-900 tabular-nums inline-flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5 text-slate-400" />
          {creator.contentCount}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">video</p>
      </div>
      <div className="rounded-xl bg-slate-50 border border-slate-100 py-2">
        <p className="text-[15px] font-bold text-slate-900 tabular-nums inline-flex items-center gap-1.5">
          <Heart className="w-3.5 h-3.5 text-slate-400" />
          {formatCount(creator.averageLikes)}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">like trung bình</p>
      </div>
      <div className="rounded-xl bg-slate-50 border border-slate-100 py-2">
        <p className="text-[15px] font-bold text-slate-900 tabular-nums inline-flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5 text-slate-400" />
          {formatCount(creator.totalShares)}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">tổng share</p>
      </div>
    </div>

    {creator.bestContent && (
      <div className="mt-3.5 pt-3.5 border-t border-slate-100">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Nội dung nổi bật nhất
        </p>
        <p className="text-[13px] text-slate-700 line-clamp-2 leading-snug break-words">
          {creator.bestContent.caption || 'Không có mô tả'}
        </p>
        <a
          href={creator.bestContent.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#A4145E] hover:underline"
        >
          Xem video gốc <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    )}

    {creator.profileUrl && (
      <a
        href={creator.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-[#A4145E] transition-colors"
      >
        Trang cá nhân <ExternalLink className="w-3 h-3" />
      </a>
    )}
  </article>
);
