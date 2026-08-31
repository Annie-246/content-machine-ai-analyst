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
  // Real text read out of a link that holds no video - a Facebook or X text
  // post, a blog article. Sent to the model instead of asking it to guess.
  sourceText?: string;
  sourceTitle?: string;
  // Photos that came with the post. Creators often put the real message on the
  // image, so the caption alone is only half the story.
  sourceImages?: { base64: string; mimeType: string }[];
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

// ---------------------------------------------------------------------------
// Content Radar
//
// Mirrors the RadarContent JSDoc contract in server/radar/providers/types.mjs.
// Note the absence of `views`: Douyin reports playCount = 0 on every search
// row, so the Radar never claims a view count it does not have.

export type RadarPlatform = 'douyin';
export type RadarSortMode = 'recommended' | 'engagement' | 'latest';
export type RadarTimeWindow = '24h' | '72h' | '7d' | '14d' | '28d';
export type RadarMode = 'keyword' | 'creator';

export interface RadarCreatorRef {
  id: string | null;
  username: string | null;
  nickname: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
  profileUrl: string | null;
}

export interface RadarContent {
  id: string;
  platform: RadarPlatform;
  caption: string | null;
  publishedAt: string | null;
  creator: RadarCreatorRef;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    collects: number | null;
  };
  thumbnailUrl: string | null;
  videoUrl: string;
  hashtags: string[];
  duration: number | null;
  isAd: boolean | null;
  radarScore: number;
  radarSignals: {
    likeFollowerRatio: number | null;
    shareFollowerRatio: number | null;
  };
}

/** One creator offered for selection in competitor mode. */
export interface RadarCreatorCandidate extends RadarCreatorRef {
  ref: string;
}

/** A creator rolled up from the rows already on screen - never a fresh crawl. */
export interface RadarCreatorSummary extends RadarCreatorRef {
  key: string;
  contentCount: number;
  totalLikes: number;
  totalShares: number;
  averageLikes: number;
  bestRadarScore: number;
  bestContent: RadarContent | null;
}

export interface RadarScanResult {
  mode: RadarMode;
  platform: RadarPlatform;
  query: { original: string; effective: string; translated: boolean };
  timeWindow: RadarTimeWindow;
  limit: number;
  sort: RadarSortMode;
  /** Rows the provider billed us for, before the local time filter. */
  fetchedCount: number;
  items: RadarContent[];
  cached: boolean;
}
