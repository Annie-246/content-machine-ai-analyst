import { postJson } from './apiClient';
import { getGeminiApiKey, getPlatformSource, getRadarKeys } from './apiKeyStore';
import type {
  BrandProfile, RadarContent, RadarCreatorCandidate, RadarPlatform, RadarScanResult,
  RadarSortMode, RadarTimeWindow,
} from '../types';

// Client side of Content Radar. Every call here costs money on the server, so
// each one is tied to a deliberate user action - never to typing, a filter
// change, or a tab switch.

export interface RadarScanInput {
  query: string;
  timeWindow: RadarTimeWindow;
  limit: number;
  sort: RadarSortMode;
  /** Floors on the numbers: 0 means no floor. Competitor mode only. */
  minViews?: number;
  minLikes?: number;
}

export interface RadarKeywordScanInput {
  platform: RadarPlatform;
  /** One provider call per keyword, so this list is what a scan costs. */
  queries: string[];
  timeWindow: RadarTimeWindow;
  /** Per keyword, not across the whole scan - it is what the provider takes. */
  limit: number;
  sort: RadarSortMode;
}

/** Mode A. One provider call per keyword; results merged and de-duplicated. */
export const scanByKeyword = (input: RadarKeywordScanInput): Promise<RadarScanResult> =>
  postJson<RadarScanResult>('/api/radar/search', {
    ...input,
    // Keys the user saved in Tích hợp, by source. Never bundled, never stored
    // on the server - they travel with the request that spends them, and the
    // server picks which source to use.
    dataKeys: getRadarKeys(input.platform),
    source: getPlatformSource(input.platform) === 'auto' ? '' : getPlatformSource(input.platform),
    // Used only to translate a non-Chinese keyword; the server falls back to its
    // own key, and to the untranslated keyword, when this is missing.
    apiKey: getGeminiApiKey(),
  });

export type SuggestionTier = 'chinh' | 'phu' | 'mo-rong';

export interface KeywordSuggestion {
  keyword: string;
  tier: SuggestionTier;
  note: string | null;
  /** One line on why this keyword is worth a scan. */
  why: string | null;
}

/**
 * Turns a broad topic into concrete search terms for the chosen platform,
 * grouped by how broad they are.
 *
 * The active brand goes with the request so suggestions fit the user's niche
 * rather than the topic in the abstract - the difference between "chatgpt" and
 * "chatgpt cho dân văn phòng". Costs a cheap LLM call and no provider run, so it
 * stays usable even when the data source is unavailable.
 */
export const suggestKeywords = (input: {
  query: string;
  platform: RadarPlatform;
  timeWindow: RadarTimeWindow;
  brand?: BrandProfile | null;
  /** 'creator' asks for short terms that match one creator's own captions. */
  scope?: 'search' | 'creator';
  /** Captions already on screen, so the ideas come from what they really post. */
  samples?: string[];
}): Promise<{
  topic: string;
  platform: string;
  suggestions: KeywordSuggestion[];
  cached: boolean;
}> => postJson('/api/radar/suggest-keywords', { ...input, apiKey: getGeminiApiKey() });

/** Mode B step 1. Resolves a pasted profile URL for free; a name costs one run. */
export const findCreators = (platform: RadarPlatform, query: string): Promise<{
  platform: string;
  resolved: boolean;
  candidates: RadarCreatorCandidate[];
}> => postJson('/api/radar/creators', {
  platform,
  query,
  dataKeys: getRadarKeys(platform),
  source: getPlatformSource(platform) === 'auto' ? '' : getPlatformSource(platform),
});

/**
 * Mode B step 2, after the user has picked a creator. One provider run.
 *
 * `query` is optional: empty means "their best recent videos", a keyword means
 * "only what they posted about this topic". Either way it is one call.
 */
export const scanCreator = (
  input: RadarScanInput & { ref: string; platform: RadarPlatform }
): Promise<RadarScanResult> =>
  postJson<RadarScanResult>('/api/radar/creator-videos', {
    platform: input.platform,
    ref: input.ref,
    query: input.query,
    minViews: input.minViews || 0,
    minLikes: input.minLikes || 0,
    timeWindow: input.timeWindow,
    limit: input.limit,
    sort: input.sort,
    dataKeys: getRadarKeys(input.platform),
    source: getPlatformSource(input.platform) === 'auto' ? '' : getPlatformSource(input.platform),
    // Only used to translate a keyword aimed at a Douyin creator.
    apiKey: getGeminiApiKey(),
  });

// ---------------------------------------------------------------------------
// Display helpers, kept beside the service so every Radar surface formats
// numbers the same way.

export const formatCount = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
};

export const formatRelativeTime = (iso: string | null): string => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';

  const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  return `${days} ngày trước`;
};

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** A creator's page, when the provider gave us enough to build one safely. */
export const creatorProfileUrl = (content: RadarContent): string | null => content.creator.profileUrl;
