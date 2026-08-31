// The contract every Content Radar provider implements.
//
// The Radar service, the score, the sorting and the creator roll-up all speak
// RadarContent and nothing else. Adding TikTok or Xiaohongshu later means
// writing one more file in this folder and registering it - no change to the
// UI, the ranking or the aggregation.

/**
 * @typedef {Object} RadarCreator
 * @property {string|null} id
 * @property {string|null} username
 * @property {string|null} nickname
 * @property {number|null} followerCount
 * @property {string|null} avatarUrl
 * @property {string|null} profileUrl
 */

/**
 * @typedef {Object} RadarMetrics
 * @property {number} likes
 * @property {number} comments
 * @property {number} shares
 * @property {number|null} collects
 */

/**
 * A single piece of content, provider-agnostic.
 *
 * Deliberately has no `views`: Douyin reports playCount = 0 on every search
 * row, and inventing or separately fetching that number is out of scope.
 *
 * @typedef {Object} RadarContent
 * @property {string} id
 * @property {string} platform
 * @property {string|null} caption
 * @property {string|null} publishedAt   ISO 8601
 * @property {RadarCreator} creator
 * @property {RadarMetrics} metrics
 * @property {string|null} thumbnailUrl
 * @property {string} videoUrl           canonical page URL, never an expiring CDN URL
 * @property {string[]} hashtags
 * @property {number|null} duration      seconds
 * @property {boolean|null} isAd
 * @property {number} [radarScore]       attached by the service, not the provider
 * @property {{likeFollowerRatio: number|null, shareFollowerRatio: number|null}} [radarSignals]
 */

/**
 * A creator match offered to the user in competitor mode. `ref` is whatever the
 * provider needs to fetch that creator's videos later - opaque to the caller.
 *
 * @typedef {Object} RadarCreatorCandidate
 * @property {string} ref
 * @property {string|null} id
 * @property {string|null} username
 * @property {string|null} nickname
 * @property {number|null} followerCount
 * @property {string|null} avatarUrl
 * @property {string|null} profileUrl
 */

/**
 * @typedef {Object} RadarProvider
 * @property {string} id
 * @property {string} label
 * @property {{searchByKeyword: boolean, searchCreators: boolean, getCreatorVideos: boolean}} capabilities
 * @property {(opts: {query: string, limit: number, sort: string, windowId: string}) => Promise<RadarContent[]>} searchByKeyword
 * @property {(opts: {query: string}) => Promise<RadarCreatorCandidate[]>} searchCreators
 * @property {(opts: {ref: string, limit: number, windowId: string}) => Promise<RadarContent[]>} getCreatorVideos
 * @property {(input: string) => string|null} [parseCreatorRef] turns a pasted profile URL into a ref
 */

export const CAPABILITIES = ['searchByKeyword', 'searchCreators', 'getCreatorVideos'];
