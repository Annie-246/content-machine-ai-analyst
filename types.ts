export enum AnalysisMode {
  REMAKE_SCRIPT = 'REMAKE_SCRIPT',
  DEEP_ANALYSIS = 'DEEP_ANALYSIS',
  SCRIPT_EXTRACT = 'SCRIPT_EXTRACT',
  CONTENT_AUDIT = 'CONTENT_AUDIT',
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  THUMBNAIL_AUDIT = 'THUMBNAIL_AUDIT',
  THUMBNAIL_GENERATE = 'THUMBNAIL_GENERATE',
  CONTENT_REMAKE = 'CONTENT_REMAKE',
  ARTICLE_ANALYSIS = 'ARTICLE_ANALYSIS',
  VIDEO_SCORING = 'VIDEO_SCORING',
  ARTICLE_SCORING = 'ARTICLE_SCORING',
}

export interface BrandProfile {
  id: string;
  name: string;
  industry: string;
  tagline: string;
  targetAudience: string;
  speakerPersona: string;
  addressingSpeaker: string;
  addressingAudience: string;
  brandVoiceTone: string;
  coreUSPs: string;
  callToAction: string;
  forbiddenKeywords: string;
  customNotes?: string;
  // Khối footer cố định chèn nguyên văn ở cuối bài đăng social (nếu thương hiệu có).
  footerBlock?: string;
  // Bộ hashtag mặc định gợi ý kèm bài đăng.
  hashtags?: string;
}

export interface AnalysisResult {
  markdown: string;
  timestamp: Date;
}

export interface VideoMeta {
  id: string;
  platform: string;
  title: string;
  description: string;
  hashtags: string[];
  durationSec: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  uploader: string;
  uploadDate: string;
  soundtrack: string;
  thumbnail: string;
  webpageUrl: string;
  sizeBytes: number;
}

export interface FileData {
  file: File | null;
  previewUrl: string;
  type: 'video' | 'image' | 'url' | 'audio';
  base64: string;
  mimeType: string;
  url?: string;
  // Set when the source was pulled from a social link and uploaded to the Gemini Files API.
  fileUri?: string;
  videoMeta?: VideoMeta;
}

export interface LoadingState {
  isLoading: boolean;
  message: string;
  step?: number;
}

export type ScriptFormula = 'auto' | 'pas' | 'aida' | 'storytelling' | 'educational' | 'before_after' | 'hero_journey';

export const FORMULA_LABELS: Record<ScriptFormula, string> = {
  auto: '⚡ AI Tự Chọn (Cấu trúc giữ chân tối đa)',
  pas: '🔥 PAS (Nỗi đau - Xoáy sâu - Giải pháp của Brand)',
  aida: '📣 AIDA (Thu hút - Thích thú - Khao khát - Kêu gọi)',
  storytelling: '📖 Storytelling (Kể chuyện chân thực, giàu cảm xúc)',
  educational: '🧠 Educational (Chia sẻ giá trị / Tips 3 bước)',
  before_after: '🔄 Before - After (Trước & Sau khi trải nghiệm)',
  hero_journey: '🚀 Hero Journey (Hành trình vượt khó & Đột phá)'
};
