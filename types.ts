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
  ARTICLE_WRITING = 'ARTICLE_WRITING',
  CONTENT_WATERFALL = 'CONTENT_WATERFALL',
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

/**
 * Một bộ tiêu chí chấm điểm do người dùng tự soạn.
 *
 * `criteria` cố tình để dạng văn bản tự do thay vì danh sách có cấu trúc: mỗi
 * người chấm bài theo một kiểu, có người dùng thang 10, có người dùng đạt/không
 * đạt, có người ghi cả trọng số. Ép vào một khuôn cứng chỉ khiến họ phải viết
 * lại bộ tiêu chí sẵn có của mình cho vừa cái form.
 */
export interface ScoringChecklist {
  id: string;
  name: string;
  /** Bộ này dùng để chấm loại nội dung nào. */
  kind: 'article' | 'video' | 'both';
  description?: string;
  criteria: string;
  updatedAt: number;
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
  // How many reader comments came back, so a thin read is visible rather than
  // silently assumed to be the whole conversation.
  commentCount?: number;
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
// Content Waterfall
//
// One source becomes a map of distinct content opportunities for one brand.
// The knobs the user actually turns per run - everything else about the brand
// already lives in BrandProfile and is not asked for twice.

export interface WaterfallOptions {
  /** How many ideas to aim for. The model returns fewer rather than pad. */
  ideaCount: number;
  /** Free text: preferred channels and formats, e.g. "TikTok, Facebook, carousel". */
  channels: string;
  objective: WaterfallObjective;
}

export type WaterfallObjective = 'auto' | 'reach' | 'engagement' | 'trust' | 'consideration' | 'conversion' | 'retention';

export const WATERFALL_OBJECTIVE_LABELS: Record<WaterfallObjective, string> = {
  auto: '⚡ AI tự chọn mục tiêu phù hợp cho từng ý tưởng',
  reach: '📡 Reach (Phủ rộng, tiếp cận người mới)',
  engagement: '💬 Engagement (Tương tác, bình luận, chia sẻ)',
  trust: '🤝 Trust & Authority (Xây uy tín chuyên môn)',
  consideration: '🔍 Consideration (Cân nhắc, so sánh, tìm hiểu sâu)',
  conversion: '🛒 Conversion (Thúc đẩy hành động, chốt đơn)',
  retention: '♻️ Retention (Giữ chân khách cũ, cộng đồng)',
};

// ---------------------------------------------------------------------------
// Content Radar
//
// Mirrors the RadarContent JSDoc contract in server/radar/providers/types.mjs.
// `metrics.views` is nullable on purpose: YouTube reports a real view count,
// while Douyin and TikTok search rows carry 0 or nothing. Null means "unknown"
// and is never rendered, so the Radar shows no view count it does not have.

export type RadarPlatform = 'douyin' | 'tiktok' | 'youtube' | 'instagram';
export type RadarSortMode = 'recommended' | 'engagement' | 'latest';
export type RadarTimeWindow = '24h' | '72h' | '7d' | '14d' | '28d' | '90d' | 'all';
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
    /** null when the platform does not publish a trustworthy view count. */
    views: number | null;
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

/** One keyword inside a scan, and how it did. */
export interface RadarQuerySummary {
  original: string;
  effective: string;
  translated: boolean;
  /** New videos this keyword contributed, after de-duplication. */
  matched: number;
  failed: boolean;
}

export interface RadarScanResult {
  mode: RadarMode;
  platform: RadarPlatform;
  source?: string;
  /** The first keyword, kept so single-keyword callers still work. */
  query: { original: string; effective: string; translated: boolean } | null;
  /** Every keyword the scan ran, in order. */
  queries?: RadarQuerySummary[];
  /** Keywords that failed, with the reason. The rest of the scan still stands. */
  failures?: { keyword: string; error: string }[];
  timeWindow: RadarTimeWindow;
  /** Per keyword, not across the scan. */
  limit: number;
  sort: RadarSortMode;
  /** Rows the provider returned, before de-duplication and the time filter. */
  fetchedCount: number;
  /**
   * Competitor mode with a keyword or a metric floor: how many of the creator's
   * videos were read to find the matches. Absent when nothing narrowed the scan.
   */
  scannedCount?: number;
  /** The metric floor that was applied, when the user set one. */
  thresholds?: { minViews: number; minLikes: number };
  /**
   * Videos the platform reported no view count for. Without this, a view floor
   * that returns nothing looks like the creator has no popular videos.
   */
  missingViews?: number;
  /** Videos with no publish date - every bounded time window drops these. */
  undatedCount?: number;
  /** Provider calls actually billed - cached keywords cost nothing. */
  billedCalls?: number;
  items: RadarContent[];
  cached: boolean;
}
