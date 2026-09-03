import React from 'react';
import { Home, LayoutGrid, Fingerprint, Puzzle, ChevronDown, Radar, Waves, History, Users } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { APP_CONFIG } from '../data/appConfig';

export type SidebarView = 'overview' | 'radar' | 'waterfall' | 'features' | 'history' | 'brand-dna' | 'integrations' | 'community';

interface NavItem {
  id: SidebarView;
  label: string;
  icon: React.ElementType;
  soon?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { id: 'overview', label: 'Tổng quan', icon: Home },
  { id: 'radar', label: 'Content Radar', icon: Radar },
  { id: 'waterfall', label: 'Content Waterfall', icon: Waves },
  { id: 'features', label: 'Content Creator', icon: LayoutGrid },
  { id: 'history', label: 'Lịch sử nội dung', icon: History },
];

const SETTINGS_NAV: NavItem[] = [
  { id: 'brand-dna', label: 'Brand DNA', icon: Fingerprint },
  { id: 'integrations', label: 'Tích hợp', icon: Puzzle },
  { id: 'community', label: 'Cộng đồng & Hỗ trợ', icon: Users },
];

const NavButton: React.FC<{ item: NavItem; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`relative w-full flex items-center gap-4 pl-8 pr-4 py-3.5 text-left transition-colors rounded-r-2xl
        ${active ? 'bg-[#FBE7F0] text-[#A4145E] font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[5px] rounded-r-full bg-[#A4145E]" />}
      <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-[#A4145E]' : 'text-slate-400'}`} />
      <span className="text-[15px]">{item.label}</span>
      {item.soon && (
        <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
          Sắp có
        </span>
      )}
    </button>
  );
};

export const Sidebar = ({
  activeView,
  onNavigate,
  teamName = APP_CONFIG.name,
  teamRole = APP_CONFIG.teamRole,
}: {
  activeView: SidebarView;
  onNavigate: (view: SidebarView) => void;
  teamName?: string;
  teamRole?: string;
}) => {
  return (
    <aside className="w-[300px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="px-8 py-6 border-b border-slate-200">
        <AppLogo />
      </div>

      <nav className="flex-1 overflow-y-auto py-6 pr-4 custom-scrollbar">
        <p className="px-8 pb-3 text-[15px] text-slate-500">{APP_CONFIG.workspaceLabel}</p>
        <div className="space-y-1">
          {MAIN_NAV.map((item) => (
            <NavButton key={item.id} item={item} active={activeView === item.id} onClick={() => onNavigate(item.id)} />
          ))}
        </div>

        <div className="mx-8 my-6 border-t border-slate-200" />

        <p className="px-8 pb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Thiết lập chung
        </p>
        <div className="space-y-1">
          {SETTINGS_NAV.map((item) => (
            <NavButton key={item.id} item={item} active={activeView === item.id} onClick={() => onNavigate(item.id)} />
          ))}
        </div>
      </nav>

      <div className="px-6 py-5 border-t border-slate-200">
        <button className="w-full flex items-center gap-3 text-left group">
          <span className="w-10 h-10 rounded-full bg-[#A4145E] text-white flex items-center justify-center font-semibold shrink-0">
            {teamName.charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-slate-900 truncate">{teamName}</span>
            <span className="block text-xs text-slate-500">{teamRole}</span>
          </span>
          <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
        </button>
      </div>
    </aside>
  );
};
