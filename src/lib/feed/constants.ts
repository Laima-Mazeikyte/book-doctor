/** Books generated per `feed_requests` row by the feed backend. */
export const FEED_REQUEST_BATCH_SIZE = 50;

/** Deadline for a shared feed read, including response-body consumption. */
export const FEED_READ_TIMEOUT_MS = 10_000;

/** Minimum time between client-initiated `feed_requests` inserts on `/rate`. */
export const FEED_REQUEST_CREATE_COOLDOWN_MS = 2000;

/** Minimum dwell time before scroll progress can unlock the next automatic feed request. */
export const FEED_BATCH_BROWSE_DWELL_MS = 2000;

/** Browsing runway to cover generation, polling, and network time. */
export const FEED_PREFETCH_RUNWAY_SECONDS = 7;

/** Automatic loading becomes an explicit Load more after this many new visible books. */
export const FEED_BROWSE_CHECKPOINT = 150;

/** Consecutive duplicate/empty feed appends before auto-pagination stops. */
export const FEED_MAX_CONSECUTIVE_EMPTY_APPENDS = 2;
