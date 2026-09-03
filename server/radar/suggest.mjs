// Keyword suggestions.
//
// Most people know their topic but not the phrase creators are actually found
// under. This turns a broad topic into concrete search terms, grouped so the
// user can see WHY each one is there rather than guessing.
//
// Two things this had wrong before and must not get wrong again:
//
//   1. The prompt and the validator both hardcoded Chinese, from the days when
//      Douyin was the only platform. Searching YouTube for "chatgpt work"
//      answered with Chinese keywords, and the validator deleted any keyword
//      that was not Chinese - so fixing only one of the two would have shown
//      "no suggestions" instead.
//
//   2. An LLM happily invents keywords that read well and return nothing. A
//      suggestion of ours, "Shopee选品爆款", turned out to have zero videos in
//      seven days. The prompt now pushes against marketing-speak explicitly.
//
// Costs an LLM call, never a provider run: suggesting is free, scanning is not.

import { cacheGet, cacheSet } from './cache.mjs';
import { generateText } from './llm.mjs';
import { SUGGESTION_TIERS, SUGGESTION_TIER_IDS } from '../../services/radar/constants.mjs';

const SUGGEST_TIMEOUT_MS = 20_000;
const SUGGEST_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_SUGGESTIONS = 9;
const MAX_TOPIC_LENGTH = 100;
const MAX_SAMPLES = 12;
const MAX_KEYWORD_LENGTH = 60;

const TIER_IDS = SUGGESTION_TIER_IDS;

const PLATFORM_LABEL = {
  douyin: 'Douyin (抖音)',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
};

/** Douyin indexes Chinese; everywhere else, the user's own language wins. */
const languageRule = (platform) =>
  platform === 'douyin'
    ? 'Write every keyword in SIMPLIFIED CHINESE. Douyin only indexes Chinese, so an English or Vietnamese keyword returns nothing there.'
    : 'Write the keywords in the SAME LANGUAGE as the topic the user typed. If the brand audience clearly speaks another language, use that instead. Never answer in Chinese unless the user typed Chinese.';

/** Only the brand fields that say something about what to search for. */
const brandContext = (brand) => {
  if (!brand || typeof brand !== 'object') return '';

  const lines = [
    ['Industry', brand.industry],
    ['Target audience', brand.targetAudience],
    ['What they sell / USP', brand.coreUSPs],
    ['Positioning', brand.tagline],
    ['Extra notes', brand.customNotes],
  ]
    .map(([label, value]) => [label, String(value || '').trim().slice(0, 220)])
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);

  if (!lines.length) return '';
  return `\nThe user's brand, so suggestions fit their niche rather than the topic in general:\n${lines.join('\n')}\n`;
};

/** A short window wants what is moving now; a wide one wants what keeps working. */
const freshnessRule = (windowId) =>
  windowId === 'all' || windowId === '90d'
    ? 'The user is looking across a long period, so favour evergreen terms that keep producing content.'
    : 'The user is looking at a short recent window, so favour terms that creators are posting about right now.';

/**
 * Captions from the creator being filtered, when the user has already scanned
 * them. Nothing describes what a creator posts about like their own captions,
 * and guessing from a handle like "@nghecontent9699" describes nothing.
 */
const sampleContext = (samples) => {
  const lines = (samples || [])
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, MAX_SAMPLES);

  if (!lines.length) return '';
  return `
Captions this creator actually posted - draw the wording from these:
${lines.map((l) => `- ${l}`).join('\n')}
`;
};

/**
 * Filtering one creator's own videos is a different job from searching a
 * platform. The keyword is matched against captions and hashtags, so a
 * three-word marketing phrase matches nothing: what works is the one or two
 * words that creator types themselves.
 */
const scopeRule = (scope) =>
  scope === 'creator'
    ? `The user is NOT searching the platform. They are filtering ONE creator's own videos by
keyword, matched against the caption and hashtags. So:
- Keep every keyword to 1-2 words. A long phrase will match none of their captions.
- Prefer the plain words a creator types in a caption over topic labels.
- Suggest angles this creator plausibly covers, not the whole niche.`
    : `The user wants to FIND CONTENT to study, not to rank in search. Suggest the terms
that creators in this niche are actually found under.`;

const buildPrompt = ({ topic, platform, brand, windowId, scope, samples }) => `You are a keyword strategist for social content discovery on ${PLATFORM_LABEL[platform] || platform}.

${scopeRule(scope)}
${brandContext(brand)}${sampleContext(samples)}
${languageRule(platform)}
${freshnessRule(windowId)}

Return ${MAX_SUGGESTIONS} keywords across three tiers:
- "chinh" (2-3): broad, high-volume, shows the mainstream of this topic.
- "phu" (3-4): narrower and specific to the user's niche.
- "mo-rong" (2): an adjacent angle the user probably has not considered.

Avoid:
- The user's own brand name.
- Single ultra-generic words like "marketing" or "AI" that match half the platform.
- Marketing-speak that sounds impressive but no creator actually posts under. If a
  phrase would return almost nothing, it is a bad suggestion no matter how apt it reads.

Return JSON only, an array of objects:
[{"keyword": "<search term>", "tier": "chinh|phu|mo-rong", "note": "<Vietnamese gloss, max 6 words>", "why": "<Vietnamese, max 12 words, why this is worth scanning>"}]

No markdown, no code fence, no explanation.

Topic the user typed: ${topic}`;

// ---------------------------------------------------------------------------
// parsing

/** Models sometimes wrap JSON in a fence despite being told not to. */
export const parseJsonArray = (text) => {
  const cleaned = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Fall back to the first bracketed block in a chattier answer.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
};

const CJK_RE = /[一-鿿]/;

export const hasCJK = (text) => CJK_RE.test(text || '');

/**
 * Keeps only entries usable as a query on THIS platform.
 *
 * The language check runs both ways: Douyin needs Chinese, and everywhere else
 * Chinese is rejected unless the user typed Chinese themselves. That second half
 * is the guard that was missing when a YouTube search answered in Chinese.
 */
export const acceptSuggestions = (rows, { platform = 'douyin', topic = '' } = {}) => {
  const topicIsCJK = hasCJK(topic);
  const perTier = new Map(SUGGESTION_TIERS.map((t) => [t.id, 0]));

  const out = [];
  const seen = new Set();

  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;

    const keyword = String(row.keyword || '').trim().replace(/^["'#]+|["']+$/g, '');
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) continue;

    if (platform === 'douyin') {
      if (!hasCJK(keyword)) continue;
    } else if (hasCJK(keyword) && !topicIsCJK) {
      continue;
    }

    const dedupe = keyword.toLowerCase();
    if (seen.has(dedupe)) continue;
    // Echoing the topic back teaches the user nothing.
    if (dedupe === String(topic || '').trim().toLowerCase()) continue;

    const tier = TIER_IDS.includes(row.tier) ? row.tier : 'phu';
    const cap = SUGGESTION_TIERS.find((t) => t.id === tier)?.max ?? 3;
    if (perTier.get(tier) >= cap) continue;

    perTier.set(tier, perTier.get(tier) + 1);
    seen.add(dedupe);
    out.push({
      keyword,
      tier,
      note: String(row.note || '').trim().slice(0, 60) || null,
      why: String(row.why || '').trim().slice(0, 90) || null,
    });

    if (out.length >= MAX_SUGGESTIONS) break;
  }

  // Group order follows SUGGESTION_TIERS so the UI never has to sort.
  return out.sort((a, b) => TIER_IDS.indexOf(a.tier) - TIER_IDS.indexOf(b.tier));
};

// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{topic, platform, suggestions, cached}>}
 */
export const suggestKeywords = async (
  { topic, platform = 'douyin', brand = null, windowId = '7d', scope = 'search', samples = [] },
  apiKey
) => {
  const trimmed = (topic || '').trim().slice(0, MAX_TOPIC_LENGTH);
  if (!trimmed) return { topic: trimmed, platform, suggestions: [], cached: false };

  // The brand shapes the answer, so it has to shape the cache key too - a
  // different brand asking the same topic must not get the first one's niche.
  const brandKey = brand ? `${brand.id || ''}:${String(brand.industry || '').slice(0, 40)}` : '-';
  // Captions are part of the answer, so a scan of a different creator must not
  // be served the previous one's suggestions.
  const sampleKey = samples.length ? String(samples.length) + ':' + String(samples[0] || '').slice(0, 40) : '-';
  const cacheKey = `radar:suggest:${platform}:${scope}:${brandKey}:${sampleKey}:${windowId}:${trimmed.toLowerCase()}`;

  const cached = cacheGet(cacheKey);
  if (cached) return { topic: trimmed, platform, suggestions: cached, cached: true };

  const key = (apiKey || '').trim() || process.env.GEMINI_API_KEY || '';
  const text = await generateText(key, buildPrompt({ topic: trimmed, platform, brand, windowId, scope, samples }), {
    timeoutMs: SUGGEST_TIMEOUT_MS,
    config: { responseMimeType: 'application/json' },
  });

  const suggestions = acceptSuggestions(parseJsonArray(text), { platform, topic: trimmed });
  if (suggestions.length) cacheSet(cacheKey, suggestions, SUGGEST_TTL_MS);

  return { topic: trimmed, platform, suggestions, cached: false };
};
