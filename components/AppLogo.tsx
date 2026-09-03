import React from 'react';
import { APP_CONFIG } from '../data/appConfig';
import { COMMUNITY } from '../data/communityConfig';

interface AppLogoProps {
  className?: string;
  variant?: 'full' | 'compact';
}

/**
 * Logo của ứng dụng - dùng chính logo XMAI của cộng đồng.
 *
 * Ảnh nằm trong public/ nên app offline vẫn hiện. Trước đây đây là một hình tam
 * giác play vẽ tay: nó trông như logo mặc định của một app bất kỳ, còn cái này
 * nói ngay app đến từ đâu.
 */
export const AppLogo: React.FC<AppLogoProps> = ({ className = '', variant = 'full' }) => {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <img
        src={COMMUNITY.skool.logo}
        alt={APP_CONFIG.name}
        className="shrink-0 w-10 h-10 rounded-xl object-cover shadow-sm ring-1 ring-slate-900/10"
      />

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
