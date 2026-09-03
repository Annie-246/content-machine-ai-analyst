import React from 'react';
import { Radar, Waves, LayoutGrid, History, ArrowRight, Fingerprint } from 'lucide-react';
import type { SidebarView } from './Sidebar';

/**
 * Phần mở đầu của trang Tổng quan.
 *
 * Chỗ này trước đây là ba ô đếm số - tên brand, số bộ quy tắc, giọng văn - toàn
 * những thứ người dùng vừa tự nhập nên đọc lại chẳng biết thêm gì. Người mới mở
 * app lần đầu cần biết app làm được gì và bắt đầu từ đâu, nên đây là chỗ trả lời
 * đúng hai câu đó.
 */

type Feature = {
  id: SidebarView;
  icon: React.ElementType;
  title: string;
  desc: string;
  tint: string;
  iconBg: string;
};

const FEATURES: Feature[] = [
  {
    id: 'radar',
    icon: Radar,
    title: 'Content Radar',
    desc: 'Tìm nội dung đang viral theo từ khoá trên Douyin, TikTok, YouTube, Instagram - để biết thị trường đang nói gì trước khi bắt tay viết.',
    tint: 'hover:border-[#A4145E]',
    iconBg: 'bg-[#A4145E]',
  },
  {
    id: 'waterfall',
    icon: Waves,
    title: 'Content Waterfall',
    desc: 'Một nguồn bất kỳ - bài viết, video, podcast, ghi chú - bung thành hàng chục ý tưởng nội dung khác nhau cho thương hiệu.',
    tint: 'hover:border-[#A4145E]',
    iconBg: 'bg-[#A4145E]',
  },
  {
    id: 'features',
    icon: LayoutGrid,
    title: 'Content Creator',
    desc: 'Nơi viết ra bài hoàn chỉnh: remake kịch bản video, remake bài viết, phân tích sâu, trích script, chấm điểm, tạo ảnh minh hoạ.',
    tint: 'hover:border-[#A4145E]',
    iconBg: 'bg-[#A4145E]',
  },
  {
    id: 'history',
    icon: History,
    title: 'Lịch sử nội dung',
    desc: 'Mọi thứ đã tạo được lưu lại ngay trên máy bạn, xem lại và sao chép bất cứ lúc nào.',
    tint: 'hover:border-[#A4145E]',
    iconBg: 'bg-[#A4145E]',
  },
];

export const OverviewIntro: React.FC<{
  brandName: string;
  onNavigate: (view: SidebarView) => void;
  onOpenBrand: () => void;
}> = ({ brandName, onNavigate, onOpenBrand }) => (
  <>
    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-8">
      <p className="text-[17px] text-slate-700 leading-relaxed max-w-3xl">
        Content Machine là hệ thống do team Nhật Dương xây dựng để hỗ trợ đội ngũ sản xuất nội dung.
        Hệ thống đọc những nội dung đang hiệu quả ngoài kia - video, bài đăng, bình luận của người
        xem - rồi dựng lại thành video và bài viết mang đúng giọng, đúng bản sắc thương hiệu của bạn.
        Mỗi nội dung làm ra đều có cấu trúc chuẩn của một nội dung viral, thay vì một bài chung chung
        ai đọc cũng thấy quen quen. Tất cả để phục vụ một việc:{' '}
        <span className="font-semibold text-slate-900">tăng tốc độ sản xuất nội dung lên gấp 5 lần</span>.
      </p>

      <button
        onClick={onOpenBrand}
        className="mt-5 inline-flex items-center gap-2.5 text-sm font-semibold text-slate-700 hover:text-[#A4145E] transition-colors"
      >
        <Fingerprint className="w-4 h-4" />
        Đang viết theo Brand DNA của <span className="font-bold">{brandName}</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>

    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
      {FEATURES.map((f) => {
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            onClick={() => onNavigate(f.id)}
            className={`text-left rounded-2xl border-2 border-slate-200 bg-white p-6 transition-all hover:shadow-md ${f.tint} group`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-10 h-10 rounded-xl ${f.iconBg} flex items-center justify-center shrink-0`}>
                <Icon className="w-5 h-5 text-white" />
              </span>
              <p className="text-[17px] font-bold text-slate-900">{f.title}</p>
              <ArrowRight className="w-4 h-4 text-slate-300 ml-auto group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
          </button>
        );
      })}
    </div>
  </>
);
