// Shared Content Radar constants.
//
// Plain .mjs for the same reason server/handlers.mjs is: the production server
// runs it under node without a build step, while Vite bundles it for the
// browser. One definition, so the dropdowns the user sees and the validation
// the server enforces can never drift apart.

/** Platforms the Radar can query. V1 ships Douyin only. */
export const PLATFORMS = [
  { id: 'douyin', label: 'Douyin', available: true },
];

export const DEFAULT_PLATFORM = 'douyin';

/** How far back a scan looks. `hours` drives the local publishedAt filter. */
export const TIME_WINDOWS = [
  { id: '24h', label: '24 giờ', hours: 24 },
  { id: '72h', label: '72 giờ', hours: 72 },
  { id: '7d', label: '7 ngày', hours: 24 * 7 },
  { id: '14d', label: '14 ngày', hours: 24 * 14 },
  { id: '28d', label: '28 ngày', hours: 24 * 28 },
];

export const DEFAULT_TIME_WINDOW = '7d';

export const getTimeWindow = (id) => TIME_WINDOWS.find((w) => w.id === id) || null;

/**
 * Result caps the user can pick. This is a ceiling on how many raw rows we ask
 * the provider for - each row costs money - never a promise of how many survive
 * the local time filter.
 */
export const RESULT_LIMITS = [10, 20, 50];
export const DEFAULT_RESULT_LIMIT = 20;
export const MAX_RESULT_LIMIT = 50;

export const SORT_MODES = [
  { id: 'recommended', label: 'Đề xuất' },
  { id: 'engagement', label: 'Nhiều tương tác' },
  { id: 'latest', label: 'Mới nhất' },
];

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
};

/**
 * Ceilings for the log curve. A metric at its cap scores ~1.0; beyond it the
 * curve flattens instead of letting one viral outlier compress everything else
 * into the bottom of the range.
 */
export const RADAR_CAPS = {
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

/** Hours after which the recency component halves. */
export const RECENCY_HALF_LIFE_HOURS = 72;

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
