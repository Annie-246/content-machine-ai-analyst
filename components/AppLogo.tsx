import React from 'react';
import { APP_CONFIG } from '../data/appConfig';

interface AppLogoProps {
  className?: string;
  variant?: 'full' | 'compact';
}

/**
 * Logo của ứng dụng (không gắn với thương hiệu khách hàng nào).
 * Vẽ bằng SVG nội tuyến nên không cần file ảnh trong public/.
 */
export const AppLogo: React.FC<AppLogoProps> = ({ className = '', variant = 'full' }) => {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <span className="shrink-0 w-10 h-10 rounded-xl bg-[#dc2626] flex items-center justify-center shadow-sm">
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
          <path
            d="M9 7.5v9l7-4.5-7-4.5Z"
            fill="#ffffff"
          />
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.5" />
        </svg>
      </span>

      {variant !== 'compact' && (
        <span className="min-w-0">
          <span className="block text-[17px] font-extrabold tracking-tight text-slate-900 truncate">
            {APP_CONFIG.name}
          </span>
          <span className="block text-[11px] font-medium text-slate-500 truncate">
            {APP_CONFIG.tagline}
          </span>
        </span>
      )}
    </div>
  );
};
