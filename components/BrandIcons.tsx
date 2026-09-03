import React from 'react';
import { COMMUNITY } from '../data/communityConfig';

// Logo các nền tảng, vẽ thẳng bằng SVG.
//
// Không tải từ CDN vì app chạy offline được - một cái logo hỏng vì mất mạng
// trông tệ hơn là không có logo. Cũng không dùng icon đơn sắc của lucide nữa:
// người ta nhận ra Zalo hay YouTube bằng màu trước khi kịp đọc chữ.

type IconProps = { className?: string };

export const ZaloIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <rect width="48" height="48" rx="11" fill="#0068FF" />
    <path
      fill="#fff"
      d="M12.4 16.1h10.9v2.6l-7 9.4h7.2v2.9H12v-2.6l7-9.4h-6.6v-2.9Z"
    />
    <path fill="#fff" d="M25.6 14.6h3v16.4h-3z" />
    <path
      fill="#fff"
      d="M35.2 18.7c3 0 5.3 2.4 5.3 5.5s-2.3 5.5-5.3 5.5-5.3-2.4-5.3-5.5 2.3-5.5 5.3-5.5Zm0 2.8c-1.4 0-2.4 1.1-2.4 2.7s1 2.7 2.4 2.7 2.4-1.1 2.4-2.7-1-2.7-2.4-2.7Z"
    />
  </svg>
);

export const FacebookIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#1877F2" />
    <path
      fill="#fff"
      d="M31.5 30.9l1-6.6h-6.3v-4.3c0-1.8.9-3.6 3.7-3.6h2.9v-5.6s-2.6-.5-5.1-.5c-5.2 0-8.6 3.2-8.6 8.9v5.1h-5.8v6.6h5.8v16h7.1v-16h5.3Z"
    />
  </svg>
);

export const YoutubeIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 48 34" className={className} aria-hidden="true">
    <path
      fill="#FF0000"
      d="M47 5.3A6 6 0 0 0 42.8 1C39 0 24 0 24 0S9 0 5.2 1A6 6 0 0 0 1 5.3C0 9.1 0 17 0 17s0 7.9 1 11.7A6 6 0 0 0 5.2 33C9 34 24 34 24 34s15 0 18.8-1A6 6 0 0 0 47 28.7C48 24.9 48 17 48 17s0-7.9-1-11.7Z"
    />
    <path fill="#fff" d="M19.2 24.3 31.7 17 19.2 9.7v14.6Z" />
  </svg>
);

export const GmailIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 48 36" className={className} aria-hidden="true">
    <path fill="#4285F4" d="M3.3 36h7.6V17.6L0 9.4v23.3C0 34.5 1.5 36 3.3 36Z" />
    <path fill="#34A853" d="M37.1 36h7.6c1.8 0 3.3-1.5 3.3-3.3V9.4l-10.9 8.2V36Z" />
    <path fill="#FBBC04" d="M37.1 3.3v14.3L48 9.4V4.9c0-4-4.6-6.3-7.9-3.9l-3 2.3Z" />
    <path fill="#EA4335" d="M10.9 17.6V3.3L24 13.1l13.1-9.8v14.3L24 27.5 10.9 17.6Z" />
    <path fill="#C5221F" d="M0 4.9v4.5l10.9 8.2V3.3l-3-2.3C4.6-1.4 0 .9 0 4.9Z" />
  </svg>
);

/**
 * Logo XMAI của cộng đồng. Là ảnh thật lấy từ trang Skool chứ không vẽ lại, và
 * nằm trong public/ nên app offline vẫn hiện.
 */
export const XmaiLogo: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <img
    src={COMMUNITY.skool.logo}
    alt={COMMUNITY.skool.name}
    className={`${className} rounded-[22%] object-cover`}
  />
);
