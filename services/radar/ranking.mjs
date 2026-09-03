// Radar Score: deterministic code, no LLM, no view counts.
//
// Douyin does not publish play counts in search results (the spike measured
// playCount = 0 on every row), so the score is built from the engagement that
// IS reported, weighed against how big the creator's audience already is.
// A 1.8k-follower account pulling 8.8k likes has to outrank a 14.8M-follower
// account pulling 6.8k likes - that is the whole point of the feature.

import {
  RADAR_WEIGHTS, RADAR_CAPS, BREAKOUT_MIX, RECENCY_HALF_LIFE_HOURS, ENGAGEMENT_WEIGHTS,
} from './constants.mjs';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

const toNumber = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * Compress an unbounded count onto 0..1. Log so the gap between 10 and 100
 * matters as much as the gap between 1,000 and 10,000, capped so a single
 * mega-viral row cannot flatten the rest of the list.
 */
const logScore = (value, cap) => {
  const n = toNumber(value);
  if (n === null || n <= 0) return 0;
  return clamp01(Math.log1p(n) / Math.log1p(cap));
};

/**
 * Ratios need the same treatment but are fractional, so scale into percent
 * first - otherwise every real value sits in the flat part of log1p.
 */
const ratioScore = (ratio, cap) => {
  if (ratio === null || ratio <= 0) return 0;
  return clamp01(Math.log1p(ratio * 100) / Math.log1p(cap * 100));
};

/** Age in hours, or null when the row carries no usable publish date. */
export const ageInHours = (publishedAt, now = Date.now()) => {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
};

/**
 * Fresh content scores 1 and halves every `halfLife` hours.
 *
 * `halfLife === null` means the caller asked for no time window at all, so
 * recency is not a signal: it returns null and drops out of the weighted total
 * instead of scoring every video 0 and deflating the whole list.
 */
const recencyScore = (hours, halfLife) => {
  if (hours === null || halfLife === null) return null;
  return clamp01(Math.pow(0.5, hours / halfLife));
};

/**
 * The two creator-relative signals surfaced in the UI. Guarding the divisor at
 * 1 keeps a follower count of 0 or null from producing Infinity.
 */
export const computeSignals = (metrics, followerCount) => {
  const followers = Math.max(toNumber(followerCount) ?? 0, 1);
  const likes = toNumber(metrics?.likes);
  const shares = toNumber(metrics?.shares);

  return {
    likeFollowerRatio: likes === null ? null : likes / followers,
    shareFollowerRatio: shares === null ? null : shares / followers,
  };
};

/**
 * Radar Score, 0-100.
 *
 * Each component is scored 0..1 independently, then combined by RADAR_WEIGHTS.
 * Components whose input is missing are dropped from BOTH the numerator and the
 * weight total, so a provider that cannot report collects yields comparable
 * scores rather than uniformly deflated ones.
 *
 * @param {number|null|undefined} halfLifeHours hours for the recency half-life.
 *   `undefined` keeps the standalone default; `null` scores without recency.
 */
export const computeRadarScore = (content, now = Date.now(), halfLifeHours = RECENCY_HALF_LIFE_HOURS) => {
  const metrics = content?.metrics || {};
  const followerCount = content?.creator?.followerCount;
  const signals = computeSignals(metrics, followerCount);

  // Breakout only means something when we know how big the audience is.
  const hasFollowers = toNumber(followerCount) !== null;
  const breakout = hasFollowers
    ? clamp01(
        BREAKOUT_MIX.like * ratioScore(signals.likeFollowerRatio, RADAR_CAPS.likeFollowerRatio) +
        BREAKOUT_MIX.share * ratioScore(signals.shareFollowerRatio, RADAR_CAPS.shareFollowerRatio)
      )
    : null;

  const hours = ageInHours(content?.publishedAt, now);

  const components = [
    [RADAR_WEIGHTS.breakout, breakout],
    // null when the platform does not report views - see RADAR_WEIGHTS.views.
    [RADAR_WEIGHTS.views, toNumber(metrics.views) === null ? null : logScore(metrics.views, RADAR_CAPS.views)],
    [RADAR_WEIGHTS.likes, toNumber(metrics.likes) === null ? null : logScore(metrics.likes, RADAR_CAPS.likes)],
    [RADAR_WEIGHTS.shares, toNumber(metrics.shares) === null ? null : logScore(metrics.shares, RADAR_CAPS.shares)],
    [RADAR_WEIGHTS.collects, toNumber(metrics.collects) === null ? null : logScore(metrics.collects, RADAR_CAPS.collects)],
    [RADAR_WEIGHTS.comments, toNumber(metrics.comments) === null ? null : logScore(metrics.comments, RADAR_CAPS.comments)],
    [RADAR_WEIGHTS.recency, recencyScore(hours, halfLifeHours)],
  ];

  let weighted = 0;
  let totalWeight = 0;
  for (const [weight, value] of components) {
    if (value === null) continue;
    weighted += weight * value;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weighted / totalWeight) * 1000) / 10;
};

/**
 * Raw engagement volume, used by the "Nhiều tương tác" sort and as the
 * tie-breaker elsewhere. Deliberately NOT audience-relative - that is what the
 * Radar Score is for, and users asking for "most engagement" mean the raw pile.
 */
export const engagementVolume = (content) => {
  const m = content?.metrics || {};
  return (
    (toNumber(m.likes) ?? 0) * ENGAGEMENT_WEIGHTS.likes +
    (toNumber(m.comments) ?? 0) * ENGAGEMENT_WEIGHTS.comments +
    (toNumber(m.shares) ?? 0) * ENGAGEMENT_WEIGHTS.shares +
    (toNumber(m.collects) ?? 0) * ENGAGEMENT_WEIGHTS.collects
  );
};

/** Attaches radarScore + radarSignals to a normalized content row. */
export const withRadarScore = (content, now = Date.now(), halfLifeHours = RECENCY_HALF_LIFE_HOURS) => ({
  ...content,
  radarScore: computeRadarScore(content, now, halfLifeHours),
  radarSignals: computeSignals(content?.metrics, content?.creator?.followerCount),
});
