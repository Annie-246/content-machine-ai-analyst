// Provider registry.
//
// A platform can be served by more than one data source. They all return the
// same RadarContent, so everything above this layer is unaffected by which one
// answers.
//
// Order matters: the first source with a usable key wins when the user has not
// pinned one. Douyin leads with TikHub because a 20-result scan costs ~$0.01
// there against ~$0.10 on Apify.

import { douyinApifyProvider } from './douyinApify.mjs';
import { tikhubDouyinProvider } from './tikhubDouyin.mjs';
import { tiktokTikhubProvider } from './tiktokTikhub.mjs';
import { instagramTikhubProvider } from './instagramTikhub.mjs';
import { youtubeProvider } from './youtubeData.mjs';

const PROVIDERS = [
  tikhubDouyinProvider,
  douyinApifyProvider,
  tiktokTikhubProvider,
  youtubeProvider,
  instagramTikhubProvider,
];

export const getProvidersForPlatform = (platform) =>
  PROVIDERS.filter((p) => p.platform === platform);

export const getProviderBySource = (platform, source) =>
  PROVIDERS.find((p) => p.platform === platform && p.source === source) || null;

export const listPlatforms = () => [...new Set(PROVIDERS.map((p) => p.platform))];

export const listProviders = () => [...PROVIDERS];
