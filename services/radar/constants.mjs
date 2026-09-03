// Shared Content Radar constants.
//
// Plain .mjs for the same reason server/handlers.mjs is: the production server
// runs it under node without a build step, while Vite bundles it for the
// browser. One definition, so the dropdowns the user sees and the validation
// the server enforces can never drift apart.

/** Platforms the Radar can query. */
export const PLATFORMS = [
  { id: 'douyin', label: 'Douyin', available: true },
  { id: 'tiktok', label: 'TikTok', available: true },
  { id: 'youtube', label: 'YouTube', available: true },
  { id: 'instagram', label: 'Instagram', available: true },
];

export const DEFAULT_PLATFORM = 'douyin';

/**
 * How far back a scan looks. `hours` drives the local publishedAt filter;
 * `hours: null` means no filter at all.
 *
 * The long windows matter more than they look. A niche keyword can be popular
 * yet publish rarely - measured on Douyin, "Shopee选品爆款" has viral videos at
 * 25, 34 and 155 days old and NOTHING inside 7 days. Without a wide option the
 * Radar would report that topic as dead.
 */
export const TIME_WINDOWS = [
  { id: '24h', label: '24 giờ', hours: 24 },
  { id: '72h', label: '72 giờ', hours: 72 },
  { id: '7d', label: '7 ngày', hours: 24 * 7 },
  { id: '14d', label: '14 ngày', hours: 24 * 14 },
  { id: '28d', label: '28 ngày', hours: 24 * 28 },
  { id: '90d', label: '90 ngày', hours: 24 * 90 },
  { id: 'all', label: 'Không giới hạn', hours: null },
];

export const DEFAULT_TIME_WINDOW = '7d';

export const getTimeWindow = (id) => TIME_WINDOWS.find((w) => w.id === id) || null;

/**
 * Result caps the user can pick. This is a ceiling on how many raw rows we ask
 * the provider for - each row costs money - never a promise of how many survive
 * the local time filter.
 */
/** Quick presets. The field also accepts any number in [MIN, MAX]. */
export const RESULT_LIMITS = [10, 20, 50];
export const DEFAULT_RESULT_LIMIT = 20;
export const MIN_RESULT_LIMIT = 1;
export const MAX_RESULT_LIMIT = 50;

/**
 * How many keywords one scan may carry. Each keyword is its own provider call,
 * so this is the ceiling on what one click can spend.
 */
export const MAX_KEYWORDS = 5;

/**
 * A per-request provider hands back a fixed-size page - measured at 7 rows for
 * TikHub's Douyin search, which takes no page-size parameter. To honour a limit
 * above that the Radar has to ask for another page, and each page is billed
 * again, so the number of pages is capped hard.
 */
export const PROVIDER_PAGE_SIZE = 7;
export const MAX_PAGES_PER_KEYWORD = 4;

/** Provider calls one keyword will cost at this limit. Shown before scanning. */
export const pagesNeeded = (limit) =>
  Math.min(Math.max(Math.ceil(clampLimit(limit) / PROVIDER_PAGE_SIZE), 1), MAX_PAGES_PER_KEYWORD);

/**
 * Same clamp on the browser and on the server, so the UI never promises more
 * than it gets.
 *
 * An empty field means "I have not chosen", not "give me one": Number('') is 0,
 * which would otherwise clamp to the minimum and quietly scan a single video.
 */
export const clampLimit = (value) => {
  if (typeof value === 'string' && !value.trim()) return DEFAULT_RESULT_LIMIT;
  if (value === null || value === undefined) return DEFAULT_RESULT_LIMIT;

  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_RESULT_LIMIT;
  return Math.min(Math.max(n, MIN_RESULT_LIMIT), MAX_RESULT_LIMIT);
};

export const SORT_MODES = [
  { id: 'recommended', label: 'Đề xuất' },
  { id: 'engagement', label: 'Nhiều tương tác' },
  { id: 'latest', label: 'Mới nhất' },
];

/** The two ways competitor mode can read a creator's page. */
export const CREATOR_SCAN_MODES = [
  { id: 'best', label: 'Video tốt nhất', hint: 'Lấy video gần đây, xếp theo sức hút' },
  { id: 'keyword', label: 'Theo từ khoá', hint: 'Chỉ giữ video nói về chủ đề bạn nhập' },
];

export const DEFAULT_CREATOR_SCAN_MODE = 'best';

/**
 * How many of a creator's videos to pull before filtering by keyword.
 *
 * The endpoints that list a creator's posts take no keyword, so the filter runs
 * locally - and filtering the 3 latest videos would almost always return
 * nothing. One page is one billed call whatever its size, so this asks for the
 * page the provider caps at rather than the handful the user wants to see.
 */
export const CREATOR_KEYWORD_SCAN_LIMIT = 50;

/**
 * How many pages of a creator's feed a keyword scan may read.
 *
 * TikHub hands back ~10 videos per page whatever `count` asks for, so one page
 * covers about two weeks of an active creator - not enough to answer "have they
 * ever covered this topic". Each page is billed, hence the hard cap.
 */
export const CREATOR_KEYWORD_MAX_PAGES = 4;

export const DEFAULT_SORT_MODE = 'recommended';

// ---------------------------------------------------------------------------
// Radar Score configuration.
//
// Kept in one object so tuning the ranking is a single edit, never a hunt
// through the formula. Weights are relative; they are renormalised at runtime
// over whichever components actually have data, so a provider that cannot
// supply (say) collects does not silently drag every score down.

export const RADAR_WEIGHTS = {
  /** Engagement relative to audience size - the "small creator broke out" signal. */
  breakout: 0.35,
  likes: 0.20,
  shares: 0.15,
  collects: 0.10,
  comments: 0.05,
  recency: 0.15,
  /**
   * Only YouTube reports a trustworthy view count; Douyin and TikTok search
   * results carry 0 or nothing. A platform that cannot supply it passes null and
   * the component drops out of the weighting entirely, so scores stay
   * comparable instead of every Douyin row losing this slice.
   */
  views: 0.15,
};

/**
 * Ceilings for the log curve. A metric at its cap scores ~1.0; beyond it the
 * curve flattens instead of letting one viral outlier compress everything else
 * into the bottom of the range.
 */
export const RADAR_CAPS = {
  views: 5_000_000,
  likes: 100_000,
  shares: 20_000,
  collects: 20_000,
  comments: 5_000,
  /** likes per follower. 5 = 500%, already exceptional. */
  likeFollowerRatio: 5,
  /** shares per follower. 1 = 100%. */
  shareFollowerRatio: 1,
};

/** Inside the breakout component, how likes and shares split the credit. */
export const BREAKOUT_MIX = { like: 0.6, share: 0.4 };

/**
 * Hours after which the recency component halves, when no window is given.
 *
 * A fixed half-life only discriminates inside the first couple of weeks: at 28
 * days it scores 0.0016 and past 90 days it is 0.000000 for everything. On a
 * long window that makes recency dead weight - it stops ranking anything while
 * still consuming its share of the score. So the half-life scales with the
 * window the user actually chose, and on "Không giới hạn" recency is dropped
 * from the formula entirely rather than deflating every result equally.
 */
export const RECENCY_HALF_LIFE_HOURS = 72;

/** Half-life as a fraction of the selected window. */
export const RECENCY_HALF_LIFE_FRACTION = 0.25;

/** Floor, so a 24h window still spreads its videos out instead of collapsing. */
export const MIN_RECENCY_HALF_LIFE_HOURS = 2;

/**
 * The half-life to use for a window, in hours.
 * `null` means "no window" - recency should not be scored at all.
 */
export const recencyHalfLife = (windowHours) => {
  if (windowHours === null || windowHours === undefined) return null;
  return Math.max(windowHours * RECENCY_HALF_LIFE_FRACTION, MIN_RECENCY_HALF_LIFE_HOURS);
};

/**
 * Weights for the "Nhiều tương tác" sort. Shares and collects count for more
 * than a like because they cost the viewer something: a share spends social
 * capital, a collect is an explicit "I want this later".
 */
export const ENGAGEMENT_WEIGHTS = {
  likes: 1,
  comments: 2,
  shares: 4,
  collects: 3,
};

/**
 * How AI keyword suggestions are grouped. Shared so the prompt that asks for the
 * tiers and the UI that renders them can never disagree about the ids.
 *
 * The axis is discovery breadth, not SEO: a user cannot tell by looking whether
 * a keyword is a safe broad bet or a narrow gamble, so the grouping says it.
 */
export const SUGGESTION_TIERS = [
  { id: 'chinh', label: 'Từ khoá chính', hint: 'Rộng, nhiều kết quả, thấy mặt bằng chung', max: 3 },
  { id: 'phu', label: 'Từ khoá phụ', hint: 'Hẹp hơn, đúng ngách của bạn', max: 4 },
  { id: 'mo-rong', label: 'Mở rộng', hint: 'Góc tiếp cận có thể bạn chưa nghĩ tới', max: 2 },
];

export const SUGGESTION_TIER_IDS = SUGGESTION_TIERS.map((t) => t.id);
