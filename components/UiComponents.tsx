import React from 'react';
import { FileVideo, FileImage, UploadCloud, Loader2, Sparkles, FileText, ScanEye, RefreshCw, Copy, Check, Plus, Newspaper, Clapperboard, FileAudio, ShieldCheck } from 'lucide-react';
import { AnalysisMode } from '../types';

export const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className = '', 
  disabled = false,
  icon: Icon,
  title
}: { 
  children?: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline'; 
  className?: string;
  disabled?: boolean;
  icon?: React.ElementType;
  title?: string;
}) => {
  const baseStyle = "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pink-500";
  
  const variants = {
    primary: "bg-gradient-to-r from-pink-500 via-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white shadow-md shadow-pink-500/20 border border-pink-400/30 active:scale-[0.98]",
    secondary: "bg-pink-50 hover:bg-pink-100 text-pink-900 border border-pink-200 active:scale-[0.98]",
    ghost: "bg-transparent hover:bg-pink-50 text-slate-700 hover:text-pink-900",
    outline: "bg-white border border-pink-300 text-pink-800 hover:border-pink-500 hover:bg-pink-50/50"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      title={title}
      className={`${baseStyle} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

export const FeatureCard = ({ 
  mode, 
  active, 
  onClick, 
  disabled 
}: { 
  mode: AnalysisMode; 
  active: boolean; 
  onClick: () => void; 
  disabled: boolean 
}) => {
  let icon, title, desc, badge;

  switch (mode) {
    case AnalysisMode.REMAKE_SCRIPT:
      icon = RefreshCw;
      title = "Remake Kịch Bản (3 Bước)";
      desc = "Phân tích điểm tốt video gốc + Lồng ghép 100% Brand DNA.";
      badge = "Khuyên dùng";
      break;
    case AnalysisMode.CONTENT_AUDIT:
      icon = Newspaper;
      title = "Remake Bài Viết Social";
      desc = "Từ Text/Link/Ảnh/Audio -> Bài post Facebook/Threads chuẩn giọng thương hiệu.";
      break;
    case AnalysisMode.SCRIPT_GENERATION:
      icon = Clapperboard;
      title = "Tạo Script Từ Ý Tưởng";
      desc = "Từ ý tưởng nháp thô -> Kịch bản viral TikTok/Shorts chuẩn thương hiệu.";
      break;
    case AnalysisMode.DEEP_ANALYSIS:
      icon = ScanEye;
      title = "Phân Tích Sâu Video";
      desc = "Bóc tách chi tiết toàn bộ kịch bản, lời thoại, hình thức & các yếu tố viral gốc.";
      break;
    default:
      icon = Sparkles;
      title = "Phân Tích AI";
      desc = "Xử lý nội dung đa phương tiện.";
  }

  const IconComponent = icon as React.ElementType;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative overflow-hidden group p-4 rounded-xl border text-left transition-all duration-200 w-full h-full
        ${active 
          ? 'bg-gradient-to-br from-pink-50 to-pink-50 border-pink-400 shadow-md shadow-pink-500/10 ring-2 ring-pink-400/40' 
          : 'bg-white border-pink-100 hover:border-pink-300 hover:bg-pink-50/40 shadow-sm'}
        ${disabled ? 'opacity-35 cursor-not-allowed grayscale' : ''}
      `}
    >
      <div className="flex items-start justify-between mb-2.5">
        <div className={`p-2.5 rounded-xl inline-block ${active ? 'bg-gradient-to-br from-pink-500 to-pink-600 text-white shadow-md shadow-pink-500/25' : 'bg-pink-50 text-pink-700 group-hover:text-pink-900 border border-pink-200'}`}>
          <IconComponent className="w-5 h-5" />
        </div>
        {badge && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-100 to-pink-100 text-amber-800 border border-amber-300">
            {badge}
          </span>
        )}
      </div>

      <h3 className={`font-bold text-sm mb-1 ${active ? 'text-pink-950' : 'text-slate-900'}`}>{title}</h3>
      <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{desc}</p>
      
      {active && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-pink-500 shadow-[0_0_8px_#ec4899]"></div>
      )}
    </button>
  );
};

export const FileDropzone = ({ 
  onFileSelect, 
  currentFile, 
  variant = 'normal',
  label = "Kéo thả Video, Audio hoặc Thumbnail gốc"
}: { 
  onFileSelect: (file: File) => void;
  currentFile: File | null;
  variant?: 'normal' | 'mini';
  label?: string;
}) => {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  if (variant === 'mini') {
    return (
      <div 
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={`
          relative border border-dashed rounded-xl p-4 text-center transition-all duration-200 group bg-white
          ${currentFile ? 'border-pink-400 bg-pink-50/60' : 'border-pink-200 hover:border-pink-400 hover:bg-pink-50/40'}
        `}
      >
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleChange} 
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${currentFile ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-600 border border-pink-200'}`}>
            {currentFile ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          </div>
          <div className="text-left overflow-hidden">
             <p className={`text-sm font-medium truncate ${currentFile ? 'text-pink-950 font-semibold' : 'text-slate-700'}`}>
               {currentFile ? currentFile.name : label}
             </p>
             <p className="text-xs text-slate-500">{currentFile ? 'Đã tải lên thành công' : 'Định dạng PNG, JPG, WEBP'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-200 bg-white shadow-sm
        ${currentFile ? 'border-pink-400 bg-pink-50/40' : 'border-pink-200 hover:border-pink-400 hover:bg-pink-50/20'}
      `}
    >
      <input 
        type="file" 
        accept="video/*,image/*,audio/*" 
        onChange={handleChange} 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      
      <div className="flex flex-col items-center justify-center gap-2.5">
        {currentFile ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-pink-100 flex items-center justify-center text-pink-700 mb-1 border border-pink-200 shadow-sm">
              {currentFile.type.startsWith('video') ? <FileVideo className="w-7 h-7" /> : 
               currentFile.type.startsWith('audio') ? <FileAudio className="w-7 h-7" /> : 
               <FileImage className="w-7 h-7" />}
            </div>
            <div>
              <p className="text-pink-950 font-bold text-sm truncate max-w-xs">{currentFile.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{(currentFile.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
            <p className="text-xs text-pink-800 bg-pink-50 font-medium px-3 py-1 rounded-full mt-1 border border-pink-200">
              Nhấp hoặc thả file khác để thay đổi
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-pink-50 flex items-center justify-center text-pink-600 group-hover:scale-105 transition-transform border border-pink-200 shadow-sm">
              <UploadCloud className="w-6 h-6 text-pink-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{label}</h3>
              <p className="text-xs text-slate-500 mt-1">Hỗ trợ Video (MP4/MOV), Audio (MP3/WAV/Voice), Ảnh (PNG/JPG)</p>
            </div>
            <span className="text-xs text-pink-800 font-semibold bg-pink-50 px-3.5 py-1.5 rounded-lg border border-pink-200 hover:border-pink-400 mt-1 inline-block shadow-sm">
              Chọn File Từ Thiết Bị
            </span>
          </>
        )}
      </div>
    </div>
  );
};


