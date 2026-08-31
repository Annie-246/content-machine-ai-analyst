// Local time-window filtering.
//
// The provider's own publish-time filter is coarser than the windows this
// product offers, so we ask for exactly N raw rows and narrow them here. What
// survives, survives - we never go back for more, because every extra row is
// billed.

import { getTimeWindow } from './constants.mjs';

/**
 * Keeps rows published inside the window. Rows with no usable publish date are
 * dropped: showing undated content in a "last 24 hours" list would be a lie.
 */
export const filterByTimeWindow = (items, windowId, now = Date.now()) => {
  const win = getTimeWindow(windowId);
  if (!win) return items.slice();

  const cutoff = now - win.hours * 3_600_000;

  return items.filter((item) => {
    if (!item?.publishedAt) return false;
    const t = Date.parse(item.publishedAt);
    if (Number.isNaN(t)) return false;
    return t >= cutoff;
  });
};
