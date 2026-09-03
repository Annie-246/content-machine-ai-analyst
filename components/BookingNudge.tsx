import React from 'react';
import { CalendarCheck, ArrowUpRight } from 'lucide-react';
import { COMMUNITY } from '../data/communityConfig';

/**
 * Lời mời đặt lịch, đặt ngay dưới kết quả vừa chạy xong.
 *
 * Vị trí này là có chủ đích: người vừa nhận được thứ mình cần là người đang dễ
 * nghĩ tới bước tiếp theo nhất. Cùng lời mời đó đặt ở màn hình chờ thì chỉ là
 * một banner bị lướt qua.
 *
 * Đổi lại, nó phải kín đáo - một dòng chữ, không màu mè, không tự bật, không
 * chặn thao tác. Người dùng đang làm việc, và app này bán uy tín chứ không bán
 * lượt click.
 */
export const BookingNudge: React.FC = () => {
  const { booking } = COMMUNITY;
  if (!booking.url) return null;

  return (
    <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center gap-x-2 gap-y-1">
      <CalendarCheck className="w-4 h-4 text-slate-400 shrink-0" />
      <span className="text-sm text-slate-500">
        Muốn một hệ thống AI riêng cho đội ngũ của bạn?
      </span>
      <button
        onClick={() => window.open(booking.url, '_blank', 'noopener,noreferrer')}
        className="inline-flex items-center gap-1 text-sm font-semibold text-[#A4145E] hover:underline"
      >
        {booking.cta} <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
