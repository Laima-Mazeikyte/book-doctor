/** Books generated per `feed_requests` row by the feed backend. */
export const FEED_REQUEST_BATCH_SIZE = 50;

/** Minimum time between client-initiated `feed_requests` inserts on `/rate`. */
export const FEED_REQUEST_CREATE_COOLDOWN_MS = 2000;

/** Minimum dwell time before scroll progress can unlock the next automatic feed request. */
export const FEED_BATCH_BROWSE_DWELL_MS = 2000;

/** Row progress through the current feed batch needed before prefetching another batch. */
export const FEED_BATCH_PROGRESS_FULL = 0.45;

/** Lower row progress accepted when the user is already near the bottom of the list. */
export const FEED_BATCH_PROGRESS_NEAR_BOTTOM = 0.25;

/** Distance from document bottom that counts as near-bottom browse progress. */
export const FEED_NEAR_BOTTOM_PX = 800;

/** Consecutive duplicate/empty feed appends before auto-pagination stops. */
export const FEED_MAX_CONSECUTIVE_EMPTY_APPENDS = 2;
