import { postJson } from './apiClient';
import { getGeminiApiKey, getPlatformSource, getRadarKeys } from './apiKeyStore';
import type {
  RadarContent, RadarCreatorCandidate, RadarScanResult, RadarSortMode, RadarTimeWindow,
} from '../types';

// Client side of Content Radar. Every call here costs money on the server, so
// each one is tied to a deliberate user action - never to typing, a filter
// change, or a tab switch.

export interface RadarScanInput {
  query: string;
  timeWindow: RadarTimeWindow;
  limit: number;
  sort: RadarSortMode;
}

/** Mode A. One provider run. */
export const scanByKeyword = (input: RadarScanInput): Promise<RadarScanResult> =>
  postJson<RadarScanResult>('/api/radar/search', {
    platform: 'douyin',
    ...input,
    // Keys the user saved in Tích hợp, by source. Never bundled, never stored
    // on the server - they travel with the request that spends them, and the
    // server picks which source to use.
    dataKeys: getRadarKeys('douyin'),
    source: getPlatformSource('douyin') === 'auto' ? '' : getPlatformSource('douyin'),
    // Used only to translate a non-Chinese keyword; the server falls back to its
    // own key, and to the untranslated keyword, when this is missing.
    apiKey: getGeminiApiKey(),
  });

export interface KeywordSuggestion {
  keyword: string;
  note: string | null;
}

/**
 * Turns a broad topic into concrete Chinese search terms. Costs a cheap LLM
 * call and no Apify run, so it is safe to offer before the user commits to a
 * scan - and it still works when the data source is unavailable.
 */
export const suggestKeywords = (query: string): Promise<{
  topic: string;
  suggestions: KeywordSuggestion[];
  cached: boolean;
}> => postJson('/api/radar/suggest-keywords', { query, apiKey: getGeminiApiKey() });

/** Mode B step 1. Resolves a pasted profile URL for free; a name costs one run. */
export const findCreators = (query: string): Promise<{
  platform: string;
  resolved: boolean;
  candidates: RadarCreatorCandidate[];
}> => postJson('/api/radar/creators', {
  platform: 'douyin',
  query,
  dataKeys: getRadarKeys('douyin'),
  source: getPlatformSource('douyin') === 'auto' ? '' : getPlatformSource('douyin'),
});

/** Mode B step 2, after the user has picked a creator. One provider run. */
export const scanCreator = (input: RadarScanInput & { ref: string }): Promise<RadarScanResult> =>
  postJson<RadarScanResult>('/api/radar/creator-videos', {
    platform: 'douyin',
    ref: input.ref,
    timeWindow: input.timeWindow,
    limit: input.limit,
    sort: input.sort,
    dataKeys: getRadarKeys('douyin'),
    source: getPlatformSource('douyin') === 'auto' ? '' : getPlatformSource('douyin'),
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
