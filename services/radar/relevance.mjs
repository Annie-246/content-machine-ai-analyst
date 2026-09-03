// Keyword matching for competitor mode.
//
// The endpoints that list one creator's videos take no keyword - TikTok's
// fetch_user_post_videos, Douyin's user posts, Instagram's user reels all just
// return the latest N. So filtering by keyword there means filtering here, on
// the captions and hashtags already downloaded. YouTube is the exception: its
// search call takes `q` alongside channelId, so it filters upstream and never
// comes through this file.
//
// Diacritics are stripped on both sides. Vietnamese creators caption in both
// "kịch bản" and "kich ban", and a filter that misses half of them is worse
// than no filter.

const stripDiacritics = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'));

export const normalizeText = (value) =>
  stripDiacritics(value).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The words a row has to contain. Punctuation and the # of a hashtag are
 * separators, so "kịch bản" matches "#kichban" as two tokens against the
 * joined text.
 */
export const keywordTokens = (keyword) =>
  normalizeText(keyword)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Caption plus hashtags - what the video itself says, not who posted it. */
export const contentText = (content) =>
  normalizeText([content?.caption || '', ...(content?.hashtags || [])].join(' '))
    // Hashtags arrive glued ("#kichbanvideo"), so the separators go too and
    // matching runs against a continuous string.
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * One-letter tokens are dropped before matching: "ý" in "ý tưởng" becomes "y",
 * which occurs inside half the words in a Vietnamese caption and would let
 * anything through.
 */
const significantTokens = (tokens) => {
  const kept = tokens.filter((t) => t.length > 1);
  return kept.length ? kept : tokens;
};

/**
 * How many tokens a caption has to carry.
 *
 * Requiring all of them looked right and was wrong in practice: a creator
 * writes "3 cách ra ý tưởng content", the user types "cách tìm ý tưởng", and an
 * exact-AND filter returns nothing on a channel full of matching videos. Two
 * thirds is strict enough that "Tìm content viral" still refuses to match
 * everything tagged #viral - one token out of three is not a match.
 */
const MATCH_RATIO = 2 / 3;

export const requiredMatches = (tokenCount) => Math.max(1, Math.ceil(tokenCount * MATCH_RATIO));

export const matchesKeyword = (content, keyword) => {
  const tokens = significantTokens(keywordTokens(keyword));
  if (!tokens.length) return true;

  const text = contentText(content);
  // The phrase itself, written as one run of letters - always a match.
  if (text.includes(tokens.join(''))) return true;

  const hits = tokens.filter((token) => text.includes(token)).length;
  return hits >= requiredMatches(tokens.length);
};

export const filterByKeyword = (items, keyword) => {
  if (!keywordTokens(keyword).length) return items || [];
  return (items || []).filter((item) => matchesKeyword(item, keyword));
};

// ---------------------------------------------------------------------------
// Metric thresholds
//
// "Their videos from the last 7 days that broke 100k views" - a floor on the
// numbers, applied after the time window so the two read as one question.

const toNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A row whose view count the platform never reported cannot prove it cleared
 * the floor, so it does not. Douyin and TikTok search rows carry no play count
 * at all - the caller is expected to say so rather than let the list look empty
 * for no reason.
 */
export const meetsThresholds = (content, { minViews = 0, minLikes = 0 } = {}) => {
  if (minViews > 0) {
    const views = toNumber(content?.metrics?.views);
    if (views === null || views < minViews) return false;
  }
  if (minLikes > 0) {
    const likes = toNumber(content?.metrics?.likes);
    if (likes === null || likes < minLikes) return false;
  }
  return true;
};

export const filterByThresholds = (items, thresholds = {}) => {
  const { minViews = 0, minLikes = 0 } = thresholds;
  if (minViews <= 0 && minLikes <= 0) return items || [];
  return (items || []).filter((item) => meetsThresholds(item, { minViews, minLikes }));
};

/** How many rows the platform gave no view count for - drives the UI's warning. */
export const countMissingViews = (items) =>
  (items || []).filter((item) => toNumber(item?.metrics?.views) === null).length;

/** Rows with no publish date at all: any bounded window silently drops these. */
export const countUndated = (items) =>
  (items || []).filter((item) => !item?.publishedAt || Number.isNaN(Date.parse(item.publishedAt))).length;
