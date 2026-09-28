/**
 * The 25 readers "Test your skill" shows, always in this order; the release's reader file holds
 * exactly these. All come from the 100 readers with up to 122 rated books, who have lists from
 * all three recommenders. Fifteen were found by someone, in the benchmark's proportions: Unread
 * finds 11, ChatGPT 5 and Hardcover 5 (15, 7 and 6 of those 100 readers), and the mix of
 * Unread-only wins, overlaps and the others' own wins matches too. Ten were missed by all,
 * spread across history lengths. Every book on show is in our catalog, except one ChatGPT or
 * Hardcover pick for readers 12, 32 and 98, kept for the wins they show.
 */
export const SHOWCASE_READER_IDS: readonly string[] = [
	// Found by someone: two of Unread's solo wins open, then a mix.
	'user_0041', // Unread only
	'user_0028', // Unread only
	'user_0049', // all three
	'user_0038', // Hardcover only
	'user_0072', // Unread only
	'user_0024', // ChatGPT only
	'user_0050', // Unread and Hardcover
	'user_0091', // Unread only
	'user_0032', // Unread and ChatGPT
	'user_0012', // Hardcover only
	'user_0079', // Unread only
	'user_0098', // ChatGPT only
	'user_0077', // Unread only
	'user_0093', // all three
	'user_0058', // Unread only
	// Missed by all, alternating shorter and longer histories.
	'user_0031',
	'user_0081',
	'user_0040',
	'user_0064',
	'user_0045',
	'user_0063',
	'user_0006',
	'user_0078',
	'user_0033',
	'user_0054'
];
