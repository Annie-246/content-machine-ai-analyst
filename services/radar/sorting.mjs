// Sorting runs entirely on data the browser already holds. Changing the sort
// must never cost another provider run.

import { engagementVolume } from './ranking.mjs';

const publishedTime = (item) => {
  const t = Date.parse(item?.publishedAt || '');
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * - `recommended`: Radar Score, the audience-relative ranking.
 * - `engagement`: raw weighted volume (shares and collects outweigh likes).
 * - `latest`: newest first.
 *
 * Every mode falls back to engagement volume to break ties, so equal scores
 * still come out in a stable, sensible order.
 */
export const sortRadarContent = (items, mode) => {
  const list = items.slice();

  switch (mode) {
    case 'latest':
      return list.sort((a, b) => publishedTime(b) - publishedTime(a) || engagementVolume(b) - engagementVolume(a));
    case 'engagement':
      return list.sort((a, b) => engagementVolume(b) - engagementVolume(a) || (b.radarScore || 0) - (a.radarScore || 0));
    case 'recommended':
    default:
      return list.sort((a, b) => (b.radarScore || 0) - (a.radarScore || 0) || engagementVolume(b) - engagementVolume(a));
  }
};
