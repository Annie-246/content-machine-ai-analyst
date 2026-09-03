export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'deepseek';

// The three kinds of work the app sends to a model.
export type Capability = 'video' | 'text' | 'image';

export interface CapabilityInfo {
  id: Capability;
  label: string;
  desc: string;
}

export const CAPABILITIES: CapabilityInfo[] = [
  { id: 'video', label: 'Phân tích video', desc: 'Remake kịch bản, phân tích sâu video, trích script' },
  { id: 'text', label: 'Nội dung văn bản', desc: 'Phân tích bài viết, remake bài viết, tạo kịch bản từ ý tưởng' },
  { id: 'image', label: 'Tạo hình ảnh', desc: 'Sinh ảnh và thumbnail' },
];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  hint: string;
  keyPrefix: string;
  docsUrl: string;
  defaultModel: string;
  // What this provider can actually do inside this app today.
  supports: Capability[];
  // Why a capability is unavailable, shown on the disabled button.
  unsupportedReason: Partial<Record<Capability, string>>;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    hint: 'Nhà cung cấp duy nhất đọc được video trực tiếp.',
    keyPrefix: 'AIza',
    docsUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.6-flash',
    supports: ['video', 'text', 'image'],
    unsupportedReason: {},
  },
  {
    id: 'openai',
    name: 'OpenAI',
    hint: 'Dùng tốt cho nội dung văn bản.',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5.6-terra',
    supports: ['text'],
    unsupportedReason: {
      video: 'OpenAI không nhận video làm đầu vào',
      image: 'Chưa nối phần sinh ảnh của OpenAI vào app',
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    hint: 'Dùng tốt cho nội dung văn bản dài, giọng văn tự nhiên.',
    keyPrefix: 'sk-ant-',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-5',
    supports: ['text'],
    unsupportedReason: {
      video: 'Claude không nhận video làm đầu vào',
      image: 'Claude không sinh ảnh',
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hint: 'Chi phí thấp, phù hợp khối lượng văn bản lớn.',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-v4-flash',
    supports: ['text'],
    unsupportedReason: {
      video: 'DeepSeek chỉ nhận ảnh tĩnh, không đọc được video hay âm thanh',
      image: 'DeepSeek không sinh ảnh',
    },
  },
];

export const getProvider = (id: ProviderId): ProviderInfo =>
  PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

const STORAGE_KEY = 'cm_api_providers';

export interface ProviderSettings {
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  // Which provider handles which kind of work.
  assignments: Record<Capability, ProviderId>;
  // Where the API lives. Empty means "same site as this page", which is right
  // whenever the frontend and the server are deployed together.
  serverUrl?: string;
  serverToken?: string;
}

const DEFAULT_SETTINGS: ProviderSettings = {
  keys: {},
  models: {},
  assignments: { video: 'gemini', text: 'gemini', image: 'gemini' },
  serverUrl: '',
  serverToken: '',
};

export const loadProviderSettings = (): ProviderSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      keys: parsed.keys || {},
      models: parsed.models || {},
      assignments: { ...DEFAULT_SETTINGS.assignments, ...(parsed.assignments || {}) },
      serverUrl: parsed.serverUrl || '',
      serverToken: parsed.serverToken || '',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveProviderSettings = (settings: ProviderSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Không lưu được cấu hình API key', e);
  }
};

export const getApiKey = (id: ProviderId): string => {
  const saved = loadProviderSettings().keys[id];
  if (saved && saved.trim()) return saved.trim();
  // Gemini also falls back to the key baked in at build time.
  if (id === 'gemini') return process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  return '';
};

export const getGeminiApiKey = (): string => getApiKey('gemini');

export interface ResolvedProvider {
  id: ProviderId;
  name: string;
  apiKey: string;
  model: string;
}

// Returns the provider assigned to a capability, falling back to Gemini when
// the assigned one has no key saved.
export const resolveProvider = (capability: Capability): ResolvedProvider => {
  const settings = loadProviderSettings();
  const assigned = settings.assignments[capability] || 'gemini';
  const info = getProvider(assigned);
  const key = getApiKey(assigned);

  if (!key || !info.supports.includes(capability)) {
    const fallback = getProvider('gemini');
    return {
      id: 'gemini',
      name: fallback.name,
      apiKey: getApiKey('gemini'),
      model: settings.models.gemini || fallback.defaultModel,
    };
  }

  return {
    id: assigned,
    name: info.name,
    apiKey: key,
    model: settings.models[assigned] || info.defaultModel,
  };
};

export const maskKey = (key: string): string => {
  if (key.length <= 10) return '••••••';
  return `${key.slice(0, 6)}${'•'.repeat(12)}${key.slice(-4)}`;
};

// Base URL of the API server. A value saved in the app wins; otherwise the
// build-time default; otherwise the site the page is served from.
export const getServerUrl = (): string => {
  const saved = loadProviderSettings().serverUrl;
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  const fromEnv = process.env.API_BASE_URL || '';
  return fromEnv.replace(/\/+$/, '');
};

export const getServerToken = (): string => (loadProviderSettings().serverToken || '').trim();

// ---------------------------------------------------------------------------
// Data sources (Content Radar)
//
// These are not LLM providers - they are the services that supply social data.
// One key normally covers every platform, because a single Apify account runs
// every actor. A per-platform override exists for the case where someone wants
// to bill a platform to a separate account.

export type DataProviderId = 'tikhub' | 'apify' | 'google';

export interface DataProviderInfo {
  id: DataProviderId;
  name: string;
  hint: string;
  keyPrefix: string;
  docsUrl: string;
  /** Platforms this source can serve today. */
  platforms: string[];
}

export const DATA_PROVIDERS: DataProviderInfo[] = [
  {
    id: 'tikhub',
    name: 'TikHub',
    hint: 'Tính tiền theo request (~$0.01 cho cả trang kết quả). Rẻ hơn nhiều khi quét từ khoá.',
    keyPrefix: '',
    docsUrl: 'https://user.tikhub.io/dashboard/api',
    platforms: ['douyin'],
  },
  {
    id: 'apify',
    name: 'Apify',
    hint: 'Tính tiền theo từng video (~$0.005/video). Quét đối thủ chạy được cả trên gói free.',
    keyPrefix: 'apify_api_',
    docsUrl: 'https://console.apify.com/settings/integrations',
    platforms: ['douyin'],
  },
  {
    id: 'google',
    name: 'Google (YouTube Data API)',
    hint: 'Miễn phí, 10.000 đơn vị quota/ngày (~98 lần quét). Bật YouTube Data API v3 cho project.',
    keyPrefix: 'AIza',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    platforms: ['youtube'],
  },
];

/**
 * Platforms the Radar can scan and which sources can serve each one, in order
 * of preference. 'auto' picks the first source that has a key.
 */
export const RADAR_PLATFORMS: { id: string; label: string; sources: DataProviderId[] }[] = [
  { id: 'douyin', label: 'Douyin', sources: ['tikhub', 'apify'] },
  { id: 'tiktok', label: 'TikTok', sources: ['tikhub'] },
  { id: 'youtube', label: 'YouTube', sources: ['google'] },
  { id: 'instagram', label: 'Instagram', sources: ['tikhub'] },
];

export const getDataProvider = (id: DataProviderId): DataProviderInfo =>
  DATA_PROVIDERS.find((p) => p.id === id) || DATA_PROVIDERS[0];

const readSettings = (): any => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeSettings = (patch: Record<string, unknown>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSettings(), ...patch }));
  } catch (e) {
    console.error('Không lưu được cấu hình nguồn dữ liệu', e);
  }
};

/** The shared key for a data source, used by every platform it serves. */
export const getDataKey = (id: DataProviderId): string => (readSettings().dataKeys?.[id] || '').trim();

export const setDataKey = (id: DataProviderId, key: string): void => {
  writeSettings({ dataKeys: { ...(readSettings().dataKeys || {}), [id]: key.trim() } });
};

/**
 * Optional per-platform override of a source's shared key. Empty means "use the
 * shared one". Keyed by platform AND source, so someone can bill Douyin-via-
 * TikHub to one account and Douyin-via-Apify to another.
 */
const overrideKey = (platform: string, source: DataProviderId) => `${platform}:${source}`;

export const getPlatformKeyOverride = (platform: string, source: DataProviderId): string =>
  (readSettings().platformKeys?.[overrideKey(platform, source)] || '').trim();

export const setPlatformKeyOverride = (platform: string, source: DataProviderId, key: string): void => {
  writeSettings({
    platformKeys: { ...(readSettings().platformKeys || {}), [overrideKey(platform, source)]: key.trim() },
  });
};

/** Which source a platform should use. 'auto' = first one with a key. */
export type RadarSourceChoice = DataProviderId | 'auto';

export const getPlatformSource = (platform: string): RadarSourceChoice =>
  (readSettings().platformSources?.[platform] as RadarSourceChoice) || 'auto';

export const setPlatformSource = (platform: string, source: RadarSourceChoice): void => {
  writeSettings({ platformSources: { ...(readSettings().platformSources || {}), [platform]: source } });
};

/** The key for one source on one platform: override first, then the shared key. */
export const getSourceKey = (platform: string, source: DataProviderId): string =>
  getPlatformKeyOverride(platform, source) || getDataKey(source);

/**
 * Every key the server may need for this platform, by source id. The server
 * decides which one to spend, so it can fall back when the preferred source has
 * no key saved.
 */
export const getRadarKeys = (platform: string): Partial<Record<DataProviderId, string>> => {
  const entry = RADAR_PLATFORMS.find((p) => p.id === platform);
  const out: Partial<Record<DataProviderId, string>> = {};
  for (const source of entry?.sources || []) {
    const key = getSourceKey(platform, source);
    if (key) out[source] = key;
  }
  return out;
};
