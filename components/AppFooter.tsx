import React from 'react';
import { ArrowUpRight, Heart } from 'lucide-react';
import { COMMUNITY } from '../data/communityConfig';
import { ZaloIcon, FacebookIcon, YoutubeIcon, GmailIcon, XmaiLogo } from './BrandIcons';

/**
 * Dải chân trang, hiện ở mọi màn hình.
 *
 * Nền đen là màu của chính logo XMAI, nên nó không phải một màu thứ ba mượn về.
 * Nền trắng thử rồi: dải chân trang chìm hẳn vào nội dung và không ai nhìn - người dùng luôn thấy nhưng không bị nó
 * tranh chỗ với thứ họ đang làm. Đây cũng là điểm chạm duy nhất lặp lại trên mọi
 * trang, nên nó phải gọn: một dòng thương hiệu, vài logo, một nút.
 *
 * Toàn bộ nội dung lấy từ `data/communityConfig.ts`; link nào trống thì phần đó
 * tự biến mất.
 */
export const AppFooter: React.FC<{ onOpenCommunity: () => void }> = ({ onOpenCommunity }) => {
  const { skool, booking, donate, contact } = COMMUNITY;

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const hasDonate = !!(donate.qrImage || donate.accountNumber);

  const socials = [
    contact.facebook && { key: 'fb', icon: <FacebookIcon className="w-6 h-6" />, title: 'Facebook', url: contact.facebook },
    contact.youtube && { key: 'yt', icon: <YoutubeIcon className="w-6 h-6" />, title: 'YouTube', url: contact.youtube },
    contact.zalo && { key: 'zl', icon: <ZaloIcon className="w-6 h-6" />, title: contact.zaloLabel || 'Zalo', url: contact.zalo },
    contact.email && { key: 'mail', icon: <GmailIcon className="w-6 h-6" />, title: contact.email, url: `mailto:${contact.email}` },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; title: string; url: string }[];

  return (
    <footer className="mt-auto bg-slate-900 text-white">
      <div className="px-10 py-6 flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Thương hiệu cộng đồng */}
        <button
          onClick={() => (skool.url ? open(skool.url) : onOpenCommunity())}
          className="flex items-center gap-3.5 text-left min-w-0 group"
        >
          <XmaiLogo className="w-11 h-11 shrink-0 ring-1 ring-white/15 rounded-[10px]" />
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-white truncate group-hover:text-white/70 transition-colors">
              {skool.name}
            </span>
            <span className="block text-xs text-white/50 truncate max-w-md">{skool.description}</span>
          </span>
        </button>

        {/* Logo mạng xã hội */}
        {!!socials.length && (
          <div className="flex items-center gap-2.5 lg:ml-auto shrink-0">
            {socials.map((s) => (
              <button
                key={s.key}
                onClick={() => open(s.url)}
                title={s.title}
                aria-label={s.title}
                className="w-11 h-11 rounded-xl bg-white hover:scale-105 flex items-center justify-center transition-transform"
              >
                {s.icon}
              </button>
            ))}
          </div>
        )}

        {/* Hành động */}
        <div className="flex items-center gap-2.5 shrink-0">
          {hasDonate && (
            <button
              onClick={onOpenCommunity}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-white/20 text-white hover:bg-white/10 text-sm font-semibold transition-colors"
            >
              <Heart className="w-4 h-4" fill="currentColor" /> Ủng hộ
            </button>
          )}
          {!!booking.url && (
            <button
              onClick={() => open(booking.url)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] text-white text-sm font-bold transition-colors whitespace-nowrap"
            >
              {booking.cta} <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
          {!!skool.url && (
            <button
              onClick={() => open(skool.url)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-slate-900 hover:bg-slate-200 text-sm font-bold transition-colors whitespace-nowrap"
            >
              Tham gia cộng đồng <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
