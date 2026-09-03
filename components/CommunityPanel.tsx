import React, { useState } from 'react';
import { CalendarCheck, PlayCircle, Heart, Copy, Check, ArrowUpRight, QrCode } from 'lucide-react';
import { COMMUNITY } from '../data/communityConfig';
import { ZaloIcon, FacebookIcon, YoutubeIcon, GmailIcon, XmaiLogo } from './BrandIcons';

/**
 * Cộng đồng, hướng dẫn, đặt lịch tư vấn và ủng hộ tác giả.
 *
 * Chỉ dùng một màu nhấn duy nhất giống phần còn lại của app. Trước đây mỗi khối
 * một màu - chàm, xanh lá, hổ phách - và kết quả là mắt không biết nhìn vào đâu
 * trước. Giờ thứ tự đọc do cỡ chữ và khoảng trắng quyết định, không do màu.
 *
 * Mọi thứ tự ẩn khi chưa có link trong `data/communityConfig.ts`, nên trang
 * không bao giờ hiện một cái nút bấm vào chẳng đi đâu cả.
 */

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

const CopyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* trình duyệt chặn clipboard - người dùng vẫn đọc và gõ tay được */
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
        <p className="mt-0.5 text-base font-bold text-slate-900 truncate">{value}</p>
      </div>
      <button
        onClick={copy}
        className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors
          ${copied
            ? 'bg-[#FDF2F7] text-[#A4145E] border border-[#A4145E]/30'
            : 'bg-slate-900 text-white hover:bg-slate-700'}`}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Đã chép' : 'Chép'}
      </button>
    </div>
  );
};

const ContactButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
}> = ({ icon, label, sub, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:border-slate-900 hover:shadow-sm transition-all text-left group"
  >
    <span className="shrink-0">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[15px] font-bold text-slate-900 truncate">{label}</span>
      {!!sub && <span className="block text-xs text-slate-500 truncate">{sub}</span>}
    </span>
    <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-slate-900 transition-colors shrink-0 ml-auto" />
  </button>
);

export const CommunityPanel: React.FC = () => {
  const { skool, booking, guide, donate, contact } = COMMUNITY;

  const hasDonate = !!(donate.qrImage || donate.accountNumber);
  const hasContact = !!(contact.zalo || contact.facebook || contact.youtube || contact.email);

  return (
    <div className="max-w-5xl pb-10">
      <h1 className="text-[40px] leading-tight font-bold text-slate-900">Cộng đồng &amp; Hỗ trợ</h1>
      <p className="mt-3 text-[15px] text-slate-600">
        Nơi học cách dùng app hiệu quả hơn, và tìm mình khi bạn cần.
      </p>

      {/* Skool */}
      {!!skool.url && (
        <div className="mt-8 rounded-3xl overflow-hidden border-2 border-slate-200 bg-white shadow-sm">
          {!!skool.banner && (
            <img src={skool.banner} alt={skool.name} className="w-full aspect-[16/9] object-cover" />
          )}
          <div className="p-8">
            <div className="flex items-center gap-3">
              <XmaiLogo className="w-11 h-11 shrink-0 ring-1 ring-slate-900/10 rounded-[10px]" />
              <div>
                <p className="text-xs uppercase tracking-widest text-[#A4145E] font-bold">Cộng đồng</p>
                <h2 className="text-2xl font-bold text-slate-900 leading-tight">{skool.name}</h2>
              </div>
            </div>
            <p className="mt-4 text-[15px] text-slate-600 leading-relaxed max-w-2xl">{skool.description}</p>
            <button
              onClick={() => openExternal(skool.url)}
              className="mt-6 inline-flex items-center gap-2 px-7 py-4 rounded-2xl bg-[#A4145E] hover:bg-[#86104D] text-white text-[15px] font-bold transition-colors"
            >
              Tham gia cộng đồng <ArrowUpRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Đặt lịch và liên hệ đứng cạnh nhau: đều là "cách tìm mình", nên tách ra
          hai chỗ rời rạc trên trang chỉ bắt người đọc phải tìm hai lần. */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {!!booking.url && (
          <div className="rounded-3xl border-2 border-[#A4145E] bg-gradient-to-br from-[#FDF2F7] to-white p-8 flex flex-col">
            <span className="w-12 h-12 rounded-2xl bg-[#A4145E] flex items-center justify-center shrink-0">
              <CalendarCheck className="w-6 h-6 text-white" />
            </span>
            <h2 className="mt-4 text-xl font-bold text-slate-900">{booking.heading}</h2>
            <p className="mt-2 text-[15px] text-slate-600 leading-relaxed flex-1">{booking.description}</p>
            <button
              onClick={() => openExternal(booking.url)}
              className="mt-6 inline-flex items-center justify-center gap-2 w-full px-6 py-4 rounded-2xl bg-[#A4145E] hover:bg-[#86104D] text-white text-[15px] font-bold transition-colors"
            >
              {booking.cta} <ArrowUpRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {hasContact && (
          <div className="rounded-3xl border-2 border-slate-200 bg-white p-8">
            <h2 className="text-xl font-bold text-slate-900">Liên hệ</h2>
            <p className="mt-1 text-[15px] text-slate-600">Nhắn mình qua kênh nào tiện nhất với bạn.</p>

            <div className="mt-4 grid grid-cols-1 gap-3">
              {!!contact.zalo && (
                <ContactButton
                  icon={<ZaloIcon className="w-9 h-9" />}
                  label="Zalo"
                  sub={contact.zaloLabel}
                  onClick={() => openExternal(contact.zalo)}
                />
              )}
              {!!contact.facebook && (
                <ContactButton
                  icon={<FacebookIcon className="w-9 h-9" />}
                  label="Facebook"
                  sub="Nhắn tin trực tiếp"
                  onClick={() => openExternal(contact.facebook)}
                />
              )}
              {!!contact.youtube && (
                <ContactButton
                  icon={<YoutubeIcon className="w-9 h-9" />}
                  label="YouTube"
                  sub="Kênh chia sẻ kiến thức AI"
                  onClick={() => openExternal(contact.youtube)}
                />
              )}
              {!!contact.email && (
                <ContactButton
                  icon={<GmailIcon className="w-9 h-9" />}
                  label="Email"
                  sub={contact.email}
                  onClick={() => openExternal(`mailto:${contact.email}`)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hướng dẫn sử dụng */}
      {!!guide.url && (
        <div className="mt-6 rounded-3xl border-2 border-slate-200 bg-white p-8 flex flex-col sm:flex-row sm:items-center gap-6">
          <span className="w-12 h-12 rounded-2xl bg-[#A4145E] flex items-center justify-center shrink-0">
            <PlayCircle className="w-6 h-6 text-white" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-900">Hướng dẫn sử dụng</h2>
            <p className="mt-1 text-[15px] text-slate-600 leading-relaxed">
              Cách lấy API key miễn phí, gắn vào app và dùng từng tính năng.
            </p>
          </div>
          <button
            onClick={() => openExternal(guide.url)}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-[#A4145E] hover:bg-[#86104D] text-white text-[15px] font-bold transition-colors"
          >
            {guide.label} <ArrowUpRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Ủng hộ */}
      {hasDonate && (
        <div className="mt-6 rounded-3xl border-2 border-slate-200 bg-white p-8">
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl bg-[#A4145E] flex items-center justify-center shrink-0">
              <Heart className="w-6 h-6 text-white" fill="currentColor" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{donate.heading}</h2>
              <p className="text-sm text-slate-600">{donate.description}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col md:flex-row gap-8 items-start">
            {!!donate.qrImage && (
              <div className="shrink-0 mx-auto md:mx-0">
                <img
                  src={donate.qrImage}
                  alt="Mã QR chuyển khoản"
                  className="w-72 rounded-2xl border-2 border-slate-200 bg-white shadow-lg"
                />
              </div>
            )}
            <div className="flex-1 min-w-0 w-full">
              <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#A4145E] bg-[#FDF2F7] px-4 py-2.5 rounded-xl">
                <QrCode className="w-5 h-5 shrink-0" />
                Mở app ngân hàng và quét mã bên cạnh
              </p>
              <div className="mt-4 rounded-2xl bg-white border border-slate-200 px-5">
                {!!donate.bankName && <CopyRow label="Ngân hàng" value={donate.bankName} />}
                {!!donate.accountNumber && <CopyRow label="Số tài khoản" value={donate.accountNumber} />}
                {!!donate.accountName && <CopyRow label="Chủ tài khoản" value={donate.accountName} />}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
