/** Approved 404 copy. Asterisks mark inline emphasis, rendered as text and <em>. */
export const NOT_FOUND_QUOTES = [
	'Have you tried turning the book off and on again?',
	'Readers who found this page also found nothing.',
	'This is a plot hole.',
	'The web is dark and full of broken links.',
	'Task failed successfully.',
	'We’re calling it experimental literature.',
	'Based on your interest in this page, may we recommend a page that exists?',
	'People who searched for this also searched for meaning.',
	'The answer is 42. The error is 404.',
	'Your disappointment is immeasurable.',
	'It’s not a bug. It’s an unreliable narrator.',
	'I have no memory of this book.',
	'Big Book doesn’t want you to find this page.',
	'This page was deleted for character development.',
	'We’ve removed the chapter to improve loading times.',
	'Content warning: no content.',
	'The abridged edition went a little too far.',
	'We’ve personalized this absence just for you.',
	'The algorithm has entered its absurdist phase.',
	'Your request has been forwarded to the void.',
	'Recommended for fans of *Waiting for Godot*.',
	'Your suspension of disbelief has timed out.',
	'To read, or not to read. The server has decided.',
	'Impossible to put down. Or load.',
	'Please enable imagination in your browser settings.',
	'Finding this page is left as an exercise for the reader.',
	'The fourth wall was load-bearing.',
	'We regret that your URL does not meet our editorial needs.',
	'This page has been shortlisted for existence.'
] as const;

/** A refresh gets a new document seed; each missing path has one stable quote. */
export function notFoundQuote(seed: number, pathname: string): string {
	let hash = seed >>> 0;
	for (const character of pathname) {
		hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
	}
	return NOT_FOUND_QUOTES[hash % NOT_FOUND_QUOTES.length];
}
