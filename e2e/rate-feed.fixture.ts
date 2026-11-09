import { expect, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

export const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const authKey = `sb-${new URL(env.VITE_SUPABASE_URL || env.PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const owner = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const books = Array.from({ length: 1200 }, (_, index) => ({
	id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
	book_id: `01${String(index + 1).padStart(24, '0')}`,
	title: `Virtual Book ${index}`,
	author: 'Virtual Author',
	summary: `Description for book ${index}.`
}));

export async function setup(page: Page, { initialCount = 1000 } = {}) {
	const session = {
		access_token: 'virtual-feed-token',
		refresh_token: 'test-refresh',
		token_type: 'bearer',
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		user: {
			id: owner,
			is_anonymous: false,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'virtual@example.com',
			app_metadata: {},
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
	await page.addInitScript(
		({ authKey, session }) => localStorage.setItem(authKey, JSON.stringify(session)),
		{ authKey, session }
	);
	const state = {
		jobs: 0,
		writes: 0,
		polls: 0,
		latestReads: 0,
		release: () => {},
		status: 'completed',
		searchBooks: [] as typeof books,
		returnedBooks: null as typeof books | null
	};
	const completed = new Promise<void>((resolve) => {
		state.release = resolve;
	});
	await page.route('**/auth/v1/**', (route) => route.fulfill({ json: session }));
	await page.route('**/functions/v1/**', (route) =>
		route.fulfill({
			json: {
				hits: state.searchBooks.map((book) => ({ book_id: book.book_id })),
				estimatedTotalHits: state.searchBooks.length
			}
		})
	);
	await page.route('**/rest/v1/**', async (route) => {
		const request = route.request();
		const table = new URL(request.url()).pathname.split('/').at(-1);
		if (request.method() !== 'GET') {
			if (table === 'feed_requests') {
				state.jobs++;
				return route.fulfill({ json: { public_id: `FeedRun${state.jobs}` } });
			}
			state.writes++;
			return route.fulfill({ status: 204, body: '' });
		}
		if (table === 'feed_requests') return route.fulfill({ json: [] });
		if (table === 'books')
			return route.fulfill({
				json: state.searchBooks.map((book) => ({ ...book, book_name: book.title }))
			});
		const data =
			table === 'user_ratings'
				? [
						{
							book_id: 'prior-ulid',
							book_rating: 4,
							books: {
								id: 'prior-uuid',
								book_id: 'prior-ulid',
								book_name: 'Prior book',
								author: 'Author'
							}
						}
					]
				: [];
		return route.fulfill({
			json: data,
			headers: {
				'content-range': `*/${data.length}`,
				'access-control-expose-headers': 'content-range'
			}
		});
	});
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/feed/latest') {
			state.latestReads++;
			return route.fulfill({
				json: {
					mode: 'has_eligible_feed',
					books: books.slice(0, initialCount),
					request_id: 'FeedRunA',
					latest_request_id: 'FeedRunA',
					latest_request_status: 'completed',
					latest_request_error_message: null,
					ratings_count: 1,
					interaction_count: 1,
					eligible_for_feed: true,
					status: 'completed',
					error_message: null
				}
			});
		}
		if (url.pathname === '/api/feed') {
			state.polls++;
			const job = state.jobs;
			await completed;
			return route.fulfill({
				json: {
					request_id: `FeedRun${job}`,
					status: state.status,
					books:
						state.returnedBooks ??
						books.slice(initialCount + (job - 1) * 50, initialCount + job * 50)
				}
			});
		}
		return route.fulfill({ json: { books: [], count: 0 } });
	});
	return state;
}

export async function jump(page: Page, index: number) {
	await page.evaluate((index) => {
		const list = document.querySelector<HTMLElement>('.virtual-feed')!;
		const style = getComputedStyle(list);
		const columns = style.gridTemplateColumns.split(/\s+/).length;
		const height = list
			.querySelector<HTMLElement>('[data-feed-book]')!
			.getBoundingClientRect().height;
		window.scrollTo(
			0,
			window.scrollY +
				list.getBoundingClientRect().top +
				Math.floor(index / columns) * (height + parseFloat(style.rowGap)) +
				5
		);
	}, index);
	await expect(page.locator(`[data-feed-index="${index}"]`)).toBeInViewport();
}
