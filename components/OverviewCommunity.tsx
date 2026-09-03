import React from 'react';
import { CalendarCheck, Heart, ArrowUpRight } from 'lucide-react';
import { COMMUNITY } from '../data/communityConfig';
import { XmaiLogo } from './BrandIcons';

/**
 * Dải cộng đồng dưới trang Tổng quan.
 *
 * Đặt ở đây vì Tổng quan là màn hình người dùng thấy trước khi bắt tay vào việc,
 * chứ không phải lúc đang làm dở - một lời mời chen ngang giữa công việc thì chỉ
 * làm người ta khó chịu.
 *
 * Ba thẻ này có màu riêng thay vì cùng một viền xám: khi mọi thứ trông giống
 * nhau thì mắt lướt qua tất cả, và một lời mời không ai nhìn thì cũng như không
 * có. Thẻ nào chưa có link trong `data/communityConfig.ts` thì tự ẩn.
 */
export const OverviewCommunity: React.FC<{ onOpenCommunity: () => void }> = ({ onOpenCommunity }) => {
  const { skool, booking, donate } = COMMUNITY;

  const hasDonate = !!(donate.qrImage || donate.accountNumber);
  if (![!!skool.url, !!booking.url, hasDonate].some(Boolean)) return null;

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <div className="mt-14 pt-10 border-t-2 border-slate-200">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold text-slate-900">Cộng đồng &amp; Hỗ trợ</h2>
        <button
          onClick={onOpenCommunity}
          className="text-[15px] font-semibold text-[#A4145E] hover:underline shrink-0"
        >
          Xem tất cả
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        {!!skool.url && (
          <button
            onClick={() => open(skool.url)}
            className="text-left rounded-3xl border-2 border-[#A4145E] bg-gradient-to-br from-[#FDF2F7] to-white p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <XmaiLogo className="w-11 h-11 ring-1 ring-slate-900/10 rounded-[10px]" />
            <p className="mt-4 text-lg font-bold text-slate-900 leading-snug">{skool.name}</p>
            <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">{skool.description}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-[#A4145E]">
              Tham gia <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        )}

        {!!booking.url && (
          <button
            onClick={() => open(booking.url)}
            className="text-left rounded-3xl border-2 border-[#A4145E] bg-gradient-to-br from-[#FDF2F7] to-white p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <span className="w-11 h-11 rounded-2xl bg-[#A4145E] flex items-center justify-center">
              <CalendarCheck className="w-6 h-6 text-white" />
            </span>
            <p className="mt-4 text-lg font-bold text-slate-900 leading-snug">{booking.heading}</p>
            <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">{booking.description}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-[#A4145E]">
              {booking.cta} <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        )}

        {hasDonate && (
          <button
            onClick={onOpenCommunity}
            className="text-left rounded-3xl border-2 border-[#A4145E] bg-gradient-to-br from-[#FDF2F7] to-white p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all group"
          >
            <span className="w-11 h-11 rounded-2xl bg-[#A4145E] flex items-center justify-center">
              <Heart className="w-6 h-6 text-white" fill="currentColor" />
            </span>
            <p className="mt-4 text-lg font-bold text-slate-900 leading-snug">{donate.heading}</p>
            <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">{donate.description}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-[#A4145E]">
              Xem cách ủng hộ <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
