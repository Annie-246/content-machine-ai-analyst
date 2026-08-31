// Creator roll-up for the Creator tab.
//
// Built purely from the rows already fetched - opening the tab must not trigger
// another provider run. That means the numbers here describe "this creator
// inside these results", not the creator's whole channel, and the UI wording
// has to say so.

const keyOf = (creator) =>
  creator?.id || creator?.username || creator?.nickname || null;

/**
 * One entry per creator appearing in the result set, sorted by their single
 * best Radar Score - the question a user has here is "who is breaking out",
 * not "who posted most".
 */
export const aggregateCreators = (items) => {
  const byCreator = new Map();

  for (const item of items) {
    const key = keyOf(item?.creator);
    if (!key) continue;

    let row = byCreator.get(key);
    if (!row) {
      row = {
        key,
        id: item.creator.id ?? null,
        username: item.creator.username ?? null,
        nickname: item.creator.nickname ?? null,
        followerCount: item.creator.followerCount ?? null,
        avatarUrl: item.creator.avatarUrl ?? null,
        profileUrl: item.creator.profileUrl ?? null,
        contentCount: 0,
        totalLikes: 0,
        totalShares: 0,
        bestRadarScore: 0,
        bestContent: null,
      };
      byCreator.set(key, row);
    }

    row.contentCount += 1;
    row.totalLikes += item.metrics?.likes ?? 0;
    row.totalShares += item.metrics?.shares ?? 0;

    // A later row may carry a follower count an earlier one lacked.
    if (row.followerCount === null && item.creator.followerCount !== null) {
      row.followerCount = item.creator.followerCount;
    }
    if (!row.avatarUrl && item.creator.avatarUrl) row.avatarUrl = item.creator.avatarUrl;
    if (!row.profileUrl && item.creator.profileUrl) row.profileUrl = item.creator.profileUrl;

    const score = item.radarScore ?? 0;
    if (!row.bestContent || score > row.bestRadarScore) {
      row.bestRadarScore = score;
      row.bestContent = item;
    }
  }

  return [...byCreator.values()]
    .map((row) => ({
      ...row,
      averageLikes: row.contentCount ? Math.round(row.totalLikes / row.contentCount) : 0,
    }))
    .sort((a, b) => b.bestRadarScore - a.bestRadarScore || b.contentCount - a.contentCount);
};
