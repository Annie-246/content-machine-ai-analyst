import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  AlertCircle, 
  Copy, 
  Check, 
  ExternalLink, 
  Loader2, 
  Link as LinkIcon, 
  Download, 
  Wand2, 
  PenTool, 
  Globe, 
  Monitor, 
  Camera, 
  X, 
  MessageSquareQuote, 
  FilePenLine, 
  Trash2, 
  Mic, 
  Sigma, 
  SlidersHorizontal,
  Share2,
  FileCheck2,
  BookOpen,
  FileSpreadsheet,
  Sheet,
  ArrowRight,
  ArrowLeft,
  FileImage,
  UploadCloud,
  ClipboardPaste,
  ClipboardList,
} from 'lucide-react';
import { 
  AnalysisMode, 
  LoadingState, 
  FileData, 
  BrandProfile, 
  ScriptFormula,
  FORMULA_LABELS,
  VideoMeta
} from './types';
import { STORAGE_KEY_BRAND_PROFILES, STORAGE_KEY_ACTIVE_BRAND, createBlankBrand } from './data/brandPresets';
import { analyzeContent, fileToGenerativePart, generateRemakeThumbnail } from './services/geminiService';
import { loadLinkSource } from './services/sourceLoader';
import { Button, FileDropzone } from './components/UiComponents';
import { BrandProfileModal } from './components/BrandProfileModal';
import { BrandSelectorBanner } from './components/BrandSelectorBanner';
import { Sidebar, SidebarView } from './components/Sidebar';
import { ContentRadar } from './components/ContentRadar';
import { ContentWaterfall } from './components/ContentWaterfall';
import { TopBar } from './components/TopBar';
import { FeatureLauncher } from './components/FeatureLauncher';
import { FeatureRail } from './components/FeatureRail';
import { WorkflowStepper, SectionCard, RunStatus } from './components/WorkspaceShell';
import { getFeature } from './data/features';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { CommunityPanel } from './components/CommunityPanel';
import { ChecklistModal } from './components/ChecklistModal';
import { listChecklistsFor, getChecklist } from './services/checklistStore';
import { OverviewCommunity } from './components/OverviewCommunity';
import { OverviewIntro } from './components/OverviewIntro';
import { BookingNudge } from './components/BookingNudge';
import { AppFooter } from './components/AppFooter';
import { OnboardingWizard } from './components/OnboardingWizard';
import { getGeminiApiKey } from './services/apiKeyStore';
import { postJson } from './services/apiClient';
import { exportToExcelCsv, openInGoogleSheets } from './src/utils/exportUtils';
import { HistoryPanel } from './components/HistoryPanel';
import { purgeExpired, requestPersistence, dataUrlToBlob, type HistoryKind } from './services/historyStore';
import { recordAndBackup } from './services/historyBackup';

type AppView = 'overview' | 'radar' | 'waterfall' | 'features' | 'workspace' | 'history' | 'integrations' | 'community';

const FEATURE_TITLES: Partial<Record<AnalysisMode, string>> = {
  [AnalysisMode.REMAKE_SCRIPT]: 'Remake kịch bản video',
  [AnalysisMode.DEEP_ANALYSIS]: 'Phân tích sâu video',
  [AnalysisMode.SCRIPT_EXTRACT]: 'Trích script video',
  [AnalysisMode.SCRIPT_GENERATION]: 'Tạo kịch bản từ ý tưởng',
  [AnalysisMode.CONTENT_AUDIT]: 'Remake bài viết',
  [AnalysisMode.ARTICLE_WRITING]: 'Viết bài',
  [AnalysisMode.ARTICLE_ANALYSIS]: 'Phân tích sâu bài viết',
  [AnalysisMode.THUMBNAIL_AUDIT]: 'Tạo hình ảnh',
  [AnalysisMode.VIDEO_SCORING]: 'Chấm điểm nội dung video',
  [AnalysisMode.ARTICLE_SCORING]: 'Chấm điểm nội dung bài viết',
};

// Tên tính năng lấy từ catalogue khi bảng trên chưa khai báo, để thêm mode mới
// không còn rơi vào một tiêu đề mặc định sai như trước.
const featureTitle = (mode: AnalysisMode): string =>
  FEATURE_TITLES[mode] || getFeature(mode)?.title || 'Kết quả';

type SourceKind = 'link' | 'upload' | 'screen' | 'text' | 'images';

interface FeatureConfig {
  subtitle: string;
  sources: SourceKind[];
  sourceLabel: string;
  sourceHint: string;
  linkPlaceholder?: string;
  textLabel?: string;
  textPlaceholder?: string;
  actionLabel: string;
  uploadLabel?: string;
  available?: boolean;
}

// Each feature only shows the inputs it actually needs.
const FEATURE_CONFIG: Partial<Record<AnalysisMode, FeatureConfig>> = {
  [AnalysisMode.REMAKE_SCRIPT]: {
    subtitle: 'Bóc tách video gốc rồi viết lại thành kịch bản mới chuẩn Brand DNA.',
    sources: ['link', 'upload', 'screen'],
    sourceLabel: 'Nguồn video gốc',
    sourceHint: 'Link, Video, Audio hoặc quay màn hình',
    linkPlaceholder: 'Dán link video TikTok, YouTube, Reels, Facebook...',
    actionLabel: 'Remake kịch bản chuẩn thương hiệu',
    uploadLabel: 'Hoặc kéo thả video, audio gốc',
  },
  [AnalysisMode.DEEP_ANALYSIS]: {
    subtitle: 'Bóc tách chi tiết kịch bản, lời thoại, hình ảnh, hook và yếu tố viral của video gốc.',
    sources: ['link', 'upload'],
    sourceLabel: 'Video cần phân tích',
    sourceHint: 'Link hoặc file video',
    linkPlaceholder: 'Dán link video TikTok, YouTube, Reels, Facebook...',
    actionLabel: 'Phân tích sâu video',
    uploadLabel: 'Hoặc kéo thả file video vào đây',
  },
  [AnalysisMode.SCRIPT_EXTRACT]: {
    subtitle: 'Trích xuất nguyên văn lời thoại kèm mốc thời gian. Video tiếng nước ngoài sẽ có thêm cột bản dịch tiếng Việt.',
    sources: ['link', 'upload'],
    sourceLabel: 'Video cần trích script',
    sourceHint: 'Link hoặc file video, audio',
    linkPlaceholder: 'Dán link video TikTok, YouTube, Reels, Facebook...',
    actionLabel: 'Trích script video',
    uploadLabel: 'Hoặc kéo thả video, audio vào đây',
  },
  [AnalysisMode.SCRIPT_GENERATION]: {
    subtitle: 'Từ ý tưởng thô hoặc một bài viết có sẵn thành kịch bản video hoàn chỉnh theo công thức bạn chọn.',
    sources: ['link', 'text'],
    sourceLabel: 'Ý tưởng của bạn',
    sourceHint: 'Ý tưởng, link bài viết hoặc blog',
    linkPlaceholder: 'Dán link bài viết, blog hoặc bài đăng để lấy làm chất liệu...',
    textLabel: 'Ý tưởng / bản nháp thô (bỏ trống được nếu đã dán link):',
    textPlaceholder: 'VD: Mình muốn làm video về 3 sai lầm chống nắng khiến da sạm đi...',
    actionLabel: 'Tạo kịch bản viral',
  },
  [AnalysisMode.CONTENT_AUDIT]: {
    subtitle: 'Viết lại bài viết hiện có thành phiên bản mới chuẩn giọng văn thương hiệu.',
    sources: ['link', 'text', 'images'],
    sourceLabel: 'Bài viết gốc',
    sourceHint: 'Link, text hoặc ảnh chụp bài',
    linkPlaceholder: 'Dán link bài viết gốc (Facebook, Threads, blog...)',
    textLabel: 'Nội dung bài viết gốc:',
    textPlaceholder: 'Dán nội dung bài viết cần remake vào đây...',
    actionLabel: 'Remake bài viết chuẩn thương hiệu',
  },
  [AnalysisMode.ARTICLE_WRITING]: {
    subtitle: 'Từ vài dòng ý tưởng thành bài viết hoàn chỉnh, viết theo đúng những gì làm nên một bài hiệu quả.',
    sources: ['text', 'link', 'images'],
    sourceLabel: 'Ý tưởng của bạn',
    sourceHint: 'Ý tưởng thô, link tham khảo hoặc ảnh',
    linkPlaceholder: 'Dán link bài viết, tài liệu để lấy thêm chất liệu (không bắt buộc)...',
    textLabel: 'Ý tưởng bài viết (chỉ cần vài dòng):',
    textPlaceholder: 'VD: Muốn viết bài chia sẻ về việc nhiều shop chạy ads mà không ra đơn, nguyên nhân thật nằm ở sản phẩm chứ không phải ngân sách...',
    actionLabel: 'Viết bài kèm hook gợi ý',
  },
  [AnalysisMode.ARTICLE_ANALYSIS]: {
    subtitle: 'Mổ xẻ một bài viết hay để hiểu vì sao nó hiệu quả. Chỉ phân tích, không chấm điểm và không viết lại.',
    sources: ['link', 'text', 'images'],
    sourceLabel: 'Bài viết cần phân tích',
    sourceHint: 'Link, text hoặc ảnh chụp bài',
    linkPlaceholder: 'Dán link bài viết (Facebook, Threads, blog...)',
    textLabel: 'Nội dung bài viết (dán text vào đây):',
    textPlaceholder: 'Dán toàn bộ nội dung bài viết cần phân tích. Có thể bỏ trống nếu đã dán link hoặc tải ảnh chụp bài viết.',
    actionLabel: 'Phân tích sâu bài viết',
  },
  [AnalysisMode.THUMBNAIL_AUDIT]: {
    subtitle: 'Tạo hình ảnh minh họa, đồ họa cho bài viết và nội dung mạng xã hội.',
    sources: [],
    sourceLabel: 'Nguồn hình ảnh',
    sourceHint: '',
    actionLabel: 'Tạo hình ảnh',
    available: false,
  },
  [AnalysisMode.VIDEO_SCORING]: {
    subtitle: 'Chấm điểm video theo bộ tiêu chí bạn tự nạp, hoặc theo Brand DNA nếu chưa có bộ nào.',
    sources: ['link', 'upload'],
    sourceLabel: 'Video cần chấm',
    sourceHint: 'Link hoặc file video',
    linkPlaceholder: 'Dán link video TikTok, YouTube, Reels, Facebook...',
    actionLabel: 'Chấm điểm video',
    uploadLabel: 'Hoặc kéo thả file video vào đây',
  },
  [AnalysisMode.ARTICLE_SCORING]: {
    subtitle: 'Chấm điểm bài viết theo bộ tiêu chí bạn tự nạp, hoặc theo Brand DNA nếu chưa có bộ nào.',
    sources: ['link', 'text', 'images'],
    sourceLabel: 'Nội dung cần chấm',
    sourceHint: 'Link, text hoặc ảnh chụp bài',
    linkPlaceholder: 'Dán link bài viết, Google Docs, PDF hoặc bài đăng mạng xã hội...',
    textLabel: 'Nội dung cần chấm điểm:',
    textPlaceholder: 'Dán nội dung vào đây. Có thể bỏ trống nếu đã dán link hoặc tải ảnh chụp.',
    actionLabel: 'Chấm điểm bài viết',
  },
};

// Giá trị đệm khi danh sách brand rỗng - lúc đó giao diện wizard được hiển thị thay thế.
const PLACEHOLDER_BRAND: BrandProfile = createBlankBrand('');

const App = () => {
  // Brand Management State
  const [brandList, setBrandList] = useState<BrandProfile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BRAND_PROFILES);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Error reading saved brand profiles", e);
    }
    return [];
  });

  const [activeBrandId, setActiveBrandId] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem(STORAGE_KEY_ACTIVE_BRAND);
      if (savedId) return savedId;
    } catch (e) {
      console.error("Error reading active brand id", e);
    }
    return '';
  });

  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);

  // Screenshots of the article being analysed - multiple images allowed.
  const [articleImages, setArticleImages] = useState<{ file: File; previewUrl: string; base64: string; mimeType: string }[]>([]);

  // Shell navigation: mở app là vào Tổng quan, từ đó người dùng tự chọn đi tiếp.
  const [view, setView] = useState<AppView>('overview');
  const [sidebarActive, setSidebarActive] = useState<SidebarView>('overview');
  // Trên điện thoại sidebar nằm ngoài màn hình, mở ra bằng nút menu ở thanh trên.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const activeBrand: BrandProfile = brandList.find(b => b.id === activeBrandId) || brandList[0] || PLACEHOLDER_BRAND;

  // Analysis & Workflow State
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [selectedMode, setSelectedMode] = useState<AnalysisMode>(AnalysisMode.REMAKE_SCRIPT);
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState<LoadingState>({ isLoading: false, message: '', step: 0 });
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  // Comments carry the objections and questions a caption never admits to, so
  // they are worth reading - but only when the run is about the audience rather
  // than about the post itself.
  const [readComments, setReadComments] = useState(true);
  const [customUserPrompt, setCustomUserPrompt] = useState('');
  const [userInstructions, setUserInstructions] = useState('');
  const [selectedFormula, setSelectedFormula] = useState<ScriptFormula>('auto');
  // Bộ tiêu chí chấm điểm đang chọn. Rỗng nghĩa là chấm theo Brand DNA và bộ
  // tiêu chí chuẩn của app.
  const [selectedChecklistId, setSelectedChecklistId] = useState('');
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [checklistVersion, setChecklistVersion] = useState(0);


  const featureConfig = FEATURE_CONFIG[selectedMode] || FEATURE_CONFIG[AnalysisMode.REMAKE_SCRIPT]!;

  // checklistVersion đổi mỗi khi người dùng sửa kho, để danh sách này đọc lại.
  const availableChecklists = React.useMemo(
    () => listChecklistsFor(selectedMode === AnalysisMode.VIDEO_SCORING ? 'video' : 'article'),
    [selectedMode, checklistVersion],
  );
  const activeFeature = getFeature(selectedMode);
  const ActiveFeatureIcon = activeFeature.icon;

  // Which stage of the 1-2-3 bar to light up.
  const hasSource = !!fileData || !!customUserPrompt.trim() || articleImages.length > 0;
  const currentStep = result ? 3 : hasSource ? 2 : 1;

  // A long job used to look like a hang. The status panel counts from here.
  const [sheetHint, setSheetHint] = useState('');
  const [pastedCount, setPastedCount] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  useEffect(() => {
    setRunStartedAt(loading.isLoading ? Date.now() : null);
  }, [loading.isLoading]);

  // Listening on the window means the paste works wherever the caret happens to
  // be, not only inside the drop box.
  const acceptsImages = featureConfig.sources.includes('images');
  useEffect(() => {
    if (view !== 'workspace' || !acceptsImages) return;
    const onPaste = (event: ClipboardEvent) => {
      if (takeImagesFromClipboard(event.clipboardData)) event.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [view, acceptsImages]);

  const runExpectation = fileData?.fileUri || fileData?.videoMeta
    ? 'Video dài có thể mất 1-3 phút. Cứ để tab này mở.'
    : 'Thường mất 20-60 giây. Cứ để tab này mở.';
  
  // Thumbnail Remake State
  const [userAssetData, setUserAssetData] = useState<FileData | null>(null);
  const [thumbnailText, setThumbnailText] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  // Screen Share Stream
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BRAND_PROFILES, JSON.stringify(brandList));
    } catch (e) {
      console.error("Error saving brand profiles", e);
    }
  }, [brandList]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_BRAND, activeBrandId);
    } catch (e) {
      console.error("Error saving active brand ID", e);
    }
  }, [activeBrandId]);

  useEffect(() => {
    return () => {
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [screenStream]);

  // Lịch sử nội dung: dọn dữ liệu hết hạn ngay khi mở app.
  //
  // A browser tab has no background job, so start-up is the only moment the
  // promise "text goes after 7 days, images after 3" can actually be kept.
  useEffect(() => {
    purgeExpired();
    requestPersistence();
  }, []);

  /**
   * Files a finished result into the local history, then hands it to Drive.
   *
   * Deliberately not awaited by the callers: saving must never delay the result
   * appearing on screen, and a failed save is logged inside the store rather
   * than surfaced as an error on a run that actually succeeded.
   */
  const recordHistory = (input: {
    kind: HistoryKind;
    html?: string;
    title?: string;
    sourceUrl?: string;
    assets?: { name: string; mimeType: string; blob: Blob }[];
  }) => {
    recordAndBackup({
      brandId: activeBrand.id,
      brandName: activeBrand.name,
      kind: input.kind,
      mode: selectedMode,
      modeLabel: featureTitle(selectedMode),
      title: input.title,
      html: input.html,
      sourceUrl: input.sourceUrl,
      assets: input.assets,
    });
  };

  const handleSaveBrandProfile = (updatedBrand: BrandProfile) => {
    setBrandList(prev => {
      const index = prev.findIndex(b => b.id === updatedBrand.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = updatedBrand;
        return next;
      }
      return [...prev, updatedBrand];
    });
    setActiveBrandId(updatedBrand.id);
  };

  // Thêm một brand mới rỗng rồi mở luôn form Brand DNA để điền.
  const handleAddBrand = () => {
    const fresh = createBlankBrand('');
    setBrandList(prev => [...prev, fresh]);
    setActiveBrandId(fresh.id);
    setIsBrandModalOpen(true);
  };

  // Nhận brand từ file JSON: trùng id thì ghi đè, chưa có thì thêm mới.
  const handleImportBrand = (brand: BrandProfile) => {
    setBrandList(prev => {
      const index = prev.findIndex(b => b.id === brand.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = brand;
        return next;
      }
      return [...prev, brand];
    });
    setActiveBrandId(brand.id);
  };

  const handleImportBrands = (brands: BrandProfile[]) => {
    brands.forEach(handleImportBrand);
  };

  const handleDeleteBrand = (brandId: string) => {
    const next = brandList.filter(b => b.id !== brandId);
    setBrandList(next);
    if (brandId === activeBrandId) setActiveBrandId(next[0]?.id || '');
  };

  const handleFileSelect = async (file: File) => {
    stopScreenShare();
    setError('');
    setResult('');
    setGeneratedImageUrl('');
    setUrlInput('');
    setUserAssetData(null);
    setAspectRatio('16:9');
    
    if (file.size > 30 * 1024 * 1024) {
      setError("File lớn hơn 30MB! Với video dài, bạn nên trích xuất đoạn quan trọng (dưới 1-2 phút) hoặc dùng tính năng Live Screen để AI phân tích trực tiếp.");
      return;
    }

    const type = file.type.startsWith('video') ? 'video' : 
                 file.type.startsWith('audio') ? 'audio' : 'image';
    
    if (type === 'image') {
      setSelectedMode(AnalysisMode.CONTENT_AUDIT);
    } else if (type === 'audio') {
      if (selectedMode !== AnalysisMode.CONTENT_AUDIT && selectedMode !== AnalysisMode.SCRIPT_GENERATION) {
        setSelectedMode(AnalysisMode.REMAKE_SCRIPT);
      }
    }

    try {
      const { inlineData } = await fileToGenerativePart(file);
      setFileData({
        file,
        previewUrl: URL.createObjectURL(file),
        type,
        base64: inlineData.data,
        mimeType: inlineData.mimeType
      });
    } catch (e) {
      setError("Lỗi khi đọc file. Vui lòng thử lại.");
    }
  };

  const handleUserAssetSelect = async (file: File) => {
    if (!file.type.startsWith('image')) {
       setError("Vui lòng tải lên file ảnh (JPG, PNG, WEBP).");
       return;
    }
    
    try {
      const { inlineData } = await fileToGenerativePart(file);
      setUserAssetData({
        file,
        previewUrl: URL.createObjectURL(file),
        type: 'image',
        base64: inlineData.data,
        mimeType: inlineData.mimeType
      });
    } catch (e) {
      setError("Lỗi xử lý ảnh của bạn.");
    }
  };

  const handleClearData = () => {
    setFileData(null);
    setResult('');
    setError('');
    setUrlInput('');
    setGeneratedImageUrl('');
    stopScreenShare();
  };

  const startScreenShare = async () => {
    setError('');
    setFileData(null);
    setUrlInput('');
    setResult('');
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { cursor: "always" } as any, 
        audio: false 
      });
      
      setScreenStream(stream);
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
      };

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Screen share error:", err);
      if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') {
        setError("Không thể chia sẻ màn hình: " + (err.message || "Vui lòng cấp quyền trình duyệt."));
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
  };

  const captureScreenAndAnalyze = async () => {
    if (!videoRef.current || !screenStream) return;
    setLoading({ isLoading: true, message: 'Đang chụp ảnh màn hình...', step: 1 });

    try {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob(async (blob) => {
        if (!blob) {
           setError("Lỗi khi chụp màn hình.");
           setLoading({ isLoading: false, message: '', step: 0 });
           return;
        }
        stopScreenShare();
        const { inlineData } = await fileToGenerativePart(blob);
        setFileData({
          file: null,
          previewUrl: URL.createObjectURL(blob),
          type: 'image',
          base64: inlineData.data,
          mimeType: 'image/jpeg'
        });
        
        setLoading({ isLoading: true, message: `Bóc tách điểm tốt & Lồng ghép Brand ${activeBrand.name}...`, step: 2 });
        try {
          const responseText = await analyzeContent(
            '',
            selectedMode,
            inlineData.data,
            'image/jpeg',
            customUserPrompt,
            undefined,
            undefined,
            activeBrand,
            userInstructions,
            selectedFormula
          );
          setResult(responseText);
          recordHistory({ kind: 'analysis', html: responseText });
          setTimeout(() => {
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        } catch (apiErr: any) {
          setError(apiErr.message);
        } finally {
          setLoading({ isLoading: false, message: '', step: 0 });
        }
      }, 'image/jpeg', 0.95);
    } catch (err: any) {
      setError("Lỗi khi xử lý ảnh chụp: " + err.message);
      setLoading({ isLoading: false, message: '', step: 0 });
    }
  };

  const downloadCurrentFile = async () => {
    if (!fileData || !fileData.previewUrl) return;
    
    try {
      if (fileData.file) {
        const link = document.createElement('a');
        link.href = fileData.previewUrl;
        link.download = fileData.file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const response = await fetch(fileData.previewUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const timestamp = new Date().getTime();
      const extension = fileData.mimeType.split('/')[1]?.split(';')[0] || 'bin';
      link.download = `brand-source-export-${timestamp}.${extension}`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      setError("Không thể tải file trực tiếp. Hãy dùng chuột phải để lưu.");
    }
  };

  // Reads whatever text sits behind a link - a Facebook or X post, a Threads
  // thread, an article - so the model works from the real wording instead of
  // being told to look the link up on the web.
  const handleUrlFetch = async () => {
    if (!urlInput.trim()) return;

    // Only the video features need the file itself; the rest read the page.
    const wantsVideo = featureConfig.sources.includes('upload') || featureConfig.sources.includes('screen');

    setLoading({ isLoading: true, message: 'Đang kết nối liên kết...', step: 1 });
    setError('');
    setResult('');

    if (wantsVideo) {
      setFileData(null);
      setGeneratedImageUrl('');
      setUserAssetData(null);
      stopScreenShare();
    }

    try {
      const { fileData: loaded, warning } = await loadLinkSource(urlInput.trim(), {
        mode: wantsVideo ? 'video' : 'text',
        withComments: readComments,
        onProgress: (message) => setLoading({ isLoading: true, message, step: 1 }),
      });
      setFileData(loaded);
      if (warning) setError(warning);
    } catch (err: any) {
      console.error(err);
      setError('Lỗi tải link: ' + (err.message || 'Vui lòng kiểm tra lại đường dẫn.'));
    } finally {
      setLoading({ isLoading: false, message: '', step: 0 });
    }
  };

  const handleAnalyze = async () => {
    // Tính năng nào có ô nhập text thì gửi luôn text đó cho model. Trước đây chỗ này
    // liệt kê tay từng mode nên "Viết bài" và "Chấm điểm bài viết" bị bỏ quên: người
    // dùng gõ ý tưởng vào ô mà model không nhận được, rồi tự nghĩ ra một chủ đề khác.
    const isTextMode = featureConfig.sources.includes('text');

    const hasPastedText = isTextMode && !!customUserPrompt.trim();
    const hasScreenshots = featureConfig.sources.includes('images') && articleImages.length > 0;

    if (!fileData && !hasPastedText && !hasScreenshots) {
      const accepted = [
        featureConfig.sources.includes('link') ? 'dán link' : '',
        featureConfig.sources.includes('upload') ? 'tải file lên' : '',
        featureConfig.sources.includes('text') ? 'dán nội dung text' : '',
        featureConfig.sources.includes('images') ? 'dán hoặc tải ảnh chụp bài viết' : '',
      ].filter(Boolean).join(', ');
      setError('Chưa có nguồn nào để chạy. Hãy ' + accepted + '.');
      return;
    }

    setLoading({ 
      isLoading: true, 
      message: `Bóc tách nội dung gốc ➔ Hòa quyện Brand DNA (${activeBrand.name}) ➔ Xuất kết quả...`,
      step: 2
    });
    setError('');
    setResult('');
    setGeneratedImageUrl('');

    const attachedImages = [
      ...(hasScreenshots ? articleImages.map(({ base64, mimeType }) => ({ base64, mimeType })) : []),
      ...(fileData?.sourceImages || []),
    ].slice(0, 10);

    try {
      const responseText = await analyzeContent(
        '',
        selectedMode,
        fileData?.base64 || '',
        fileData?.mimeType || '',
        isTextMode ? customUserPrompt : undefined,
        fileData?.sourceText,
        fileData?.url,
        activeBrand,
        userInstructions,
        selectedFormula,
        fileData?.fileUri,
        fileData?.videoMeta,
        attachedImages.length ? attachedImages : undefined,
        undefined,
        selectedChecklistId ? getChecklist(selectedChecklistId)?.criteria : undefined
      );
      setResult(responseText);
      recordHistory({
        kind: 'analysis',
        html: responseText,
        sourceUrl: fileData?.url || fileData?.videoMeta?.webpageUrl || urlInput.trim() || undefined,
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err: any) {
      setError(err.message || "Đã có lỗi xảy ra trong quá trình phân tích.");
    } finally {
      setLoading({ isLoading: false, message: '', step: 0 });
    }
  };

  const handleRemakeThumbnail = async () => {
    if (!fileData || !userAssetData) return;

    setLoading({ isLoading: true, message: 'AI đang thiết kế lại Thumbnail chuẩn nhận diện thương hiệu...', step: 2 });
    setError('');
    
    try {
      const generatedImageBase64 = await generateRemakeThumbnail(
        '',
        fileData.base64,
        userAssetData.base64,
        userAssetData.mimeType,
        thumbnailText || activeBrand.tagline || activeBrand.name,
        aspectRatio,
        activeBrand
      );
      setGeneratedImageUrl(generatedImageBase64);

      const imageBlob = dataUrlToBlob(generatedImageBase64);
      const caption = thumbnailText.trim() || activeBrand.tagline || activeBrand.name;
      recordHistory({
        kind: 'image',
        title: `Thumbnail — ${caption}`.slice(0, 90),
        html: `<p>Thumbnail remake tỷ lệ ${aspectRatio} cho ${activeBrand.name}.</p><p>Chữ trên ảnh: ${caption}</p>`,
        assets: imageBlob ? [{ name: 'thumbnail.png', mimeType: imageBlob.type || 'image/png', blob: imageBlob }] : undefined,
      });

      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      setError(err.message || "Lỗi khi tạo thumbnail remake.");
    } finally {
      setLoading({ isLoading: false, message: '', step: 0 });
    }
  };

  const copyToClipboard = () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = result;
    const textToCopy = tempDiv.textContent || tempDiv.innerText || "";
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportAsTxt = () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = result;
    const text = tempDiv.textContent || tempDiv.innerText || "";
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const slug = featureTitle(selectedMode).toLowerCase().replace(/\s+/g, '-');
    link.download = `${slug}-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    exportToExcelCsv(result, `bang-phan-tich-video-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.csv`);
  };

  const handleOpenGoogleSheets = async () => {
    const title = `${featureTitle(selectedMode)} - ${activeBrand.name}`;
    const copied = await openInGoogleSheets(result, title);
    // Google offers no way to hand data to a brand-new sheet without the user
    // authorising the app, so the paste is the one step left to them.
    setSheetHint(copied
      ? 'Đã mở Google Sheets mới ở tab khác. Bấm ô A1 rồi Ctrl+V (Cmd+V) để dán kết quả đã định dạng.'
      : 'Đã mở Google Sheets mới, nhưng trình duyệt chặn sao chép tự động. Dùng nút CSV rồi vào Sheet: Tệp ▸ Nhập ▸ Tải lên.');
    setTimeout(() => setSheetHint(''), 15000);
  };


  const handleArticleImagesSelect = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const picked = Array.from(files as ArrayLike<File>).filter((f) => f.type.startsWith('image'));
    if (!picked.length) return;

    const loaded = await Promise.all(
      picked.map(async (file) => {
        const { inlineData } = await fileToGenerativePart(file);
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          base64: inlineData.data,
          mimeType: file.type || 'image/jpeg',
        };
      })
    );
    setArticleImages((prev) => [...prev, ...loaded]);
    setError('');
  };

  const takeImagesFromClipboard = (data: DataTransfer | null): boolean => {
    const files = Array.from(data?.files || []).filter((f) => f.type.startsWith('image'));
    if (!files.length) return false;
    handleArticleImagesSelect(files);
    setPastedCount(files.length);
    window.setTimeout(() => setPastedCount(0), 2500);
    return true;
  };

  const removeArticleImage = (index: number) => {
    setArticleImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const resetWorkspaceInputs = () => {
    setFileData(null);
    setUrlInput('');
    setCustomUserPrompt('');
    setUserInstructions('');
    setUserAssetData(null);
    setArticleImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
    setResult('');
    setError('');
    setGeneratedImageUrl('');
  };

  const handleSelectFeature = (mode: AnalysisMode) => {
    // Every feature starts from a clean slate; leftovers from the previous
    // feature would otherwise be sent to the AI instead of the new input.
    resetWorkspaceInputs();
    setSelectedMode(mode);
    stopScreenShare();
    setSidebarActive('features');
    setView('workspace');
  };

  const handleNavigate = (target: SidebarView) => {
    setSidebarActive(target);
    setIsMobileNavOpen(false);
    switch (target) {
      case 'overview':
        setView('overview');
        break;
      case 'features':
        setView('features');
        break;
      case 'radar':
        setView('radar');
        break;
      case 'waterfall':
        setView('waterfall');
        break;
      case 'history':
        setView('history');
        break;
      // Tone of voice is one section inside the brand profile modal, so it
      // never needed a second door of its own.
      case 'brand-dna':
        setIsBrandModalOpen(true);
        break;
      case 'integrations':
        setView('integrations');
        break;
      case 'community':
        setView('community');
        break;
    }
  };

  if (brandList.length === 0) {
    return (
      <OnboardingWizard
        onCreateBlank={(name) => {
          const fresh = createBlankBrand(name);
          setBrandList([fresh]);
          setActiveBrandId(fresh.id);
          setIsBrandModalOpen(true);
        }}
        onUseSample={(sample) => {
          setBrandList([sample]);
          setActiveBrandId(sample.id);
        }}
        onImportBrands={handleImportBrands}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans antialiased selection:bg-pink-500 selection:text-white flex">
      <Sidebar
        activeView={sidebarActive}
        onNavigate={handleNavigate}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeBrand={activeBrand}
          brandList={brandList}
          onSelectBrand={setActiveBrandId}
          onManageBrand={() => setIsBrandModalOpen(true)}
          onAddBrand={handleAddBrand}
          onOpenMenu={() => setIsMobileNavOpen(true)}
        />

        <div className="flex-1 flex min-w-0 items-start">
        <main className="flex-1 min-w-0 px-4 py-6 lg:px-10 lg:py-10">

        {view === 'features' && (
          <FeatureLauncher onSelectFeature={handleSelectFeature} />
        )}

        {view === 'radar' && <ContentRadar brand={activeBrand} />}

        {view === 'waterfall' && <ContentWaterfall brand={activeBrand} />}

        {view === 'history' && <HistoryPanel brand={activeBrand} />}

        {view === 'integrations' && <IntegrationsPanel />}

        {view === 'community' && <CommunityPanel />}

        {view === 'overview' && (
          <div className="max-w-5xl">
            <h1 className="text-[26px] sm:text-[32px] lg:text-[40px] leading-tight font-bold text-slate-900">
              Sản xuất nội dung theo bản sắc thương hiệu
            </h1>
            <p className="mt-3 text-[15px] text-slate-600">
              Không gian làm việc của {activeBrand.name}.
            </p>

            <div className="mt-8">
              <OverviewIntro
                brandName={activeBrand.name}
                onNavigate={handleNavigate}
                onOpenBrand={() => setIsBrandModalOpen(true)}
              />
            </div>

            <OverviewCommunity onOpenCommunity={() => setView('community')} />
          </div>
        )}

        {view === 'workspace' && (
        <div className="max-w-[880px] space-y-7">

        {/* BACK TO LIBRARY */}
        <button
          onClick={() => setView('features')}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#A4145E] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại Content Creator
        </button>

        {/* FEATURE HEADER */}
        <div className="flex flex-wrap items-start gap-5">
          <div className="w-[68px] h-[68px] rounded-2xl bg-[#FDF2F7] border border-[#f8d3e0] flex items-center justify-center shrink-0">
            <ActiveFeatureIcon className="w-9 h-9 text-[#A4145E]" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-[240px]">
            <h1 className="text-[24px] sm:text-[28px] lg:text-[34px] leading-tight font-bold text-slate-900">
              {featureTitle(selectedMode)}
            </h1>
            <p className="mt-1.5 text-[15px] text-slate-600">{featureConfig.subtitle}</p>
          </div>
          {featureConfig.available !== false && !screenStream && (
            <button
              onClick={handleAnalyze}
              disabled={loading.isLoading}
              className="shrink-0 inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold transition-colors shadow-sm"
            >
              {loading.isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Đang chạy...</>
              ) : (
                <>Bắt đầu <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          )}
        </div>

        {featureConfig.available === false ? (
          <div className="rounded-2xl border border-dashed border-pink-300 bg-pink-50/40 p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white border border-pink-200 flex items-center justify-center text-pink-600 mx-auto mb-4">
              <Wand2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Tính năng đang được phát triển</h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto mt-2 leading-relaxed">
              {featureConfig.subtitle} Phần này chưa sẵn sàng để sử dụng.
            </p>
            <button
              onClick={() => setView('features')}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-[#A4145E] text-[#A4145E] font-medium hover:bg-[#FDF2F7] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Quay lại Content Creator
            </button>
          </div>
        ) : (
        <>

        {/* WORKFLOW STEPPER */}
        <WorkflowStepper steps={activeFeature.steps} current={currentStep} running={loading.isLoading} />

        {/* ACTIVE BRAND GUIDELINES - hidden for pure analysis features */}
        {selectedMode !== AnalysisMode.ARTICLE_ANALYSIS && (
        <BrandSelectorBanner
          activeBrand={activeBrand}
          brandList={brandList}
          onOpenModal={() => setIsBrandModalOpen(true)}
          onSelectBrand={setActiveBrandId}
          onAddBrand={handleAddBrand}
        />
        )}

        {/* ================= STEP 1: SOURCE ================= */}
        <SectionCard n={1} title={activeFeature.steps[0][0]} hint={featureConfig.sourceHint}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">

            <div className="space-y-3.5 min-w-0">
              {/* Paste URL */}
              {featureConfig.sources.includes('link') && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A4145E]" />
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlFetch(); } }}
                      placeholder={featureConfig.linkPlaceholder}
                      className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-3 text-sm text-slate-800 focus:outline-none focus:border-[#A4145E] transition-colors placeholder:text-slate-400"
                      disabled={!!screenStream}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    className="shrink-0 text-xs px-4"
                    onClick={handleUrlFetch}
                    disabled={loading.isLoading || !urlInput.trim() || !!screenStream}
                  >
                    {loading.isLoading && urlInput ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lấy nội dung'}
                  </Button>
                </div>
                {loading.isLoading && loading.step === 1 && (
                  <RunStatus compact message={loading.message || 'Đang lấy nội dung...'} startedAt={runStartedAt} />
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={readComments}
                    onChange={(e) => setReadComments(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#A4145E] cursor-pointer"
                    disabled={!!screenStream}
                  />
                  Đọc cả bình luận trong bài
                  {typeof fileData?.commentCount === 'number' && fileData.commentCount > 0 && (
                    <span className="text-[#A4145E] font-medium">
                      · đã đọc {fileData.commentCount} bình luận
                    </span>
                  )}
                </label>
                <p className="text-xs text-slate-500">
                  Nhận link bài viết, ảnh, video, reel trên Facebook, Instagram, Threads, X, TikTok, Douyin, YouTube và link web thường.
                </p>
              </div>
              )}

              {/* File Dropzone */}
              {featureConfig.sources.includes('upload') && !screenStream && (
                <FileDropzone
                  onFileSelect={handleFileSelect}
                  currentFile={fileData?.file || null}
                  label={featureConfig.uploadLabel || 'Kéo thả file nguồn vào đây'}
                />
              )}

              {/* Live Screen Option */}
              {featureConfig.sources.includes('screen') && (
                <div className="relative pt-0.5">
                  {!screenStream ? (
                    <button
                      onClick={startScreenShare}
                      className="w-full py-3 px-3 rounded-xl border border-dashed border-pink-300 bg-pink-50/60 hover:bg-pink-100/70 text-pink-800 flex items-center justify-center gap-2 transition-all text-xs group"
                    >
                      <Monitor className="w-4 h-4 group-hover:scale-110 transition-transform text-pink-600" />
                      <span className="font-semibold">Quay màn hình trực tiếp</span>
                    </button>
                  ) : (
                    <div className="bg-slate-900 rounded-xl overflow-hidden border border-pink-500 shadow-2xl relative">
                      <div className="bg-pink-600 px-3 py-1.5 flex items-center justify-between text-white text-xs font-medium">
                        <span className="flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5" /> Đang thu màn hình của bạn</span>
                        <button onClick={stopScreenShare} className="hover:bg-pink-700 rounded p-1"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="relative aspect-video bg-black">
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                      </div>
                      <div className="p-3 bg-slate-900 border-t border-pink-900/50 flex justify-center">
                        <Button onClick={captureScreenAndAnalyze} className="w-full text-xs">
                          <Camera className="w-4 h-4 mr-1.5" />
                          Chụp khung hình & phân tích ngay
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pasted text source */}
              {featureConfig.sources.includes('text') && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-[#A4145E]" /> {featureConfig.textLabel}
                </label>
                <textarea
                  className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:border-[#A4145E] outline-none h-40 resize-none custom-scrollbar placeholder:text-slate-400"
                  placeholder={featureConfig.textPlaceholder}
                  value={customUserPrompt}
                  onChange={(e) => setCustomUserPrompt(e.target.value)}
                />
              </div>
              )}

              {/* Screenshots of an article */}
              {featureConfig.sources.includes('images') && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileImage className="w-3.5 h-3.5 text-[#A4145E]" /> Ảnh chụp bài viết (chọn được nhiều ảnh)
                </label>
                <div className="relative border border-dashed border-pink-300 rounded-xl p-4 bg-pink-50/40 hover:bg-pink-50/70 transition-colors text-center">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => { handleArticleImagesSelect(e.target.files); e.target.value = ''; }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <UploadCloud className="w-6 h-6 text-pink-600 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold text-slate-800">Kéo thả hoặc chọn ảnh chụp bài viết</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    AI đọc chữ trong ảnh và phân tích cả bố cục, màu sắc
                  </p>
                </div>

                {/* A paste here bubbles to the window listener, which is the single
                    place that reads the clipboard - handling it twice would add
                    every screenshot twice. */}
                <div
                  tabIndex={0}
                  className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-center cursor-text transition-colors outline-none focus:border-[#A4145E] focus:bg-[#FDF2F7] hover:border-slate-400"
                >
                  <div className="flex items-center justify-center gap-2 text-slate-600">
                    <ClipboardPaste className="w-4 h-4 text-[#A4145E]" />
                    <span className="text-xs font-semibold">Hoặc bấm vào ô này rồi Ctrl+V để dán ảnh</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Chụp màn hình xong dán thẳng vào, không cần lưu thành file
                  </p>
                </div>

                {pastedCount > 0 && (
                  <p className="text-[11px] font-semibold text-emerald-700">
                    Đã dán {pastedCount} ảnh từ clipboard.
                  </p>
                )}

                {articleImages.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Đang có {articleImages.length} ảnh — AI sẽ đọc chữ và phân tích cả phần hình.
                  </p>
                )}

                {articleImages.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {articleImages.map((img, i) => (
                      <div key={img.previewUrl} className="relative group rounded-lg overflow-hidden border border-pink-200 bg-white">
                        <img src={img.previewUrl} alt={`Ảnh bài viết ${i + 1}`} className="w-full h-20 object-cover" />
                        <button
                          onClick={() => removeArticleImage(i)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Xóa ảnh này"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>

            {/* SOURCE PREVIEW */}
            <div className="min-w-0">
              {fileData ? (
                <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white relative group">
                  <div className="absolute top-2.5 right-2.5 z-20 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {fileData.previewUrl && !fileData.videoMeta && (
                      <button
                        onClick={downloadCurrentFile}
                        className="bg-[#A4145E] hover:bg-[#86104D] text-white p-1.5 rounded-full transition-all shadow-md"
                        title="Tải về máy"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={handleClearData}
                      className="bg-slate-700 hover:bg-slate-900 text-white p-1.5 rounded-full transition-colors shadow-md"
                      title="Xóa nguồn này"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {fileData.videoMeta ? (
                    <div>
                      {fileData.videoMeta.thumbnail ? (
                        <img src={fileData.videoMeta.thumbnail} alt="Thumbnail video gốc" className="w-full aspect-video object-cover bg-slate-950" />
                      ) : (
                        <div className="aspect-video flex items-center justify-center bg-slate-950 text-pink-300">
                          <Globe className="w-8 h-8" />
                        </div>
                      )}
                      <div className="p-3.5 space-y-1.5">
                        <p className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug">
                          {fileData.videoMeta.title || '(Không có caption)'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {fileData.videoMeta.platform}
                          {fileData.videoMeta.durationSec !== null && ` · ${fileData.videoMeta.durationSec}s`}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 font-medium pt-0.5">
                          <span>👁 {fileData.videoMeta.viewCount?.toLocaleString('vi-VN') ?? '—'}</span>
                          <span>❤️ {fileData.videoMeta.likeCount?.toLocaleString('vi-VN') ?? '—'}</span>
                          <span>💬 {fileData.videoMeta.commentCount?.toLocaleString('vi-VN') ?? '—'}</span>
                        </div>
                        <p className="text-[11px] text-emerald-700 font-semibold pt-0.5">
                          ✓ Đã tải video thật gửi tới AI
                        </p>
                      </div>
                    </div>
                  ) : fileData.sourceText ? (
                    <div className="p-3.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[#A4145E]">
                        <FileCheck2 className="w-4 h-4" />
                        <span className="text-[11px] font-bold uppercase tracking-wide">Đã đọc nội dung</span>
                      </div>
                      <p className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug">
                        {fileData.sourceTitle || fileData.url}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {fileData.sourceText.length.toLocaleString('vi-VN')} ký tự đã trích xuất
                        {fileData.sourceImages?.length ? ' · ' + fileData.sourceImages.length + ' ảnh trong bài' : ''}
                      </p>
                      <p className="text-[11px] text-slate-600 line-clamp-6 leading-relaxed bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                        {fileData.sourceText.slice(0, 400)}
                      </p>
                    </div>
                  ) : fileData.type === 'video' ? (
                    <video src={fileData.previewUrl} controls className="w-full aspect-video object-contain bg-slate-950" />
                  ) : fileData.type === 'audio' ? (
                    <div className="p-4 flex flex-col items-center justify-center bg-pink-50/50 text-pink-800 gap-2.5">
                      <Mic className="w-8 h-8 text-pink-500" />
                      <audio src={fileData.previewUrl} controls className="w-full" />
                      <p className="text-[11px] text-slate-500 truncate max-w-full">{fileData.file?.name || 'File âm thanh'}</p>
                    </div>
                  ) : fileData.type === 'url' ? (
                    <div className="p-4 flex flex-col items-center justify-center bg-pink-50/50 text-pink-800 gap-2 text-center">
                      <Globe className="w-8 h-8 text-pink-500" />
                      <p className="font-bold text-slate-900 text-[13px]">Đã kết nối link nguồn</p>
                      <p className="text-[11px] text-slate-500 break-all font-mono">{fileData.url}</p>
                    </div>
                  ) : (
                    <img src={fileData.previewUrl} alt="Preview" className="w-full aspect-video object-contain bg-slate-950" />
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center h-full flex flex-col items-center justify-center min-h-[180px]">
                  <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center mb-2.5">
                    <ActiveFeatureIcon className="w-5 h-5 text-slate-400" strokeWidth={1.5} />
                  </div>
                  <p className="text-[13px] font-semibold text-slate-600">Chưa có nguồn</p>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">{activeFeature.steps[0][1]}</p>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ================= STEP 2: TUNING ================= */}
        <SectionCard n={2} title={activeFeature.steps[1][0]} hint={activeFeature.steps[1][1]}>
          <div className="space-y-5">
            {/* Bộ tiêu chí chấm điểm */}
            {(selectedMode === AnalysisMode.ARTICLE_SCORING || selectedMode === AnalysisMode.VIDEO_SCORING) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-[#A4145E]" /> Bộ tiêu chí chấm điểm
                  </label>
                  <button
                    onClick={() => setIsChecklistOpen(true)}
                    className="text-xs font-semibold text-[#A4145E] hover:underline"
                  >
                    Quản lý bộ tiêu chí
                  </button>
                </div>
                <select
                  value={selectedChecklistId}
                  onChange={(e) => setSelectedChecklistId(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl p-3 focus:border-[#A4145E] outline-none"
                >
                  <option value="">Để hệ thống AI tự chấm điểm</option>
                  {availableChecklists.map((c) => (
                    <option key={c.id} value={c.id}>
                      Chấm theo bộ: {c.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  {selectedChecklistId
                    ? 'AI sẽ chấm đúng theo thang điểm bạn đã viết trong bộ tiêu chí này.'
                    : availableChecklists.length
                      ? 'AI tự chấm theo Brand DNA và bộ tiêu chí chuẩn của app. Chọn một bộ ở trên để chấm theo thang điểm riêng của bạn.'
                      : 'AI tự chấm theo Brand DNA và bộ tiêu chí chuẩn của app. Bấm "Quản lý bộ tiêu chí" để thêm bộ riêng, mỗi bộ thêm vào sẽ hiện thành một lựa chọn ở đây.'}
                </p>
              </div>
            )}

            {/* Script Formula Selection */}
            {(selectedMode === AnalysisMode.REMAKE_SCRIPT || selectedMode === AnalysisMode.SCRIPT_GENERATION
              || selectedMode === AnalysisMode.ARTICLE_WRITING) && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Sigma className="w-3.5 h-3.5 text-[#A4145E]" /> Cấu trúc / công thức triển khai
                </label>
                <select
                  value={selectedFormula}
                  onChange={(e) => setSelectedFormula(e.target.value as ScriptFormula)}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl p-3 focus:border-[#A4145E] outline-none"
                >
                  {(Object.keys(FORMULA_LABELS) as ScriptFormula[]).map((f) => (
                    <option key={f} value={f}>{FORMULA_LABELS[f]}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Extra Instructions */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <FilePenLine className="w-3.5 h-3.5 text-[#A4145E]" /> Yêu cầu bổ sung (tùy chọn)
              </label>
              <textarea
                className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:border-[#A4145E] outline-none h-24 resize-none custom-scrollbar placeholder:text-slate-400"
                placeholder="VD: Nhấn mạnh sản phẩm chủ lực, thời lượng dưới 60s, giữ đúng xưng hô của brand..."
                value={userInstructions}
                onChange={(e) => setUserInstructions(e.target.value)}
              />
            </div>

            {/* ACTION TRIGGER */}
            {!screenStream && (
              <Button
                onClick={handleAnalyze}
                disabled={loading.isLoading}
                className="w-full py-3.5 text-sm font-bold shadow-md"
              >
                {loading.isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Đang chạy...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>{featureConfig.actionLabel}</span>
                  </>
                )}
              </Button>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-3 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <div className="leading-relaxed">{error}</div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ================= STEP 3: RESULT ================= */}
        <div ref={resultRef}>
        <SectionCard
          n={3}
          title={activeFeature.steps[2][0]}
          hint={result ? `Áp dụng quy tắc: ${activeBrand.name}` : activeFeature.steps[2][1]}
          action={result ? (
            <div className="flex items-center flex-wrap gap-2 justify-end">
              <button
                onClick={handleOpenGoogleSheets}
                className="text-xs flex items-center gap-1.5 text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-300 transition-colors font-semibold"
                title="Mở Google Sheets mới và dán kết quả đã định dạng (Ctrl+V)"
              >
                <Sheet className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Google Sheets</span>
              </button>
              <button
                onClick={handleExportExcel}
                className="text-xs flex items-center gap-1.5 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors font-medium"
                title="Tải file CSV mở được bằng Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">CSV</span>
              </button>
              <button
                onClick={exportAsTxt}
                className="text-xs flex items-center gap-1.5 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors font-medium"
                title="Xuất file văn bản .txt"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">.txt</span>
              </button>
              <button
                onClick={copyToClipboard}
                className="text-xs flex items-center gap-1.5 text-white bg-[#A4145E] hover:bg-[#86104D] px-3 py-1.5 rounded-lg font-semibold transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Đã copy' : 'Copy'}
              </button>
            </div>
          ) : undefined}
        >
          {sheetHint && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              <Sheet className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span className="leading-relaxed">{sheetHint}</span>
            </div>
          )}

          {loading.isLoading && loading.step === 2 ? (
            <RunStatus
              message={loading.message || 'Đang xử lý...'}
              startedAt={runStartedAt}
              expectation={runExpectation}
            />
          ) : result ? (
            <div className="space-y-6">
              {/* Long results simply scroll inside this pane. */}
              <div className="max-h-[720px] overflow-y-auto overflow-x-auto custom-scrollbar pr-1">
                {/* `analysis-output` in index.css styles the model's raw HTML.
                    Tailwind only builds classes it can find in the source, so a
                    class the model invents at runtime has no CSS at all - real
                    rules on the tags themselves are what keep the result readable. */}
                <div
                  className="analysis-output font-sans"
                  dangerouslySetInnerHTML={{ __html: result }}
                />
              </div>

              <BookingNudge />

              {/* Thumbnail Remake Section if in THUMBNAIL_AUDIT */}
              {selectedMode === AnalysisMode.THUMBNAIL_AUDIT && (
                <div className="border-t border-slate-200 pt-6 animate-in fade-in">
                  <div className="flex items-center gap-2 mb-4 text-pink-900">
                    <Wand2 className="w-5 h-5 text-pink-600" />
                    <h3 className="text-base font-bold">Remake thumbnail cho brand ({activeBrand.name})</h3>
                  </div>

                  <div className="bg-white rounded-xl p-5 border border-slate-200 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs uppercase text-slate-700 font-bold">1. Ảnh khuôn mặt / sản phẩm của brand</label>
                      <FileDropzone
                        variant="mini"
                        onFileSelect={handleUserAssetSelect}
                        currentFile={userAssetData?.file || null}
                        label="Thả ảnh sản phẩm hoặc model của brand vào đây"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs uppercase text-slate-700 font-bold">2. Tiêu đề chữ nổi trên thumbnail</label>
                      <input
                        type="text"
                        className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 focus:border-[#A4145E] outline-none"
                        placeholder={activeBrand.tagline || 'VD: 1 CHẠM - 12H BẢO VỆ CHUẨN NHẬT...'}
                        value={thumbnailText}
                        onChange={(e) => setThumbnailText(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs uppercase text-slate-700 font-bold">3. Tỉ lệ khung hình</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          onClick={() => setAspectRatio('16:9')}
                          className={`py-2.5 rounded-lg border text-xs font-semibold transition-all ${aspectRatio === '16:9' ? 'bg-[#A4145E] border-[#A4145E] text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
                        >
                          16:9 (YouTube)
                        </button>
                        <button
                          onClick={() => setAspectRatio('9:16')}
                          className={`py-2.5 rounded-lg border text-xs font-semibold transition-all ${aspectRatio === '9:16' ? 'bg-[#A4145E] border-[#A4145E] text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
                        >
                          9:16 (TikTok / Reels)
                        </button>
                      </div>
                    </div>

                    <Button
                      onClick={handleRemakeThumbnail}
                      disabled={!userAssetData || loading.isLoading}
                      className="w-full text-xs py-2.5"
                    >
                      {loading.isLoading && userAssetData ? (
                        <><Loader2 className="animate-spin w-4 h-4" /> Đang render hình ảnh chuẩn brand...</>
                      ) : 'Tạo thumbnail remake mới'}
                    </Button>
                  </div>
                </div>
              )}

              {generatedImageUrl && (
                <div className="space-y-3 animate-in zoom-in-95 duration-500">
                  <h4 className="text-emerald-700 text-xs font-bold flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" /> Thumbnail remake hoàn tất
                  </h4>
                  <div className={`rounded-xl overflow-hidden border-2 border-pink-400 relative group mx-auto ${aspectRatio === '9:16' ? 'max-w-[280px]' : 'w-full'}`}>
                    <img src={generatedImageUrl} alt="Generated Thumbnail" className="w-full h-auto" />
                    <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <a
                        href={generatedImageUrl}
                        download={`remake-thumbnail-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.png`}
                        className="bg-white text-slate-900 px-5 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 hover:scale-105 transition-transform"
                      >
                        <Download className="w-4 h-4 text-pink-600" /> Tải thumbnail về máy
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-14">
              <div className="w-14 h-14 rounded-2xl bg-[#FDF2F7] border border-[#f8d3e0] flex items-center justify-center mb-3">
                <Sparkles className="w-7 h-7 text-[#A4145E]" />
              </div>
              <h4 className="text-sm font-bold text-slate-800">Chưa có kết quả</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
                Điền nguồn ở bước 1 rồi bấm <strong>Bắt đầu</strong>. Kết quả sẽ bám theo bản sắc của thương hiệu{' '}
                <strong>{activeBrand.name}</strong> và có thể cuộn để đọc hết.
              </p>
            </div>
          )}
        </SectionCard>
        </div>

        </>
        )}

        </div>
        )}

        </main>

        {view === 'workspace' && (
          <FeatureRail activeMode={selectedMode} onSelect={handleSelectFeature} />
        )}
        </div>

        {/* Ngoài hàng ngang chứa main và FeatureRail: đặt bên trong đó thì footer
            thành một cột thứ ba đứng cạnh nội dung, chứ không nằm dưới. */}
        <AppFooter onOpenCommunity={() => handleNavigate('community')} />
      </div>

      <ChecklistModal
        isOpen={isChecklistOpen}
        onClose={() => setIsChecklistOpen(false)}
        onChanged={() => setChecklistVersion((v) => v + 1)}
      />

      {/* BRAND GUIDELINES MANAGEMENT MODAL */}
      <BrandProfileModal
        isOpen={isBrandModalOpen}
        onClose={() => setIsBrandModalOpen(false)}
        activeBrand={activeBrand}
        onSaveBrand={handleSaveBrandProfile}
        brandList={brandList}
        onImportBrand={handleImportBrand}
        onDeleteBrand={handleDeleteBrand}
      />
    </div>
  );
};

export default App;
