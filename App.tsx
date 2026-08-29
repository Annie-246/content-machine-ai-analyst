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
  UploadCloud
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
import { Button, FileDropzone } from './components/UiComponents';
import { BrandProfileModal } from './components/BrandProfileModal';
import { BrandSelectorBanner } from './components/BrandSelectorBanner';
import { Sidebar, SidebarView } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { FeatureLauncher } from './components/FeatureLauncher';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { OnboardingWizard } from './components/OnboardingWizard';
import { getGeminiApiKey } from './services/apiKeyStore';
import { postJson } from './services/apiClient';
import { exportToExcelCsv, openInGoogleSheets } from './src/utils/exportUtils';

type AppView = 'overview' | 'features' | 'workspace' | 'integrations';

const FEATURE_TITLES: Partial<Record<AnalysisMode, string>> = {
  [AnalysisMode.REMAKE_SCRIPT]: 'Remake kịch bản video',
  [AnalysisMode.DEEP_ANALYSIS]: 'Phân tích sâu video',
  [AnalysisMode.SCRIPT_EXTRACT]: 'Trích script video',
  [AnalysisMode.SCRIPT_GENERATION]: 'Tạo kịch bản từ ý tưởng',
  [AnalysisMode.CONTENT_AUDIT]: 'Remake bài viết',
  [AnalysisMode.ARTICLE_ANALYSIS]: 'Phân tích sâu bài viết',
  [AnalysisMode.THUMBNAIL_AUDIT]: 'Tạo hình ảnh',
  [AnalysisMode.VIDEO_SCORING]: 'Chấm điểm nội dung video',
  [AnalysisMode.ARTICLE_SCORING]: 'Chấm điểm nội dung bài viết',
};

// Links we can download server-side with yt-dlp.
const SOCIAL_LINK_RE = /(youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|threads\.net)/i;

// Modes that expose the script formula picker.
const FORMULA_MODES = [AnalysisMode.REMAKE_SCRIPT, AnalysisMode.SCRIPT_GENERATION];

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
    subtitle: 'Trích xuất nguyên văn lời thoại kèm mốc thời gian từ video.',
    sources: ['link', 'upload'],
    sourceLabel: 'Video cần trích script',
    sourceHint: 'Link hoặc file video, audio',
    linkPlaceholder: 'Dán link video TikTok, YouTube, Reels, Facebook...',
    actionLabel: 'Trích script video',
    uploadLabel: 'Hoặc kéo thả video, audio vào đây',
  },
  [AnalysisMode.SCRIPT_GENERATION]: {
    subtitle: 'Từ ý tưởng thô thành kịch bản video hoàn chỉnh theo công thức bạn chọn.',
    sources: ['text'],
    sourceLabel: 'Ý tưởng của bạn',
    sourceHint: 'Chỉ cần mô tả ý tưởng',
    textLabel: 'Ý tưởng / bản nháp thô:',
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
    subtitle: 'Chấm điểm video theo bộ tiêu chí của thương hiệu.',
    sources: [],
    sourceLabel: 'Nguồn video',
    sourceHint: '',
    actionLabel: 'Chấm điểm nội dung',
    available: false,
  },
  [AnalysisMode.ARTICLE_SCORING]: {
    subtitle: 'Chấm điểm bài viết theo bộ tiêu chí của thương hiệu.',
    sources: [],
    sourceLabel: 'Nguồn bài viết',
    sourceHint: '',
    actionLabel: 'Chấm điểm nội dung',
    available: false,
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

  // Shell navigation: the launcher screen opens a feature, which reveals the workspace.
  const [view, setView] = useState<AppView>('features');
  const [sidebarActive, setSidebarActive] = useState<SidebarView>('features');

  const activeBrand: BrandProfile = brandList.find(b => b.id === activeBrandId) || brandList[0] || PLACEHOLDER_BRAND;

  // Analysis & Workflow State
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [selectedMode, setSelectedMode] = useState<AnalysisMode>(AnalysisMode.REMAKE_SCRIPT);
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState<LoadingState>({ isLoading: false, message: '', step: 0 });
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [customUserPrompt, setCustomUserPrompt] = useState('');
  const [userInstructions, setUserInstructions] = useState('');
  const [selectedFormula, setSelectedFormula] = useState<ScriptFormula>('auto');

  const featureConfig = FEATURE_CONFIG[selectedMode] || FEATURE_CONFIG[AnalysisMode.REMAKE_SCRIPT]!;
  
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

  const handleUrlFetch = async () => {
    if (!urlInput.trim()) return;

    const isSocialLink = SOCIAL_LINK_RE.test(urlInput);

    // Article modes keep a plain web link as-is, but a social post still gets
    // downloaded so the AI can actually see it instead of guessing.
    if ((selectedMode === AnalysisMode.CONTENT_AUDIT || selectedMode === AnalysisMode.ARTICLE_ANALYSIS) && !isSocialLink) {
      setFileData({
        file: null,
        previewUrl: '',
        type: 'url',
        base64: '',
        mimeType: '',
        url: urlInput
      });
      setError('');
      setResult('');
      return;
    }

    setLoading({ isLoading: true, message: 'Đang kết nối liên kết...', step: 1 });
    setError('');
    setResult('');
    setFileData(null);
    setGeneratedImageUrl('');
    setUserAssetData(null);
    stopScreenShare();

    try {
      // A social post can never be fetched from the browser (CORS), so go
      // straight to the server-side downloader instead of failing first.
      if (isSocialLink) {
        setLoading({ isLoading: true, message: 'Đang tải video từ mạng xã hội và đẩy lên Gemini...', step: 1 });

        let payload: any;
        try {
          payload = await postJson('/api/fetch-video', { url: urlInput, apiKey: getGeminiApiKey() });
        } catch (apiError: any) {
          setError(apiError.message || 'Không tải được video từ link này.');
          setLoading({ isLoading: false, message: '', step: 0 });
          return;
        }

        const meta = payload.meta as VideoMeta;
        setFileData({
          file: null,
          previewUrl: meta.thumbnail || '',
          type: 'video',
          base64: '',
          mimeType: payload.mimeType,
          url: urlInput,
          fileUri: payload.fileUri,
          videoMeta: meta
        });
        setLoading({ isLoading: false, message: '', step: 0 });
        return;
      }

      let blob: Blob;
      try {
        const response = await fetch(urlInput);
        if (!response.ok) throw new Error('Direct fetch failed');
        blob = await response.blob();
      } catch (directError) {
        try {
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(urlInput)}`;
          const proxyResponse = await fetch(proxyUrl);
          if (!proxyResponse.ok) throw new Error('Proxy fetch failed');
          blob = await proxyResponse.blob();
        } catch (proxyError) {
          setFileData({
            file: null,
            previewUrl: '',
            type: 'url',
            base64: '',
            mimeType: '',
            url: urlInput
          });
          setError("Chuyển sang chế độ đọc Link Web.");
          setLoading({ isLoading: false, message: '', step: 0 });
          return;
        }
      }

      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = urlInput.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg'].includes(ext || '')) mimeType = 'image/jpeg';
        else if (['png'].includes(ext || '')) mimeType = 'image/png';
        else if (['mov'].includes(ext || '')) mimeType = 'video/quicktime';
        else if (['mp3', 'wav', 'ogg'].includes(ext || '')) mimeType = 'audio/mpeg';
        else mimeType = 'video/mp4';
        blob = blob.slice(0, blob.size, mimeType);
      }

      const type = mimeType.startsWith('image') ? 'image' : 
                   mimeType.startsWith('audio') ? 'audio' : 'video';

      const { inlineData } = await fileToGenerativePart(blob);
      setFileData({
        file: null,
        previewUrl: URL.createObjectURL(blob),
        type,
        base64: inlineData.data,
        mimeType: mimeType
      });

    } catch (err: any) {
      console.error(err);
      setError("Lỗi tải link: " + (err.message || "Vui lòng kiểm tra lại đường dẫn."));
    } finally {
      setLoading({ isLoading: false, message: '', step: 0 });
    }
  };

  const handleAnalyze = async () => {
    const isArticleAnalysis = selectedMode === AnalysisMode.ARTICLE_ANALYSIS;
    const isTextMode = selectedMode === AnalysisMode.CONTENT_AUDIT || selectedMode === AnalysisMode.SCRIPT_GENERATION || isArticleAnalysis;

    if (!fileData && !isTextMode) {
      setError("Vui lòng tải lên file Video/Audio/Ảnh hoặc dán link nội dung gốc để phân tích.");
      return;
    }

    // Article analysis accepts any one of: pasted text, a link, or screenshots.
    if (isArticleAnalysis && !fileData && !customUserPrompt.trim() && articleImages.length === 0) {
      setError("Vui lòng dán link bài viết, dán nội dung text, hoặc tải lên ảnh chụp bài viết.");
      return;
    }

    if (isTextMode && !isArticleAnalysis && !fileData && !customUserPrompt.trim()) {
      setError("Vui lòng nhập ý tưởng/bản nháp thô hoặc nội dung văn bản gốc.");
      return;
    }

    setLoading({ 
      isLoading: true, 
      message: `Bước 1: Bóc tách điểm tốt nội dung gốc ➔ Bước 2: Hòa quyện Brand DNA (${activeBrand.name}) ➔ Bước 3: Xuất kịch bản...`,
      step: 1
    });
    setError('');
    setResult('');
    setGeneratedImageUrl('');

    try {
      const responseText = await analyzeContent(
        '',
        selectedMode,
        fileData?.base64 || '',
        fileData?.mimeType || '',
        isTextMode ? customUserPrompt : undefined,
        undefined,
        fileData?.url,
        activeBrand,
        userInstructions,
        selectedFormula,
        fileData?.fileUri,
        fileData?.videoMeta,
        featureConfig.sources.includes('images')
          ? articleImages.map(({ base64, mimeType }) => ({ base64, mimeType }))
          : undefined
      );
      setResult(responseText);
      
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
    const slug = (FEATURE_TITLES[selectedMode] || 'ket-qua').toLowerCase().replace(/\s+/g, '-');
    link.download = `${slug}-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    exportToExcelCsv(result, `bang-phan-tich-video-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.csv`);
  };

  const handleOpenGoogleSheets = () => {
    openInGoogleSheets(result);
  };


  const handleArticleImagesSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith('image'));
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
    switch (target) {
      case 'overview':
        setView('overview');
        break;
      case 'features':
        setView('features');
        break;
      // Brand DNA and tone of voice both live in the brand profile modal.
      case 'brand-dna':
      case 'voice':
        setIsBrandModalOpen(true);
        break;
      // The formula picker only exists inside script modes, so jump there.
      case 'formula':
        if (!FORMULA_MODES.includes(selectedMode)) setSelectedMode(AnalysisMode.REMAKE_SCRIPT);
        setView('workspace');
        break;
      case 'integrations':
        setView('integrations');
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
    <div className="min-h-screen bg-white text-slate-800 font-sans antialiased selection:bg-red-500 selection:text-white flex">
      <Sidebar activeView={sidebarActive} onNavigate={handleNavigate} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeBrand={activeBrand}
          brandList={brandList}
          onSelectBrand={setActiveBrandId}
          onManageBrand={() => setIsBrandModalOpen(true)}
          onAddBrand={handleAddBrand}
        />

        <main className="flex-1 px-10 py-10">

        {view === 'features' && (
          <FeatureLauncher onSelectFeature={handleSelectFeature} />
        )}

        {view === 'integrations' && <IntegrationsPanel />}

        {view === 'overview' && (
          <div className="max-w-5xl">
            <h1 className="text-[40px] leading-tight font-bold text-slate-900">Tổng quan</h1>
            <p className="mt-3 text-[15px] text-slate-600">
              Không gian làm việc của {activeBrand.name}.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="rounded-2xl border border-slate-200 p-6">
                <p className="text-sm text-slate-500">Brand đang áp dụng</p>
                <p className="mt-1.5 text-lg font-bold text-slate-900">{activeBrand.name}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-6">
                <p className="text-sm text-slate-500">Số bộ quy tắc đã lưu</p>
                <p className="mt-1.5 text-lg font-bold text-slate-900">{brandList.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-6">
                <p className="text-sm text-slate-500">Giọng văn</p>
                <p className="mt-1.5 text-lg font-bold text-slate-900 truncate">
                  {activeBrand.brandVoiceTone || 'Chưa thiết lập'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setView('features')}
              className="mt-8 inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#dc2626] hover:bg-[#c70045] text-white font-semibold transition-colors"
            >
              Chọn tính năng <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {view === 'workspace' && (
        <div className="space-y-6">

        {/* WORKSPACE HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setView('features')}
              className="w-10 h-10 rounded-full border border-slate-200 hover:border-[#dc2626] flex items-center justify-center transition-colors group shrink-0"
              title="Quay lại danh sách tính năng"
            >
              <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:text-[#dc2626]" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{FEATURE_TITLES[selectedMode] || 'Phân tích AI'}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{featureConfig.subtitle}</p>
            </div>
          </div>
        </div>

        {featureConfig.available === false ? (
          <div className="rounded-2xl border border-dashed border-red-300 bg-red-50/40 p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white border border-red-200 flex items-center justify-center text-red-600 mx-auto mb-4">
              <Wand2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Tính năng đang được phát triển</h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto mt-2 leading-relaxed">
              {featureConfig.subtitle} Phần này chưa sẵn sàng để sử dụng.
            </p>
            <button
              onClick={() => setView('features')}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-[#dc2626] text-[#dc2626] font-medium hover:bg-[#fef2f2] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Quay lại danh sách tính năng
            </button>
          </div>
        ) : (
        <>

        {/* ACTIVE BRAND GUIDELINES BANNER - hidden for pure analysis features */}
        {selectedMode !== AnalysisMode.ARTICLE_ANALYSIS && (
        <BrandSelectorBanner
          activeBrand={activeBrand}
          brandList={brandList}
          onOpenModal={() => setIsBrandModalOpen(true)}
          onSelectBrand={setActiveBrandId}
          onAddBrand={handleAddBrand}
        />
        )}

        {/* WORKFLOW GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
          
          {/* LEFT COLUMN: Input & Configuration */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* STEP 1: Input Source */}
            <div className="bg-white p-5 rounded-2xl border border-red-200 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-red-950 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-r from-red-500 to-red-600 text-white inline-flex items-center justify-center text-[11px] shadow-sm">1</span>
                  {featureConfig.sourceLabel}
                </label>
                <span className="text-[11px] text-red-600 font-medium">{featureConfig.sourceHint}</span>
              </div>

              {/* Paste URL */}
              {featureConfig.sources.includes('link') && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder={featureConfig.linkPlaceholder}
                    className="w-full bg-red-50/40 border border-red-200 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-800 focus:outline-none focus:border-red-500 focus:bg-white transition-colors placeholder:text-slate-400"
                    disabled={!!screenStream}
                  />
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 text-xs px-3"
                  onClick={handleUrlFetch}
                  disabled={loading.isLoading || !urlInput.trim() || !!screenStream}
                >
                  {loading.isLoading && urlInput ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch Link'}
                </Button>
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
                <div className="relative pt-1">
                  {!screenStream ? (
                    <button 
                      onClick={startScreenShare}
                      className="w-full py-2.5 px-3 rounded-xl border border-dashed border-red-300 bg-red-50/60 hover:bg-red-100/70 text-red-800 flex items-center justify-center gap-2 transition-all text-xs group shadow-sm"
                    >
                      <Monitor className="w-4 h-4 group-hover:scale-110 transition-transform text-red-600" />
                      <span className="font-semibold">Quay Màn Hình Trực Tiếp (Live Screen Capture)</span>
                    </button>
                  ) : (
                    <div className="bg-slate-900 rounded-xl overflow-hidden border border-red-500 shadow-2xl relative">
                      <div className="bg-gradient-to-r from-red-600 to-red-600 px-3 py-1.5 flex items-center justify-between text-white text-xs font-medium">
                        <span className="flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5" /> Đang thu màn hình của bạn</span>
                        <button onClick={stopScreenShare} className="hover:bg-red-700 rounded p-1"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="relative aspect-video bg-black">
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                      </div>
                      <div className="p-3 bg-slate-900 border-t border-red-900/50 flex justify-center">
                        <Button onClick={captureScreenAndAnalyze} className="w-full text-xs">
                          <Camera className="w-4 h-4 mr-1.5" />
                          Chụp Khung Hình & Phân Tích Ngay
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* STEP 2: Brand Tuning & Formula */}
            <div className="bg-white p-5 rounded-2xl border border-red-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-red-950 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-r from-red-500 to-red-600 text-white inline-flex items-center justify-center text-[11px] shadow-sm">2</span>
                  Cấu Hình Công Thức & Ghi Chú Riêng
                </label>
              </div>

              {/* Script Formula Selection */}
              {(selectedMode === AnalysisMode.REMAKE_SCRIPT || selectedMode === AnalysisMode.SCRIPT_GENERATION) && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-red-900 flex items-center gap-1">
                    <Sigma className="w-3.5 h-3.5 text-red-600" /> Cấu Trúc / Công Thức Kịch Bản:
                  </label>
                  <select 
                    value={selectedFormula}
                    onChange={(e) => setSelectedFormula(e.target.value as ScriptFormula)}
                    className="w-full bg-red-50/50 border border-red-200 text-slate-800 text-xs rounded-xl p-3 focus:border-red-500 focus:bg-white outline-none"
                  >
                    {(Object.keys(FORMULA_LABELS) as ScriptFormula[]).map((f) => (
                      <option key={f} value={f}>{FORMULA_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Text and screenshot inputs, shown only for features that use them */}
              {(featureConfig.sources.includes('text') || featureConfig.sources.includes('images')) && (
                <div className="space-y-4">
                  {featureConfig.sources.includes('text') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-red-900 flex items-center gap-1">
                      <PenTool className="w-3.5 h-3.5 text-red-600" /> {featureConfig.textLabel}
                    </label>
                    <textarea
                      className="w-full bg-red-50/40 border border-red-200 rounded-xl p-3 text-xs text-slate-800 focus:border-red-500 focus:bg-white outline-none h-40 resize-none custom-scrollbar placeholder:text-slate-400"
                      placeholder={featureConfig.textPlaceholder}
                      value={customUserPrompt}
                      onChange={(e) => setCustomUserPrompt(e.target.value)}
                    />
                  </div>
                  )}

                  {featureConfig.sources.includes('images') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-red-900 flex items-center gap-1">
                      <FileImage className="w-3.5 h-3.5 text-red-600" /> Ảnh chụp bài viết (có thể chọn nhiều ảnh):
                    </label>

                    <div className="relative border border-dashed border-red-300 rounded-xl p-4 bg-red-50/40 hover:bg-red-50/70 transition-colors text-center">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          handleArticleImagesSelect(e.target.files);
                          e.target.value = '';
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <UploadCloud className="w-6 h-6 text-red-600 mx-auto mb-1.5" />
                      <p className="text-xs font-semibold text-slate-800">Kéo thả hoặc chọn ảnh chụp bài viết</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        AI sẽ đọc chữ trong ảnh và phân tích cả bố cục, màu sắc, chữ trên ảnh
                      </p>
                    </div>

                    {articleImages.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        {articleImages.map((img, i) => (
                          <div key={img.previewUrl} className="relative group rounded-lg overflow-hidden border border-red-200 bg-white">
                            <img src={img.previewUrl} alt={`Ảnh bài viết ${i + 1}`} className="w-full h-20 object-cover" />
                            <button
                              onClick={() => removeArticleImage(i)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Xóa ảnh này"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {articleImages.length > 0 && (
                      <p className="text-[11px] text-emerald-700 font-medium">
                        Đã thêm {articleImages.length} ảnh — AI sẽ phân tích cả phần hình ảnh.
                      </p>
                    )}
                  </div>
                  )}
                </div>
              )}

              {/* Extra Instructions */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-red-900 flex items-center gap-1">
                  <FilePenLine className="w-3.5 h-3.5 text-red-600" /> Yêu cầu bổ sung đặc biệt (Tùy chọn):
                </label>
                <textarea 
                  className="w-full bg-red-50/40 border border-red-200 rounded-xl p-3 text-xs text-slate-800 focus:border-red-500 focus:bg-white outline-none h-20 resize-none custom-scrollbar placeholder:text-slate-400"
                  placeholder="VD: Nhấn mạnh vào sản phẩm chủ lực, thời lượng dưới 60s, giữ đúng xưng hô của brand..."
                  value={userInstructions}
                  onChange={(e) => setUserInstructions(e.target.value)}
                />
              </div>

              {/* ACTION TRIGGER BUTTON */}
              {!screenStream && (
                <Button 
                  onClick={handleAnalyze} 
                  disabled={loading.isLoading} 
                  className="w-full py-3.5 text-sm md:text-base font-bold shadow-md"
                >
                  {loading.isLoading && !urlInput && !userAssetData ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>{loading.message}</span>
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
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-3 animate-in fade-in shadow-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <div className="leading-relaxed">{error}</div>
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: Media Preview & Results */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* SOURCE MEDIA PREVIEW */}
            {fileData && (
              <div className="bg-white rounded-2xl overflow-hidden border border-red-200 shadow-sm relative group">
                <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-red-700 border border-red-300 flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  {fileData.videoMeta ? `${fileData.videoMeta.platform} · Đã tải về` : fileData.file ? 'File Gốc' : fileData.type === 'url' ? 'Web Link' : 'Nguồn Dữ Liệu'}
                </div>

                <div className="absolute top-3 right-3 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {fileData.previewUrl && !fileData.videoMeta && (
                    <button
                      onClick={downloadCurrentFile}
                      className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white p-2 rounded-full transition-all shadow-md"
                      title="Tải về máy"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={handleClearData}
                    className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full transition-colors shadow-md"
                    title="Xóa nguồn này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {fileData.videoMeta ? (
                  <div>
                    {fileData.videoMeta.thumbnail ? (
                      <img
                        src={fileData.videoMeta.thumbnail}
                        alt="Thumbnail video gốc"
                        className="w-full max-h-[300px] object-contain bg-slate-950"
                      />
                    ) : (
                      <div className="h-[120px] flex items-center justify-center bg-slate-950 text-red-300">
                        <Globe className="w-10 h-10" />
                      </div>
                    )}
                    <div className="p-4 space-y-2 bg-red-50/40">
                      <p className="text-sm font-semibold text-slate-900 line-clamp-2">
                        {fileData.videoMeta.title || '(Không có caption)'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fileData.videoMeta.uploader || 'Không rõ tác giả'}
                        {fileData.videoMeta.durationSec !== null && ` · ${fileData.videoMeta.durationSec}s`}
                        {` · ${(fileData.videoMeta.sizeBytes / 1024 / 1024).toFixed(1)}MB`}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 font-medium pt-1">
                        <span>👁 {fileData.videoMeta.viewCount?.toLocaleString('vi-VN') ?? '—'}</span>
                        <span>❤️ {fileData.videoMeta.likeCount?.toLocaleString('vi-VN') ?? '—'}</span>
                        <span>💬 {fileData.videoMeta.commentCount?.toLocaleString('vi-VN') ?? '—'}</span>
                        <span>🔁 {fileData.videoMeta.shareCount?.toLocaleString('vi-VN') ?? '—'}</span>
                      </div>
                      <p className="text-[11px] text-emerald-700 font-semibold pt-1">
                        ✓ Video đã được tải và gửi tới AI — phân tích dựa trên nội dung thật.
                      </p>
                    </div>
                  </div>
                ) : fileData.type === 'video' ? (
                  <video
                    src={fileData.previewUrl}
                    controls
                    className="w-full max-h-[340px] object-contain bg-slate-950"
                  />
                ) : fileData.type === 'audio' ? (
                  <div className="h-[160px] flex flex-col items-center justify-center bg-red-50/50 text-red-800 gap-3 px-8">
                    <Mic className="w-10 h-10 text-red-500" />
                    <audio src={fileData.previewUrl} controls className="w-full max-w-md" />
                    <p className="text-xs text-slate-500">{fileData.file?.name || 'File Âm Thanh'}</p>
                  </div>
                ) : fileData.type === 'url' ? (
                  <div className="h-[180px] flex flex-col items-center justify-center bg-red-50/50 text-red-800 gap-2.5 p-6">
                    <Globe className="w-10 h-10 text-red-500" />
                    <div className="text-center">
                      <p className="font-bold text-slate-900 text-sm">Đã kết nối Link Nguồn</p>
                      <p className="text-xs text-slate-500 truncate max-w-md mt-1 font-mono">{fileData.url}</p>
                    </div>
                  </div>
                ) : (
                  <img 
                    src={fileData.previewUrl} 
                    alt="Preview" 
                    className="w-full max-h-[340px] object-contain bg-slate-950" 
                  />
                )}
              </div>
            )}

            {/* RESULTS CONTAINER */}
            <div ref={resultRef} className="bg-white rounded-2xl border border-red-200 min-h-[500px] flex flex-col shadow-sm overflow-hidden">
              
              {/* Result Header */}
              <div className="p-4 border-b border-red-200 flex items-center justify-between bg-red-50/60">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-red-100 text-red-700 rounded-xl border border-red-300 shadow-sm">
                    <Sparkles className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                      Kết quả: {FEATURE_TITLES[selectedMode] || 'Phân tích AI'}
                    </h3>
                    <span className="text-[11px] text-slate-600 font-medium">
                      Áp dụng quy tắc: <strong className="text-red-700">{activeBrand.name}</strong>
                    </span>
                  </div>
                </div>

                {result && (
                  <div className="flex items-center flex-wrap gap-2">
                    <button 
                      onClick={handleExportExcel}
                      className="text-xs flex items-center gap-1.5 text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-300 transition-colors shadow-sm font-semibold"
                      title="Tải bảng phân tích chi tiết định dạng Excel / CSV"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Tải Excel (CSV)</span>
                    </button>
                    <button 
                      onClick={handleOpenGoogleSheets}
                      className="text-xs flex items-center gap-1.5 text-sky-800 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg border border-sky-300 transition-colors shadow-sm font-semibold"
                      title="Mở bảng dữ liệu trong Google Sheets (đã tự động sao chép để bạn chỉ cần dán Ctrl+V)"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-sky-600" />
                      <span>Mở Google Sheets</span>
                    </button>
                    <button 
                      onClick={exportAsTxt}
                      className="text-xs flex items-center gap-1 text-slate-700 hover:text-slate-900 bg-white hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 transition-colors font-medium shadow-sm"
                      title="Xuất file văn bản .txt"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      <span className="hidden sm:inline">Xuất .txt</span>
                    </button>
                    <button 
                      onClick={copyToClipboard}
                      className="text-xs flex items-center gap-1 text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-200" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Đã copy!" : "Copy Kịch Bản"}
                    </button>
                  </div>
                )}
              </div>
              
              {/* Result Body */}
              <div className="p-6 flex-1 overflow-y-auto max-h-[700px] custom-scrollbar bg-[#fdfafb]">
                {result ? (
                  <div className="space-y-6">
                    <div className="prose prose-slate max-w-none">
                      <div 
                        className="font-sans leading-relaxed text-xs md:text-sm space-y-4"
                        dangerouslySetInnerHTML={{ __html: result }}
                      />
                    </div>

                    {/* Thumbnail Remake Section if in THUMBNAIL_AUDIT */}
                    {selectedMode === AnalysisMode.THUMBNAIL_AUDIT && (
                      <div className="mt-8 border-t border-red-200 pt-6 animate-in fade-in">
                        <div className="flex items-center gap-2 mb-4 text-red-900">
                          <Wand2 className="w-5 h-5 text-red-600" />
                          <h3 className="text-base font-bold">Remake Thumbnail Cho Brand ({activeBrand.name})</h3>
                        </div>
                        
                        <div className="bg-white rounded-xl p-5 border border-red-200 shadow-sm space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-xs uppercase text-slate-700 font-bold">1. Upload ảnh khuôn mặt / Sản phẩm Brand của bạn</label>
                            <FileDropzone 
                              variant="mini" 
                              onFileSelect={handleUserAssetSelect} 
                              currentFile={userAssetData?.file || null}
                              label="Thả ảnh sản phẩm hoặc model của brand vào đây"
                            />
                          </div>
                          
                          <div className="space-y-1.5">
                            <label className="text-xs uppercase text-slate-700 font-bold">2. Tiêu đề chữ nổi trên Thumbnail</label>
                            <input 
                              type="text" 
                              className="w-full bg-red-50/40 border border-red-200 rounded-lg p-2.5 text-xs text-slate-800 focus:border-red-500 focus:bg-white outline-none"
                              placeholder={activeBrand.tagline || "VD: 1 CHẠM - 12H BẢO VỆ CHUẨN NHẬT..."}
                              value={thumbnailText}
                              onChange={(e) => setThumbnailText(e.target.value)}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs uppercase text-slate-700 font-bold">3. Tỉ lệ khung hình</label>
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={() => setAspectRatio('16:9')}
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-semibold transition-all ${aspectRatio === '16:9' ? 'bg-gradient-to-r from-red-500 to-red-600 border-red-400 text-white shadow-md' : 'bg-red-50/50 border-red-200 text-slate-700 hover:bg-red-100/60'}`}
                              >
                                16:9 (YouTube Video)
                              </button>
                              <button
                                onClick={() => setAspectRatio('9:16')}
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-semibold transition-all ${aspectRatio === '9:16' ? 'bg-gradient-to-r from-red-500 to-red-600 border-red-400 text-white shadow-md' : 'bg-red-50/50 border-red-200 text-slate-700 hover:bg-red-100/60'}`}
                              >
                                9:16 (TikTok / Reels / Shorts)
                              </button>
                            </div>
                          </div>

                          <Button 
                            onClick={handleRemakeThumbnail}
                            disabled={!userAssetData || loading.isLoading}
                            className="w-full text-xs py-2.5"
                          >
                            {loading.isLoading && userAssetData ? (
                              <><Loader2 className="animate-spin w-4 h-4"/> Đang render hình ảnh chuẩn brand...</>
                            ) : "Tạo Thumbnail Remake Mới"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {generatedImageUrl && (
                      <div className="mt-6 space-y-3 animate-in zoom-in-95 duration-500">
                        <h4 className="text-emerald-700 text-xs font-bold flex items-center gap-1.5">
                          <Check className="w-4 h-4 text-emerald-600" /> Thumbnail Remake Hoàn Tất Chuẩn Nhận Diện Brand
                        </h4>
                        <div className={`rounded-xl overflow-hidden border-2 border-red-400 shadow-xl relative group mx-auto ${aspectRatio === '9:16' ? 'max-w-[280px]' : 'w-full'}`}>
                          <img src={generatedImageUrl} alt="Generated Thumbnail" className="w-full h-auto" />
                          <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <a 
                              href={generatedImageUrl} 
                              download={`remake-thumbnail-${activeBrand.name.toLowerCase().replace(/\s+/g, '-')}.png`}
                              className="bg-white text-slate-900 px-5 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 hover:scale-105 transition-transform shadow-xl"
                            >
                              <Download className="w-4 h-4 text-red-600" /> Tải Thumbnail Về Máy
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-[380px] p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 mb-3 shadow-sm">
                      <Sparkles className="w-8 h-8 text-red-500" />
                    </div>
                    <h4 className="text-sm font-bold text-slate-800">Sẵn sàng: {FEATURE_TITLES[selectedMode] || 'Phân tích AI'}</h4>
                    <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
                      {featureConfig.subtitle} Điền nguồn ở cột bên trái rồi bấm chạy. Kết quả sẽ bám theo bản sắc của thương hiệu <strong>{activeBrand.name}</strong>.
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        </>
        )}

        </div>
        )}

        </main>
      </div>

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
