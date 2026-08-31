import React, { useState } from 'react';
import { Heart, MessageCircle, Share2, Bookmark, ExternalLink, ImageOff, Megaphone } from 'lucide-react';
import type { RadarContent } from '../types';
import { formatCount, formatDuration, formatRelativeTime } from '../services/radarService';

// Score bands, so a strong find reads as strong at a glance instead of being one
// number among many.
const scoreTone = (score: number): string => {
  if (score >= 70) return 'bg-[#dc2626] text-white border-[#dc2626]';
  if (score >= 45) return 'bg-[#fef2f2] text-[#dc2626] border-[#f8d3e0]';
  return 'bg-slate-50 text-slate-500 border-slate-200';
};

const Stat: React.FC<{ icon: React.ElementType; value: number | null; label: string }> = ({
  icon: Icon, value, label,
}) => (
  <span className="inline-flex items-center gap-1.5 text-slate-600" title={label}>
    <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    <span className="text-[13px] font-medium tabular-nums">{formatCount(value)}</span>
  </span>
);

// Douyin's CDN serves covers with hotlink rules and a .heic extension that not
// every browser decodes, so a broken thumbnail is expected rather than
// exceptional. It degrades to a placeholder instead of a torn layout.
const Thumbnail: React.FC<{ url: string | null; duration: number | null }> = ({ url, duration }) => {
  const [broken, setBroken] = useState(false);
  const length = formatDuration(duration);

  return (
    <div className="relative w-[104px] sm:w-[116px] shrink-0 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 aspect-[9/16]">
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageOff className="w-5 h-5 text-slate-300" />
        </div>
      )}

      {length && (
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[10px] font-medium tabular-nums">
          {length}
        </span>
      )}
    </div>
  );
};

export const RadarContentCard: React.FC<{ content: RadarContent }> = ({ content }) => {
  const { creator, metrics } = content;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 flex gap-4 hover:border-[#f0c9d8] hover:shadow-sm transition-all">
      <Thumbnail url={content.thumbnailUrl} duration={content.duration} />

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start gap-3">
          {/* Caption first: it is what tells the user whether this is worth opening. */}
          <p className="flex-1 min-w-0 text-[14px] leading-snug text-slate-900 font-medium line-clamp-3 break-words">
            {content.caption || <span className="text-slate-400 font-normal">Không có mô tả</span>}
          </p>

          <span
            className={`shrink-0 px-2.5 py-1 rounded-lg border text-[13px] font-bold tabular-nums ${scoreTone(content.radarScore)}`}
            title="Radar Score - mức độ đáng chú ý so với quy mô kênh"
          >
            {Math.round(content.radarScore)}
          </span>
        </div>

        <div className="mt-2.5 flex items-center gap-2 min-w-0">
          {creator.avatarUrl ? (
            <img
              src={creator.avatarUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover bg-slate-100 shrink-0"
            />
          ) : (
            <span className="w-6 h-6 rounded-full bg-slate-100 shrink-0" />
          )}

          <span className="text-[13px] text-slate-700 font-medium truncate">
            {creator.nickname || creator.username || 'Không rõ'}
          </span>
          <span className="text-[12px] text-slate-400 shrink-0">
            {formatCount(creator.followerCount)} follower
          </span>
        </div>

        <div className="mt-2.5 flex items-center gap-3.5 flex-wrap">
          <Stat icon={Heart} value={metrics.likes} label="Lượt thích" />
          <Stat icon={Share2} value={metrics.shares} label="Lượt chia sẻ" />
          <Stat icon={MessageCircle} value={metrics.comments} label="Bình luận" />
          {metrics.collects !== null && <Stat icon={Bookmark} value={metrics.collects} label="Lượt lưu" />}
        </div>

        {content.hashtags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {content.hashtags.slice(0, 4).map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600 max-w-[140px] truncate">
                #{tag}
              </span>
            ))}
            {content.hashtags.length > 4 && (
              <span className="px-2 py-0.5 text-[11px] text-slate-400">+{content.hashtags.length - 4}</span>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-slate-400 flex items-center gap-2">
            {formatRelativeTime(content.publishedAt)}
            {content.isAd && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600" title="Nội dung quảng cáo">
                <Megaphone className="w-3 h-3" /> Quảng cáo
              </span>
            )}
          </span>

          <a
            href={content.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#dc2626] hover:underline shrink-0"
          >
            Xem video gốc <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
};
